package ai.oya.keel.codegen;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * pytest scaffolds: one file per node and one for the pipeline. They are real tests, small and
 * green on the generated code, written to `tests/` only when the file does not exist — the agent
 * and the person own them from then on. Sources read data the test itself writes to `tmp_path`,
 * so nothing here needs S3 or the Data Catalog.
 */
public final class TestGen {
    private TestGen() {}

    public static Map<String, String> generate(JsonNode dagJson, PySpark.Generated gen) {
        Dag dag = Dag.parse(dagJson);
        List<Dag.Node> order = dag.topo();
        Map<String, String> names = gen.names();
        Map<String, String> files = new LinkedHashMap<>();
        files.put("tests/conftest.py", CONFTEST);
        for (Dag.Node n : order) files.put("tests/test_" + names.get(n.id()) + ".py", nodeTest(n, names, dag));
        files.put("tests/test_pipeline.py", pipelineTest(order, names, dag));
        return files;
    }

    static final String CONFTEST = """
            import os
            import sys

            import pytest

            sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

            from awsglue.context import GlueContext  # noqa: E402
            from awsglue.dynamicframe import DynamicFrame  # noqa: E402
            from pyspark.context import SparkContext  # noqa: E402


            @pytest.fixture(scope="session")
            def glueContext():
                return GlueContext(SparkContext.getOrCreate())


            def dyf(glueContext, rows, name="t"):
                \"\"\"A DynamicFrame from a list of dicts: the fixture every node test starts from.\"\"\"
                return DynamicFrame.fromDF(glueContext.spark_session.createDataFrame(rows), glueContext, name)
            """;

    /**
     * Sample rows for a node: its columns as far as the DAG lets us infer them (OutputSchemas on
     * sources, ApplyMapping's targets, SelectFields' paths, a Join's union, otherwise the input's),
     * three rows, and where a Filter downstream compares a column to a constant, that constant —
     * so a scaffolded pipeline actually flows data instead of filtering everything away.
     */
    static String rows(Dag.Node n, Dag dag) {
        Map<String, String> cols = columns(n, dag, new java.util.HashSet<>());
        Map<String, String> hints = hints(dag);
        StringBuilder b = new StringBuilder("[");
        for (int r = 1; r <= 3; r++) {
            b.append(r > 1 ? ", " : "").append("{");
            int i = 0;
            for (Map.Entry<String, String> c : cols.entrySet()) {
                String v = hints.containsKey(c.getKey()) && !isNumeric(c.getValue()) ? PySpark.pyString(hints.get(c.getKey())) : sample(c.getValue(), r);
                b.append(i++ > 0 ? ", " : "").append(PySpark.pyString(c.getKey())).append(": ").append(v);
            }
            b.append("}");
        }
        return b.append("]").toString();
    }

    static String rows(Dag.Node n) { return rows(n, null); }

    public static boolean isNumeric(String t) { String x = t.toLowerCase(); return x.contains("int") || x.contains("double") || x.contains("float") || x.contains("decimal") || x.equals("long"); }

    /** column → type, inferred down the DAG; `{id:int, value:string}` when nothing is known. */
    public static Map<String, String> columns(Dag.Node n, Dag dag, java.util.Set<String> seen) {
        Map<String, String> out = new LinkedHashMap<>();
        for (JsonNode s : n.body().path("OutputSchemas")) for (JsonNode c : s.path("Columns")) out.put(c.path("Name").asText(), c.path("Type").asText("string"));
        if (!out.isEmpty() || dag == null || !seen.add(n.id())) { if (out.isEmpty()) { out.put("id", "int"); out.put("value", "string"); } return out; }
        Map<String, String> in = new LinkedHashMap<>();
        for (String id : n.inputs()) { Dag.Node up = dag.nodes.get(id); if (up != null) in.putAll(columns(up, dag, seen)); }
        JsonNode b = n.body();
        switch (n.type()) {
            case "ApplyMapping" -> { for (JsonNode m : b.path("Mapping")) if (!m.path("Dropped").asBoolean(false)) out.put(m.path("ToKey").asText(PySpark.join(m.path("FromPath"))), m.path("ToType").asText("string")); }
            case "SelectFields" -> { for (String p : PySpark.paths(b.path("Paths"))) out.put(p, in.getOrDefault(p, "string")); }
            case "DropFields" -> { out.putAll(in); for (String p : PySpark.paths(b.path("Paths"))) out.remove(p); }
            case "RenameField" -> { out.putAll(in); String from = PySpark.join(b.path("SourcePath")), to = PySpark.join(b.path("TargetPath")); if (out.containsKey(from)) { out.put(to, out.remove(from)); } }
            case "Aggregate" -> {
                for (String g : PySpark.paths(b.path("Groups"))) out.put(g, in.getOrDefault(g, "string"));
                for (JsonNode a : b.path("Aggs")) { String col = PySpark.join(a.path("Column")); String fn = a.path("AggFunc").asText("count"); out.put(col + "_" + fn, fn.startsWith("count") ? "long" : in.getOrDefault(col, "double")); }
            }
            default -> out.putAll(in);
        }
        if (out.isEmpty()) { out.put("id", "int"); out.put("value", "string"); }
        return out;
    }

