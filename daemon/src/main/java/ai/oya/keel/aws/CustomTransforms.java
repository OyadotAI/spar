package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
import ai.oya.keel.State;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import software.amazon.awssdk.services.s3.model.S3Object;

/**
 * Glue Studio's extra visual transforms — Flatten, To timestamp, Concatenate, Lookup and the rest —
 * are not API node types. They are **custom visual transforms**: a `.json` config and a `.py` beside
 * it in the account's Glue assets bucket, which the console reads to build a form and which deploy
 * as `DynamicTransform` nodes. Keel reads the same files, so the palette shows what this account has.
 */
@RestController
public class CustomTransforms {
    private final AwsClients aws;
    private final State state;
    private final ObjectMapper json;

    public CustomTransforms(AwsClients aws, State state, ObjectMapper json) { this.aws = aws; this.state = state; this.json = json; }

    /** Where the console keeps them: `s3://aws-glue-assets-<account>-<region>/transforms/`. */
    String bucket() {
        String b = state.scriptBucket();
        if (b != null && !b.isBlank()) return b;
        return "aws-glue-assets-" + aws.sts().getCallerIdentity().account() + "-" + aws.region();
    }

    @GetMapping("/api/glue/transforms")
    public Map<String, Object> list(@RequestParam(required = false) String prefix) {
        String bucket = bucket();
        String key = prefix == null || prefix.isBlank() ? "transforms/" : prefix;
        List<Map<String, Object>> out = new ArrayList<>();
        List<String> problems = new ArrayList<>();
        try {
            var r = aws.s3().listObjectsV2(b -> b.bucket(bucket).prefix(key).maxKeys(500));
            for (S3Object o : r.contents()) {
                if (!o.key().endsWith(".json")) continue;
                try {
                    String text = aws.s3().getObjectAsBytes(b -> b.bucket(bucket).key(o.key())).asUtf8String();
                    JsonNode c = json.readTree(text);
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("key", o.key());
                    m.put("path", "s3://" + bucket + "/" + o.key().replaceAll("\\.json$", ".py"));
                    m.put("name", c.path("name").asText(o.key().replaceAll(".*/", "").replaceAll("\\.json$", "")));
                    m.put("displayName", c.path("displayName").asText(c.path("name").asText("")));
                    m.put("description", c.path("description").asText(""));
                    m.put("functionName", c.path("functionName").asText(c.path("name").asText("")));
                    m.put("version", c.path("version").asText("1.0"));
                    List<Map<String, Object>> params = new ArrayList<>();
                    for (JsonNode p : c.path("parameters")) {
                        Map<String, Object> q = new LinkedHashMap<>();
                        q.put("name", p.path("name").asText());
                        q.put("displayName", p.path("displayName").asText(p.path("name").asText()));
                        q.put("type", p.path("type").asText("str"));
                        q.put("isOptional", p.path("isOptional").asBoolean(false));
                        q.put("description", p.path("description").asText(""));
                        q.put("validationRule", p.path("validationRule").asText(""));
                        q.put("validationMessage", p.path("validationMessage").asText(""));
                        List<String> opts = new ArrayList<>();
                        for (JsonNode o2 : p.path("listOptions")) opts.add(o2.isTextual() ? o2.asText() : o2.path("value").asText());
                        q.put("listOptions", opts);
                        q.put("listType", p.path("listType").asText(""));
                        params.add(q);
                    }
                    m.put("parameters", params);
                    out.add(m);
                } catch (RuntimeException | java.io.IOException e) {
                    problems.add(o.key() + ": " + e.getMessage());
                }
            }
        } catch (software.amazon.awssdk.awscore.exception.AwsServiceException e) {
            throw new ApiError(e.statusCode() == 403 ? 403 : 404,
                    "cannot read s3://" + bucket + "/" + key + ": " + e.awsErrorDetails().errorMessage(),
                    "custom visual transforms live in the Glue assets bucket; set the script bucket in Settings if yours differs");
        }
        out.sort((a, b) -> String.valueOf(a.get("displayName")).compareToIgnoreCase(String.valueOf(b.get("displayName"))));
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("bucket", bucket); res.put("prefix", key); res.put("transforms", out);
        if (!problems.isEmpty()) res.put("problems", problems);
        return res;
    }
}
