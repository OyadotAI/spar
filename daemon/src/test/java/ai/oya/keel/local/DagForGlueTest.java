package ai.oya.keel.local;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/**
 * The deploy that failed in the wild:
 *   "Unknown parameter in CodeGenConfigurationNodes.n-paid.Filter: OutputSchemas,
 *    must be one of: Name, Inputs, LogicalOperator, Filters"
 *
 * Keel records an inferred schema on any node because that is what drives the column pickers
 * downstream. Glue only declares OutputSchemas on sources and on the four transforms that emit an
 * arbitrary shape, so the payload has to be narrower than the file.
 */
class DagForGlueTest {
    private static final ObjectMapper M = new ObjectMapper();

    private static JsonNode dag(String json) throws Exception { return M.readTree(json); }

    @Test
    void stripsOutputSchemasFromTransformsThatDoNotDeclareIt() throws Exception {
        JsonNode in = dag("""
            {
              "n-orders": {"S3CsvSource": {"Name": "Orders", "Paths": ["s3://b/o/"],
                            "OutputSchemas": [{"Columns": [{"Name": "id", "Type": "int"}]}]}},
              "n-paid":   {"Filter": {"Name": "Only paid", "Inputs": ["n-orders"], "LogicalOperator": "AND",
                            "Filters": [], "OutputSchemas": [{"Columns": [{"Name": "id", "Type": "int"}]}]}},
              "n-join":   {"Join": {"Name": "Join", "Inputs": ["n-paid", "n-orders"], "JoinType": "equijoin",
                            "Columns": [], "OutputSchemas": [{"Columns": []}]}}
            }""");
        JsonNode out = Project.dagForGlue(in);

        assertFalse(out.path("n-paid").path("Filter").has("OutputSchemas"), "Filter must not carry OutputSchemas");
        assertFalse(out.path("n-join").path("Join").has("OutputSchemas"), "Join must not carry OutputSchemas");
        assertTrue(out.path("n-orders").path("S3CsvSource").has("OutputSchemas"), "a source keeps its schema");
        // everything else survives untouched
        assertTrue(out.path("n-paid").path("Filter").has("Filters"));
        assertTrue(out.path("n-join").path("Join").path("Inputs").isArray());
        // and the caller's dag.json is not mutated
        assertTrue(in.path("n-paid").path("Filter").has("OutputSchemas"), "dag.json keeps what the pickers need");
    }

    @Test
    void keepsItOnTheTransformsThatDoDeclareIt() throws Exception {
        for (String type : new String[] {"CustomCode", "SparkSQL", "DynamicTransform", "Recipe"}) {
            JsonNode out = Project.dagForGlue(dag("""
                {"n": {"%s": {"Name": "n", "Inputs": ["x"], "OutputSchemas": [{"Columns": []}]}},
                 "x": {"S3CsvSource": {"Name": "x"}}}""".formatted(type)));
            assertTrue(out.path("n").path(type).has("OutputSchemas"), type + " emits its own shape");
        }
    }

    @Test
    void everySourceTypeKeepsIt() {
        assertTrue(Project.acceptsOutputSchemas("S3ParquetSource"));
        assertTrue(Project.acceptsOutputSchemas("AmazonRedshiftSource"));
        assertFalse(Project.acceptsOutputSchemas("ApplyMapping"));
        assertFalse(Project.acceptsOutputSchemas("Aggregate"));
        assertFalse(Project.acceptsOutputSchemas("S3DirectTarget"));
    }
}
