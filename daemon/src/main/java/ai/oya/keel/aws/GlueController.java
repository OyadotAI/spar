package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
import ai.oya.keel.Events;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import software.amazon.awssdk.services.glue.model.BatchStopJobRunResponse;
import software.amazon.awssdk.services.glue.model.GetJobRunsResponse;

@RestController
public class GlueController {
    private final GlueService glue;
    private final JobsCache cache;
    private final Sync sync;
    private final LogsService logs;
    private final Events events;
    private final ai.oya.keel.local.Project project;
    private final ai.oya.keel.git.Lanes lanes;

    public GlueController(GlueService glue, JobsCache cache, Sync sync, LogsService logs, Events events,
                          ai.oya.keel.local.Project project, ai.oya.keel.git.Lanes lanes) {
        this.glue = glue; this.cache = cache; this.sync = sync; this.logs = logs; this.events = events; this.project = project; this.lanes = lanes;
    }

    @GetMapping("/api/glue/jobs")
    public Map<String, Object> jobs() {
        if (!cache.filled()) sync.awaitFirst(20);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("refreshedAt", cache.refreshedAt());
        m.put("jobs", cache.all().stream().map(j -> j.withLocal(Map.of("imported", project.exists(j.name()), "lane", lanes.exists(j.name())))).toList());
        if (sync.lastError() != null && !cache.filled()) throw new ApiError(502, sync.lastError());
        return m;
    }

    @GetMapping("/api/glue/jobs/{name}")
    public Object job(@PathVariable String name) { return glue.getJobJson(name); }

    @GetMapping("/api/glue/jobs/{name}/runs")
    public Map<String, Object> runs(@PathVariable String name, @RequestParam(defaultValue = "50") int max,
                                    @RequestParam(required = false) String next) {
        cache.touch(name);
        GetJobRunsResponse r = glue.runs(name, max, next);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("runs", r.jobRuns().stream().map(RunInfo::of).toList());
        m.put("next", r.nextToken());
        return m;
    }

    @GetMapping("/api/glue/jobs/{name}/runs/{id}")
    public RunInfo run(@PathVariable String name, @PathVariable String id) { cache.touch(name); return glue.run(name, id); }

    public record StartBody(Map<String, String> arguments, String retryOf) {}

    @PostMapping("/api/glue/jobs/{name}/runs")
    public Map<String, String> start(@PathVariable String name, @RequestBody(required = false) StartBody b) {
        String id = glue.start(name, b == null ? null : b.arguments(), b == null ? null : b.retryOf());
        cache.touch(name);
        try { sync.applyRun(name, glue.run(name, id)); } catch (RuntimeException ignored) { /* the runs loop will see it */ }
        return Map.of("runId", id);
    }

    @PostMapping("/api/glue/jobs/{name}/runs/{id}/stop")
    public Map<String, Object> stop(@PathVariable String name, @PathVariable String id) {
        BatchStopJobRunResponse r = glue.stop(name, id);
        cache.touch(name);
        return Map.of("ok", r.errors().isEmpty(), "errors", r.errors().stream().map(e -> e.errorDetail().errorMessage()).toList());
    }

    @GetMapping("/api/glue/jobs/{name}/runs/{id}/logs/tail")
    public List<LogsService.Line> tail(@PathVariable String name, @PathVariable String id,
                                       @RequestParam(defaultValue = "200") int n, @RequestParam(defaultValue = "error") String group) {
        return logs.tail(id, Math.min(2000, n), group, prefixFor(name, id));
    }

    /** SSE: `streams`, then `line` per event, then `end {reason}`. Stops 30s after the run ends or when the client leaves. */
    @GetMapping("/api/glue/jobs/{name}/runs/{id}/logs")
    public SseEmitter follow(@PathVariable String name, @PathVariable String id, @RequestParam(defaultValue = "all") String group) {
        SseEmitter e = new SseEmitter(0L);
        AtomicBoolean alive = new AtomicBoolean(true);
        e.onCompletion(() -> alive.set(false));
        e.onTimeout(() -> alive.set(false));
        e.onError(t -> alive.set(false));
        cache.touch(name);
        Thread.ofVirtual().name("logs-" + id).start(() -> {
            AtomicReference<Long> endedAt = new AtomicReference<>();
            AtomicReference<Long> lastCheck = new AtomicReference<>(0L);
            try {
                logs.follow(id, group, prefixFor(name, id),
                        streams -> send(e, alive, "streams", streams),
                        line -> send(e, alive, "line", line),
                        () -> {
                            if (!alive.get()) return false;
                            long now = System.currentTimeMillis();
                            if (endedAt.get() == null && now - lastCheck.get() > 15_000) {
                                lastCheck.set(now);
                                try {
                                    RunInfo r = glue.run(name, id);
                                    sync.applyRun(name, r);
                                    if (r.terminal()) endedAt.set(now);
                                } catch (RuntimeException ignored) { /* transient; keep tailing */ }
                            }
                            return true;
                        },
                        endedAt::get);
                send(e, alive, "end", Map.of("reason", endedAt.get() != null ? "run ended" : "closed"));
            } catch (RuntimeException ex) {
                send(e, alive, "end", Map.of("reason", ex.getMessage() == null ? ex.toString() : ex.getMessage()));
            }
            e.complete();
        });
        return e;
    }

    private String prefixFor(String job, String runId) {
        JobSummary j = cache.get(job);
        // A run carries the log group it used when a security configuration is on; otherwise the defaults.
        if (j != null && j.latestRun() != null && runId.equals(j.latestRun().id()) && j.latestRun().logGroupName() != null) {
            String g = j.latestRun().logGroupName();
            if (!g.equals("/aws-glue/jobs/") && g.startsWith("/aws-glue/jobs")) return g.endsWith("/") ? g.substring(0, g.length() - 1) : g;
        }
        return null;
    }

    private static void send(SseEmitter e, AtomicBoolean alive, String name, Object data) {
        if (!alive.get()) return;
        try { e.send(SseEmitter.event().name(name).data(data)); }
        catch (IOException | IllegalStateException ex) { alive.set(false); }
    }

    /** Sync needs the bus too; expose it for tests that assert emitted kinds. */
    Events events() { return events; }
}
