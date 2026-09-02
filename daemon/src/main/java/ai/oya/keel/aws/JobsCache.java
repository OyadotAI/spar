package ai.oya.keel.aws;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/** What Keel currently believes about every job in the account. `Sync` writes it, everything else reads it. */
@Component
public class JobsCache {
    private final Map<String, JobSummary> jobs = new ConcurrentHashMap<>();
    private final Map<String, Instant> interest = new ConcurrentHashMap<>();
    private volatile Instant refreshedAt;
    private volatile boolean filled;

    public JobSummary get(String name) { return jobs.get(name); }
    public void put(JobSummary j) { jobs.put(j.name(), j); }
    public JobSummary remove(String name) { return jobs.remove(name); }
    public java.util.Set<String> names() { return jobs.keySet(); }
    public int size() { return jobs.size(); }
    public boolean filled() { return filled; }
    public Instant refreshedAt() { return refreshedAt; }
    public void markRefreshed() { refreshedAt = Instant.now(); filled = true; }

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
