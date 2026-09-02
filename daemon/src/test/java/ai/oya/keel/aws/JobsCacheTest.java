package ai.oya.keel.aws;

import static org.assertj.core.api.Assertions.assertThat;

import ai.oya.keel.State;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class JobsCacheTest {
    private static JobSummary job(String name) {
        return new JobSummary(name, "VISUAL", "5.0", "G.1X", 2, "glueetl", "s3://b/s.py", "arn:role",
                Instant.parse("2026-01-01T00:00:00Z"), Instant.parse("2026-01-02T00:00:00Z"), 480, 0, "STANDARD",
                new RunInfo("jr_1", 1, "SUCCEEDED", null, null, Instant.parse("2026-01-02T00:00:00Z"),
                        Instant.parse("2026-01-02T00:01:00Z"), 60, 120.0, Map.of(), "/aws-glue/jobs", "5.0", "G.1X", 2, null, null, null, 0.03),
                Map.of());
    }

    @Test
    void theListingSurvivesTheProcessAndBelongsToItsProfile(@TempDir Path dir) {
        ObjectMapper om = new ObjectMapper().findAndRegisterModules();
        State state = new State(dir.toString(), om);
        state.set("dev", "us-east-2", null);
        JobsCache a = new JobsCache(state, om);
        a.put(job("orders"));
        a.put(job("customers"));
        a.markRefreshed();

        // A fresh process draws the last listing before AWS has answered anything, marked stale.
        JobsCache b = new JobsCache(state, om);
        b.loadFromDisk();
        assertThat(b.names()).containsExactlyInAnyOrder("orders", "customers");
        assertThat(b.stale()).isTrue();
        assertThat(b.filled()).isFalse();
        assertThat(b.get("orders").latestRun().id()).isEqualTo("jr_1");
        assertThat(b.refreshedAt()).isNotNull();

        // Another profile's jobs are not these jobs.
        state.set("prod", "us-east-2", null);
        JobsCache c = new JobsCache(state, om);
        c.loadFromDisk();
        assertThat(c.names()).isEmpty();
        assertThat(c.stale()).isFalse();
    }
}
