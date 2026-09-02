package ai.oya.keel.aws;

import ai.oya.keel.Events;
import ai.oya.keel.State;
import ai.oya.keel.StateController;
import jakarta.annotation.PostConstruct;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.awscore.exception.AwsServiceException;
import software.amazon.awssdk.services.glue.model.Job;

/**
 * Near real time without asking AWS to push: three loops that diff what Glue says against the
 * cache and emit only what changed. Glue itself only pushes terminal run states (and only via
 * EventBridge), and job create/update only exists as CloudTrail events, so polling is the floor
 * and {@link LiveEvents} is the accelerator.
 *
 * <ul>
 *   <li>inventory — `ListJobs` every 5s: names added or removed anywhere.</li>
 *   <li>definitions — `BatchGetJobs` every 30s: `LastModifiedOn` moved → the job changed remotely.</li>
 *   <li>runs — `GetJobRuns(max=1)`: hot jobs (a non-terminal latest run, or one the app is looking at)
 *       every 3s; everything else in a sweep spread across `max(5s, jobs / 8 per s)`.</li>
 * </ul>
 * One token bucket (8/s, burst 16) caps the whole thing; a throttle from AWS doubles the sweep
 * up to 60s and the status bar says so. Loops sleep while nobody is subscribed to /api/events.
 */
@Component
@org.springframework.core.annotation.Order(1)
public class Sync implements StateController.StateContributor {
    private static final Logger log = LoggerFactory.getLogger(Sync.class);

    private final GlueService glue;
    private final JobsCache cache;
    private final Events events;
    private final State state;
    private final AwsClients aws;

    private final Bucket bucket = new Bucket(8, 16);
    private final Set<String> known = ConcurrentHashMap.newKeySet();
    private final Map<String, Instant> due = new ConcurrentHashMap<>();
    private volatile String profileKey = "";
    private volatile boolean throttled;
    private volatile Instant backoffUntil = Instant.EPOCH;
    private volatile int backoffSeconds = 2;
    private volatile String lastError;
    private volatile boolean pushHealthy;
    private volatile CountDownLatch firstPass = new CountDownLatch(1);

    public Sync(GlueService glue, JobsCache cache, Events events, State state, AwsClients aws) {
        this.glue = glue; this.cache = cache; this.events = events; this.state = state; this.aws = aws;
    }

    @PostConstruct
    void start() {
        loop("sync-inventory", 5, this::inventory);
        loop("sync-definitions", 30, this::definitions);
        loop("sync-runs", 1, this::runs);
    }

    /** {@link LiveEvents} tells us when push is delivering, so the sweeps can relax. */
    public void setPushHealthy(boolean healthy) { pushHealthy = healthy; }
    public boolean throttled() { return throttled; }
    public String lastError() { return lastError; }

    public int sweepSeconds() {
        int base = pushHealthy ? 60 : Math.max(5, cache.size() / 8);
        return throttled ? Math.min(60, base * 2) : base;
    }

