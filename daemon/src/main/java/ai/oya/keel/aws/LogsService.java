package ai.oya.keel.aws;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.cloudwatchlogs.model.DescribeLogStreamsResponse;
import software.amazon.awssdk.services.cloudwatchlogs.model.GetLogEventsResponse;
import software.amazon.awssdk.services.cloudwatchlogs.model.OutputLogEvent;
import software.amazon.awssdk.services.cloudwatchlogs.model.ResourceNotFoundException;

/**
 * Where a job run's logs are depends on the Glue version and on the account's security
 * configuration, so we do not guess: every candidate group is asked for streams whose name starts
 * with the run id, and whatever answers is what we tail.
 */
@Service
public class LogsService {
    public static final List<String> GROUPS = List.of("/aws-glue/jobs/error", "/aws-glue/jobs/output", "/aws-glue/jobs/logs-v2");

    public record StreamRef(String group, String stream) {}
    public record Line(long ts, String group, String stream, String message) {}

    private final AwsClients aws;

    public LogsService(AwsClients aws) { this.aws = aws; }

    public List<StreamRef> discover(String runId, String groupFilter, String groupPrefix) {
        List<StreamRef> out = new ArrayList<>();
        for (String g : GROUPS) {
            String kind = g.substring(g.lastIndexOf('/') + 1);
            if (groupFilter != null && !groupFilter.equals("all") && !kind.equals(groupFilter)) continue;
            String group = groupPrefix == null ? g : groupPrefix + "/" + kind;
            try {
                String next = null;
                do {
                    final String token = next;
                    DescribeLogStreamsResponse r = aws.logs().describeLogStreams(b ->
                            b.logGroupName(group).logStreamNamePrefix(runId).nextToken(token));
                    r.logStreams().forEach(s -> {
                        String n = s.logStreamName();
                        if (n.endsWith("-progress-bar")) return;
                        // insights streams are read on their own tab, not mixed into the console
                        if (n.contains("job-insights-rca-driver") || n.contains("job-insights-rule-driver")) return;
                        out.add(new StreamRef(group, n));
                    });
                    next = r.nextToken();
                } while (next != null);
            } catch (ResourceNotFoundException e) {
                // this account has no such group (older Glue, or a security configuration renamed it)
            }
        }
        return out;
    }

    /** Glue's job-insights streams for a run: the consolidated root cause, and the rule-based guidance. */
    public Map<String, List<Line>> insights(String runId) {
        Map<String, List<Line>> out = new java.util.LinkedHashMap<>();
        for (String suffix : List.of("job-insights-rca-driver", "job-insights-rule-driver")) {
            List<Line> lines = new ArrayList<>();
            for (String group : List.of("/aws-glue/jobs/error", "/aws-glue/jobs/logs-v2")) {
                try {
                    var r = aws.logs().describeLogStreams(b -> b.logGroupName(group).logStreamNamePrefix(runId));
                    for (var st : r.logStreams()) {
                        if (!st.logStreamName().contains(suffix)) continue;
                        var ev = aws.logs().getLogEvents(b -> b.logGroupName(group).logStreamName(st.logStreamName()).limit(500).startFromHead(true));
                        for (var e : ev.events()) lines.add(new Line(e.timestamp(), kind(group), st.logStreamName(), e.message()));
                    }
                } catch (ResourceNotFoundException ignored) { }
            }
            out.put(suffix.contains("rca") ? "rootCause" : "guidance", lines);
        }
        return out;
    }

    /** The last `n` lines across every stream of the run, oldest first. */
    public List<Line> tail(String runId, int n, String groupFilter, String groupPrefix) {
        List<Line> all = new ArrayList<>();
        for (StreamRef s : discover(runId, groupFilter, groupPrefix)) {
            GetLogEventsResponse r = aws.logs().getLogEvents(b -> b.logGroupName(s.group()).logStreamName(s.stream()).limit(n).startFromHead(false));
            for (OutputLogEvent e : r.events()) all.add(new Line(e.timestamp(), kind(s.group()), s.stream(), e.message()));
        }
        all.sort((a, b) -> Long.compare(a.ts(), b.ts()));
        return all.size() > n ? all.subList(all.size() - n, all.size()) : all;
    }

    /**
     * Follows every stream of a run from the head. `alive` says whether the client is still there
     * and `terminalSince` is asked for the moment the run ended; 30s after that we stop.
     */
    public void follow(String runId, String groupFilter, String groupPrefix, Consumer<List<StreamRef>> onStreams,
                       Consumer<Line> onLine, java.util.function.BooleanSupplier alive,
                       java.util.function.Supplier<Long> terminalSince) {
        Map<StreamRef, String> tokens = new HashMap<>();
        List<StreamRef> streams = new ArrayList<>();
        long lastDiscover = 0;
        while (alive.getAsBoolean()) {
            long now = System.currentTimeMillis();
            if (now - lastDiscover > 15_000) {
                // re-sent even when unchanged: it is the stream's heartbeat, so a run with no
                // streams yet reads as "waiting", not as a dead connection
                streams = discover(runId, groupFilter, groupPrefix);
                onStreams.accept(streams);
                lastDiscover = now;
            }
            for (StreamRef s : streams) {
                String token = tokens.get(s);
                GetLogEventsResponse r = aws.logs().getLogEvents(b -> {
                    b.logGroupName(s.group()).logStreamName(s.stream()).limit(1000);
                    if (token == null) b.startFromHead(true); else b.nextToken(token);
                });
                for (OutputLogEvent e : r.events()) onLine.accept(new Line(e.timestamp(), kind(s.group()), s.stream(), e.message()));
                tokens.put(s, r.nextForwardToken());
            }
            Long ended = terminalSince.get();
            if (ended != null && now - ended > 30_000) return;
            try { Thread.sleep(2000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); return; }
        }
    }

    static String kind(String group) { return group.substring(group.lastIndexOf('/') + 1); }
}
