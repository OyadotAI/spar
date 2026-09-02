package ai.oya.keel.local;

import ai.oya.keel.ApiError;
import ai.oya.keel.aws.GlueService;
import ai.oya.keel.codegen.Layout;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/** AWS → disk. A visual job becomes job.json + dag.json (+ an auto layout); a script job brings its script down from S3. */
@Component
public class Importer {
    private final Project project;
    private final GlueService glue;
    private final ai.oya.keel.codegen.Generator generator;

    public Importer(Project project, GlueService glue, ai.oya.keel.codegen.Generator generator) { this.project = project; this.glue = glue; this.generator = generator; }

    public Map<String, Object> importJob(String job, boolean overwrite) {
        Project.validName(job);
        JsonNode def = glue.getJobJson(job);
        if (def == null || def.isMissingNode() || !def.hasNonNull("Name")) throw ApiError.notFound("Glue has no job named " + job);
        Path d = project.dir(job);
        List<String> written = new ArrayList<>();
        boolean fresh = !Files.exists(d.resolve("job.json"));
        if (fresh || overwrite) {
            project.writeJob(job, def);
            written.add("job.json");
        }
        JsonNode nodes = def.get("CodeGenConfigurationNodes");
        String mode = def.path("JobMode").asText("SCRIPT");
        if (nodes != null && nodes.isObject() && nodes.size() > 0) {
            if (fresh || overwrite || !Files.exists(d.resolve("dag.json"))) {
                project.writeDag(job, nodes, Files.exists(d.resolve("layout.json")) && !overwrite ? null : Layout.auto(nodes), null);
                written.add("dag.json");
                written.add("layout.json");
                try { // the code and tests the DAG implies; an unsupported node type is reported, not fatal
                    @SuppressWarnings("unchecked") List<String> w = (List<String>) generator.generate(job, true, false).get("written");
                    written.addAll(w);
                } catch (ApiError e) { written.add("(codegen: " + e.getMessage() + ")"); }
            }
        } else if (fresh || overwrite) {
            String loc = def.path("Command").path("ScriptLocation").asText(null);
            if (loc != null && loc.startsWith("s3://")) {
                try { project.writeScript(job, glue.getScript(loc)); written.add("job.py"); }
                catch (RuntimeException e) { /* the script is optional for a listing; the app says it is missing */ }
            }
        }
        ObjectNode summary = (ObjectNode) new com.fasterxml.jackson.databind.ObjectMapper().valueToTree(project.summary(job));
        return Map.of("name", job, "jobMode", mode, "written", written, "summary", summary);
    }
}
