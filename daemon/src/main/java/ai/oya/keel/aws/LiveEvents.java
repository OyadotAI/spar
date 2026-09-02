package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
import ai.oya.keel.Events;
import ai.oya.keel.State;
import ai.oya.keel.StateController;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import software.amazon.awssdk.awscore.exception.AwsServiceException;
import software.amazon.awssdk.services.eventbridge.model.RuleState;
import software.amazon.awssdk.services.eventbridge.model.Target;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;
import software.amazon.awssdk.services.sqs.model.QueueDoesNotExistException;

/**
 * The accelerator: an SQS queue fed by two EventBridge rules — Glue's own run-state events (only
 * terminal states, no trail needed) and CloudTrail API-call events (CreateJob, UpdateJob, DeleteJob,
 * StartJobRun, BatchStopJobRun — delivered only if the account has a trail). A long-poll receiver
 * turns each message into one targeted Glue call and one bus event, ~1–2s after the fact. Everything
 * is named after this install so two machines never steal each other's messages.
 */
@RestController
@Order(2)
public class LiveEvents implements StateController.StateContributor {
    private static final Logger log = LoggerFactory.getLogger(LiveEvents.class);
    static final String GLUE_PATTERN = "{\"source\":[\"aws.glue\"],\"detail-type\":[\"Glue Job State Change\",\"Glue Job Run Status\"]}";
    static final String API_PATTERN = "{\"source\":[\"aws.glue\"],\"detail-type\":[\"AWS API Call via CloudTrail\"],"
            + "\"detail\":{\"eventName\":[\"CreateJob\",\"UpdateJob\",\"DeleteJob\",\"StartJobRun\",\"BatchStopJobRun\"]}}";

    private final AwsClients aws;
    private final State state;
    private final Sync sync;
    private final GlueService glue;
    private final Events events;
    private final ObjectMapper json;

    private volatile String queueUrl;
    private volatile String probedFor = "";
    private volatile String trail = "unknown";
    private volatile Instant lastEventAt;
    private volatile String error;
    private volatile Thread receiver;

    public LiveEvents(AwsClients aws, State state, Sync sync, GlueService glue, Events events, ObjectMapper json) {
        this.aws = aws; this.state = state; this.sync = sync; this.glue = glue; this.events = events; this.json = json;
    }

    String prefix() { return "keel-live-" + state.installId(); }

    @PostConstruct
    void start() {
        Thread.ofVirtual().name("live-probe").start(() -> {
            while (true) {
                try {
                    String p = state.profile();
                    if (p != null && !p.isBlank()) {
                        String key = p + "@" + aws.region();
                        if (!key.equals(probedFor)) { probedFor = key; stopReceiver(); queueUrl = null; probe(); }
                    }
                } catch (RuntimeException e) { error = short_(e); }
                try { Thread.sleep(5000); } catch (InterruptedException e) { return; }
            }
        });
    }

    private void probe() {
        try {
            queueUrl = aws.sqs().getQueueUrl(b -> b.queueName(prefix())).queueUrl();
            startReceiver();
        } catch (QueueDoesNotExistException e) {
            queueUrl = null;
        }
    }

    @GetMapping("/api/live")
    public Map<String, Object> status() {
        Map<String, Object> m = new LinkedHashMap<>();
        sync.contribute(m);
        @SuppressWarnings("unchecked") Map<String, Object> live = (Map<String, Object>) m.get("live");
        live.put("push", push());
        return live;
    }

    @PostMapping("/api/live/enable")
    public Map<String, Object> enable() {
        try {
            String account = aws.sts().getCallerIdentity().account();
            String region = aws.region();
            String name = prefix();
            String url = aws.sqs().createQueue(b -> b.queueName(name).attributes(Map.of(QueueAttributeName.MESSAGE_RETENTION_PERIOD, "86400"))).queueUrl();
            String queueArn = aws.sqs().getQueueAttributes(b -> b.queueUrl(url).attributeNames(QueueAttributeName.QUEUE_ARN)).attributes().get(QueueAttributeName.QUEUE_ARN);
            String glueRule = aws.eventBridge().putRule(b -> b.name(name + "-glue").eventPattern(GLUE_PATTERN).state(RuleState.ENABLED)
                    .description("Keel: Glue job run state changes")).ruleArn();
            String apiRule = aws.eventBridge().putRule(b -> b.name(name + "-api").eventPattern(API_PATTERN).state(RuleState.ENABLED)
                    .description("Keel: Glue job API calls via CloudTrail")).ruleArn();
            for (String rule : List.of(name + "-glue", name + "-api"))
                aws.eventBridge().putTargets(b -> b.rule(rule).targets(Target.builder().id("keel").arn(queueArn).build()));
            String policy = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"events.amazonaws.com\"},"
                    + "\"Action\":\"sqs:SendMessage\",\"Resource\":\"" + queueArn + "\",\"Condition\":{\"ArnEquals\":{\"aws:SourceArn\":[\""
                    + glueRule + "\",\"" + apiRule + "\"]}}}]}";
            aws.sqs().setQueueAttributes(b -> b.queueUrl(url).attributes(Map.of(QueueAttributeName.POLICY, policy)));
            log.info("live: enabled push for account {} in {} via {}", account, region, url);
            queueUrl = url;
            error = null;
            checkTrail();
            startReceiver();
            emit();
            return status();
        } catch (AwsServiceException e) {
            throw new ApiError(403, "could not create the queue or rules: " + e.awsErrorDetails().errorMessage(),
                    "the profile needs sqs:CreateQueue, sqs:SetQueueAttributes, events:PutRule, events:PutTargets");
        }
    }

