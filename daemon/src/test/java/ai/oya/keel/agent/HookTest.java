package ai.oya.keel.agent;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;

class HookTest {
    @Test
    void settingsCarryTheCurlHookAndFailOpen() throws Exception {
        ObjectMapper om = new ObjectMapper();
        JsonNode s = om.readTree(Hook.settingsJson(om, 4321, "orders", List.of("Bash(aws glue*)"), false));
        JsonNode hook = s.path("hooks").path("PreToolUse").get(0);
        assertThat(hook.path("matcher").asText()).isEqualTo(Hook.HOOKED_TOOLS);
        String cmd = hook.path("hooks").get(0).path("command").asText();
        assertThat(cmd).startsWith("curl -fsS").contains("--data-binary @-").contains("http://127.0.0.1:4321/api/approve/ask?lane=orders").endsWith("|| true");
        assertThat(hook.path("hooks").get(0).path("timeout").asInt()).isGreaterThan(Hook.CURL_MAX_TIME);
        assertThat(Hook.CURL_MAX_TIME).isGreaterThan(Hook.DAEMON_WAIT_SECONDS);
        List<String> allow = om.convertValue(s.path("permissions").path("allow"), om.getTypeFactory().constructCollectionType(List.class, String.class));
        assertThat(allow).contains("Bash(aws glue*)", "mcp__keel__ask_user").doesNotContain("Bash");
        JsonNode trusted = om.readTree(Hook.settingsJson(om, 1, "x", List.of(), true));
        assertThat(trusted.path("permissions").path("allow").toString()).contains("\"Bash\"").contains("\"WebFetch\"");
    }
}
