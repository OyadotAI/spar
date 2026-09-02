package ai.oya.keel;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class StateController {
    private final State state;
    private final Tools tools;
    private final Events events;
    private final List<StateContributor> contributors;

    /** Anything that wants a section in `/api/state` (profiles, live mode) registers one of these. */
    public interface StateContributor { void contribute(Map<String, Object> state); }

    public StateController(State state, Tools tools, Events events, List<StateContributor> contributors) {
        this.state = state; this.tools = tools; this.events = events; this.contributors = contributors;
    }

    @GetMapping("/api/state")
    public Map<String, Object> get() {
        Map<String, Object> m = new LinkedHashMap<>(state.asMap());
        m.put("hasProject", state.hasProject());
        m.put("os", System.getProperty("os.name"));
        m.put("tools", tools.detect());
        for (StateContributor c : contributors) c.contribute(m);
        return m;
    }

    public record ProfileBody(String profile, String region, String scriptBucket) {}

    @PostMapping("/api/profile")
    public Map<String, Object> profile(@RequestBody ProfileBody b) {
        state.set(b.profile(), b.region(), b.scriptBucket());
        events.emit("state.changed", state.asMap());
        return get();
    }
}
