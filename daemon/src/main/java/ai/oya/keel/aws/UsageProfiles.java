package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
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
import org.springframework.web.bind.annotation.RestController;
import software.amazon.awssdk.services.glue.model.ConfigurationObject;
import software.amazon.awssdk.services.glue.model.ProfileConfiguration;
import software.amazon.awssdk.services.glue.model.UsageProfileDefinition;

/**
 * Usage profiles: the account's guardrails for job and session capacity (defaults, allowed values,
 * min/max), applied at authoring time. A job carries a `ProfileName`; Job details shows it.
 */
@RestController
public class UsageProfiles {
    private final AwsClients aws;

    public UsageProfiles(AwsClients aws) { this.aws = aws; }

    @GetMapping("/api/glue/profiles")
    public List<Map<String, Object>> list() {
        List<Map<String, Object>> out = new ArrayList<>();
        try {
            String next = null;
            do {
                final String token = next;
                var r = aws.glue().listUsageProfiles(b -> b.maxResults(25).nextToken(token));
                for (UsageProfileDefinition d : r.profiles()) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("name", d.name()); m.put("description", d.description());
                    m.put("createdOn", d.createdOn() == null ? null : d.createdOn().toString());
                    out.add(m);
                }
                next = r.nextToken();
            } while (next != null);
        } catch (software.amazon.awssdk.awscore.exception.AwsServiceException e) {
            throw new ApiError(403, "cannot list usage profiles: " + e.awsErrorDetails().errorMessage(), null);
        }
        return out;
    }

    @GetMapping("/api/glue/profiles/{name}")
    public Map<String, Object> get(@PathVariable String name) {
        var r = aws.glue().getUsageProfile(b -> b.name(name));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", r.name()); m.put("description", r.description());
        m.put("createdOn", r.createdOn() == null ? null : r.createdOn().toString());
        m.put("job", params(r.configuration() == null ? null : r.configuration().jobConfiguration()));
        m.put("session", params(r.configuration() == null ? null : r.configuration().sessionConfiguration()));
        return m;
    }

    public record Param(String defaultValue, String allowedValues, String minValue, String maxValue) {}
    public record Body(String description, Map<String, Param> job, Map<String, Param> session) {}

    @PostMapping("/api/glue/profiles/{name}")
    public Map<String, Object> create(@PathVariable String name, @RequestBody Body b) {
        aws.glue().createUsageProfile(x -> x.name(name).description(b.description()).configuration(config(b)));
        return get(name);
    }

    @PutMapping("/api/glue/profiles/{name}")
    public Map<String, Object> update(@PathVariable String name, @RequestBody Body b) {
        aws.glue().updateUsageProfile(x -> x.name(name).description(b.description()).configuration(config(b)));
        return get(name);
    }

    @DeleteMapping("/api/glue/profiles/{name}")
    public Map<String, Object> delete(@PathVariable String name) { aws.glue().deleteUsageProfile(b -> b.name(name)); return Map.of("deleted", name); }

    private static ProfileConfiguration config(Body b) {
        ProfileConfiguration.Builder c = ProfileConfiguration.builder();
        if (b.job() != null) c.jobConfiguration(objects(b.job()));
        if (b.session() != null) c.sessionConfiguration(objects(b.session()));
        return c.build();
    }

    private static Map<String, ConfigurationObject> objects(Map<String, Param> in) {
        Map<String, ConfigurationObject> out = new LinkedHashMap<>();
        in.forEach((k, v) -> out.put(k, ConfigurationObject.builder()
                .defaultValue(blankToNull(v.defaultValue()))
                .allowedValues(v.allowedValues() == null || v.allowedValues().isBlank() ? null : List.of(v.allowedValues().split("\\s*,\\s*")))
                .minValue(blankToNull(v.minValue())).maxValue(blankToNull(v.maxValue())).build()));
        return out;
    }

    private static String blankToNull(String s) { return s == null || s.isBlank() ? null : s; }

    private static Map<String, Object> params(Map<String, ConfigurationObject> in) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (in == null) return out;
        in.forEach((k, v) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("default", v.defaultValue()); m.put("allowed", v.allowedValues()); m.put("min", v.minValue()); m.put("max", v.maxValue());
            out.put(k, m);
        });
        return out;
    }
}
