package ai.oya.keel.codegen;

import ai.oya.keel.ApiError;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/** dag.json, parsed: nodes with their type, name and inputs, and a deterministic topological order. */
public final class Dag {
    public record Node(String id, String type, String name, List<String> inputs, JsonNode body) {
        public boolean isSource() { return inputs.isEmpty() && type.endsWith("Source"); }
        public boolean isTarget() { return type.endsWith("Target"); }
    }

    public final Map<String, Node> nodes = new LinkedHashMap<>();

    public static Dag parse(JsonNode dag) {
        Dag d = new Dag();
        if (dag == null || !dag.isObject()) throw ApiError.badRequest("dag.json must be an object");
        for (Iterator<Map.Entry<String, JsonNode>> it = dag.fields(); it.hasNext();) {
            Map.Entry<String, JsonNode> e = it.next();
            JsonNode n = e.getValue();
            if (!n.isObject() || n.size() != 1) throw ApiError.badRequest("node '" + e.getKey() + "' must have exactly one type key");
            String type = n.fieldNames().next();
            JsonNode body = n.get(type);
            List<String> inputs = new ArrayList<>();
            for (JsonNode in : body.path("Inputs")) inputs.add(in.asText());
            d.nodes.put(e.getKey(), new Node(e.getKey(), type, body.path("Name").asText(e.getKey()), inputs, body));
        }
        return d;
    }

    /** Kahn's algorithm with the ready set ordered by id, so the same DAG always yields the same order. */
    public List<Node> topo() {
        Map<String, Integer> indeg = new HashMap<>();
        Map<String, List<String>> out = new HashMap<>();
        for (Node n : nodes.values()) {
            indeg.merge(n.id(), 0, Integer::sum);
            for (String in : n.inputs()) {
                if (!nodes.containsKey(in)) throw ApiError.badRequest("node '" + n.name() + "' has input '" + in + "' which does not exist");
                indeg.merge(n.id(), 1, Integer::sum);
                out.computeIfAbsent(in, k -> new ArrayList<>()).add(n.id());
            }
        }
        TreeSet<String> ready = new TreeSet<>();
        for (Map.Entry<String, Integer> e : indeg.entrySet()) if (e.getValue() == 0) ready.add(e.getKey());
        List<Node> order = new ArrayList<>();
        while (!ready.isEmpty()) {
            String id = ready.pollFirst();
            order.add(nodes.get(id));
            for (String next : out.getOrDefault(id, List.of())) if (indeg.merge(next, -1, Integer::sum) == 0) ready.add(next);
        }
        if (order.size() != nodes.size()) {
            Set<String> seen = new HashSet<>();
            order.forEach(n -> seen.add(n.id()));
            List<String> stuck = new ArrayList<>();
            for (String id : nodes.keySet()) if (!seen.contains(id)) stuck.add(nodes.get(id).name());
            throw ApiError.badRequest("the DAG has a cycle through: " + String.join(", ", stuck));
        }
        return order;
    }

    /** Python identifiers from node names: `My Customers (2024)` → `my_customers_2024`; keywords and clashes get a suffix. */
    public static Map<String, String> snakeNames(List<Node> order) {
        Map<String, String> out = new LinkedHashMap<>();
        Set<String> used = new HashSet<>();
        for (Node n : order) {
            String s = snake(n.name());
            String candidate = s;
            for (int i = 2; used.contains(candidate); i++) candidate = s + "_" + i;
            used.add(candidate);
            out.put(n.id(), candidate);
        }
        return out;
    }

    private static final Set<String> RESERVED = Set.of("false", "none", "true", "and", "as", "assert", "async", "await", "break", "class",
            "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda",
            "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
            "main", "spark", "sc", "job", "args", "gluecontext", "re", "f", "sys", "dynamicframe", "dynamicframecollection");

    public static String snake(String name) {
        String s = name == null ? "" : name.toLowerCase().replaceAll("[^a-z0-9]+", "_").replaceAll("^_+|_+$", "");
        if (s.isEmpty() || Character.isDigit(s.charAt(0))) s = "n_" + s;
        if (RESERVED.contains(s)) s = s + "_";
        return s;
    }

    public Deque<Node> sources() {
        Deque<Node> out = new ArrayDeque<>();
        for (Node n : nodes.values()) if (n.isSource()) out.add(n);
        return out;
    }
}