    /** column → constant from every Filter's EQ / IN / CONTAINS rows: the value a sample row should carry. */
    public static Map<String, String> hints(Dag dag) {
        Map<String, String> out = new LinkedHashMap<>();
        if (dag == null) return out;
        for (Dag.Node n : dag.nodes.values()) {
            if (!n.type().equals("Filter")) continue;
            for (JsonNode f : n.body().path("Filters")) {
                String op = f.path("Operation").asText("");
                if (!(op.equals("EQ") || op.equals("IN") || op.equals("CONTAINS") || op.equals("STARTS_WITH") || op.equals("ENDS_WITH")) || f.path("Negated").asBoolean(false)) continue;
                JsonNode vals = f.path("Values");
                if (vals.size() < 2) continue;
                String col = vals.get(0).path("Value").isArray() ? vals.get(0).path("Value").path(0).asText() : vals.get(0).path("Value").asText();
                String val = vals.get(1).path("Value").isArray() ? vals.get(1).path("Value").path(0).asText() : vals.get(1).path("Value").asText();
                if (!col.isEmpty() && !val.isEmpty()) out.putIfAbsent(col, val);
            }
        }
        return out;
    }

    static String sample(String type, int r) {
        String t = type.toLowerCase();
        if (t.contains("int") || t.equals("long") || t.equals("short") || t.equals("byte")) return Integer.toString(r);
        if (t.contains("double") || t.contains("float") || t.contains("decimal")) return r + ".5";
        if (t.equals("boolean")) return r % 2 == 0 ? "True" : "False";
        return PySpark.pyString("v" + r);
    }

