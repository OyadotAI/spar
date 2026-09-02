package ai.oya.keel.codegen;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ai.oya.keel.ApiError;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;

class PySparkTest {
    static JsonNode dag() throws Exception { return new ObjectMapper().readTree(Files.readString(Path.of("src/test/resources/fixtures/dag-simple.json"))); }

    @Test
    void goldenSimplePipeline() throws Exception {
        PySpark.Generated g = PySpark.generate(dag());
        Path golden = Path.of("src/test/resources/fixtures/job-simple.py");
        if (!Files.exists(golden)) { Files.writeString(golden, g.script()); }
        assertThat(g.script()).isEqualTo(Files.readString(golden));
        assertThat(g.ranges()).containsKeys("n-orders", "n-customers", "n-map", "n-paid", "n-join", "n-agg", "n-out");
        String[] lines = g.script().split("\n");
        for (Map.Entry<String, int[]> e : g.ranges().entrySet()) {
            assertThat(lines[e.getValue()[0] - 1]).as(e.getKey()).startsWith("def ");
            assertThat(e.getValue()[1]).isGreaterThan(e.getValue()[0]);
        }
        assertThat(g.script()).contains("def only_paid(glueContext, map_orders):")
                .contains("lambda row: (row[\"status\"] == \"paid\") and (row[\"amount\"] > 0)")
                .contains("Join.apply(frame1=only_paid, frame2=customers_csv, keys1=[\"customer_id\"], keys2=[\"customer_id\"]")
                .contains("F.sum(\"amount\").alias(\"amount_sum\"), F.count(\"order_id\").alias(\"order_id_count\")")
                .contains("f_revenue_csv = revenue_csv(glueContext, f_revenue_by_country)");
        Map<String, String> tests = TestGen.generate(dag(), g);
        assertThat(tests).containsKeys("tests/conftest.py", "tests/test_orders_csv.py", "tests/test_only_paid.py", "tests/test_pipeline.py");
        assertThat(tests.get("tests/test_pipeline.py")).contains("f_orders_csv = job.orders_csv(glueContext, paths=[str(tmp_path / \"in_orders_csv\")])");
    }

    @Test
    void unknownTypeNamesTheNode() throws Exception {
        String j = "{\"a\":{\"S3CsvSource\":{\"Name\":\"A\",\"Paths\":[]}},\"b\":{\"PIIDetection\":{\"Name\":\"Scrub\",\"Inputs\":[\"a\"]}}}";
        assertThatThrownBy(() -> PySpark.generate(new ObjectMapper().readTree(j))).isInstanceOf(ApiError.class)
                .hasMessageContaining("Scrub").hasMessageContaining("b").hasMessageContaining("SparkSQL");
    }

    @Test
    void literalsAreEscaped() {
        assertThat(PySpark.pyString("a\"b\\c\nd")).isEqualTo("\"a\\\"b\\\\c\\nd\"");
        assertThat(PySpark.py(java.util.List.of("x", "y"))).isEqualTo("[\"x\", \"y\"]");
        assertThat(PySpark.py(true)).isEqualTo("True");
    }
}
