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
import java.util.List;
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

    /**
     * `scriptMode` decides who owns `Command.ScriptLocation`, because Glue and Keel both want it:
     * passing `CodeGenConfigurationNodes` makes Glue regenerate the script there, asynchronously,
     * some seconds after UpdateJob.
     *   visual — the DAG only; Glue's generated script runs. The console is fully visual.
     *   tested — our tested job.py runs and the job is SCRIPT mode; the console shows no canvas.
     *   both   — default: the DAG goes up, we wait for Glue's regeneration to settle, then write
     *            our script over it and verify. The response says whether it stuck.
     */
    public record Body(Boolean create, String scriptMode) {}

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
        String mode = b == null || b.scriptMode() == null || b.scriptMode().isBlank() ? "both" : b.scriptMode();
        if (!List.of("both", "visual", "tested").contains(mode)) throw ApiError.badRequest("scriptMode is both, visual or tested");
        boolean visualDag = dag != null && dag.isObject() && dag.size() > 0 && !"tested".equals(mode);
        if (visualDag) {
            Project.validateDag(dag);
            update.set("CodeGenConfigurationNodes", dag);
            update.put("JobMode", "VISUAL");
        } else if ("tested".equals(mode)) {
            // no DAG on the job: nothing regenerates the script, so the tested code is what runs
            update.remove("CodeGenConfigurationNodes");
            update.put("JobMode", "SCRIPT");
        }
        if (!update.hasNonNull("Role")) throw new ApiError(400, "job.json has no Role", "add the IAM role Glue should run as");
        boolean exists = glue.jobExists(name);
        boolean create = b != null && Boolean.TRUE.equals(b.create());
        if (!exists && !create) throw new ApiError(404, "Glue has no job named " + name, "deploy with create=true to create it");
        if (exists) glue.updateJob(name, update);
        else { ObjectNode c = update.deepCopy(); c.put("Name", name); glue.createJob(c); }
        String note;
        boolean scriptIsOurs = false;
        if (script != null && !script.isBlank() && !"visual".equals(mode)) {
            // Wait for Glue's own regeneration to settle before writing ours over it: the object has
            // to read the same twice in a row (or 90s pass), otherwise the regeneration lands after
            // our write and the job runs code that never saw a test. This is the bug that shipped
            // once already — a run failed on Glue's generated aggregate while our tests were green.
            String settled = settle(location, 90_000);
            glue.putScript(location, script);
            scriptIsOurs = verify(location, script, 20_000);
            note = scriptIsOurs
                    ? "Deployed. The tested job.py is what runs, at " + location + "."
                    : "Deployed, but Glue rewrote the script after Keel wrote it. The job currently runs Glue's generated code, not the tested job.py. Redeploy, or deploy with scriptMode=tested to keep yours.";
            if (settled == null) note += " (Glue was still rewriting the script when the wait ran out.)";
            note += " A Save in the AWS console regenerates the script from the DAG; redeploy from Keel afterwards.";
        } else if ("visual".equals(mode)) {
            note = "Deployed the DAG only. Glue generates the script at " + location + "; the local job.py is not what runs.";
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
        m.put("scriptMode", mode);
        m.put("scriptIsOurs", scriptIsOurs);
        m.put("jobMode", update.path("JobMode").asText("SCRIPT"));
        return m;
    }

    /**
     * Puts the tested script back after somebody else's UpdateJob.
     *
     * A job with CodeGenConfigurationNodes gets its ScriptLocation rewritten by Glue after *any*
     * UpdateJob — turning on a flag counts — so a change that has nothing to do with the code
     * silently replaces the tested job.py with Glue's generated one, and the next run fails on code
     * that never saw a test. That is not hypothetical: it has happened to this account twice.
     *
     * Returns a sentence for the caller to show, or null when there was nothing to put back.
     */
    public String reassertScript(String name) {
        if (!project.exists(name)) return null;
        String script = Project.readText(project.dir(name).resolve("job.py"));
        if (script == null || script.isBlank()) return null;
        JsonNode job;
        try { job = glue.getJobJson(name); } catch (RuntimeException e) { return null; }
        if (!"VISUAL".equalsIgnoreCase(job.path("JobMode").asText(""))) return null; // only visual jobs are regenerated
        String location = job.path("Command").path("ScriptLocation").asText(null);
        if (location == null || location.isBlank()) return null;
        String settled = settle(location, 90_000);
        if (script.equals(settled)) return null; // Glue left ours alone
        glue.putScript(location, script);
        return verify(location, script, 20_000)
                ? "Glue regenerated the script after this change, so Keel put the tested job.py back at " + location + "."
                : "Glue regenerated the script after this change and kept rewriting it. The job currently runs Glue's generated code, not the tested job.py — deploy again from the Authoring tab.";
    }

    /** Reads the object until two consecutive reads agree; returns the settled text, or null on timeout. */
    private String settle(String location, long millis) {
        long deadline = System.currentTimeMillis() + millis;
        String last = null;
        while (System.currentTimeMillis() < deadline) {
            String now;
            try { now = glue.getScript(location); } catch (RuntimeException e) { now = null; }
            if (now != null && now.equals(last)) return now;
            last = now;
            try { Thread.sleep(3000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); return null; }
        }
        return null;
    }

    /** Our script must still be there after the wait; Glue sometimes regenerates once more. */
    private boolean verify(String location, String script, long millis) {
        long deadline = System.currentTimeMillis() + millis;
        boolean ok = true;
        while (System.currentTimeMillis() < deadline) {
            try { Thread.sleep(5000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
            try {
                if (!script.equals(glue.getScript(location))) { glue.putScript(location, script); ok = false; }
                else if (!ok) ok = true; // our re-put stuck
            } catch (RuntimeException ignored) { }
        }
        try { return script.equals(glue.getScript(location)); } catch (RuntimeException e) { return ok; }
    }
}
