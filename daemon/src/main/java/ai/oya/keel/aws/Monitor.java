package ai.oya.keel.aws;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import software.amazon.awssdk.services.glue.model.JobRun;

/** Glue Studio's monitoring dashboard: what ran in the last day, how it went, what it cost in DPU-hours. Cached a minute. */
@RestController
public class Monitor {
    private final GlueService glue;
    private final JobsCache cache;
    private volatile Map<String, Object> last;
    private volatile Instant at = Instant.EPOCH;

    public Monitor(GlueService glue, JobsCache cache) { this.glue = glue; this.cache = cache; }

    @GetMapping("/api/glue/monitor")
    public synchronized Map<String, Object> monitor(@RequestParam(defaultValue = "24") int hours, @RequestParam(defaultValue = "false") boolean refresh) {
        if (!refresh && last != null && at.isAfter(Instant.now().minusSeconds(60))) return last;
        Instant since = Instant.now().minusSeconds(hours * 3600L);
        int succeeded = 0, failed = 0, running = 0, stopped = 0, total = 0;
        double dpuHours = 0, execSeconds = 0;
        List<Map<String, Object>> recent = new ArrayList<>();
        int perJob = hours <= 24 ? 25 : hours <= 168 ? 75 : 200;
        for (String job : cache.names()) {
            List<JobRun> runs;
            try { runs = glue.runs(job, perJob, null).jobRuns(); } catch (RuntimeException e) { continue; }
            for (JobRun r : runs) {
                if (r.startedOn() == null || r.startedOn().isBefore(since)) continue;
                total++;
                String s = r.jobRunStateAsString();
                switch (s) {
                    case "SUCCEEDED" -> succeeded++;
                    case "FAILED", "ERROR", "TIMEOUT" -> failed++;
                    case "STOPPED", "STOPPING", "EXPIRED" -> stopped++;
                    default -> running++;
                }
                double h = dpuHours(r);
                dpuHours += h;
                execSeconds += r.executionTime() == null ? 0 : r.executionTime();
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("job", job); m.put("id", r.id()); m.put("state", s); m.put("startedOn", r.startedOn().toString());
                m.put("completedOn", r.completedOn() == null ? null : r.completedOn().toString());
                m.put("executionTime", r.executionTime()); m.put("dpuHours", h); m.put("errorMessage", r.errorMessage());
                m.put("workerType", r.workerTypeAsString() == null ? "—" : r.workerTypeAsString());
                m.put("numberOfWorkers", r.numberOfWorkers());
                m.put("jobType", jobType(cache.get(job)));
                m.put("triggerName", r.triggerName());
                recent.add(m);
            }
        }
        recent.sort((a, b) -> String.valueOf(b.get("startedOn")).compareTo(String.valueOf(a.get("startedOn"))));
        // the breakdowns Glue Studio's dashboard draws: by job type, by worker type, and by day
        Map<String, Map<String, Integer>> byType = new java.util.LinkedHashMap<>(), byWorker = new java.util.LinkedHashMap<>(), byDay = new java.util.TreeMap<>();
        for (Map<String, Object> r : recent) {
            String st = bucket(String.valueOf(r.get("state")));
            byType.computeIfAbsent(String.valueOf(r.get("jobType")), k -> new java.util.LinkedHashMap<>()).merge(st, 1, Integer::sum);
            byWorker.computeIfAbsent(String.valueOf(r.get("workerType")), k -> new java.util.LinkedHashMap<>()).merge(st, 1, Integer::sum);
            byDay.computeIfAbsent(String.valueOf(r.get("startedOn")).substring(0, 10), k -> new java.util.LinkedHashMap<>()).merge(st, 1, Integer::sum);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("byType", byType); out.put("byWorker", byWorker); out.put("byDay", byDay);
        out.put("hours", hours); out.put("total", total); out.put("succeeded", succeeded); out.put("failed", failed); out.put("running", running); out.put("stopped", stopped);
        out.put("dpuHours", Math.round(dpuHours * 100) / 100.0); out.put("executionHours", Math.round(execSeconds / 36) / 100.0);
        out.put("recent", recent.size() > 500 ? recent.subList(0, 500) : recent);
        out.put("at", Instant.now().toString());
        last = out; at = Instant.now();
        return out;
    }

    static String bucket(String state) {
        return switch (state) {
            case "SUCCEEDED" -> "succeeded";
            case "FAILED", "ERROR", "TIMEOUT" -> "failed";
            case "STOPPED", "STOPPING", "EXPIRED" -> "stopped";
            default -> "running";
        };
    }

    static String jobType(JobSummary j) {
        if (j == null || j.commandName() == null) return "Spark";
        return switch (j.commandName()) {
            case "gluestreaming" -> "Streaming";
            case "pythonshell" -> "Python shell";
            case "glueray" -> "Ray";
            default -> "Spark";
        };
    }

    /** What Glue bills: DPU seconds when it reports them (flex/autoscaling), else workers × DPU factor × execution time. */
    public static double dpuHours(JobRun r) {
        if (r.dpuSeconds() != null && r.dpuSeconds() > 0) return r.dpuSeconds() / 3600.0;
        if (r.executionTime() == null) return 0;
        double factor = switch (r.workerTypeAsString() == null ? "" : r.workerTypeAsString()) {
            case "G.025X" -> 0.25; case "G.2X", "Z.2X" -> 2; case "G.4X" -> 4; case "G.8X" -> 8; case "G.12X" -> 12; case "G.16X" -> 16; default -> 1;
        };
        double workers = r.numberOfWorkers() != null ? r.numberOfWorkers() : r.maxCapacity() != null ? r.maxCapacity() : 2;
        return workers * factor * r.executionTime() / 3600.0;
    }
}
