package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
import ai.oya.keel.Events;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** The per-job actions Glue Studio has on its jobs page: clone, delete, export, tags, bookmark reset, and editing job details in place. */
@RestController
public class JobActions {
    private final GlueService glue;
    private final AwsClients aws;
    private final Sync sync;
    private final Events events;

    public JobActions(GlueService glue, AwsClients aws, Sync sync, Events events) { this.glue = glue; this.aws = aws; this.sync = sync; this.events = events; }

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
        ObjectNode def = glue.getJobJson(name).deepCopy();
        for (String k : new String[] {"Name", "CreatedOn", "LastModifiedOn", "AllocatedCapacity", "ProfileName"}) def.remove(k);
        patch.fields().forEachRemaining(e -> { if (e.getValue().isNull()) def.remove(e.getKey()); else def.set(e.getKey(), e.getValue()); });
        if (def.hasNonNull("WorkerType")) def.remove("MaxCapacity");
        glue.updateJob(name, def);
        try { sync.applyJob(glue.getJob(name)); } catch (RuntimeException ignored) { }
        return Map.of("updated", name);
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
