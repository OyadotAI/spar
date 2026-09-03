package ai.oya.keel;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;

class ToolsTest {
    @Test
    void detectsInstalledTools() {
        Tools tools = new Tools();
        Map<String, Tools.Tool> m = tools.detect();
        assertThat(m).containsKey("claude");
        assertThat(m).containsKey("git");
        assertThat(m).containsKey("aws");
        assertThat(m).containsKey("docker");
        assertThat(tools.has("git")).isTrue();
        Tools.Tool claude = m.get("claude");
        assertThat(claude.installed()).isTrue();
        assertThat(claude.version()).contains("Claude Code");
        assertThat(claude.loggedIn()).isNotNull();
    }
}