    /** The first jobs page waits for one inventory pass instead of painting "no jobs" for a beat. */
    public boolean awaitFirst(long seconds) {
        try { return firstPass.await(seconds, TimeUnit.SECONDS); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); return false; }
    }

    /** Something outside the loops learned about a run (push, a start from the app): apply and broadcast. */
    public void applyRun(String job, RunInfo run) {
        JobSummary j = cache.get(job);
        if (j == null) return;
        if (j.latestRun() != null && run.startedOn() != null && j.latestRun().startedOn() != null
                && run.startedOn().isBefore(j.latestRun().startedOn()) && !run.id().equals(j.latestRun().id())) return;
        if (run.sameAs(j.latestRun())) return;
        cache.put(j.withRun(run));
        events.emit("run.changed", Map.of("job", job, "run", run));
    }

    public void applyJob(Job job) {
        JobSummary old = cache.get(job.name());
        JobSummary next = JobSummary.of(job, old == null ? null : old.latestRun(), old == null ? null : old.local());
        cache.put(next);
        known.add(job.name());
        if (old == null) events.emit("jobs.changed", Map.of("added", List.of(job.name()), "removed", List.of()));
        else events.emit("job.changed", remoteChanged(job.name(), next));
    }

    public void applyRemoved(String name) {
        known.remove(name);
        if (cache.remove(name) != null) events.emit("jobs.changed", Map.of("added", List.of(), "removed", List.of(name)));
    }

    @Override
    public void contribute(Map<String, Object> s) {
        Map<String, Object> live = new LinkedHashMap<>();
        live.put("mode", state.profile() == null ? "off" : pushHealthy ? "push" : "polling");
        live.put("sweepSeconds", sweepSeconds());
        live.put("throttled", throttled);
        if (lastError != null) live.put("error", lastError);
        s.put("live", live);
    }

    // ---- loops -----------------------------------------------------------------------------------

    private void loop(String name, int everySeconds, Runnable body) {
        Thread.ofVirtual().name(name).start(() -> {
            while (true) {
                try {
                    if (!ready()) { sleep(2000); continue; }
                    if (Instant.now().isBefore(backoffUntil)) { sleep(500); continue; }
                    body.run();
                    if (throttled) { throttled = false; backoffSeconds = 2; emitLive(); }
                    lastError = null;
                } catch (AwsServiceException e) {
                    if (isThrottle(e)) throttle(); else fail(e);
                } catch (RuntimeException e) {
                    fail(e);
                }
                sleep(everySeconds * 1000L);
            }
        });
    }

    private boolean ready() {
        String p = state.profile();
        if (p == null || p.isBlank()) return false;
        String key = p + "@" + aws.region();
        if (!key.equals(profileKey)) {
            profileKey = key;
            known.clear(); due.clear(); cache.clear();
            firstPass = new CountDownLatch(1);
        }
        return events.hasSubscribers() || !cache.filled();
    }

    private void inventory() {
        bucket.take();
        List<String> names = glue.listJobNames();
        Set<String> now = new HashSet<>(names);
        List<String> added = new ArrayList<>(), removed = new ArrayList<>();
        for (String n : names) if (!known.contains(n)) added.add(n);
        for (String n : known) if (!now.contains(n)) removed.add(n);
        if (!added.isEmpty()) {
            bucket.take();
            for (Job j : glue.batchGet(added)) {
                JobSummary old = cache.get(j.name());
                cache.put(JobSummary.of(j, old == null ? null : old.latestRun(), old == null ? null : old.local()));
                known.add(j.name());
                due.put(j.name(), Instant.EPOCH); // a new job gets its latest run on the next runs tick
            }
        }
        for (String n : removed) { known.remove(n); cache.remove(n); due.remove(n); }
        cache.markRefreshed();
        firstPass.countDown();
        if (!added.isEmpty() || !removed.isEmpty()) events.emit("jobs.changed", Map.of("added", added, "removed", removed));
    }

    private void definitions() {
        if (pushHealthy && cache.refreshedAt() != null && cache.refreshedAt().isAfter(Instant.now().minusSeconds(120))) {
            // push carries UpdateJob when a trail exists; without one this loop is the only thing that sees an edit,
            // so it still runs, just less often
        }
        List<String> names = new ArrayList<>(known);
        if (names.isEmpty()) return;
        for (int i = 0; i < names.size(); i += 100) {
            bucket.take();
            for (Job j : glue.batchGet(names.subList(i, Math.min(names.size(), i + 100)))) {
                JobSummary old = cache.get(j.name());
                if (old == null) continue;
                if (java.util.Objects.equals(old.lastModifiedOn(), j.lastModifiedOn())) continue;
                JobSummary next = JobSummary.of(j, old.latestRun(), old.local());
                cache.put(next);
                events.emit("job.changed", remoteChanged(j.name(), next));
            }
        }
    }

    private void runs() {
        if (known.isEmpty()) return;
        Instant now = Instant.now();
        int sweep = sweepSeconds();
        long spread = Math.max(1, (sweep * 1000L) / Math.max(1, known.size()));
        List<String> ready = new ArrayList<>();
        for (String n : known) {
            Instant d = due.get(n);
            if (d == null) { due.put(n, now.plusMillis(ready.size() * spread)); d = due.get(n); }
            if (!d.isAfter(now)) ready.add(n);
        }
        ready.sort((a, b) -> due.get(a).compareTo(due.get(b)));
        for (String n : ready) {
            if (!bucket.tryTake()) break; // the rest stay due; next tick picks them up in order
            RunInfo latest = glue.latestRun(n);
            JobSummary j = cache.get(n);
            if (j == null) continue;
            boolean hot = cache.hot(n) || (latest != null && !latest.terminal());
            due.put(n, Instant.now().plusSeconds(hot ? 3 : sweep));
            if (latest == null ? j.latestRun() == null : latest.sameAs(j.latestRun())) continue;
            cache.put(j.withRun(latest));
            events.emit("run.changed", Map.of("job", n, "run", latest == null ? Map.of() : latest));
        }
    }

    private Map<String, Object> remoteChanged(String name, JobSummary j) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("remote", Map.of("lastModifiedOn", j.lastModifiedOn() == null ? "" : j.lastModifiedOn().toString()));
        return m;
    }

    private static boolean isThrottle(AwsServiceException e) {
        String code = e.awsErrorDetails() == null ? "" : e.awsErrorDetails().errorCode();
        return "ThrottlingException".equals(code) || "TooManyRequestsException".equals(code) || e.statusCode() == 429;
    }

    private void throttle() {
        throttled = true;
        backoffUntil = Instant.now().plusSeconds(backoffSeconds);
        backoffSeconds = Math.min(60, backoffSeconds * 2);
        lastError = "AWS is throttling; polling slowed";
        emitLive();
    }

    private void fail(RuntimeException e) {
        String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        if (!m.equals(lastError)) {
            lastError = m.length() > 300 ? m.substring(0, 300) : m;
            log.warn("sync: {}", lastError);
            ai.oya.keel.ApiError mapped = ai.oya.keel.Errors.fromAws(e, state.profile());
            if (mapped != null && mapped.status == 401) events.emit("aws.auth", Map.of("error", mapped.getMessage(), "fix", mapped.fix == null ? "" : mapped.fix));
            emitLive();
        }
        backoffUntil = Instant.now().plusSeconds(10);
    }

    private void emitLive() {
        Map<String, Object> m = new LinkedHashMap<>();
        contribute(m);
        events.emit("live.changed", m.get("live"));
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }

    /** A token bucket: `rate` tokens per second, `burst` at most. `take` waits, `tryTake` does not. */
    static final class Bucket {
        private final double rate; private final int burst; private double tokens; private long last = System.nanoTime();
        Bucket(double rate, int burst) { this.rate = rate; this.burst = burst; this.tokens = burst; }
        synchronized boolean tryTake() { refill(); if (tokens >= 1) { tokens -= 1; return true; } return false; }
        void take() { while (!tryTake()) sleep(125); }
        private void refill() {
            long now = System.nanoTime();
            tokens = Math.min(burst, tokens + (now - last) / 1e9 * rate);
            last = now;
        }
    }
}
