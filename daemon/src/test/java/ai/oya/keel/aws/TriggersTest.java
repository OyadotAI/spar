package ai.oya.keel.aws;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ai.oya.keel.Events;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.glue.GlueClient;
import software.amazon.awssdk.services.glue.model.Action;
import software.amazon.awssdk.services.glue.model.CreateTriggerRequest;
import software.amazon.awssdk.services.glue.model.CreateTriggerResponse;
import software.amazon.awssdk.services.glue.model.GetTriggerRequest;
import software.amazon.awssdk.services.glue.model.GetTriggerResponse;
import software.amazon.awssdk.services.glue.model.GetTriggersRequest;
import software.amazon.awssdk.services.glue.model.GetTriggersResponse;
import software.amazon.awssdk.services.glue.model.Trigger;
import software.amazon.awssdk.services.glue.model.TriggerState;

class TriggersTest {
    @Test
    void listsSchedulesForAJob() {
        AwsClients aws = mock(AwsClients.class);
        GlueClient glue = mock(GlueClient.class);
        Events events = mock(Events.class);
        when(aws.glue()).thenReturn(glue);

        Trigger trigger = Trigger.builder()
                .name("nightly-sync")
                .schedule("cron(0 0 * * ? *)")
                .state(TriggerState.ACTIVATED)
                .description("Runs nightly")
                .actions(Action.builder().jobName("job-a").arguments(Map.of("--env", "prod")).build())
                .build();

        when(glue.getTriggers(any(Consumer.class))).thenAnswer(inv -> {
            Consumer<GetTriggersRequest.Builder> consumer = inv.getArgument(0);
            GetTriggersRequest.Builder b = GetTriggersRequest.builder();
            consumer.accept(b);
            GetTriggersRequest req = b.build();
            assertThat(req.dependentJobName()).isEqualTo("job-a");
            return GetTriggersResponse.builder().triggers(List.of(trigger)).build();
        });

        Triggers triggers = new Triggers(aws, events);
        List<Triggers.Schedule> schedules = triggers.list("job-a");

        assertThat(schedules).hasSize(1);
        Triggers.Schedule s = schedules.get(0);
        assertThat(s.name()).isEqualTo("nightly-sync");
        assertThat(s.schedule()).isEqualTo("cron(0 0 * * ? *)");
        assertThat(s.state()).isEqualTo("ACTIVATED");
        assertThat(s.description()).isEqualTo("Runs nightly");
        assertThat(s.jobs()).containsExactly("job-a");
        assertThat(s.arguments()).containsEntry("--env", "prod");
    }

    @Test
    void createsScheduleAndEmitsJobChanged() {
        AwsClients aws = mock(AwsClients.class);
        GlueClient glue = mock(GlueClient.class);
        Events events = mock(Events.class);
        when(aws.glue()).thenReturn(glue);

        Trigger trigger = Trigger.builder()
                .name("custom-schedule")
                .schedule("cron(0 12 * * ? *)")
                .state(TriggerState.CREATED)
                .actions(Action.builder().jobName("job-b").build())
                .build();

        when(glue.createTrigger(any(Consumer.class))).thenReturn(CreateTriggerResponse.builder().name("custom-schedule").build());
        when(glue.getTrigger(any(Consumer.class))).thenReturn(GetTriggerResponse.builder().trigger(trigger).build());

        Triggers triggers = new Triggers(aws, events);
        Triggers.Schedule s = triggers.create("job-b", new Triggers.Create("custom-schedule", "0 12 * * ? *", "Daily noon", null, true));

        assertThat(s.name()).isEqualTo("custom-schedule");
        assertThat(s.schedule()).isEqualTo("cron(0 12 * * ? *)");
        verify(events).emit("job.changed", Map.of("name", "job-b", "schedules", true));
    }
}
