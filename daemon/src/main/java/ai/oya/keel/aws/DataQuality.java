package ai.oya.keel.aws;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import software.amazon.awssdk.services.glue.model.DataQualityResultDescription;
import software.amazon.awssdk.services.glue.model.DataQualityRuleResult;
import software.amazon.awssdk.services.glue.model.GetDataQualityResultResponse;

/** Glue Studio's Data quality tab: the results an Evaluate Data Quality node published for this job's runs. */
@RestController
public class DataQuality {
    private final AwsClients aws;

    public DataQuality(AwsClients aws) { this.aws = aws; }

    @GetMapping("/api/glue/jobs/{name}/dq")
    public List<Map<String, Object>> results(@PathVariable String name, @RequestParam(required = false) String run, @RequestParam(defaultValue = "20") int max) {
        List<Map<String, Object>> out = new ArrayList<>();
        var r = aws.glue().listDataQualityResults(b -> b.maxResults(Math.min(100, max)).filter(f -> { f.jobName(name); if (run != null && !run.isBlank()) f.jobRunId(run); }));
        for (DataQualityResultDescription d : r.results()) {
            GetDataQualityResultResponse full;
            try { full = aws.glue().getDataQualityResult(b -> b.resultId(d.resultId())); } catch (RuntimeException e) { continue; }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("resultId", d.resultId()); m.put("runId", d.jobRunId()); m.put("startedOn", d.startedOn() == null ? null : d.startedOn().toString());
            m.put("score", full.score()); m.put("evaluationContext", full.evaluationContext()); m.put("rulesetName", full.rulesetName());
            List<Map<String, Object>> rules = new ArrayList<>();
            for (DataQualityRuleResult rr : full.ruleResults()) {
                Map<String, Object> x = new LinkedHashMap<>();
                x.put("name", rr.name()); x.put("description", rr.description()); x.put("result", rr.resultAsString()); x.put("evaluationMessage", rr.evaluationMessage());
                x.put("evaluatedMetrics", rr.evaluatedMetrics());
                rules.add(x);
            }
            m.put("rules", rules);
            List<Map<String, Object>> anal = new ArrayList<>();
            for (var a : full.analyzerResults()) anal.add(Map.of("name", a.name(), "description", a.description() == null ? "" : a.description(), "evaluatedMetrics", a.evaluatedMetrics()));
            m.put("analyzers", anal);
            out.add(m);
        }
        return out;
    }
}
