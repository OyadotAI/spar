package ai.oya.keel.agent;

import ai.oya.keel.Events;
import ai.oya.keel.State;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * What the daemon knows about a turn that the transcript does not: the tree before it, the files
 * it moved, the gate's verdict, the commit, the cost. Each fact is written to
 * `.keel/turns/<job>/<turn>.json` and broadcast on the bus in one call, so a replay and the live
 * view cannot disagree.
 */
@RestController
public class Turns {
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Record {
        public String turn, job, mode, prompt, session, started, ended, snapshot, commit;
        public Long ms;
        public List<String> files = new ArrayList<>();
        public Map<String, Object> gate, usage, failed;
        public List<Map<String, Object>> approvals = new ArrayList<>();
    }

    private final State state;
    private final Events events;
    private final ObjectMapper json;

    public Turns(State state, Events events, ObjectMapper json) { this.state = state; this.events = events; this.json = json; }

    /** Write the record and tell every window which fact just landed. The one path a fact takes. */
    public synchronized void emit(Record r, String kind, Map<String, Object> fact) {
        try {
            Path dir = state.keelDir().resolve("turns").resolve(r.job);
            Files.createDirectories(dir);
            Path f = dir.resolve(r.turn + ".json");
            Path tmp = dir.resolve(r.turn + ".json.tmp");
            Files.writeString(tmp, json.writeValueAsString(r));
            Files.move(tmp, f, java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            // a record that cannot be written is still a fact the window should see
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("lane", r.job);
        m.put("turn", r.turn);
        m.put("kind", kind);
        m.put("at", Instant.now().toString());
        m.putAll(fact);
        events.emit("turn", m);
    }

    @GetMapping("/api/turns")
    public List<Record> list(@RequestParam String job) {
        Path dir = state.keelDir().resolve("turns").resolve(job);
        List<Record> out = new ArrayList<>();
        if (!Files.isDirectory(dir)) return out;
        try (Stream<Path> s = Files.list(dir)) {
            for (Path p : s.filter(x -> x.toString().endsWith(".json")).toList()) {
                try { out.add(json.readValue(Files.readString(p), Record.class)); } catch (IOException ignored) { }
            }
        } catch (IOException ignored) { }
        out.sort((a, b) -> String.valueOf(b.started).compareTo(String.valueOf(a.started)));
        return out.size() > 200 ? out.subList(0, 200) : out;
    }
}
