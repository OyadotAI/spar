package ai.oya.keel.aws;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import ai.oya.keel.Events;
import ai.oya.keel.State;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import software.amazon.awssdk.services.glue.model.Job;
import software.amazon.awssdk.services.glue.model.JobCommand;

class SyncTest {
    record Emitted(String kind, Object data) {}

    static class RecordingEvents extends Events {
        final List<Emitted> out = new ArrayList<>();
        @Override public void emit(String kind, Object data) { out.add(new Emitted(kind, data)); }
        @Override public boolean hasSubscribers() { return true; }
    }

    static Job job(String name, Instant modified) {
        return Job.builder().name(name).jobMode("VISUAL").glueVersion("5.0").lastModifiedOn(modified)
                .command(JobCommand.builder().name("glueetl").scriptLocation("s3://b/" + name + ".py").build()).build();
    }

    static RunInfo run(String id, String state) {
        return new RunInfo(id, 1, state, null, null, Instant.parse("2026-09-02T10:00:00Z"), null, null, null, Map.of(), null, null, null, null, null, null, null, null);
    }

    @Test
    void inventoryDiffsNamesAndRunsTierByState() throws Exception {
        GlueService glue = mock(GlueService.class);
        State state = mock(State.class);
        when(state.profile()).thenReturn("dev");
        AwsClients aws = mock(AwsClients.class);
        when(aws.region()).thenReturn("eu-west-1");
        RecordingEvents events = new RecordingEvents();
        JobsCache cache = new JobsCache();
        Sync sync = new Sync(glue, cache, events, state, aws);

        // first pass: two jobs appear
        when(glue.listJobNames()).thenReturn(List.of("a", "b"));
        when(glue.batchGet(anyList())).thenAnswer(inv -> ((List<String>) inv.getArgument(0)).stream().map(n -> job(n, Instant.EPOCH)).toList());
        invoke(sync, "inventory");
        assertThat(cache.names()).containsExactlyInAnyOrder("a", "b");
        assertThat(events.out).anySatisfy(e -> {
            assertThat(e.kind()).isEqualTo("jobs.changed");
            assertThat(((Map<?, ?>) e.data()).get("added")).isEqualTo(List.of("a", "b"));
        });

        // runs: a is RUNNING (hot, due again in 3s), b SUCCEEDED (cold, due after the sweep)
        when(glue.latestRun("a")).thenReturn(run("r1", "RUNNING"));
        when(glue.latestRun("b")).thenReturn(run("r2", "SUCCEEDED"));
        invoke(sync, "runs");
        // everything was due at EPOCH after inventory
        assertThat(cache.get("a").latestRun().state()).isEqualTo("RUNNING");
        assertThat(cache.get("b").latestRun().state()).isEqualTo("SUCCEEDED");
        assertThat(events.out.stream().filter(e -> e.kind().equals("run.changed")).count()).isEqualTo(2);
        assertThat(cache.hot("a")).isTrue();
        assertThat(cache.hot("b")).isFalse();

        // same answer again: nothing emitted
        int before = events.out.size();
        setDue(sync, "a"); setDue(sync, "b");
        invoke(sync, "runs");
        assertThat(events.out).hasSize(before);

        // b disappears, c arrives
        when(glue.listJobNames()).thenReturn(List.of("a", "c"));
        invoke(sync, "inventory");
        assertThat(cache.names()).containsExactlyInAnyOrder("a", "c");
        Emitted last = events.out.get(events.out.size() - 1);
        assertThat(last.kind()).isEqualTo("jobs.changed");
        assertThat(((Map<?, ?>) last.data()).get("removed")).isEqualTo(List.of("b"));

        // a definition edit moves LastModifiedOn → job.changed with remote
        when(glue.batchGet(anyList())).thenAnswer(inv -> ((List<String>) inv.getArgument(0)).stream().map(n -> job(n, Instant.parse("2026-09-02T11:00:00Z"))).toList());
        invoke(sync, "definitions");
        assertThat(events.out.get(events.out.size() - 1).kind()).isEqualTo("job.changed");
    }

    @Test
    void bucketRefillsAtRate() throws Exception {
        Sync.Bucket b = new Sync.Bucket(1000, 2);
        assertThat(b.tryTake()).isTrue();
        assertThat(b.tryTake()).isTrue();
        assertThat(b.tryTake()).isFalse();
        Thread.sleep(5);
        assertThat(b.tryTake()).isTrue();
    }

    private static void invoke(Sync s, String method) throws Exception {
        var m = Sync.class.getDeclaredMethod(method);
        m.setAccessible(true);
        m.invoke(s);
    }

    @SuppressWarnings("unchecked")
    private static void setDue(Sync s, String name) throws Exception {
        var f = Sync.class.getDeclaredField("due");
        f.setAccessible(true);
        ((Map<String, Instant>) f.get(s)).put(name, Instant.EPOCH);
    }
}
