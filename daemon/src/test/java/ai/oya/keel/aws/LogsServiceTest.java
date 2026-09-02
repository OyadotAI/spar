package ai.oya.keel.aws;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.cloudwatchlogs.CloudWatchLogsClient;
import software.amazon.awssdk.services.cloudwatchlogs.model.DescribeLogStreamsRequest;
import software.amazon.awssdk.services.cloudwatchlogs.model.DescribeLogStreamsResponse;
import software.amazon.awssdk.services.cloudwatchlogs.model.LogStream;
import software.amazon.awssdk.services.cloudwatchlogs.model.ResourceNotFoundException;

class LogsServiceTest {
    @Test
    void discoversAcrossGroupsDroppingProgressBarAndMissingGroups() {
        CloudWatchLogsClient logs = mock(CloudWatchLogsClient.class);
        when(logs.describeLogStreams(any(Consumer.class))).thenAnswer(inv -> {
            DescribeLogStreamsRequest.Builder b = DescribeLogStreamsRequest.builder();
            ((Consumer<DescribeLogStreamsRequest.Builder>) inv.getArgument(0)).accept(b);
            DescribeLogStreamsRequest req = b.build();
            return switch (req.logGroupName()) {
                case "/aws-glue/jobs/error" -> DescribeLogStreamsResponse.builder().logStreams(
                        LogStream.builder().logStreamName("jr_1-driver").build(),
                        LogStream.builder().logStreamName("jr_1-1").build(),
                        LogStream.builder().logStreamName("jr_1-progress-bar").build()).build();
                case "/aws-glue/jobs/output" -> DescribeLogStreamsResponse.builder().logStreams(
                        LogStream.builder().logStreamName("jr_1-driver").build()).build();
                default -> throw ResourceNotFoundException.builder().message("no such group").build();
            };
        });
        AwsClients aws = mock(AwsClients.class);
        when(aws.logs()).thenReturn(logs);
        List<LogsService.StreamRef> found = new LogsService(aws).discover("jr_1", "all", null);
        assertThat(found).containsExactly(
                new LogsService.StreamRef("/aws-glue/jobs/error", "jr_1-driver"),
                new LogsService.StreamRef("/aws-glue/jobs/error", "jr_1-1"),
                new LogsService.StreamRef("/aws-glue/jobs/output", "jr_1-driver"));
        assertThat(new LogsService(aws).discover("jr_1", "output", null)).hasSize(1);
    }
}
