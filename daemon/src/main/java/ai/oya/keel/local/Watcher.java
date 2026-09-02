package ai.oya.keel.local;

import ai.oya.keel.Events;
import ai.oya.keel.State;
import io.methvin.watcher.DirectoryChangeEvent;
import io.methvin.watcher.DirectoryWatcher;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * The local half of "near real time": a dag.json edited in an editor, by a terminal `claude`, or
 * by `git checkout` reaches the canvas the same way an API write does — the job's rev bumps and
 * `job.changed` goes out. Keel's own writes are recognised by content hash and not double-fired.
 */
@Component
public class Watcher {
    private static final Logger log = LoggerFactory.getLogger(Watcher.class);
    private final State state;
    private final Project project;
    private final Events events;
    private DirectoryWatcher watcher;
    private final ScheduledExecutorService debounce = java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> { Thread t = new Thread(r, "watch-debounce"); t.setDaemon(true); return t; });
    private final Map<String, ScheduledFuture<?>> pending = new ConcurrentHashMap<>();

    public Watcher(State state, Project project, Events events) { this.state = state; this.project = project; this.events = events; }

    @PostConstruct
    void start() {
        List<Path> roots = new ArrayList<>();
        Path jobs = state.project().resolve("jobs");
        Path worktrees = state.keelDir().resolve("worktrees");
        try {
            Files.createDirectories(jobs);
            Files.createDirectories(worktrees);
            roots.add(jobs);
            roots.add(worktrees);
            watcher = DirectoryWatcher.builder().paths(roots).listener(this::on).build();
            watcher.watchAsync();
        } catch (IOException | RuntimeException e) {
            log.warn("watcher: not watching ({}); outside edits will not reach the canvas until reload", e.getMessage());
        }
    }

    @PreDestroy
    void stop() { try { if (watcher != null) watcher.close(); } catch (IOException ignored) { } }

    private void on(DirectoryChangeEvent ev) {
        Path p = ev.path();
        if (p == null) return;
        String s = p.toString().replace('\\', '/');
        int i = s.lastIndexOf("/jobs/");
        if (i < 0) return;
        String rest = s.substring(i + 6);
        int slash = rest.indexOf('/');
        if (slash <= 0) return;
        String job = rest.substring(0, slash);
        String file = rest.substring(slash + 1);
        if (!job.matches(Project.NAME)) return;
        if (file.contains("__pycache__") || file.contains(".pytest_cache") || file.endsWith(".tmp") || file.startsWith(".junit") || file.startsWith(".preview") || file.startsWith(".ranges")) return;
        if (!Files.isRegularFile(p) && ev.eventType() != DirectoryChangeEvent.EventType.DELETE) return;
        if (!p.startsWith(project.dir(job))) return; // a root copy while the lane is the live one, or vice versa
        if (ev.eventType() != DirectoryChangeEvent.EventType.DELETE) {
            try { if (project.wasOwnWrite(p, Files.readString(p).stripTrailing())) return; } catch (IOException ignored) { }
        }
        ScheduledFuture<?> prev = pending.put(job, debounce.schedule(() -> fire(job, file), 200, TimeUnit.MILLISECONDS));
        if (prev != null) prev.cancel(false);
    }

    private void fire(String job, String file) {
        pending.remove(job);
        long rev = project.bump(job);
        events.emit("job.changed", Map.of("name", job, "rev", rev, "file", file, "outside", true));
    }
}
