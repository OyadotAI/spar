package ai.oya.keel.term;

import ai.oya.keel.State;
import com.pty4j.PtyProcess;
import com.pty4j.PtyProcessBuilder;
import com.pty4j.WinSize;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

/**
 * A pty per WebSocket at `/ws/term?cwd=…&cols=…&rows=…`. Bytes go both ways as binary frames; a
 * text frame from the client is a control message (`{"resize":{"cols":..,"rows":..}}`), a text
 * frame from the server is the tab title. The pty lives here rather than in Electron so the
 * renderer is the same on every OS and Electron ships no native module.
 */
@Configuration
@EnableWebSocket
public class Terminals implements WebSocketConfigurer {
    private final State state;

    public Terminals(State state) { this.state = state; }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(new Handler(), "/ws/term").setAllowedOrigins("*");
    }

    private final class Handler extends AbstractWebSocketHandler {
        private final Map<String, PtyProcess> ptys = new ConcurrentHashMap<>();

        @Override
        public void afterConnectionEstablished(WebSocketSession s) throws Exception {
            Map<String, String> q = query(s.getUri());
            String cwd = q.getOrDefault("cwd", state.project().toString());
            int cols = Integer.parseInt(q.getOrDefault("cols", "120")), rows = Integer.parseInt(q.getOrDefault("rows", "30"));
            Map<String, String> env = new HashMap<>(System.getenv());
            env.put("TERM", "xterm-256color");
            env.put("COLORTERM", "truecolor");
            env.put("KEEL", "1");
            if (state.profile() != null) env.put("AWS_PROFILE", state.profile());
            if (state.region() != null) env.put("AWS_REGION", state.region());
            PtyProcess p = new PtyProcessBuilder(shell()).setDirectory(cwd).setEnvironment(env)
                    .setInitialColumns(cols).setInitialRows(rows).setConsole(false).start();
            ptys.put(s.getId(), p);
            InputStream in = p.getInputStream();
            Thread.ofVirtual().name("pty-" + s.getId()).start(() -> {
                byte[] buf = new byte[8192];
                try {
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        synchronized (s) { s.sendMessage(new BinaryMessage(java.util.Arrays.copyOf(buf, n))); }
                    }
                } catch (IOException ignored) {
                    // the shell exited or the socket closed; either way this pty is done
                }
                try { s.close(CloseStatus.NORMAL); } catch (IOException ignored) { }
            });
            String cmd = q.get("run");
            if (cmd != null && !cmd.isBlank()) { // e.g. `aws sso login --profile X`, typed for the person
                OutputStream out = p.getOutputStream();
                out.write((cmd + "\n").getBytes(StandardCharsets.UTF_8));
                out.flush();
            }
        }

        @Override
        protected void handleBinaryMessage(WebSocketSession s, BinaryMessage m) throws IOException {
            PtyProcess p = ptys.get(s.getId());
            if (p == null) return;
            OutputStream out = p.getOutputStream();
            out.write(m.getPayload().array(), m.getPayload().position(), m.getPayload().remaining());
            out.flush();
        }

        @Override
        protected void handleTextMessage(WebSocketSession s, TextMessage m) {
            PtyProcess p = ptys.get(s.getId());
            if (p == null) return;
            java.util.regex.Matcher r = java.util.regex.Pattern.compile("\"cols\"\\s*:\\s*(\\d+).*\"rows\"\\s*:\\s*(\\d+)").matcher(m.getPayload());
            if (r.find()) p.setWinSize(new WinSize(Integer.parseInt(r.group(1)), Integer.parseInt(r.group(2))));
        }

        @Override
        public void afterConnectionClosed(WebSocketSession s, CloseStatus status) {
            PtyProcess p = ptys.remove(s.getId());
            if (p != null) { p.destroy(); }
        }
    }

    static String[] shell() {
        if (System.getProperty("os.name", "").toLowerCase().contains("win")) {
            String pwsh = System.getenv("ProgramFiles") + "\\PowerShell\\7\\pwsh.exe";
            if (java.nio.file.Files.exists(java.nio.file.Path.of(pwsh))) return new String[] {pwsh, "-NoLogo"};
            return new String[] {System.getenv().getOrDefault("COMSPEC", "cmd.exe")};
        }
        String sh = System.getenv("SHELL");
        return new String[] {sh == null || sh.isBlank() ? "/bin/sh" : sh, "-l"};
    }

    static Map<String, String> query(URI uri) {
        Map<String, String> m = new HashMap<>();
        if (uri == null || uri.getRawQuery() == null) return m;
        for (String kv : uri.getRawQuery().split("&")) {
            int eq = kv.indexOf('=');
            if (eq > 0) m.put(URLDecoder.decode(kv.substring(0, eq), StandardCharsets.UTF_8), URLDecoder.decode(kv.substring(eq + 1), StandardCharsets.UTF_8));
        }
        return m;
    }
}
