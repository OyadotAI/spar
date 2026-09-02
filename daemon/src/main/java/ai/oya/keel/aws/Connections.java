package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
import com.fasterxml.jackson.databind.JsonNode;
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
import software.amazon.awssdk.services.glue.model.Connection;
import software.amazon.awssdk.services.glue.model.ConnectionInput;
import software.amazon.awssdk.services.glue.model.ConnectionPropertyKey;
import software.amazon.awssdk.services.glue.model.ConnectionType;
import software.amazon.awssdk.services.glue.model.PhysicalConnectionRequirements;

/** The Glue console's Connections page: what a job can attach to, created, edited, tested, deleted. */
@RestController
public class Connections {
    private final AwsClients aws;

    public Connections(AwsClients aws) { this.aws = aws; }

    @GetMapping("/api/glue/connections/full")
    public List<Map<String, Object>> list() {
        List<Map<String, Object>> out = new ArrayList<>();
        String next = null;
        do {
            final String token = next;
            var r = aws.glue().getConnections(b -> b.maxResults(100).nextToken(token));
            for (Connection c : r.connectionList()) out.add(toMap(c));
            next = r.nextToken();
        } while (next != null);
        out.sort((a, b) -> String.valueOf(a.get("name")).compareToIgnoreCase(String.valueOf(b.get("name"))));
        return out;
    }

    @GetMapping("/api/glue/connections/types")
    public List<String> types() {
        List<String> out = new ArrayList<>();
        for (ConnectionType t : ConnectionType.values()) if (t != ConnectionType.UNKNOWN_TO_SDK_VERSION) out.add(t.toString());
        return out;
    }

    public record Body(String name, String type, String description, Map<String, String> properties,
                       String subnetId, List<String> securityGroups, String availabilityZone, List<String> matchCriteria) {}

    @PostMapping("/api/glue/connections")
    public Map<String, Object> create(@RequestBody Body b) {
        if (b.name() == null || b.name().isBlank()) throw ApiError.badRequest("a connection needs a name");
        aws.glue().createConnection(x -> x.connectionInput(input(b)));
        return get(b.name());
    }

    @PutMapping("/api/glue/connections/{name}")
    public Map<String, Object> update(@PathVariable String name, @RequestBody Body b) {
        aws.glue().updateConnection(x -> x.name(name).connectionInput(input(new Body(name, b.type(), b.description(), b.properties(), b.subnetId(), b.securityGroups(), b.availabilityZone(), b.matchCriteria()))));
        return get(name);
    }

    @DeleteMapping("/api/glue/connections/{name}")
    public Map<String, Object> delete(@PathVariable String name) { aws.glue().deleteConnection(b -> b.connectionName(name)); return Map.of("deleted", name); }

    @GetMapping("/api/glue/connections/{name}")
    public Map<String, Object> get(@PathVariable String name) { return toMap(aws.glue().getConnection(b -> b.name(name)).connection()); }

    /** Glue's own connectivity test; it runs in the account and takes a role. */
    @PostMapping("/api/glue/connections/{name}/test")
    public Map<String, Object> test(@PathVariable String name, @RequestBody(required = false) JsonNode body) {
        String role = body == null ? null : body.path("role").asText(null);
        try {
            aws.glue().testConnection(b -> { b.connectionName(name); if (role != null && !role.isBlank()) b.catalogId(null); });
            return Map.of("started", true, "note", "Glue is testing the connection; its result appears in the console's connection page.");
        } catch (software.amazon.awssdk.awscore.exception.AwsServiceException e) {
            throw new ApiError(400, e.awsErrorDetails().errorMessage(), null);
        }
    }

    private static ConnectionInput input(Body b) {
        Map<ConnectionPropertyKey, String> props = new LinkedHashMap<>();
        if (b.properties() != null) b.properties().forEach((k, v) -> { try { props.put(ConnectionPropertyKey.fromValue(k), v); } catch (RuntimeException ignored) { } });
        ConnectionInput.Builder in = ConnectionInput.builder().name(b.name())
                .connectionType(b.type() == null ? ConnectionType.JDBC : ConnectionType.fromValue(b.type()))
                .description(b.description()).connectionProperties(props);
        if (b.matchCriteria() != null) in.matchCriteria(b.matchCriteria());
        if (b.subnetId() != null && !b.subnetId().isBlank()) {
            in.physicalConnectionRequirements(PhysicalConnectionRequirements.builder().subnetId(b.subnetId())
                    .securityGroupIdList(b.securityGroups() == null ? List.of() : b.securityGroups())
                    .availabilityZone(b.availabilityZone()).build());
        }
        return in.build();
    }

    static Map<String, Object> toMap(Connection c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", c.name()); m.put("type", c.connectionTypeAsString()); m.put("description", c.description());
        m.put("status", c.statusAsString()); m.put("statusReason", c.statusReason());
        m.put("createdOn", c.creationTime() == null ? null : c.creationTime().toString());
        m.put("lastUpdated", c.lastUpdatedTime() == null ? null : c.lastUpdatedTime().toString());
        Map<String, String> props = new LinkedHashMap<>();
        c.connectionProperties().forEach((k, v) -> props.put(k.toString(), k.toString().toLowerCase().contains("password") || k.toString().contains("SECRET") ? "••••" : v));
        m.put("properties", props);
        if (c.physicalConnectionRequirements() != null) {
            m.put("subnetId", c.physicalConnectionRequirements().subnetId());
            m.put("securityGroups", c.physicalConnectionRequirements().securityGroupIdList());
            m.put("availabilityZone", c.physicalConnectionRequirements().availabilityZone());
        }
        m.put("matchCriteria", c.matchCriteria());
        return m;
    }
}
