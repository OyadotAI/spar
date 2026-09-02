package ai.oya.keel.aws;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import software.amazon.awssdk.services.cloudwatch.model.Dimension;
import software.amazon.awssdk.services.cloudwatch.model.Metric;
import software.amazon.awssdk.services.cloudwatch.model.MetricDataQuery;
import software.amazon.awssdk.services.cloudwatch.model.MetricDataResult;
import software.amazon.awssdk.services.cloudwatch.model.MetricStat;

/**
 * The charts Glue Studio's Metrics tab draws, read straight from CloudWatch's `Glue` namespace for
 * one job run: ETL data movement, memory, CPU, executors, and the shuffle counters. A job run only
 * publishes these when `--enable-metrics` is on, so an empty series is a real answer, not an error.
 */
@RestController
public class Metrics {
    /** id → (metric name, dimension JobRunId|Type, statistic, label, unit, group). */
    record Spec(String id, String metric, String type, String stat, String label, String unit, String group) {}

    static final List<Spec> SPECS = List.of(
            new Spec("bytesRead", "glue.ALL.s3.filesystem.read_bytes", "gauge", "Sum", "S3 bytes read", "bytes", "Data movement"),
            new Spec("bytesWritten", "glue.ALL.s3.filesystem.write_bytes", "gauge", "Sum", "S3 bytes written", "bytes", "Data movement"),
            new Spec("driverHeap", "glue.driver.jvm.heap.usage", "gauge", "Average", "Driver heap used", "percent", "Memory"),
            new Spec("executorHeap", "glue.ALL.jvm.heap.usage", "gauge", "Average", "Executor heap used (avg)", "percent", "Memory"),
            new Spec("driverCpu", "glue.driver.system.cpuSystemLoad", "gauge", "Average", "Driver CPU load", "percent", "CPU"),
            new Spec("executorCpu", "glue.ALL.system.cpuSystemLoad", "gauge", "Average", "Executor CPU load (avg)", "percent", "CPU"),
            new Spec("neededExecutors", "glue.driver.ExecutorAllocationManager.executors.numberMaxNeededExecutors", "gauge", "Maximum", "Executors needed", "count", "Executors"),
            new Spec("activeExecutors", "glue.driver.ExecutorAllocationManager.executors.numberAllExecutors", "gauge", "Maximum", "Executors active", "count", "Executors"),
            new Spec("completedStages", "glue.driver.aggregate.numCompletedStages", "count", "Sum", "Stages completed", "count", "Progress"),
            new Spec("completedTasks", "glue.driver.aggregate.numCompletedTasks", "count", "Sum", "Tasks completed", "count", "Progress"),
            new Spec("failedTasks", "glue.driver.aggregate.numFailedTasks", "count", "Sum", "Tasks failed", "count", "Progress"),
            new Spec("shuffleRead", "glue.driver.aggregate.shuffleLocalBytesRead", "gauge", "Sum", "Shuffle bytes read", "bytes", "Shuffle"),
            new Spec("shuffleWritten", "glue.driver.aggregate.shuffleBytesWritten", "gauge", "Sum", "Shuffle bytes written", "bytes", "Shuffle"),
            new Spec("recordsRead", "glue.ALL.s3.filesystem.read_bytes", "gauge", "SampleCount", "Read samples", "count", "Data movement"));

    private final AwsClients aws;
    private final GlueService glue;

    public Metrics(AwsClients aws, GlueService glue) { this.aws = aws; this.glue = glue; }

    @GetMapping("/api/glue/jobs/{name}/runs/{id}/metrics")
    public Map<String, Object> metrics(@PathVariable String name, @PathVariable String id) {
        RunInfo run = glue.run(name, id);
        Instant start = run.startedOn() == null ? Instant.now().minusSeconds(3600) : run.startedOn().minusSeconds(60);
        Instant end = run.completedOn() == null ? Instant.now() : run.completedOn().plusSeconds(120);
        long span = Math.max(60, end.getEpochSecond() - start.getEpochSecond());
        int period = span <= 1800 ? 60 : span <= 21600 ? 300 : 900; // CloudWatch caps at 1440 points

        List<MetricDataQuery> queries = new ArrayList<>();
        for (Spec s : SPECS) {
            queries.add(MetricDataQuery.builder().id(s.id()).label(s.label())
                    .metricStat(MetricStat.builder().stat(s.stat()).period(period)
                            .metric(Metric.builder().namespace("Glue").metricName(s.metric())
                                    .dimensions(Dimension.builder().name("JobRunId").value(id).build(),
                                            Dimension.builder().name("JobName").value(name).build(),
                                            Dimension.builder().name("Type").value(s.type()).build()).build()).build())
                    .build());
        }
        Map<String, Object> out = new LinkedHashMap<>();
        List<Map<String, Object>> series = new ArrayList<>();
        boolean any = false;
        for (int i = 0; i < queries.size(); i += 20) { // CloudWatch takes 500, but keep requests small
            List<MetricDataQuery> chunk = queries.subList(i, Math.min(queries.size(), i + 20));
            var r = aws.cloudWatch().getMetricData(b -> b.startTime(start).endTime(end).scanBy("TimestampAscending").metricDataQueries(chunk));
            for (MetricDataResult m : r.metricDataResults()) {
                Spec spec = SPECS.stream().filter(s -> s.id().equals(m.id())).findFirst().orElse(null);
                if (spec == null) continue;
                List<Object[]> points = new ArrayList<>();
                for (int k = 0; k < m.timestamps().size(); k++) points.add(new Object[] {m.timestamps().get(k).toEpochMilli(), m.values().get(k)});
                if (!points.isEmpty()) any = true;
                Map<String, Object> s = new LinkedHashMap<>();
                s.put("id", spec.id()); s.put("label", spec.label()); s.put("unit", spec.unit()); s.put("group", spec.group()); s.put("points", points);
                series.add(s);
            }
        }
        out.put("run", id); out.put("period", period); out.put("start", start.toString()); out.put("end", end.toString());
        out.put("series", series);
        out.put("any", any);
        if (!any) out.put("note", "CloudWatch has no Glue metrics for this run. Turn on \"Job metrics\" (--enable-metrics) on the Job details tab; the job's role also needs cloudwatch:PutMetricData.");
        return out;
    }

    /** The run's own numbers, for the header of the metrics tab. */
    @GetMapping("/api/glue/jobs/{name}/runs/{id}/summary")
    public Map<String, Object> summary(@PathVariable String name, @PathVariable String id) {
        RunInfo r = glue.run(name, id);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("state", r.state()); m.put("executionTime", r.executionTime()); m.put("dpuHours", r.dpuHours());
        m.put("workerType", r.workerType()); m.put("numberOfWorkers", r.numberOfWorkers()); m.put("glueVersion", r.glueVersion());
        m.put("startedOn", r.startedOn() == null ? null : r.startedOn().toString());
        m.put("completedOn", r.completedOn() == null ? null : r.completedOn().toString());
        return m;
    }

    /** Every metric this account actually publishes for the job, so an empty chart can be explained. */
    @GetMapping("/api/glue/jobs/{name}/metrics/available")
    public List<String> available(@PathVariable String name, @RequestParam(required = false) String run) {
        List<String> out = new ArrayList<>();
        var r = aws.cloudWatch().listMetrics(b -> b.namespace("Glue").dimensions(d -> d.name("JobName").value(name)));
        for (Metric m : r.metrics()) if (run == null || m.dimensions().stream().anyMatch(d -> d.name().equals("JobRunId") && d.value().equals(run))) out.add(m.metricName());
        return out.stream().distinct().sorted().toList();
    }
}
