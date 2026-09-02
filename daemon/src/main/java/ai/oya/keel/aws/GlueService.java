package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
import ai.oya.keel.Proc;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.glue.model.BatchGetJobsResponse;
import software.amazon.awssdk.services.glue.model.BatchStopJobRunResponse;
import software.amazon.awssdk.services.glue.model.GetJobRunsResponse;
import software.amazon.awssdk.services.glue.model.Job;
import software.amazon.awssdk.services.glue.model.JobRun;
import software.amazon.awssdk.services.glue.model.ListJobsResponse;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

/**
 * Glue, typed where the SDK's shapes are convenient (listing, runs) and passed through the `aws`
 * CLI as verbatim API JSON where they are not: a job definition with its DAG is a large nested
 * document that the app, the files on disk and Glue must all agree on byte for byte.
 */
@Service
public class GlueService {
    private final AwsClients aws;
    private final ObjectMapper json;

    public GlueService(AwsClients aws, ObjectMapper json) { this.aws = aws; this.json = json; }

    public List<String> listJobNames() {
        List<String> out = new ArrayList<>();
        String next = null;
        do {
            final String token = next;
            ListJobsResponse r = aws.glue().listJobs(b -> b.maxResults(1000).nextToken(token));
            out.addAll(r.jobNames());
            next = r.nextToken();
        } while (next != null);
        return out;
    }

    public List<Job> batchGet(List<String> names) {
        List<Job> out = new ArrayList<>();
        for (int i = 0; i < names.size(); i += 100) {
            List<String> chunk = names.subList(i, Math.min(names.size(), i + 100));
            BatchGetJobsResponse r = aws.glue().batchGetJobs(b -> b.jobNames(chunk));
            out.addAll(r.jobs());
        }
        return out;
    }

    public Job getJob(String name) {
        return aws.glue().getJob(b -> b.jobName(name)).job();
    }

    public GetJobRunsResponse runs(String name, int max, String next) {
        return aws.glue().getJobRuns(b -> b.jobName(name).maxResults(Math.min(200, Math.max(1, max))).nextToken(next));
    }

    public RunInfo latestRun(String name) {
        List<JobRun> rs = runs(name, 1, null).jobRuns();
        return rs.isEmpty() ? null : RunInfo.of(rs.get(0));
    }

    public RunInfo run(String name, String id) {
        return RunInfo.of(aws.glue().getJobRun(b -> b.jobName(name).runId(id)).jobRun());
    }

    public String start(String name, Map<String, String> args, String retryOf) {
        return aws.glue().startJobRun(b -> {
            b.jobName(name);
            if (args != null && !args.isEmpty()) b.arguments(args);
            if (retryOf != null && !retryOf.isBlank()) b.jobRunId(retryOf);
        }).jobRunId();
    }

    public BatchStopJobRunResponse stop(String name, String id) {
        return aws.glue().batchStopJobRun(b -> b.jobName(name).jobRunIds(id));
    }

    // ---- verbatim JSON through the CLI ----------------------------------------------------------

    /** The `Job` object exactly as the API returns it (CodeGenConfigurationNodes and all). */
    public JsonNode getJobJson(String name) {
        Proc.Result r = cli("glue", "get-job", "--job-name", name);
        try { return json.readTree(r.stdout()).path("Job"); }
        catch (IOException e) { throw new ApiError(500, "get-job returned something that is not JSON"); }
    }

    public void updateJob(String name, JsonNode jobUpdate) {
        Path f = temp(jobUpdate);
        try { cli("glue", "update-job", "--job-name", name, "--job-update", "file://" + f); }
        finally { delete(f); }
    }

    public String createJob(JsonNode job) {
        Path f = temp(job);
        try {
            Proc.Result r = cli("glue", "create-job", "--cli-input-json", "file://" + f);
            return json.readTree(r.stdout()).path("Name").asText();
        } catch (IOException e) { throw new ApiError(500, "create-job returned something that is not JSON"); }
        finally { delete(f); }
    }

    public boolean jobExists(String name) {
        try { getJob(name); return true; }
        catch (software.amazon.awssdk.services.glue.model.EntityNotFoundException e) { return false; }
    }

    private Proc.Result cli(String... args) {
        List<String> cmd = new ArrayList<>(List.of("aws"));
        cmd.addAll(List.of(args));
        cmd.addAll(List.of("--output", "json", "--profile", aws.profile(), "--region", aws.region()));
        Proc.Result r = Proc.run(null, 90, Map.of("AWS_PAGER", ""), cmd.toArray(String[]::new));
        if (!r.ok()) {
            String err = r.stderr().strip();
            if (err.contains("EntityNotFoundException")) throw ApiError.notFound(err);
            throw new ApiError(502, "aws " + args[0] + " " + args[1] + " failed: " + (err.isEmpty() ? "exit " + r.code() : err));
        }
        return r;
    }

    private Path temp(JsonNode node) {
        try {
            Path f = Files.createTempFile("keel-glue-", ".json");
            Files.writeString(f, json.writeValueAsString(node));
            return f;
        } catch (IOException e) { throw new ApiError(500, "cannot write a temp file: " + e.getMessage()); }
    }

    private static void delete(Path f) { try { Files.deleteIfExists(f); } catch (IOException ignored) { } }

    // ---- S3 scripts ------------------------------------------------------------------------------

    public record S3Uri(String bucket, String key) {
        public static S3Uri parse(String uri) {
            if (uri == null || !uri.startsWith("s3://")) throw ApiError.badRequest("not an s3:// URI: " + uri);
            String rest = uri.substring(5);
            int slash = rest.indexOf('/');
            if (slash <= 0) throw ApiError.badRequest("an S3 URI needs a bucket and a key: " + uri);
            return new S3Uri(rest.substring(0, slash), rest.substring(slash + 1));
        }
    }

    public String getScript(String s3Uri) {
        S3Uri u = S3Uri.parse(s3Uri);
        ResponseBytes<?> b = aws.s3().getObjectAsBytes(GetObjectRequest.builder().bucket(u.bucket()).key(u.key()).build());
        return b.asUtf8String();
    }

    public void putScript(String s3Uri, String body) {
        S3Uri u = S3Uri.parse(s3Uri);
        aws.s3().putObject(PutObjectRequest.builder().bucket(u.bucket()).key(u.key()).contentType("text/x-python").build(),
                RequestBody.fromString(body));
    }
}
