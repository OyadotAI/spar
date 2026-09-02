package ai.oya.keel;

import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.web.context.WebServerInitializedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.stereotype.Component;

/** Entry point. `java -jar keel-daemon.jar --project DIR [--port N] [--exit-with-parent]`. */
@SpringBootApplication
@EnableScheduling
public class KeelApplication {

    public static void main(String[] args) {
        SpringApplication.run(KeelApplication.class, rewrite(args));
    }

    /** The CLI flags the app passes, turned into Spring properties. Anything else passes through. */
    static String[] rewrite(String[] args) {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--port" -> out.add("--server.port=" + args[++i]);
                case "--project" -> out.add("--keel.project=" + args[++i]);
                case "--exit-with-parent" -> out.add("--keel.exit-with-parent=true");
                default -> out.add(args[i]);
            }
        }
        return out.toArray(String[]::new);
    }

    /** The app reads this one line from stdout to learn where we are. Everything else logs to stderr. */
    @Component
    static class PortAnnouncer {
        @EventListener
        void ready(WebServerInitializedEvent e) {
            System.out.println("KEEL_PORT=" + e.getWebServer().getPort());
            System.out.flush();
        }
    }
}
