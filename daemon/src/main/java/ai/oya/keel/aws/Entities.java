package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import software.amazon.awssdk.services.glue.model.CustomEntityType;

/**
 * The console's "Detection entities" page: custom PII patterns that a Detect Sensitive Data node
 * can look for. A pattern is a Java regex plus optional context words, so Keel validates the regex
 * here before AWS sees it.
 */
@RestController
public class Entities {
    /** The managed entity types Glue ships, for the picker beside the custom ones. */
    public static final List<String> MANAGED = List.of("PERSON_NAME", "EMAIL", "CREDIT_CARD", "IP_ADDRESS", "MAC_ADDRESS", "PHONE_NUMBER",
            "USA_PASSPORT_NUMBER", "USA_SSN", "USA_ITIN", "BANK_ACCOUNT", "USA_DRIVING_LICENSE", "USA_HCPCS_CODE", "USA_NATIONAL_DRUG_CODE",
            "USA_NATIONAL_PROVIDER_IDENTIFIER", "USA_DEA_NUMBER", "USA_HEALTH_INSURANCE_CLAIM_NUMBER", "USA_MEDICARE_BENEFICIARY_IDENTIFIER",
            "JAPAN_BANK_ACCOUNT", "JAPAN_DRIVING_LICENSE", "JAPAN_MY_NUMBER", "JAPAN_PASSPORT_NUMBER", "UK_BANK_ACCOUNT", "UK_BANK_SORT_CODE",
            "UK_DRIVING_LICENSE", "UK_NATIONAL_HEALTH_SERVICE_NUMBER", "UK_NATIONAL_INSURANCE_NUMBER", "UK_PASSPORT_NUMBER", "UK_PHONE_NUMBER",
            "UK_UNIQUE_TAXPAYER_REFERENCE_NUMBER", "UK_VALUE_ADDED_TAX", "CANADA_SIN", "CANADA_PASSPORT_NUMBER", "GERMANY_PASSPORT_NUMBER",
            "GERMANY_DRIVING_LICENSE", "FRANCE_PASSPORT_NUMBER", "FRANCE_DRIVING_LICENSE", "SPAIN_NIF_NIE", "ITALY_DRIVING_LICENSE");

    private final AwsClients aws;

    public Entities(AwsClients aws) { this.aws = aws; }

    @GetMapping("/api/glue/entities")
    public Map<String, Object> list() {
        List<Map<String, Object>> custom = new ArrayList<>();
        String next = null;
        try {
            do {
                final String token = next;
                var r = aws.glue().listCustomEntityTypes(b -> b.maxResults(100).nextToken(token));
                for (CustomEntityType t : r.customEntityTypes()) custom.add(toMap(t));
                next = r.nextToken();
            } while (next != null);
        } catch (software.amazon.awssdk.awscore.exception.AwsServiceException e) {
            throw new ApiError(403, "cannot list detection entities: " + e.awsErrorDetails().errorMessage(), null);
        }
        return Map.of("custom", custom, "managed", MANAGED);
    }

    public record Body(String name, String regex, List<String> contextWords) {}

    @PostMapping("/api/glue/entities")
    public Map<String, Object> create(@RequestBody Body b) {
        if (b.name() == null || !b.name().matches("[A-Za-z0-9_-]{1,255}")) throw ApiError.badRequest("a name of letters, digits, dash or underscore");
        validate(b.regex(), null);
        aws.glue().createCustomEntityType(x -> { x.name(b.name()).regexString(b.regex()); if (b.contextWords() != null && !b.contextWords().isEmpty()) x.contextWords(b.contextWords()); });
        var got = aws.glue().getCustomEntityType(x -> x.name(b.name()));
        return toMap(CustomEntityType.builder().name(got.name()).regexString(got.regexString()).contextWords(got.contextWords()).build());
    }

    @DeleteMapping("/api/glue/entities/{name}")
    public Map<String, Object> delete(@PathVariable String name) { aws.glue().deleteCustomEntityType(b -> b.name(name)); return Map.of("deleted", name); }

    public record Check(String regex, String sample) {}

    /** The console's "Validate" button: does the pattern compile, and does it match the sample? */
    @PostMapping("/api/glue/entities/validate")
    public Map<String, Object> validate(@RequestBody Check c) { return validate(c.regex(), c.sample()); }

    private static Map<String, Object> validate(String regex, String sample) {
        Map<String, Object> m = new LinkedHashMap<>();
        if (regex == null || regex.isBlank()) throw ApiError.badRequest("the pattern is empty");
        try {
            Pattern p = Pattern.compile(regex);
            m.put("valid", true);
            if (sample != null && !sample.isEmpty()) {
                var matcher = p.matcher(sample);
                List<String> hits = new ArrayList<>();
                while (matcher.find() && hits.size() < 20) hits.add(matcher.group());
                m.put("matches", hits);
            }
        } catch (PatternSyntaxException e) {
            throw ApiError.badRequest("the pattern does not compile: " + e.getDescription() + " at position " + e.getIndex());
        }
        return m;
    }

    static Map<String, Object> toMap(CustomEntityType t) {
        Map<String, Object> m = new LinkedHashMap<>();
        if (t == null) return m;
        m.put("name", t.name()); m.put("regexString", t.regexString()); m.put("contextWords", t.contextWords());
        return m;
    }
}
