package ai.oya.keel;

import jakarta.annotation.PostConstruct;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * `--exit-with-parent`: the app that spawned us is our only reason to exist. There is no
 * PR_SET_PDEATHSIG on macOS or Windows, and an app can die without running any quit handler, so
 * we poll our parent every second and take our children (claude, docker, ptys) with us.
 */
@Component
public class ParentWatch {
    private final boolean enabled;

    public ParentWatch(@Value("${keel.exit-with-parent}") boolean enabled) {
        this.enabled = enabled;
    }

    @PostConstruct
    void start() {
        if (!enabled) return;
        Optional<ProcessHandle> parent = ProcessHandle.current().parent();
        if (parent.isEmpty()) { exit(); return; }
        long pid = parent.get().pid();
        Thread.ofVirtual().name("parent-watch").start(() -> {
            while (true) {
                try { Thread.sleep(1000); } catch (InterruptedException e) { return; }
                Optional<ProcessHandle> now = ProcessHandle.current().parent();
                if (now.isEmpty() || now.get().pid() != pid || !now.get().isAlive()) { exit(); return; }
            }
        });
    }

    static void exit() {
        ProcessHandle.current().descendants().forEach(ProcessHandle::destroyForcibly);
        System.exit(0);
    }
}
