package ai.oya.keel.codegen;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Positions for a DAG that has none: depth = longest path from a source; one column per depth. */
public final class Layout {
    private Layout() {}

    public static JsonNode auto(JsonNode dag) {
        Dag d = Dag.parse(dag);
        Map<String, Integer> depth = new HashMap<>();
        for (Dag.Node n : d.topo()) {
            int best = 0;
            for (String in : n.inputs()) best = Math.max(best, depth.getOrDefault(in, 0) + 1);
            depth.put(n.id(), best);
        }
        Map<Integer, List<String>> columns = new HashMap<>();
        for (Dag.Node n : d.topo()) columns.computeIfAbsent(depth.get(n.id()), k -> new ArrayList<>()).add(n.id());
        ObjectNode out = new ObjectMapper().createObjectNode();
        for (Map.Entry<Integer, List<String>> e : columns.entrySet()) {
            int row = 0;
            for (String id : e.getValue()) {
                ObjectNode p = out.putObject(id);
                p.put("x", 80 + e.getKey() * 260);
                p.put("y", 80 + row++ * 140);
            }
        }
        return out;
    }
}
