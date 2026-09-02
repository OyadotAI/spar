package ai.oya.keel.aws;

import java.time.Instant;
import java.util.Map;
import software.amazon.awssdk.services.glue.model.JobRun;
import software.amazon.awssdk.services.glue.model.JobRunState;

/** A job run as the app sees it. Terminal means Glue will not change it again. */
public record RunInfo(String id, Integer attempt, String state, String stateDetail, String errorMessage,
                      Instant startedOn, Instant completedOn, Integer executionTime, Double dpuSeconds,
                      Map<String, String> arguments, String logGroupName, String glueVersion, String workerType,
                      Integer numberOfWorkers, String previousRunId, String triggerName, Double maxCapacity, Double dpuHours) {

    public static RunInfo of(JobRun r) {
        return new RunInfo(r.id(), r.attempt(), r.jobRunStateAsString(), r.stateDetail(), r.errorMessage(),
                r.startedOn(), r.completedOn(), r.executionTime(), r.dpuSeconds(), r.arguments(), r.logGroupName(),
                r.glueVersion(), r.workerTypeAsString(), r.numberOfWorkers(), r.previousRunId(), r.triggerName(), r.maxCapacity(), Monitor.dpuHours(r));
    }

    public boolean terminal() { return isTerminal(state); }

    public static boolean isTerminal(String s) {
        if (s == null) return true;
        return switch (JobRunState.fromValue(s)) {
            case STARTING, RUNNING, STOPPING, WAITING -> false;
            default -> true;
        };
    }

    /**
     * Same run, same state, same completion: nothing the app needs to redraw. A running run's
     * `executionTime` climbs on every poll and the app draws that from the clock itself, so it
     * only counts once the run has ended.
     */
    public boolean sameAs(RunInfo o) {
        return o != null && id.equals(o.id) && java.util.Objects.equals(state, o.state)
                && java.util.Objects.equals(completedOn, o.completedOn)
                && (!terminal() || java.util.Objects.equals(executionTime, o.executionTime));
    }
}
