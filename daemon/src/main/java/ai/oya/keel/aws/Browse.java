package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import software.amazon.awssdk.services.glue.model.Column;
import software.amazon.awssdk.services.glue.model.Database;
import software.amazon.awssdk.services.glue.model.Table;
import software.amazon.awssdk.services.s3.model.CommonPrefix;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.S3Object;

/** What the node panel browses: Data Catalog databases and tables, S3 buckets and prefixes, connections. */
@RestController
public class Browse {
    private final AwsClients aws;

    public Browse(AwsClients aws) { this.aws = aws; }

    @GetMapping("/api/glue/catalog/databases")
    public List<Map<String, Object>> databases() {
        List<Map<String, Object>> out = new ArrayList<>();
        String next = null;
        do {
            final String token = next;
            var r = aws.glue().getDatabases(b -> b.maxResults(100).nextToken(token));
            for (Database d : r.databaseList()) out.add(Map.of("name", d.name(), "description", d.description() == null ? "" : d.description(), "location", d.locationUri() == null ? "" : d.locationUri()));
            next = r.nextToken();
        } while (next != null);
        return out;
    }

    @GetMapping("/api/glue/catalog/tables")
    public List<Map<String, Object>> tables(@RequestParam String database) {
        List<Map<String, Object>> out = new ArrayList<>();
        String next = null;
        do {
            final String token = next;
            var r = aws.glue().getTables(b -> b.databaseName(database).maxResults(100).nextToken(token));
            for (Table t : r.tableList()) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("name", t.name());
                m.put("type", t.tableType());
                m.put("location", t.storageDescriptor() == null ? "" : t.storageDescriptor().location());
                List<Map<String, String>> cols = new ArrayList<>();
                if (t.storageDescriptor() != null) for (Column c : t.storageDescriptor().columns()) cols.add(Map.of("Name", c.name(), "Type", c.type() == null ? "string" : c.type()));
                for (Column c : t.partitionKeys()) cols.add(Map.of("Name", c.name(), "Type", c.type() == null ? "string" : c.type()));
                m.put("columns", cols);
                out.add(m);
            }
            next = r.nextToken();
        } while (next != null);
        return out;
    }

    /** `uri` is `s3://` (buckets) or `s3://bucket/prefix/` (one level of prefixes and objects). */
    @GetMapping("/api/s3/ls")
    public Map<String, Object> ls(@RequestParam(defaultValue = "s3://") String uri) {
        Map<String, Object> out = new LinkedHashMap<>();
        List<Map<String, Object>> entries = new ArrayList<>();
        if (uri.equals("s3://") || uri.equals("s3:/") || uri.isBlank()) {
            for (var b : aws.s3().listBuckets().buckets()) entries.add(Map.of("name", b.name(), "uri", "s3://" + b.name() + "/", "dir", true));
            out.put("uri", "s3://");
        } else {
            GlueService.S3Uri u = GlueService.S3Uri.parse(uri.endsWith("/") ? uri : uri + "/");
            String prefix = u.key();
            ListObjectsV2Response r = aws.s3().listObjectsV2(b -> b.bucket(u.bucket()).prefix(prefix).delimiter("/").maxKeys(500));
            for (CommonPrefix p : r.commonPrefixes()) entries.add(Map.of("name", p.prefix().substring(prefix.length()).replaceAll("/$", ""), "uri", "s3://" + u.bucket() + "/" + p.prefix(), "dir", true));
            for (S3Object o : r.contents()) { if (o.key().equals(prefix)) continue; entries.add(Map.of("name", o.key().substring(prefix.length()), "uri", "s3://" + u.bucket() + "/" + o.key(), "dir", false, "size", o.size(), "modified", o.lastModified().toString())); }
            out.put("uri", "s3://" + u.bucket() + "/" + prefix);
            out.put("truncated", r.isTruncated());
        }
        out.put("entries", entries);
        return out;
    }

    @GetMapping("/api/glue/connections")
    public List<Map<String, Object>> connections() {
        List<Map<String, Object>> out = new ArrayList<>();
        try {
            var r = aws.glue().getConnections(b -> b.maxResults(200));
            for (var c : r.connectionList()) out.add(Map.of("name", c.name(), "type", c.connectionTypeAsString(), "description", c.description() == null ? "" : c.description()));
        } catch (software.amazon.awssdk.awscore.exception.AwsServiceException e) {
            throw new ApiError(403, "cannot list connections: " + e.awsErrorDetails().errorMessage(), null);
        }
        return out;
    }
}
