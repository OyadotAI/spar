package ai.oya.keel.local;

import ai.oya.keel.ApiError;
import ai.oya.keel.State;
import ai.oya.keel.aws.GlueService;
import ai.oya.keel.aws.Sync;
import ai.oya.keel.git.Git;
import ai.oya.keel.git.Lanes;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Disk → AWS. The DAG goes up so the console stays visual; then the tested job.py goes to
 * ScriptLocation, over the script Glue regenerated from the DAG — the code that passed the tests
 * is the code that runs. A Save in the AWS console regenerates again; the response says so.
 */
@RestController
public class Deployer {
    private final Project project;
    private final GlueService glue;
    private final State state;
    private final Lanes lanes;
    private final Sync sync;

    public Deployer(Project project, GlueService glue, State state, Lanes lanes, Sync sync) {
        this.project = project; this.glue = glue; this.state = state; this.lanes = lanes; this.sync = sync;
    }

    public record Body(Boolean create) {}

    @PostMapping("/api/jobs/{name}/deploy")
    public Map<String, Object> deploy(@PathVariable String name, @RequestBody(required = false) Body b) {
        Path d = project.dir(name);
        JsonNode job = project.readJson(d.resolve("job.json"));
        if (job == null) throw ApiError.notFound("jobs/" + name + "/job.json does not exist");
        JsonNode dag = project.readJson(d.resolve("dag.json"));
        String script = Project.readText(d.resolve("job.py"));
        String location = job.path("Command").path("ScriptLocation").asText("");
        if (location.isEmpty()) {
            if (state.scriptBucket() == null || state.scriptBucket().isBlank())
                throw new ApiError(400, "this job has no ScriptLocation and no script bucket is configured", "set a script bucket in Settings");
            location = "s3://" + state.scriptBucket() + "/scripts/" + name + ".py";
        }
        ObjectNode update = job.deepCopy();
        for (String k : new String[] {"Name", "CreatedOn", "LastModifiedOn", "AllocatedCapacity", "ProfileName", "JobRunQueuingEnabled"}) update.remove(k);
        if (update.hasNonNull("WorkerType")) update.remove("MaxCapacity");
        ObjectNode cmd = update.withObject("Command");
        if (!cmd.hasNonNull("Name")) cmd.put("Name", "glueetl");
        cmd.put("ScriptLocation", location);
        if (!cmd.hasNonNull("PythonVersion")) cmd.put("PythonVersion", "3");
        if (dag != null && dag.isObject() && dag.size() > 0) {
            Project.validateDag(dag);
            update.set("CodeGenConfigurationNodes", dag);
            update.put("JobMode", "VISUAL");
        }
        if (!update.hasNonNull("Role")) throw new ApiError(400, "job.json has no Role", "add the IAM role Glue should run as");
        boolean exists = glue.jobExists(name);
        boolean create = b != null && Boolean.TRUE.equals(b.create());
        if (!exists && !create) throw new ApiError(404, "Glue has no job named " + name, "deploy with create=true to create it");
        if (exists) glue.updateJob(name, update);
        else { ObjectNode c = update.deepCopy(); c.put("Name", name); glue.createJob(c); }
        String note;
        if (script != null && !script.isBlank()) {
            glue.putScript(location, script);
            // Glue regenerates the script from the DAG on UpdateJob; make sure ours is what stays.
            // ponytail: the regeneration is asynchronous and its timing unverified; one re-check after 5s
            try { Thread.sleep(5000); } catch (InterruptedException ignored) { }
            try { if (!script.equals(glue.getScript(location))) glue.putScript(location, script); } catch (RuntimeException ignored) { }
            note = "Deployed the DAG and the tested job.py to " + location + ". A Save in the AWS console regenerates the script from the DAG and discards it; redeploy from Keel after console edits.";
        } else {
            note = "Deployed the DAG; Glue generated the script at " + location + " (no local job.py).";
        }
        try { sync.applyJob(glue.getJob(name)); } catch (RuntimeException ignored) { }
        Path lane = lanes.dirFor(name);
        String commit = Git.isRepo(lane) ? Git.commitAll(lane, "deploy " + name) : null;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("jobName", name);
        m.put("scriptLocation", location);
        m.put("created", !exists);
        m.put("commit", commit);
        m.put("note", note);
        return m;
    }
}
