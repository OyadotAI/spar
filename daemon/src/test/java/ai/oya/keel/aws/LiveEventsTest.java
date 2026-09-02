package ai.oya.keel.aws;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ai.oya.keel.Events;
import ai.oya.keel.State;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.glue.model.Job;

class LiveEventsTest {
    @Test
    void mapsMessagesToTargetedRefreshes() throws Exception {
        GlueService glue = mock(GlueService.class);
        Sync sync = mock(Sync.class);
        State state = mock(State.class);
        when(state.installId()).thenReturn("abcd1234");
        LiveEvents live = new LiveEvents(mock(AwsClients.class), state, sync, glue, mock(Events.class), new ObjectMapper());
        ObjectMapper om = new ObjectMapper();

        RunInfo r = new RunInfo("jr_1", 1, "SUCCEEDED", null, null, Instant.now(), Instant.now(), 10, 1.0, Map.of(), null, null, null, null, null, null, null, null);
        when(glue.run("orders", "jr_1")).thenReturn(r);
        live.handle(om.readTree("{\"detail-type\":\"Glue Job State Change\",\"source\":\"aws.glue\",\"detail\":{\"jobName\":\"orders\",\"state\":\"SUCCEEDED\",\"jobRunId\":\"jr_1\"}}"));
        verify(sync).applyRun("orders", r);

        Job j = Job.builder().name("orders").build();
        when(glue.getJob("orders")).thenReturn(j);
        live.handle(om.readTree("{\"detail-type\":\"AWS API Call via CloudTrail\",\"detail\":{\"eventName\":\"UpdateJob\",\"requestParameters\":{\"jobName\":\"orders\"}}}"));
        verify(sync).applyJob(j);

        live.handle(om.readTree("{\"detail-type\":\"AWS API Call via CloudTrail\",\"detail\":{\"eventName\":\"DeleteJob\",\"requestParameters\":{\"jobName\":\"old\"}}}"));
        verify(sync).applyRemoved("old");

        live.handle(om.readTree("{\"detail-type\":\"AWS API Call via CloudTrail\",\"detail\":{\"eventName\":\"StartJobRun\",\"requestParameters\":{\"jobName\":\"orders\"},\"responseElements\":{\"jobRunId\":\"jr_1\"}}}"));
        verify(glue, org.mockito.Mockito.times(2)).run("orders", "jr_1");

        assertThat(live.prefix()).isEqualTo("keel-live-abcd1234");
        assertThat(LiveEvents.API_PATTERN).contains("\"CreateJob\"").contains("AWS API Call via CloudTrail");
    }
}
