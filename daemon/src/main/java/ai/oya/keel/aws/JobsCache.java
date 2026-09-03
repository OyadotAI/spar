package ai.oya.keel.aws;

import ai.oya.keel.State;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * What Keel currently believes about every job in the account. `Sync` writes it, everything else
 * reads it.
 *
 * It also survives the process. A laptop that wakes with an expired token could otherwise not show
 * the *names* of the jobs it listed a minute earlier, so the last good listing is kept in
 * `.keel/cache/jobs.json` and drawn immediately, marked with when it was true.
 */
@Component
public class JobsCache {
    private final Map<String, JobSummary> jobs = new ConcurrentHashMap<>();
    private final Map<String, Instant> interest = new ConcurrentHashMap<>();
    private volatile Instant refreshedAt;
    private volatile boolean filled;
    private volatile long savedAt;

    private final State state;
    private final ObjectMapper json;

    public JobsCache(State state, ObjectMapper json) { this.state = state; this.json = json; }

    private Path file() {
        Path sparCache = state.project().resolve(".spar").resolve("cache").resolve("jobs.json");
        Path legacyCache = state.project().resolve(".keel").resolve("cache").resolve("jobs.json");
        return Files.exists(sparCache) || !Files.exists(legacyCache) ? sparCache : legacyCache;
    }

    /** The listing from the last run of the app, drawn before AWS has answered anything. */
    @PostConstruct
    void loadFromDisk() {
        if (!state.hasProject()) return;
        try {
            Path f = file();
            if (!Files.exists(f)) return;
            var root = json.readTree(Files.readString(f));
            // The cache belongs to one profile and region; another one's jobs are not these jobs.
            String key = state.profile() + "@" + state.region();
            if (!key.equals(root.path("key").asText(null))) return;
            List<JobSummary> list = json.convertValue(root.path("jobs"), new TypeReference<List<JobSummary>>() {});
            for (JobSummary j : list) jobs.put(j.name(), j);
            if (root.hasNonNull("refreshedAt")) refreshedAt = Instant.parse(root.get("refreshedAt").asText());
        } catch (RuntimeException | IOException e) {
            org.slf4j.LoggerFactory.getLogger(JobsCache.class).info("no usable jobs cache: {}", e.toString());
        }
    }

    /** Written at most every half minute: this runs behind a sweep that can fire every few seconds. */
    private void saveToDisk() {
        if (!state.hasProject() || System.currentTimeMillis() - savedAt < 30_000) return;
        savedAt = System.currentTimeMillis();
        try {
            Path f = file();
            Files.createDirectories(f.getParent());
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("key", state.profile() + "@" + state.region());
            m.put("refreshedAt", refreshedAt == null ? null : refreshedAt.toString());
            m.put("jobs", all());
            Files.writeString(f, json.writeValueAsString(m));
        } catch (RuntimeException | IOException ignored) {
            // a read-only project still works; the cache is an optimisation, never a requirement
        }
    }

    /** True when rows exist but no AWS call has confirmed them this session. */
    public boolean stale() { return !filled && !jobs.isEmpty(); }

    public JobSummary get(String name) { return jobs.get(name); }
    public void put(JobSummary j) { jobs.put(j.name(), j); }
    public JobSummary remove(String name) { return jobs.remove(name); }
    public java.util.Set<String> names() { return jobs.keySet(); }
    public int size() { return jobs.size(); }
    public boolean filled() { return filled; }
    public Instant refreshedAt() { return refreshedAt; }
    public void markRefreshed() { refreshedAt = Instant.now(); filled = true; saveToDisk(); }

    public void clear() { jobs.clear(); interest.clear(); filled = false; refreshedAt = null; }

    /** Latest run first, then name; the row order of the jobs page. */
    public List<JobSummary> all() {
        List<JobSummary> out = new ArrayList<>(jobs.values());
        out.sort(Comparator.<JobSummary, Instant>comparing(j -> j.latestRun() == null ? Instant.EPOCH : j.latestRun().startedOn(),
                Comparator.nullsFirst(Comparator.naturalOrder())).reversed().thenComparing(JobSummary::name));
        return out;
    }

    /** The app looked at this job; poll it on the hot tier for a minute. */
    public void touch(String name) { interest.put(name, Instant.now()); }

    public boolean hot(String name) {
        JobSummary j = jobs.get(name);
        if (j != null && j.latestRun() != null && !j.latestRun().terminal()) return true;
        Instant t = interest.get(name);
        return t != null && t.isAfter(Instant.now().minusSeconds(60));
    }
}
