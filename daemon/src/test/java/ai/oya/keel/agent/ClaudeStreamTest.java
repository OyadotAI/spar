package ai.oya.keel.agent;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The fixture is a real `claude -p "Reply with exactly: hi"` stream, captured once. */
class ClaudeStreamTest {
    @Test
    void readsSessionAndUsageFromACapturedStream() throws Exception {
        List<String> lines = Files.readAllLines(Path.of("src/test/resources/fixtures/stream.jsonl"));
        ObjectMapper om = new ObjectMapper();
        Map<String, Object> usage = new LinkedHashMap<>();
        String[] session = {null};
        for (String l : lines) ClaudeRunner.decode(om, l, usage, s -> session[0] = s);
        assertThat(session[0]).isEqualTo("51a6dbcf-8dbb-470f-9149-33df44269df5");
        assertThat(usage.get("output")).isEqualTo(4L);
        assertThat(usage.get("cacheRead")).isEqualTo(10007L);
        assertThat((Double) usage.get("costUsd")).isGreaterThan(0);
        assertThat(usage).doesNotContainKey("error");
        assertThat(lines.stream().filter(l -> l.contains("\"type\":\"result\"")).count()).isEqualTo(1);
    }
}
