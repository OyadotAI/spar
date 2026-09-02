package ai.oya.keel.local;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ai.oya.keel.ApiError;
import ai.oya.keel.Events;
import ai.oya.keel.State;
import ai.oya.keel.git.Lanes;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ProjectTest {
    @Test
    void dagPutRejectsStaleRevAndValidates(@TempDir Path dir) throws Exception {
        ObjectMapper om = new ObjectMapper();
        State state = new State(dir.toString(), om);
        Project p = new Project(state, new Lanes(state), new Events(), om);
        JsonNode dag = om.readTree(Files.readString(Path.of("src/test/resources/fixtures/dag-simple.json")));
        long rev = p.writeDag("orders", dag, null, null);
        assertThat(rev).isEqualTo(2);
        assertThat(Files.exists(dir.resolve("jobs/orders/dag.json"))).isTrue();
        assertThatThrownBy(() -> p.writeDag("orders", dag, null, 1L)).isInstanceOf(ApiError.class).hasMessageContaining("rev");
        assertThat(p.writeDag("orders", dag, null, 2L)).isEqualTo(3);
        JsonNode bad = om.readTree("{\"a\":{\"Filter\":{\"Name\":\"A\",\"Inputs\":[\"nope\"]}}}");
        assertThatThrownBy(() -> p.writeDag("orders", bad, null, null)).hasMessageContaining("does not exist");
        JsonNode twoKeys = om.readTree("{\"a\":{\"Filter\":{\"Name\":\"A\"},\"X\":{}}}");
        assertThatThrownBy(() -> Project.validateDag(twoKeys)).hasMessageContaining("exactly one key");
        assertThat(p.read("orders").get("rev")).isEqualTo(3L);
        assertThatThrownBy(() -> p.dir("../x")).isInstanceOf(ApiError.class);
    }
}
