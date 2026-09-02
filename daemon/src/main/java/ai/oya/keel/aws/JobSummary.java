package ai.oya.keel.aws;

import java.time.Instant;
import java.util.Map;
import software.amazon.awssdk.services.glue.model.Job;

/** One row of the jobs page. `local` is filled by the project layer when the job has a folder. */
public record JobSummary(String name, String jobMode, String glueVersion, String workerType, Integer numberOfWorkers,
                         String commandName, String scriptLocation, String role, Instant createdOn, Instant lastModifiedOn,
                         Integer timeout, Integer maxRetries, String executionClass, RunInfo latestRun, Map<String, Object> local) {

    public static JobSummary of(Job j, RunInfo latest, Map<String, Object> local) {
        return new JobSummary(j.name(), j.jobModeAsString(), j.glueVersion(), j.workerTypeAsString(), j.numberOfWorkers(),
                j.command() == null ? null : j.command().name(), j.command() == null ? null : j.command().scriptLocation(),
                j.role(), j.createdOn(), j.lastModifiedOn(), j.timeout(), j.maxRetries(), j.executionClassAsString(), latest, local);
    }

    public JobSummary withRun(RunInfo r) {
        return new JobSummary(name, jobMode, glueVersion, workerType, numberOfWorkers, commandName, scriptLocation, role,
                createdOn, lastModifiedOn, timeout, maxRetries, executionClass, r, local);
    }

    public JobSummary withLocal(Map<String, Object> l) {
        return new JobSummary(name, jobMode, glueVersion, workerType, numberOfWorkers, commandName, scriptLocation, role,
                createdOn, lastModifiedOn, timeout, maxRetries, executionClass, latestRun, l);
    }
}