    static String nodeTest(Dag.Node n, Map<String, String> names, Dag dag) {
        String fn = names.get(n.id());
        StringBuilder b = new StringBuilder("import job\nfrom conftest import dyf\n");
        String rows = rows(n, dag);
        switch (n.type()) {
            case "S3CsvSource" -> b.append("\n\ndef test_").append(fn).append("_reads_csv(glueContext, tmp_path):\n")
                    .append("    df = glueContext.spark_session.createDataFrame(").append(rows).append(")\n")
                    .append("    df.write.option(\"header\", True).csv(str(tmp_path / \"in\"))\n")
                    .append("    out = job.").append(fn).append("(glueContext, paths=[str(tmp_path / \"in\")])\n")
                    .append("    assert out.count() == 3\n    assert set(df.columns) <= set(out.toDF().columns)\n");
            case "S3ParquetSource" -> b.append("\n\ndef test_").append(fn).append("_reads_parquet(glueContext, tmp_path):\n")
                    .append("    df = glueContext.spark_session.createDataFrame(").append(rows).append(")\n")
                    .append("    df.write.parquet(str(tmp_path / \"in\"))\n")
                    .append("    out = job.").append(fn).append("(glueContext, paths=[str(tmp_path / \"in\")])\n")
                    .append("    assert out.count() == 3\n    assert set(df.columns) <= set(out.toDF().columns)\n");
            case "S3JsonSource" -> b.append("\n\ndef test_").append(fn).append("_reads_json(glueContext, tmp_path):\n")
                    .append("    df = glueContext.spark_session.createDataFrame(").append(rows).append(")\n")
                    .append("    df.write.json(str(tmp_path / \"in\"))\n")
                    .append("    out = job.").append(fn).append("(glueContext, paths=[str(tmp_path / \"in\")])\n")
                    .append("    assert out.count() == 3\n    assert set(df.columns) <= set(out.toDF().columns)\n");
            case "S3CatalogSource", "CatalogSource", "S3CatalogTarget" -> b.insert(0, "import pytest\n").append("\n\n@pytest.mark.skip(reason=\"needs the Glue Data Catalog; not available in the local container\")\ndef test_")
                    .append(fn).append("(glueContext):\n    pass\n");
            case "S3GlueParquetTarget" -> b.insert(0, "import pytest\n").append("\n\n@pytest.mark.skip(reason=\"the glueparquet writer is not available in the local container\")\ndef test_")
                    .append(fn).append("(glueContext):\n    pass\n");
            case "S3DirectTarget" -> b.append("\n\ndef test_").append(fn).append("_writes(glueContext, tmp_path):\n")
                    .append("    frame = dyf(glueContext, ").append(rows(dag.nodes.get(n.inputs().get(0)), dag)).append(")\n")
                    .append("    out = job.").append(fn).append("(glueContext, frame, path=str(tmp_path / \"out\"))\n")
                    .append("    assert out.count() == 3\n    assert any((tmp_path / \"out\").iterdir())\n");
            default -> {
                b.append("\n\ndef test_").append(fn).append("(glueContext):\n");
                List<String> args = new ArrayList<>();
                for (String in : n.inputs()) { String v = "in_" + names.get(in); b.append("    ").append(v).append(" = dyf(glueContext, ").append(rows(dag.nodes.get(in), dag)).append(", ").append(PySpark.pyString(dag.nodes.get(in).name())).append(")\n"); args.add(v); }
                b.append("    out = job.").append(fn).append("(glueContext").append(args.isEmpty() ? "" : ", " + String.join(", ", args)).append(")\n")
                 .append("    # TODO: assert what this node must do to its input, not just that it ran\n")
                 .append("    assert out.count() >= 0\n");
            }
        }
        return b.toString();
    }

    static String pipelineTest(List<Dag.Node> order, Map<String, String> names, Dag dag) {
        StringBuilder b = new StringBuilder("import job\n");
        boolean catalog = order.stream().anyMatch(n -> n.type().contains("Catalog"));
        if (catalog) b.append("import pytest\n\n\n@pytest.mark.skip(reason=\"the pipeline reads or writes the Data Catalog, which the local container lacks\")\n");
        else b.append("\n\n");
        b.append("def test_pipeline(glueContext, tmp_path):\n");
        boolean any = false;
        for (Dag.Node n : order) {
            String v = "f_" + names.get(n.id());
            if (n.isSource()) {
                String fmt = n.type().startsWith("S3Csv") ? "option(\"header\", True).csv" : n.type().startsWith("S3Json") ? "json" : "parquet";
                b.append("    glueContext.spark_session.createDataFrame(").append(rows(n, dag)).append(").write.").append(fmt).append("(str(tmp_path / ").append(PySpark.pyString("in_" + names.get(n.id()))).append("))\n")
                 .append("    ").append(v).append(" = job.").append(names.get(n.id())).append("(glueContext, paths=[str(tmp_path / ").append(PySpark.pyString("in_" + names.get(n.id()))).append(")])\n");
            } else if (n.isTarget()) {
                b.append("    ").append(v).append(" = job.").append(names.get(n.id())).append("(glueContext, f_").append(names.get(n.inputs().get(0)))
                 .append(n.type().equals("S3CatalogTarget") ? "" : ", path=str(tmp_path / " + PySpark.pyString("out_" + names.get(n.id())) + ")").append(")\n");
                any = true;
            } else {
                b.append("    ").append(v).append(" = job.").append(names.get(n.id())).append("(glueContext");
                for (String in : n.inputs()) b.append(", f_").append(names.get(in));
                b.append(")\n");
                any = true;
            }
        }
        if (!any && !order.isEmpty()) b.append("    assert f_").append(names.get(order.get(0).id())).append(".count() > 0\n");
        else for (Dag.Node n : order) if (n.isTarget() || order.stream().noneMatch(m -> m.inputs().contains(n.id()))) b.append("    assert f_").append(names.get(n.id())).append(".count() >= 0\n");
        return b.toString();
    }
}
