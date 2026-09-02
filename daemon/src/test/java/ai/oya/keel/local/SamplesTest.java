package ai.oya.keel.local;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ai.oya.keel.ApiError;
import ai.oya.keel.Events;
import ai.oya.keel.State;
import ai.oya.keel.codegen.Dag;
import ai.oya.keel.codegen.PySpark;
import ai.oya.keel.git.Lanes;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SamplesTest {
    private static JsonNode dag(ObjectMapper om) throws Exception {
        return om.readTree(Files.readString(Path.of("src/test/resources/fixtures/dag-simple.json")));
    }

    @Test
    void synthesisesRowsThatSurviveTheWholeDag(@TempDir Path dir) throws Exception {
        ObjectMapper om = new ObjectMapper();
        State state = new State(dir.toString(), om);
        Project p = new Project(state, new Lanes(state), new Events(), om);
        p.writeDag("orders", dag(om), null, null);
        Samples s = new Samples(p, om);

        Map<String, Object> made = s.synthesise("orders", "n-orders", 4);
        assertThat(made).containsEntry("rows", 4).containsEntry("kind", "synthetic");
        List<String> lines = Files.readAllLines(dir.resolve("jobs/orders/samples/n-orders.json")).stream().filter(l -> !l.isBlank()).toList();
        assertThat(lines).hasSize(4);
        JsonNode first = om.readTree(lines.get(0));
        // The Filter downstream wants status = paid, and ApplyMapping casts amount to double: rows
        // that ignore either of those produce an empty pipeline and a mystifying green run.
        assertThat(first.get("status").asText()).isEqualTo("paid");
        assertThat(Double.parseDouble(first.get("amount").asText())).isEqualTo(1.5);
        assertThat(Integer.parseInt(first.get("order_id").asText())).isEqualTo(1);

        // Captured rows are gitignored until somebody says otherwise, one job at a time.
        String ignore = Files.readString(dir.resolve("jobs/.gitignore"));
        assertThat(ignore).contains("*/samples/**");
        assertThat(s.committed("orders")).isFalse();
        s.commit("orders", true);
        assertThat(s.committed("orders")).isTrue();

        assertThat(s.shimManifest("orders")).contains("\"n-orders\"").contains("samples/n-orders.json");
        Dag d = Dag.parse(dag(om));
        assertThat(s.missing("orders", d, "n-agg")).containsExactly("n-customers");
        s.synthesise("orders", "n-customers", 2);
        assertThat(s.missing("orders", d, "n-agg")).isEmpty();
        assertThat(s.status("orders")).containsEntry("ready", true);

        s.clear("orders", "n-customers");
        assertThat(s.missing("orders", d, "n-agg")).containsExactly("n-customers");
        assertThatThrownBy(() -> s.synthesise("orders", "nope", 1)).isInstanceOf(ApiError.class);
    }

    @Test
    void localRunScriptInstallsTheShimAndCountsEveryNode(@TempDir Path dir) throws Exception {
        ObjectMapper om = new ObjectMapper();
        Dag d = Dag.parse(dag(om));
        PySpark.Generated gen = PySpark.generate(dag(om));
        String script = LocalRun.script(d, gen.names(), "{\"n-orders\": {\"path\": \"samples/n-orders.json\"}}", null);
        assertThat(script).contains("keel_local.install(glueContext");
        assertThat(script).contains("keel_local.watch(glueContext, stats, \"n-agg\"");
        assertThat(script).contains("KEEL_RUN_JSON:");
        for (String id : d.nodes.keySet()) assertThat(script).contains("stats, \"" + id + "\"");
        // Without bookmarks the shim is told so explicitly, rather than being handed an empty state.
        assertThat(script).contains(", None, consumed)");
        assertThat(LocalRun.script(d, gen.names(), "{}", "{\"n-orders\": []}")).contains("\\\"n-orders\\\": []");
        assertThat(LocalRun.notCovered(d)).isEmpty();
        assertThat(dir).exists();
    }
}
