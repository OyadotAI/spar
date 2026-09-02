package ai.oya.keel.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class McpTest {
    @Test
    void speaksJsonRpc() throws Exception {
        ObjectMapper om = new ObjectMapper();
        Mcp mcp = new Mcp(mock(Approvals.class), om);
        JsonNode init = om.readTree(mcp.rpc("x", om.readTree("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}")).getBody());
        assertThat(init.path("result").path("protocolVersion").asText()).isEqualTo(Mcp.PROTOCOL);
        JsonNode list = om.readTree(mcp.rpc("x", om.readTree("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}")).getBody());
        assertThat(list.path("result").path("tools").get(0).path("name").asText()).isEqualTo("ask_user");
        assertThat(mcp.rpc("x", om.readTree("{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}")).getStatusCode().value()).isEqualTo(202);
        JsonNode bad = om.readTree(mcp.rpc("x", om.readTree("{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"nope\"}")).getBody());
        assertThat(bad.path("error").path("code").asInt()).isEqualTo(-32601);
    }
}