    @PostMapping("/api/live/disable")
    public Map<String, Object> disable() {
        String name = prefix();
        stopReceiver();
        try {
            for (String rule : List.of(name + "-glue", name + "-api")) {
                try { aws.eventBridge().removeTargets(b -> b.rule(rule).ids("keel")); } catch (AwsServiceException ignored) { }
                try { aws.eventBridge().deleteRule(b -> b.name(rule)); } catch (AwsServiceException ignored) { }
            }
            if (queueUrl != null) aws.sqs().deleteQueue(b -> b.queueUrl(queueUrl));
        } catch (AwsServiceException e) {
            throw new ApiError(403, "could not remove the queue or rules: " + e.awsErrorDetails().errorMessage(), null);
        }
        queueUrl = null;
        sync.setPushHealthy(false);
        emit();
        return status();
    }

    @Override
    public void contribute(Map<String, Object> s) {
        @SuppressWarnings("unchecked") Map<String, Object> live = (Map<String, Object>) s.get("live");
        if (live != null) live.put("push", push());
    }

    private Map<String, Object> push() {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("enabled", queueUrl != null);
        if (queueUrl != null) p.put("queueUrl", queueUrl);
        p.put("trail", trail);
        if (lastEventAt != null) p.put("lastEventAt", lastEventAt.toString());
        if (error != null) p.put("error", error);
        return p;
    }

    private void checkTrail() {
        try { trail = aws.cloudTrail().describeTrails().trailList().isEmpty() ? "absent" : "present"; }
        catch (RuntimeException e) { trail = "unknown"; }
    }

    private synchronized void startReceiver() {
        if (receiver != null || queueUrl == null) return;
        String url = queueUrl;
        receiver = Thread.ofVirtual().name("live-receive").start(() -> {
            int failures = 0;
            while (url.equals(queueUrl) && !Thread.currentThread().isInterrupted()) {
                try {
                    List<Message> msgs = aws.sqs().receiveMessage(b -> b.queueUrl(url).waitTimeSeconds(20).maxNumberOfMessages(10)).messages();
                    if (failures > 0) { failures = 0; error = null; emit(); }
                    sync.setPushHealthy(true);
                    for (Message m : msgs) {
                        try { handle(json.readTree(m.body())); }
                        catch (Exception e) { log.warn("live: message dropped: {}", short_(e)); }
                        aws.sqs().deleteMessage(b -> b.queueUrl(url).receiptHandle(m.receiptHandle()));
                    }
                } catch (RuntimeException e) {
                    if (Thread.currentThread().isInterrupted()) return;
                    failures++;
                    error = short_(e);
                    if (failures >= 3) { sync.setPushHealthy(false); emit(); }
                    try { Thread.sleep(Math.min(30_000, 2_000L * failures)); } catch (InterruptedException ie) { return; }
                }
            }
        });
    }

    private synchronized void stopReceiver() {
        if (receiver != null) { receiver.interrupt(); receiver = null; }
        sync.setPushHealthy(false);
    }

    /** One message → one targeted call → one bus event. Package-private so the test can feed it JSON. */
    void handle(JsonNode msg) {
        String type = msg.path("detail-type").asText();
        JsonNode detail = msg.path("detail");
        lastEventAt = Instant.now();
        switch (type) {
            case "Glue Job State Change", "Glue Job Run Status" -> {
                String job = detail.path("jobName").asText(), run = detail.path("jobRunId").asText();
                if (!job.isEmpty() && !run.isEmpty()) sync.applyRun(job, glue.run(job, run));
            }
            case "AWS API Call via CloudTrail" -> {
                String name = detail.path("eventName").asText();
                JsonNode req = detail.path("requestParameters");
                String job = req.path("jobName").asText(req.path("name").asText(""));
                if (job.isEmpty()) return;
                switch (name) {
                    case "CreateJob", "UpdateJob" -> sync.applyJob(glue.getJob(job));
                    case "DeleteJob" -> sync.applyRemoved(job);
                    case "StartJobRun" -> {
                        String run = detail.path("responseElements").path("jobRunId").asText();
                        if (!run.isEmpty()) sync.applyRun(job, glue.run(job, run));
                    }
                    case "BatchStopJobRun" -> { for (JsonNode id : req.path("jobRunIds")) sync.applyRun(job, glue.run(job, id.asText())); }
                    default -> { }
                }
            }
            default -> { }
        }
    }

    private void emit() { events.emit("live.changed", status()); }

    private static String short_(Throwable e) {
        String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        return m.length() > 200 ? m.substring(0, 200) : m;
    }
}
