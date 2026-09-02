package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
import ai.oya.keel.Events;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import software.amazon.awssdk.services.glue.model.Action;
import software.amazon.awssdk.services.glue.model.Trigger;
import software.amazon.awssdk.services.glue.model.TriggerType;

/** Schedules, as Glue Studio calls them: SCHEDULED triggers whose one action starts this job. */
@RestController
public class Triggers {
    private final AwsClients aws;
    private final Events events;

    public Triggers(AwsClients aws, Events events) { this.aws = aws; this.events = events; }

    public record Schedule(String name, String schedule, String state, String description, List<String> jobs, Map<String, String> arguments) {}

    @GetMapping("/api/glue/jobs/{name}/schedules")
    public List<Schedule> list(@PathVariable String name) {
        List<Schedule> out = new ArrayList<>();
        String next = null;
        do {
            final String token = next;
            var r = aws.glue().getTriggers(b -> b.dependentJobName(name).maxResults(200).nextToken(token));
            for (Trigger t : r.triggers()) out.add(toSchedule(t));
            next = r.nextToken();
        } while (next != null);
        return out;
    }

    public record Create(String name, String cron, String description, Map<String, String> arguments, Boolean start) {}

    /** `cron` is a Glue cron expression (`cron(0 12 * * ? *)`), or the 6-field body without the wrapper. */
    @PostMapping("/api/glue/jobs/{name}/schedules")
    public Schedule create(@PathVariable String name, @RequestBody Create c) {
        String cron = c.cron() == null ? "" : c.cron().trim();
        if (cron.isEmpty()) throw ApiError.badRequest("a schedule needs a cron expression");
        if (!cron.startsWith("cron(")) cron = "cron(" + cron + ")";
        String tname = c.name() == null || c.name().isBlank() ? name + "-schedule" : c.name();
        final String schedule = cron;
        Action action = Action.builder().jobName(name).arguments(c.arguments() == null ? Map.of() : c.arguments()).build();
        aws.glue().createTrigger(b -> {
            b.name(tname).type(TriggerType.SCHEDULED).schedule(schedule).actions(action).startOnCreation(!Boolean.FALSE.equals(c.start()));
            if (c.description() != null) b.description(c.description());
        });
        events.emit("job.changed", Map.of("name", name, "schedules", true));
        return toSchedule(aws.glue().getTrigger(b -> b.name(tname)).trigger());
    }

    public record Update(String cron, String description, Map<String, String> arguments) {}

    @org.springframework.web.bind.annotation.PutMapping("/api/glue/schedules/{tname}")
    public Schedule update(@PathVariable String tname, @RequestBody Update u) {
        Trigger t = aws.glue().getTrigger(b -> b.name(tname)).trigger();
        String cron = u.cron() == null || u.cron().isBlank() ? t.schedule() : (u.cron().trim().startsWith("cron(") ? u.cron().trim() : "cron(" + u.cron().trim() + ")");
        List<Action> actions = new ArrayList<>();
        for (Action a : t.actions()) actions.add(u.arguments() == null ? a : a.toBuilder().arguments(u.arguments()).build());
        aws.glue().updateTrigger(b -> b.name(tname).triggerUpdate(x -> {
            x.schedule(cron).actions(actions);
            if (u.description() != null) x.description(u.description());
        }));
        return get(tname);
    }

    @PostMapping("/api/glue/schedules/{tname}/start")
    public Schedule start(@PathVariable String tname) { aws.glue().startTrigger(b -> b.name(tname)); return get(tname); }

    @PostMapping("/api/glue/schedules/{tname}/stop")
    public Schedule stop(@PathVariable String tname) { aws.glue().stopTrigger(b -> b.name(tname)); return get(tname); }

    @DeleteMapping("/api/glue/schedules/{tname}")
    public Map<String, Object> delete(@PathVariable String tname) { aws.glue().deleteTrigger(b -> b.name(tname)); return Map.of("deleted", tname); }

    private Schedule get(String tname) { return toSchedule(aws.glue().getTrigger(b -> b.name(tname)).trigger()); }

    static Schedule toSchedule(Trigger t) {
        List<String> jobs = new ArrayList<>();
        Map<String, String> args = new LinkedHashMap<>();
        for (Action a : t.actions()) { if (a.jobName() != null) jobs.add(a.jobName()); if (a.arguments() != null) args.putAll(a.arguments()); }
        return new Schedule(t.name(), t.schedule(), t.stateAsString(), t.description(), jobs, args);
    }
}
