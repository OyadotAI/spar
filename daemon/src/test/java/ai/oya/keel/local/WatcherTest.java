package ai.oya.keel.local;

import static org.assertj.core.api.Assertions.assertThat;

import ai.oya.keel.Events;
import ai.oya.keel.State;
import ai.oya.keel.git.Lanes;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class WatcherTest {
    @Test
    void anOutsideEditBumpsTheRevAndAKeelWriteDoesNot(@TempDir Path dir) throws Exception {
        ObjectMapper om = new ObjectMapper();
        State state = new State(dir.toRealPath().toString(), om);
        List<Map<?, ?>> seen = new CopyOnWriteArrayList<>();
        Events events = new Events() { @Override public void emit(String kind, Object data) { if (kind.equals("job.changed")) seen.add((Map<?, ?>) data); } };
        Project project = new Project(state, new Lanes(state), events, om);
        Watcher w = new Watcher(state, project, events);
        w.start();
        try {
            Thread.sleep(500); // the native watcher needs a beat before it reports
            project.writeDag("orders", om.readTree("{\"a\":{\"S3CsvSource\":{\"Name\":\"A\",\"Paths\":[]}}}"), null, null);
            long afterOwn = project.rev("orders");
            Thread.sleep(2500);
            assertThat(seen.stream().filter(m -> Boolean.TRUE.equals(m.get("outside"))).count()).as("own write must not double-fire").isZero();
            Files.writeString(project.dir("orders").resolve("dag.json"), "{\"a\":{\"S3CsvSource\":{\"Name\":\"Edited outside\",\"Paths\":[]}}}\n");
            for (int i = 0; i < 100 && seen.stream().noneMatch(m -> Boolean.TRUE.equals(m.get("outside"))); i++) Thread.sleep(100);
            assertThat(seen).anySatisfy(m -> { assertThat(m.get("outside")).isEqualTo(true); assertThat(m.get("name")).isEqualTo("orders"); });
            assertThat(project.rev("orders")).isGreaterThan(afterOwn);
        } finally {
            w.stop();
        }
    }
}
