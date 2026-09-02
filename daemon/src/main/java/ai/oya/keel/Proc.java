package ai.oya.keel;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * Every child process goes through here: both pipes drained on their own threads (a 64 KB pipe
 * buffer deadlocks a chatty child that nobody reads), a ceiling on every synchronous call, and git
 * told it may not ask questions.
 */
public final class Proc {
    private Proc() {}

    public record Result(int code, String stdout, String stderr, boolean timedOut) {
        public boolean ok() { return code == 0 && !timedOut; }
    }

    public static Result run(Path dir, int timeoutSec, Map<String, String> env, String... args) {
        Process p;
        try { p = start(dir, env, args); }
        catch (IOException e) { return new Result(127, "", e.getMessage(), false); }
        StringBuilder out = new StringBuilder(), err = new StringBuilder();
        Thread to = drain(p.getInputStream(), l -> append(out, l));
        Thread te = drain(p.getErrorStream(), l -> append(err, l));
        boolean done;
        try { done = p.waitFor(timeoutSec, TimeUnit.SECONDS); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); done = false; }
        if (!done) { p.descendants().forEach(ProcessHandle::destroyForcibly); p.destroyForcibly(); }
        join(to); join(te);
        return new Result(done ? p.exitValue() : -1, out.toString(), err.toString(), !done);
    }

    public static Result git(Path dir, String... args) {
        String[] full = new String[args.length + 1];
        full[0] = "git";
        System.arraycopy(args, 0, full, 1, args.length);
        return run(dir, 60, GIT_ENV, full);
    }

    /** No askpass window, no gpg-agent prompt, no "are you sure": a git that cannot ask hangs on nothing. */
    public static final Map<String, String> GIT_ENV = Map.of(
            "GIT_TERMINAL_PROMPT", "0", "GIT_ASKPASS", "", "SSH_ASKPASS", "", "GIT_EDITOR", "true");

    public static Process start(Path dir, Map<String, String> env, String... args) throws IOException {
        ProcessBuilder b = new ProcessBuilder(args);
        if (dir != null) b.directory(dir.toFile());
        if (env != null) b.environment().putAll(env);
        return b.start();
    }

    /** Reads a stream line by line on a virtual thread. Undecodable bytes are replaced, never fatal. */
    public static Thread drain(java.io.InputStream in, Consumer<String> line) {
        return Thread.ofVirtual().start(() -> {
            try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                String l;
                while ((l = r.readLine()) != null) line.accept(l);
            } catch (IOException ignored) {
                // the child closed the pipe; that is the end of the stream, not an error
            }
        });
    }

    public static List<String> lines(String s) {
        List<String> out = new ArrayList<>();
        for (String l : s.split("\n")) if (!l.isBlank()) out.add(l);
        return out;
    }

    private static void append(StringBuilder b, String l) { synchronized (b) { b.append(l).append('\n'); } }

    private static void join(Thread t) {
        try { t.join(5000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}
