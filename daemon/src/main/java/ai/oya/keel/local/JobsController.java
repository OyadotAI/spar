package ai.oya.keel.local;

import ai.oya.keel.git.Git;
import ai.oya.keel.git.Lanes;
import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class JobsController {
    private final Project project;
    private final Importer importer;
    private final Lanes lanes;

    public JobsController(Project project, Importer importer, Lanes lanes) { this.project = project; this.importer = importer; this.lanes = lanes; }

    @GetMapping("/api/jobs")
    public List<Map<String, Object>> list() { return project.list(); }

    @PostMapping("/api/jobs/{name}/import")
    public Map<String, Object> importJob(@PathVariable String name, @RequestParam(defaultValue = "false") boolean overwrite) {
        return importer.importJob(name, overwrite);
    }

    @GetMapping("/api/jobs/{name}")
    public Map<String, Object> read(@PathVariable String name) { return project.read(name); }

    /**
     * The static check on the DAG. It runs with no AWS and no Spark, so the canvas can show the
     * silent traps — a bookmarked join writing NULLs, a mapping dropping a column — while they are
     * still being drawn rather than after a run that succeeded and produced the wrong thing.
     */
    @GetMapping("/api/jobs/{name}/lint")
    public Map<String, Object> lint(@PathVariable String name) {
        JsonNode dag = project.readJson(project.dir(name).resolve("dag.json"));
        if (dag == null) throw ai.oya.keel.ApiError.notFound("no dag.json for " + name);
        JsonNode job = project.readJson(project.dir(name).resolve("job.json"));
        List<Map<String, Object>> findings = new java.util.ArrayList<>();
        for (ai.oya.keel.codegen.Lint.Finding f : ai.oya.keel.codegen.Lint.check(dag, job)) findings.add(f.asMap());
        return Map.of("rev", project.rev(name), "findings", findings);
    }

    public record DagBody(JsonNode dag, JsonNode layout, Long rev) {}

    @PutMapping("/api/jobs/{name}/dag")
    public Map<String, Object> putDag(@PathVariable String name, @RequestBody DagBody b) {
        return Map.of("rev", project.writeDag(name, b.dag(), b.layout(), b.rev()));
    }

    @PutMapping("/api/jobs/{name}/layout")
    public Map<String, Object> putLayout(@PathVariable String name, @RequestBody JsonNode layout) {
        return Map.of("rev", project.writeLayout(name, layout));
    }

    @PutMapping("/api/jobs/{name}/job")
    public Map<String, Object> putJob(@PathVariable String name, @RequestBody JsonNode job) {
        return Map.of("rev", project.writeJob(name, job));
    }

    public record ScriptBody(String script) {}

    @PutMapping("/api/jobs/{name}/script")
    public Map<String, Object> putScript(@PathVariable String name, @RequestBody ScriptBody b) {
        return Map.of("rev", project.writeScript(name, b.script()));
    }

    @PostMapping("/api/jobs/{name}/lane")
    public Map<String, Object> lane(@PathVariable String name) {
        Project.validName(name);
        Path d = lanes.ensure(name);
        return Map.of("path", d.toString(), "branch", Lanes.branch(name));
    }

    @GetMapping("/api/jobs/{name}/git")
    public Map<String, Object> git(@PathVariable String name) {
        Path d = lanes.dirFor(name);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("dir", d.toString());
        m.put("branch", Git.branch(d));
        m.put("head", Git.head(d));
        m.put("dirty", Git.status(d));
        return m;
    }

    public record CommitBody(String message) {}

    @PostMapping("/api/jobs/{name}/commit")
    public Map<String, Object> commit(@PathVariable String name, @RequestBody CommitBody b) {
        String c = Git.commitAll(lanes.dirFor(name), b.message() == null || b.message().isBlank() ? "keel: " + name : b.message());
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("commit", c);
        return m;
    }
}
