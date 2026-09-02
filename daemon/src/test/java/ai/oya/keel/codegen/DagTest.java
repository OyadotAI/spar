package ai.oya.keel.codegen;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ai.oya.keel.ApiError;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;

class DagTest {
    @Test
    void topoRespectsInputsAndIsStable() throws Exception {
        String j = "{\"c\":{\"S3DirectTarget\":{\"Name\":\"c\",\"Inputs\":[\"b\"],\"Path\":\"s3://x\"}},"
                + "\"b\":{\"Filter\":{\"Name\":\"b\",\"Inputs\":[\"a\",\"z\"],\"Filters\":[]}},"
                + "\"a\":{\"S3CsvSource\":{\"Name\":\"a\",\"Paths\":[]}},\"z\":{\"S3CsvSource\":{\"Name\":\"z\",\"Paths\":[]}}}";
        Dag d = Dag.parse(new ObjectMapper().readTree(j));
        List<String> order = d.topo().stream().map(Dag.Node::id).toList();
        assertThat(order).containsExactly("a", "z", "b", "c");
        assertThat(Dag.parse(new ObjectMapper().readTree(j)).topo().stream().map(Dag.Node::id).toList()).isEqualTo(order);
    }

    @Test
    void cyclesNameTheNodes() throws Exception {
        String j = "{\"a\":{\"Filter\":{\"Name\":\"A\",\"Inputs\":[\"b\"]}},\"b\":{\"Filter\":{\"Name\":\"B\",\"Inputs\":[\"a\"]}}}";
        assertThatThrownBy(() -> Dag.parse(new ObjectMapper().readTree(j)).topo()).isInstanceOf(ApiError.class).hasMessageContaining("cycle").hasMessageContaining("A");
    }

    @Test
    void snakeNames() {
        assertThat(Dag.snake("My Customers (2024)")).isEqualTo("my_customers_2024");
        assertThat(Dag.snake("class")).isEqualTo("class_");
        assertThat(Dag.snake("1st")).isEqualTo("n_1st");
        assertThat(Dag.snake("")).isEqualTo("n_");
        assertThat(Dag.snake("main")).isEqualTo("main_");
    }
}
