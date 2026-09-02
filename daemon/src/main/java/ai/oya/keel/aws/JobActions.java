package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
import ai.oya.keel.Events;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The per-job actions Glue Studio has on its jobs page: clone, delete, export, tags, bookmark reset, and editing job details in place. */
@RestController
public class JobActions {
    private final GlueService glue;
    private final AwsClients aws;
    private final Sync sync;
    private final Events events;
    private final ai.oya.keel.State state;
    private final com.fasterxml.jackson.databind.ObjectMapper json;
    private final ai.oya.keel.local.Deployer deployer;

    public JobActions(GlueService glue, AwsClients aws, Sync sync, Events events, ai.oya.keel.State state,
                      com.fasterxml.jackson.databind.ObjectMapper json, ai.oya.keel.local.Deployer deployer) {
        this.glue = glue; this.aws = aws; this.sync = sync; this.events = events; this.state = state; this.json = json;
        this.deployer = deployer;
    }

    /**
     * Turns on what an empty Metrics, Insights or Spark UI pane needs, in one click.
     *
     * Those three panes are empty for the same reason — a flag that is off — and telling somebody
     * to go to another tab and find it is a worse answer than doing it. The Spark UI also needs a
     * logs path, so one is filled in rather than asked for. What this cannot do is change a run
     * that has already finished, and the reply says so every time.
     */
    @PostMapping("/api/glue/jobs/{name}/observability")
    public Map<String, Object> observability(@PathVariable String name, @RequestParam(defaultValue = "all") String what) {
        ObjectNode def = updatable(name);
        ObjectNode args = def.path("DefaultArguments").isObject() ? (ObjectNode) def.get("DefaultArguments") : json.createObjectNode();
        List<String> changed = new ArrayList<>();
        boolean all = "all".equals(what);
        if (all || "metrics".equals(what)) {
            set(args, "--enable-metrics", "true", changed);
            set(args, "--enable-observability-metrics", "true", changed);
        }
        if (all || "insights".equals(what)) set(args, "--enable-job-insights", "true", changed);
        if (all || "sparkui".equals(what)) {
            set(args, "--enable-spark-ui", "true", changed);
            String path = args.path("--spark-event-logs-path").asText("");
            if (path.isBlank()) set(args, "--spark-event-logs-path", "s3://" + assetsBucket() + "/sparkHistoryLogs/" + name + "/", changed);
        }
        def.set("DefaultArguments", args);
        String script = null;
        if (!changed.isEmpty()) {
            glue.updateJob(name, def);
            script = deployer.reassertScript(name);
            try { sync.applyJob(glue.getJob(name)); } catch (RuntimeException ignored) { /* the sync loop will see it */ }
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("job", name);
        m.put("changed", changed);
        m.put("arguments", json.convertValue(args, Map.class));
        m.put("scriptNote", script);
        m.put("note", (changed.isEmpty()
                ? "Everything was already on for this job. A run that has already finished still has nothing to show."
                : "Set " + String.join(", ", changed) + ". This changes the next run; the one you are looking at has already finished.")
                + (script == null ? "" : " " + script));
        return m;
    }

    /**
     * The job as UpdateJob will accept it: GetJob returns fields the update refuses, and a job with
     * a worker type must not also carry MaxCapacity — Glue rejects the pair rather than ignoring it.
     */
    private ObjectNode updatable(String name) {
        ObjectNode def = glue.getJobJson(name).deepCopy();
        for (String k : new String[] {"Name", "CreatedOn", "LastModifiedOn", "AllocatedCapacity", "ProfileName"}) def.remove(k);
        if (def.hasNonNull("WorkerType")) def.remove("MaxCapacity");
        return def;
    }

    private static void set(ObjectNode args, String key, String value, List<String> changed) {
        if (value.equals(args.path(key).asText(null))) return;
        args.put(key, value);
        changed.add(key);
    }

    /** Where Glue itself puts a job's assets, and so where Spark event logs go unless told otherwise. */
    private String assetsBucket() {
        if (state.scriptBucket() != null && !state.scriptBucket().isBlank()) return state.scriptBucket();
        return "aws-glue-assets-" + aws.sts().getCallerIdentity().account() + "-" + aws.region();
    }

    public record CloneBody(String newName) {}

    @PostMapping("/api/glue/jobs/{name}/clone")
    public Map<String, Object> clone(@PathVariable String name, @RequestBody CloneBody b) {
        if (b.newName() == null || !b.newName().matches("[A-Za-z0-9._-]+")) throw ApiError.badRequest("the new name needs letters, digits, dot, dash, underscore");
        if (glue.jobExists(b.newName())) throw ApiError.conflict("a job named " + b.newName() + " already exists");
        ObjectNode def = glue.getJobJson(name).deepCopy();
        for (String k : new String[] {"CreatedOn", "LastModifiedOn", "AllocatedCapacity", "ProfileName"}) def.remove(k);
        if (def.hasNonNull("WorkerType")) def.remove("MaxCapacity");
        def.put("Name", b.newName());
        String created = glue.createJob(def);
        try { sync.applyJob(glue.getJob(created)); } catch (RuntimeException ignored) { }
        return Map.of("name", created);
    }

    @DeleteMapping("/api/glue/jobs/{name}")
    public Map<String, Object> delete(@PathVariable String name) {
        aws.glue().deleteJob(b -> b.jobName(name));
        sync.applyRemoved(name);
        return Map.of("deleted", name);
    }

    /** The job as Glue Studio's "Export" gives it: the full definition, importable with `POST /api/glue/jobs` or `create-job`. */
    @GetMapping("/api/glue/jobs/{name}/export")
    public JsonNode export(@PathVariable String name) { return glue.getJobJson(name); }

    /** Job details edited in place (Glue Studio's Job details tab). Body is a partial JobUpdate; unspecified fields keep their values. */
    @PutMapping("/api/glue/jobs/{name}/details")
    public Map<String, Object> details(@PathVariable String name, @RequestBody JsonNode patch) {
        ObjectNode def = updatable(name);
        patch.fields().forEachRemaining(e -> { if (e.getValue().isNull()) def.remove(e.getKey()); else def.set(e.getKey(), e.getValue()); });
        if (def.hasNonNull("WorkerType")) def.remove("MaxCapacity");
        glue.updateJob(name, def);
        String script = deployer.reassertScript(name); // saving details regenerates a visual job's script
        try { sync.applyJob(glue.getJob(name)); } catch (RuntimeException ignored) { }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("updated", name);
        m.put("note", script);
        return m;
    }

    /** Glue Studio's "Import job": an exported definition (the `Job` object) becomes a new job under `name`. */
    @PostMapping("/api/glue/jobs/{name}/import-json")
    public Map<String, Object> importJson(@PathVariable String name, @RequestBody JsonNode body) {
        if (!name.matches("[A-Za-z0-9._-]+")) throw ApiError.badRequest("job names are letters, digits, dot, dash, underscore");
        if (glue.jobExists(name)) throw ApiError.conflict("a job named " + name + " already exists");
        ObjectNode def = (body.has("Job") ? body.get("Job") : body).deepCopy();
        for (String k : new String[] {"CreatedOn", "LastModifiedOn", "AllocatedCapacity", "ProfileName"}) def.remove(k);
        if (def.hasNonNull("WorkerType")) def.remove("MaxCapacity");
        def.put("Name", name);
        if (!def.hasNonNull("Role")) throw ApiError.badRequest("the definition has no Role");
        if (!def.hasNonNull("Command")) throw ApiError.badRequest("the definition has no Command");
        String created = glue.createJob(def);
        try { sync.applyJob(glue.getJob(created)); } catch (RuntimeException ignored) { }
        return Map.of("name", created);
    }

    @PostMapping("/api/glue/jobs/{name}/bookmark/reset")
    public Map<String, Object> resetBookmark(@PathVariable String name) {
        aws.glue().resetJobBookmark(b -> b.jobName(name));
        return Map.of("reset", name);
    }

    @GetMapping("/api/glue/jobs/{name}/bookmark")
    public Map<String, Object> bookmark(@PathVariable String name) {
        try {
            var e = aws.glue().getJobBookmark(b -> b.jobName(name)).jobBookmarkEntry();
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("version", e.version()); m.put("run", e.run()); m.put("attempt", e.attempt()); m.put("runId", e.runId()); m.put("bookmark", e.jobBookmark());
            return m;
        } catch (software.amazon.awssdk.services.glue.model.EntityNotFoundException e) {
            return Map.of("none", true);
        }
    }

    public record TagsBody(Map<String, String> add, List<String> remove) {}

    @GetMapping("/api/glue/jobs/{name}/tags")
    public Map<String, String> tags(@PathVariable String name) { return aws.glue().getTags(b -> b.resourceArn(arn(name))).tags(); }

    @PutMapping("/api/glue/jobs/{name}/tags")
    public Map<String, String> setTags(@PathVariable String name, @RequestBody TagsBody b) {
        if (b.add() != null && !b.add().isEmpty()) aws.glue().tagResource(x -> x.resourceArn(arn(name)).tagsToAdd(b.add()));
        if (b.remove() != null && !b.remove().isEmpty()) aws.glue().untagResource(x -> x.resourceArn(arn(name)).tagsToRemove(b.remove()));
        return tags(name);
    }

    private String arn(String job) {
        String account = aws.sts().getCallerIdentity().account();
        return "arn:aws:glue:" + aws.region() + ":" + account + ":job/" + job;
    }

    /** Links Glue Studio shows on a run: the console, CloudWatch output/error, the Spark UI logs prefix. */
    @GetMapping("/api/glue/jobs/{name}/runs/{id}/links")
    public Map<String, String> links(@PathVariable String name, @PathVariable String id) {
        String r = aws.region();
        Map<String, String> m = new LinkedHashMap<>();
        m.put("console", "https://" + r + ".console.aws.amazon.com/gluestudio/home?region=" + r + "#/job/" + name + "/run/" + id);
        m.put("output", "https://" + r + ".console.aws.amazon.com/cloudwatch/home?region=" + r + "#logsV2:log-groups/log-group/$252Faws-glue$252Fjobs$252Foutput/log-events/" + id);
        m.put("error", "https://" + r + ".console.aws.amazon.com/cloudwatch/home?region=" + r + "#logsV2:log-groups/log-group/$252Faws-glue$252Fjobs$252Ferror/log-events/" + id);
        m.put("allLogs", "https://" + r + ".console.aws.amazon.com/cloudwatch/home?region=" + r + "#logsV2:log-groups/log-group/$252Faws-glue$252Fjobs$252Flogs-v2$3FlogStreamNameFilter$3D" + id);
        m.put("metrics", "https://" + r + ".console.aws.amazon.com/gluestudio/home?region=" + r + "#/job/" + name + "/run/" + id + "/metrics");
        return m;
    }
}
