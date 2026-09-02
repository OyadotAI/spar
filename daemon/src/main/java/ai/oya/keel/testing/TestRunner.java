package ai.oya.keel.testing;

import ai.oya.keel.ApiError;
import ai.oya.keel.Proc;
import ai.oya.keel.State;
import ai.oya.keel.agent.ClaudeRunner;
import ai.oya.keel.agent.Turns;
import ai.oya.keel.local.Project;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * pytest inside AWS's own Glue image, so what passes here is what runs there. Streams the output,
 * then the parsed junit report. Also the gate after an authoring turn: a turn whose tests fail is
 * not committed.
 */
@RestController
public class TestRunner implements ClaudeRunner.AfterTurn {
    public static final String IMAGE = "public.ecr.aws/glue/aws-glue-libs:5";
    private final Project project;
    private final State state;
    private final Map<String, Process> running = new ConcurrentHashMap<>();

    public TestRunner(Project project, State state) { this.project = project; this.state = state; }

    @GetMapping("/api/jobs/{name}/test")
    public SseEmitter test(@PathVariable String name) {
        Path d = project.dir(name);
        if (!Files.isDirectory(d.resolve("tests"))) throw ApiError.notFound("jobs/" + name + "/tests does not exist; generate first");
        if (running.containsKey(name)) throw ApiError.conflict("tests are already running for " + name);
        SseEmitter e = new SseEmitter(0L);
        AtomicBoolean alive = new AtomicBoolean(true);
        e.onCompletion(() -> alive.set(false)); e.onTimeout(() -> alive.set(false)); e.onError(t -> alive.set(false));
        Thread.ofVirtual().name("pytest-" + name).start(() -> {
            Map<String, Object> result = run(name, d, line -> send(e, alive, "line", Map.of("text", line)));
            send(e, alive, "result", result);
            send(e, alive, "done", Map.of("code", "passed".equals(result.get("status")) ? 0 : 1));
            e.complete();
        });
        return e;
    }

    @PostMapping("/api/jobs/{name}/test/stop")
    public Map<String, Object> stop(@PathVariable String name) {
        Process p = running.get(name);
        if (p == null) return Map.of("stopped", false);
        Proc.run(null, 20, null, "docker", "kill", "keel-test-" + name);
        p.destroyForcibly();
        return Map.of("stopped", true);
    }

    /** The whole run, synchronously: pull if needed, docker run, parse. */
    public Map<String, Object> run(String name, Path dir, Consumer<String> line) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (!Proc.run(null, 10, null, "docker", "info").ok()) {
            result.put("status", "error");
            result.put("message", "Docker is not running. Tests run inside " + IMAGE + "; start Docker Desktop (or the daemon) and try again.");
            return result;
        }
        if (!Proc.run(null, 20, null, "docker", "image", "inspect", IMAGE).ok()) {
            line.accept("pulling " + IMAGE + " (about 7 GB, once)…");
            if (!stream(name, null, line, "docker", "pull", IMAGE)) { result.put("status", "error"); result.put("message", "docker pull failed"); return result; }
        }
        Path junit = dir.resolve(".junit.xml");
        try { Files.deleteIfExists(junit); } catch (IOException ignored) { }
        List<String> cmd = new ArrayList<>(List.of("docker", "run", "-i", "--rm", "--name", "keel-test-" + name,
                "-v", Path.of(System.getProperty("user.home"), ".aws") + ":/home/hadoop/.aws:ro",
                "-v", dir.toAbsolutePath() + ":/home/hadoop/workspace",
                "-w", "/home/hadoop/workspace"));
        if (state.profile() != null) { cmd.add("-e"); cmd.add("AWS_PROFILE=" + state.profile()); }
        if (state.region() != null) { cmd.add("-e"); cmd.add("AWS_REGION=" + state.region()); }
        cmd.add(IMAGE);
        cmd.add("-c");
        cmd.add("python3 -m pytest -q --disable-warnings -p no:cacheprovider --junitxml=.junit.xml tests");
        long t0 = System.currentTimeMillis();
        boolean ok = stream(name, dir, line, cmd.toArray(String[]::new));
        if (Files.exists(junit)) {
            result.putAll(JUnitXml.parse(junit));
            try { Files.deleteIfExists(junit); } catch (IOException ignored) { }
        } else {
            result.put("status", "error");
            result.put("message", ok ? "pytest wrote no report" : "pytest could not start (collection error?) — see the output above");
            result.put("passed", 0); result.put("failed", 0); result.put("errors", 1); result.put("skipped", 0); result.put("cases", List.of());
        }
        result.put("ms", System.currentTimeMillis() - t0);
        return result;
    }

    private boolean stream(String name, Path dir, Consumer<String> line, String... cmd) {
        Process p;
        try { p = Proc.start(dir, null, cmd); }
        catch (IOException e) { line.accept("cannot start docker: " + e.getMessage()); return false; }
        running.put(name, p);
        try {
            Thread a = Proc.drain(p.getInputStream(), line), b = Proc.drain(p.getErrorStream(), line);
            boolean done = p.waitFor(20, TimeUnit.MINUTES);
            if (!done) { line.accept("timed out after 20 minutes"); Proc.run(null, 20, null, "docker", "kill", "keel-test-" + name); p.destroyForcibly(); }
            a.join(5000); b.join(5000);
            return done && p.exitValue() == 0;
        } catch (InterruptedException e) { Thread.currentThread().interrupt(); return false; }
        finally { running.remove(name); }
    }

    /** The gate: after an authoring turn that touched the job, run its tests and record the verdict. */
    @Override
    public void afterTurn(String job, Path cwd, Turns.Record record, List<String> files) {
        if (!"author".equals(record.mode)) return;
        Path d = cwd.resolve("jobs").resolve(job);
        if (!Files.isDirectory(d.resolve("tests")) || files.stream().noneMatch(f -> f.startsWith("jobs/" + job + "/"))) return;
        List<String> out = new ArrayList<>();
        Map<String, Object> result = run(job, d, l -> { if (out.size() < 400) out.add(l); });
        if (!"passed".equals(result.get("status")) && !result.containsKey("message")) {
            result.put("message", String.join("\n", out.subList(Math.max(0, out.size() - 40), out.size())));
        }
        record.gate = result;
    }

    private static void send(SseEmitter e, AtomicBoolean alive, String name, Object data) {
        if (!alive.get()) return;
        try { e.send(SseEmitter.event().name(name).data(data)); } catch (IOException | IllegalStateException ex) { alive.set(false); }
    }
}
