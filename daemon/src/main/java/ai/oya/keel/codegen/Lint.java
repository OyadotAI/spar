package ai.oya.keel.codegen;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The traps a Glue DAG can hold that no error message will ever name.
 *
 * The worst of them are silent: a join with bookmarks on one side writes NULL foreign keys under a
 * green "Succeeded", an ApplyMapping quietly drops a column nobody notices for a month, a
 * push-down predicate on a JDBC source is ignored and the job reads the whole table. Each finding
 * says what will happen, not just what is unusual.
 */
public final class Lint {
    private Lint() {}

    public record Finding(String node, String level, String rule, String message, String fix) {
        public Map<String, Object> asMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("node", node); m.put("level", level); m.put("rule", rule); m.put("message", message); m.put("fix", fix);
            return m;
        }
    }

    /** @param job the Glue job definition (for DefaultArguments); may be null for a draft. */
    public static List<Finding> check(JsonNode dagJson, JsonNode job) {
        Dag dag = Dag.parse(dagJson);
        List<Finding> out = new ArrayList<>();
        boolean bookmarks = job != null
                && "job-bookmark-enable".equals(job.path("DefaultArguments").path("--job-bookmark-option").asText(null));

        for (Dag.Node n : dag.nodes.values()) {
            switch (n.type()) {
                case "Join" -> joinRules(dag, n, bookmarks, out);
                case "ApplyMapping" -> mappingRules(dag, n, out);
                case "SelectFields", "DropFields" -> selectionRules(dag, n, out);
                case "RenameField" -> renameRules(dag, n, out);
                default -> { }
            }
            if (n.isSource()) sourceRules(n, out);
            if (n.type().contains("Catalog") || n.type().contains("Quality") || n.type().contains("PII")
                    || n.type().contains("FindMatches") || n.type().contains("Kinesis") || n.type().contains("Kafka"))
                out.add(new Finding(n.id(), "info", "not-local",
                        n.name() + " cannot be exercised by a local run or by the tests.",
                        "Cover it in the cloud run, and keep the local run for the logic around it."));
        }
        if (dag.nodes.values().stream().noneMatch(Dag.Node::isTarget) && !dag.nodes.isEmpty())
            out.add(new Finding(null, "warn", "no-target", "This pipeline writes nothing.",
                    "Add a target, or the run will succeed and produce no output."));
        return out;
    }

    /**
     * The NULL-foreign-key trap. With bookmarks on, the dimension side of a join is empty on every
     * run after the first, so the join matches nothing and the columns it should have supplied are
     * written as NULL. The run succeeds.
     */
    private static void joinRules(Dag dag, Dag.Node n, boolean bookmarks, List<Finding> out) {
        if (bookmarks && n.inputs().size() == 2) {
            List<String> sides = n.inputs().stream().map(in -> sourceOf(dag, in)).filter(java.util.Objects::nonNull).toList();
            if (sides.size() == 2)
                out.add(new Finding(n.id(), "warn", "join-bookmarks",
                        n.name() + " joins two bookmarked sources. After the first run, the side with no new files is empty, "
                                + "the join matches nothing, and its columns are written as NULL — with the run marked Succeeded.",
                        "Read the dimension side without a bookmark (transformation_ctx aside) or reload it in full each run."));
        }
        if (n.inputs().size() == 2) {
            Map<String, String> a = cols(dag, n.inputs().get(0)), b = cols(dag, n.inputs().get(1));
            Set<String> both = new java.util.LinkedHashSet<>(a.keySet());
            both.retainAll(b.keySet());
            if (!both.isEmpty())
                out.add(new Finding(n.id(), "info", "join-duplicate-columns",
                        n.name() + " joins frames that share " + String.join(", ", both) + ". Glue keeps both, and downstream nodes see the ambiguity, not an error.",
                        "Rename or drop the duplicates on one side before the join."));
        }
    }

    private static void mappingRules(Dag dag, Dag.Node n, List<Finding> out) {
        Map<String, String> in = n.inputs().isEmpty() ? Map.of() : cols(dag, n.inputs().get(0));
        if (in.isEmpty()) return;
        Set<String> mapped = new HashSet<>();
        for (JsonNode m : n.body().path("Mapping")) mapped.add(PySpark.join(m.path("FromPath")));
        List<String> dropped = in.keySet().stream().filter(c -> !mapped.contains(c)).toList();
        if (!dropped.isEmpty())
            out.add(new Finding(n.id(), "warn", "mapping-drops",
                    n.name() + " drops " + String.join(", ", dropped) + " — an ApplyMapping keeps only what it lists.",
                    "Add the columns to the mapping if the target needs them; this is the most common silent column loss in Glue."));
        for (JsonNode m : n.body().path("Mapping")) {
            String from = PySpark.join(m.path("FromPath"));
            String fromType = in.get(from);
            String toType = m.path("ToType").asText("");
            if (fromType != null && !toType.isEmpty() && !fromType.equalsIgnoreCase(toType)
                    && TestGen.isNumeric(toType) && !TestGen.isNumeric(fromType) && !fromType.toLowerCase().startsWith("string"))
                out.add(new Finding(n.id(), "info", "mapping-cast",
                        n.name() + " casts " + from + " from " + fromType + " to " + toType + ". A value that will not cast becomes NULL, silently.",
                        "Check the source values, or resolve the choice explicitly before mapping."));
        }
    }

    private static void selectionRules(Dag dag, Dag.Node n, List<Finding> out) {
        Map<String, String> here = TestGen.columns(n, dag, new HashSet<>());
        for (Dag.Node other : dag.nodes.values()) {
            if (!other.inputs().contains(n.id())) continue;
            for (String needed : referenced(other)) {
                if (!here.isEmpty() && !here.containsKey(needed))
                    out.add(new Finding(other.id(), "warn", "missing-column",
                            other.name() + " uses " + needed + ", which " + n.name() + " does not pass through.",
                            "Keep the column in " + n.name() + ", or stop referencing it downstream."));
            }
        }
    }

    private static void renameRules(Dag dag, Dag.Node n, List<Finding> out) {
        String from = PySpark.join(n.body().path("SourcePath"));
        for (Dag.Node other : dag.nodes.values()) {
            if (!other.inputs().contains(n.id())) continue;
            if (referenced(other).contains(from))
                out.add(new Finding(other.id(), "warn", "renamed-column",
                        other.name() + " still refers to " + from + ", which " + n.name() + " renamed.",
                        "Use the new name, or move the rename after this node."));
        }
    }

    private static void sourceRules(Dag.Node n, List<Finding> out) {
        boolean jdbcish = n.type().contains("JDBC") || n.type().contains("Redshift") || n.type().contains("MySQL")
                || n.type().contains("Postgre") || n.type().contains("Oracle") || n.type().contains("SQLServer");
        boolean hasPredicate = n.body().hasNonNull("PushDownPredicate")
                || n.body().path("AdditionalOptions").has("push_down_predicate");
        if (jdbcish && hasPredicate)
            out.add(new Finding(n.id(), "warn", "pushdown-ignored",
                    n.name() + " sets a push-down predicate, which only applies to partitioned catalog and S3 sources. A JDBC source ignores it and reads the whole table.",
                    "Use the connection's own query or sampleQuery option to filter at the database."));
        if (!n.body().has("OutputSchemas") || n.body().path("OutputSchemas").isEmpty())
            out.add(new Finding(n.id(), "info", "no-schema",
                    n.name() + " has no recorded schema, so downstream nodes and the generated tests have nothing to check against.",
                    "Run a preview on this node, or press Infer schema; both record the columns it actually produces."));
    }

    /** Column names a node names explicitly: what a rename or a drop upstream would break. */
    private static Set<String> referenced(Dag.Node n) {
        Set<String> out = new java.util.LinkedHashSet<>();
        JsonNode b = n.body();
        for (JsonNode p : b.path("Paths")) out.add(PySpark.join(p));
        for (JsonNode g : b.path("Groups")) out.add(PySpark.join(g));
        for (JsonNode a : b.path("Aggs")) out.add(PySpark.join(a.path("Column")));
        for (JsonNode m : b.path("Mapping")) out.add(PySpark.join(m.path("FromPath")));
        for (JsonNode f : b.path("Filters"))
            for (JsonNode v : f.path("Values"))
                if ("COLUMNEXTRACTED".equals(v.path("Type").asText())) out.add(PySpark.join(v.path("Value")));
        for (JsonNode c : b.path("Columns")) for (JsonNode k : c.path("Keys")) out.add(PySpark.join(k));
        out.remove("");
        return out;
    }

    private static Map<String, String> cols(Dag dag, String id) {
        Dag.Node n = dag.nodes.get(id);
        return n == null ? Map.of() : TestGen.columns(n, dag, new HashSet<>());
    }

    /** The source a node ultimately reads from, or null when it has several. */
    private static String sourceOf(Dag dag, String id) {
        Dag.Node n = dag.nodes.get(id);
        if (n == null) return null;
        if (n.isSource()) return n.id();
        if (n.inputs().size() != 1) return null;
        return sourceOf(dag, n.inputs().get(0));
    }
}
