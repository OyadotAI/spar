package ai.oya.keel.codegen;

import ai.oya.keel.ApiError;
import ai.oya.keel.local.Project;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** `POST /api/jobs/{name}/generate`: dag.json → job.py (+ .ranges.json) and the missing test scaffolds. */
@RestController
public class Generator {
    private final Project project;
    private final ObjectMapper json;

    public Generator(Project project, ObjectMapper json) { this.project = project; this.json = json; }

    public record Body(Boolean tests, Boolean force) {}

    @PostMapping("/api/jobs/{name}/generate")
    public Map<String, Object> generate(@PathVariable String name, @RequestBody(required = false) Body b) {
        boolean tests = b == null || b.tests() == null || b.tests();
        boolean force = b != null && Boolean.TRUE.equals(b.force());
        return generate(name, tests, force);
    }

    public Map<String, Object> generate(String name, boolean tests, boolean force) {
        Path d = project.dir(name);
        JsonNode dag = project.readJson(d.resolve("dag.json"));
        if (dag == null) throw ApiError.notFound("jobs/" + name + "/dag.json does not exist");
        Project.validateDag(dag);
        PySpark.Generated gen = PySpark.generate(dag);
        List<String> written = new ArrayList<>();
        project.writeFile(name, "job.py", gen.script());
        written.add("job.py");
        ObjectNode ranges = json.createObjectNode();
        gen.ranges().forEach((id, r) -> ranges.putArray(id).add(r[0]).add(r[1]));
        project.writeFile(name, ".ranges.json", ranges.toString());
        if (tests) {
            for (Map.Entry<String, String> e : TestGen.generate(dag, gen).entrySet()) {
                Path p = d.resolve(e.getKey());
                if (Files.exists(p) && !force) continue;
                project.writeFile(name, e.getKey(), e.getValue());
                written.add(e.getKey());
            }
        }
        long rev = project.bump(name);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("script", gen.script());
        out.put("ranges", ranges);
        out.put("written", written);
        out.put("rev", rev);
        return out;
    }
}
