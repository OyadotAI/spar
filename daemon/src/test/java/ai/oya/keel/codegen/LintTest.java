package ai.oya.keel.codegen;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

class LintTest {
    private static final ObjectMapper OM = new ObjectMapper();

    private static JsonNode dag() throws Exception {
        return OM.readTree(Files.readString(Path.of("src/test/resources/fixtures/dag-simple.json")));
    }

    private static List<String> rules(JsonNode dag, JsonNode job) {
        return Lint.check(dag, job).stream().map(Lint.Finding::rule).toList();
    }

    @Test
    void findsTheNullForeignKeyTrapOnlyWhenBookmarksAreOn() throws Exception {
        JsonNode off = OM.readTree("{\"DefaultArguments\":{}}");
        JsonNode on = OM.readTree("{\"DefaultArguments\":{\"--job-bookmark-option\":\"job-bookmark-enable\"}}");
        assertThat(rules(dag(), off)).doesNotContain("join-bookmarks");
        assertThat(rules(dag(), on)).contains("join-bookmarks");
        Lint.Finding f = Lint.check(dag(), on).stream().filter(x -> x.rule().equals("join-bookmarks")).findFirst().orElseThrow();
        assertThat(f.message()).contains("NULL").contains("Succeeded");
    }

    @Test
    void findsSilentColumnLossAndDanglingReferences() throws Exception {
        // SelectFields keeps only order_id, but the Aggregate downstream groups by country.
        JsonNode dag = OM.readTree("""
            {"src": {"S3CsvSource": {"Name": "S", "Paths": ["s3://b/"],
               "OutputSchemas": [{"Columns": [{"Name": "order_id", "Type": "int"}, {"Name": "country", "Type": "string"}]}]}},
             "sel": {"SelectFields": {"Name": "Only ids", "Inputs": ["src"], "Paths": [["order_id"]]}},
             "agg": {"Aggregate": {"Name": "By country", "Inputs": ["sel"], "Groups": [["country"]],
                     "Aggs": [{"Column": ["order_id"], "AggFunc": "count"}]}}}
            """);
        assertThat(rules(dag, null)).contains("missing-column", "no-target");
        // A mapping that lists fewer columns than it receives is the classic silent loss.
        JsonNode drop = OM.readTree("""
            {"src": {"S3CsvSource": {"Name": "S", "Paths": ["s3://b/"],
               "OutputSchemas": [{"Columns": [{"Name": "a", "Type": "string"}, {"Name": "b", "Type": "string"}]}]}},
             "map": {"ApplyMapping": {"Name": "M", "Inputs": ["src"],
                     "Mapping": [{"ToKey": "a", "FromPath": ["a"], "FromType": "string", "ToType": "string"}]}}}
            """);
        Lint.Finding f = Lint.check(drop, null).stream().filter(x -> x.rule().equals("mapping-drops")).findFirst().orElseThrow();
        assertThat(f.message()).contains("drops b");
    }

    @Test
    void namesWhatALocalRunCannotCoverAndAPredicateThatIsIgnored() throws Exception {
        JsonNode dag = OM.readTree("""
            {"src": {"JDBCConnectorSource": {"Name": "DB", "PushDownPredicate": "day = 1",
               "OutputSchemas": [{"Columns": [{"Name": "a", "Type": "string"}]}]}},
             "t": {"S3CatalogTarget": {"Name": "T", "Inputs": ["src"], "Database": "d", "Table": "t"}}}
            """);
        List<String> r = rules(dag, null);
        assertThat(r).contains("pushdown-ignored", "not-local");
        assertThat(r).doesNotContain("no-target");
        assertThat(Lint.check(OM.readTree("{}"), null)).isEmpty();
    }
}
