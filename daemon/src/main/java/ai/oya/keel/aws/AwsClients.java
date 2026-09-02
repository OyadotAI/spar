package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
import ai.oya.keel.State;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.ProfileCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.cloudtrail.CloudTrailClient;
import software.amazon.awssdk.services.cloudwatchlogs.CloudWatchLogsClient;
import software.amazon.awssdk.services.eventbridge.EventBridgeClient;
import software.amazon.awssdk.services.glue.GlueClient;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sts.StsClient;

/**
 * One set of SDK clients for the selected profile, rebuilt when the profile or region changes.
 * Credentials come from the profile (SSO included — `sso` and `ssooidc` are on the classpath for
 * exactly that), never from anything Keel stores.
 */
@Component
public class AwsClients {
    private final State state;
    private String key;
    private GlueClient glue;
    private CloudWatchLogsClient logs;
    private S3Client s3;
    private StsClient sts;
    private SqsClient sqs;
    private EventBridgeClient events;
    private CloudTrailClient trail;

    public AwsClients(State state) { this.state = state; }

    public synchronized GlueClient glue() { ensure(); return glue; }
    public synchronized CloudWatchLogsClient logs() { ensure(); return logs; }
    public synchronized S3Client s3() { ensure(); return s3; }
    public synchronized StsClient sts() { ensure(); return sts; }
    public synchronized SqsClient sqs() { ensure(); return sqs; }
    public synchronized EventBridgeClient eventBridge() { ensure(); return events; }
    public synchronized CloudTrailClient cloudTrail() { ensure(); return trail; }

    /** The profile the clients are built for, or a 400 the app turns into "pick a profile". */
    public String profile() {
        String p = state.profile();
        if (p == null || p.isBlank()) throw new ApiError(400, "no AWS profile selected", "choose a profile in Settings");
        return p;
    }

    public String region() {
        String r = state.region();
        if (r != null && !r.isBlank()) return r;
        String fromProfile = Profiles.region(profile());
        return fromProfile != null ? fromProfile : "us-east-1";
    }

    public synchronized void reset() { close(); key = null; }

    private void ensure() {
        String want = profile() + "@" + region();
        if (want.equals(key)) return;
        close();
        AwsCredentialsProvider creds = ProfileCredentialsProvider.builder().profileName(profile()).build();
        Region r = Region.of(region());
        glue = GlueClient.builder().credentialsProvider(creds).region(r).build();
        logs = CloudWatchLogsClient.builder().credentialsProvider(creds).region(r).build();
        s3 = S3Client.builder().credentialsProvider(creds).region(r).build();
        sts = StsClient.builder().credentialsProvider(creds).region(r).build();
        sqs = SqsClient.builder().credentialsProvider(creds).region(r).build();
        events = EventBridgeClient.builder().credentialsProvider(creds).region(r).build();
        trail = CloudTrailClient.builder().credentialsProvider(creds).region(r).build();
        key = want;
    }

    private void close() {
        for (AutoCloseable c : new AutoCloseable[] {glue, logs, s3, sts, sqs, events, trail}) {
            try { if (c != null) c.close(); } catch (Exception ignored) { /* closing is best effort */ }
        }
        glue = null; logs = null; s3 = null; sts = null; sqs = null; events = null; trail = null;
    }
}
