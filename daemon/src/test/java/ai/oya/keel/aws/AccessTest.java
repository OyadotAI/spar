package ai.oya.keel.aws;

import static org.assertj.core.api.Assertions.assertThat;

import ai.oya.keel.State;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AccessTest {
    @Test
    void readsNeedNothingAndEveryMutationNamesItsTier() {
        assertThat(Access.required("GET", "/api/glue/jobs")).isNull();
        assertThat(Access.required("GET", "/api/glue/jobs/x/runs")).isNull();
        assertThat(Access.required("POST", "/api/glue/jobs/x/runs")).isEqualTo("operate");
        assertThat(Access.required("POST", "/api/glue/jobs/x/runs/jr_1/stop")).isEqualTo("operate");
        assertThat(Access.required("POST", "/api/glue/sessions")).isEqualTo("operate");
        assertThat(Access.required("POST", "/api/jobs/x/deploy")).isEqualTo("author");
        assertThat(Access.required("DELETE", "/api/glue/jobs/x")).isEqualTo("author");
        assertThat(Access.required("POST", "/api/glue/jobs/x/role/grant")).isEqualTo("roleGrant");
        // Local work is never gated: the whole point is that it needs no account at all.
        assertThat(Access.required("PUT", "/api/jobs/x/dag")).isNull();
        assertThat(Access.required("POST", "/api/jobs/x/generate")).isNull();
        assertThat(Access.required("GET", "/api/jobs/x/run/local")).isNull();
        assertThat(Access.required("DELETE", "/api/jobs/x/bookmark/local")).isNull();
        assertThat(Access.required("POST", "/api/engine/start")).isNull();
        assertThat(Access.required("POST", "/api/jobs/x/samples/n1/synthetic")).isNull();
        // Turning a tier on cannot itself require that tier.
        assertThat(Access.required("POST", "/api/aws/tiers/author")).isNull();
    }

    @Test
    void tiersAreOffUntilTurnedOnAndSurviveARestart(@TempDir Path dir) {
        ObjectMapper om = new ObjectMapper();
        State s = new State(dir.toString(), om);
        assertThat(s.tier("read")).isTrue();
        assertThat(s.tier("author")).isFalse();
        s.setTier("author", true);
        assertThat(new State(dir.toString(), om).tier("author")).isTrue();
        assertThat(new State(dir.toString(), om).tier("operate")).isFalse();
    }

    @Test
    void policiesAreScopedToTheAccountAndTheBucketsInUse(@TempDir Path dir) {
        ObjectMapper om = new ObjectMapper();
        State s = new State(dir.toString(), om);
        s.set("default", "us-east-2", "my-scripts");
        Map<String, Object> doc = Policies.document("read", s, "111122223333", List.of("my-scripts"));
        String text = doc.toString();
        assertThat(text).contains("arn:aws:glue:us-east-2:111122223333:*");
        assertThat(text).contains("arn:aws:s3:::my-scripts/*");
        assertThat(text).doesNotContain("glue:CreateJob");
        assertThat(Policies.document("author", s, "111122223333", List.of()).toString()).contains("glue:CreateJob");
        // Read really is read: nothing in it can change an account.
        for (String a : Policies.read())
            assertThat(a).matches("^(glue:(Get|List|BatchGet|Query).*|logs:(Describe|Get|Filter|Start).*|cloudwatch:(Get|List).*|s3:(Get|List).*|sts:GetCallerIdentity)$");
    }

    @Test
    void aDenialSaysWhichFeatureItTakesAway() {
        assertThat(Access.disables("read", List.of("logs:GetLogEvents"))).containsExactly("Logs for a run");
        assertThat(Access.disables("operate", List.of("glue:StartJobRun"))).containsExactly("Run");
        assertThat(Access.disables("read", List.of())).isEmpty();
    }
}
