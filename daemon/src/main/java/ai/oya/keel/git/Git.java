package ai.oya.keel.git;

import ai.oya.keel.ApiError;
import ai.oya.keel.Proc;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The little git Keel needs, all through {@link Proc#git} so nothing can prompt. A snapshot is a
 * tree written from a throwaway index (no refs, no stash, reclaimed by gc) — v1's design — so it
 * can be taken before every turn without touching the person's own index.
 */
public final class Git {
    private Git() {}

    public static boolean isRepo(Path dir) {
        return Proc.git(dir, "rev-parse", "--is-inside-work-tree").ok();
    }

    public static void init(Path dir) {
        if (isRepo(dir)) return;
        Proc.Result r = Proc.git(dir, "init", "-q", "-b", "main");
        if (!r.ok()) throw new ApiError(500, "git init failed: " + r.stderr().strip());
    }

    /** The tree id of the working tree right now, or null if git cannot say. Per-call index, never the person's. */
    public static String snapshot(Path dir) {
        Path index;
        try { index = Files.createTempFile("keel-index-", ""); Files.delete(index); }
        catch (java.io.IOException e) { return null; }
        Map<String, String> env = new HashMap<>(Proc.GIT_ENV);
        env.put("GIT_INDEX_FILE", index.toString());
        try {
            if (!Proc.run(dir, 60, env, "git", "add", "-A", "--", ".").ok()) return null;
            Proc.Result r = Proc.run(dir, 60, env, "git", "write-tree");
            return r.ok() ? r.stdout().strip() : null;
        } finally {
            try { Files.deleteIfExists(index); } catch (java.io.IOException ignored) { }
        }
    }

    /** Paths that differ between two trees, relative to the repo root. */
    public static List<String> changed(Path dir, String before, String after) {
        if (before == null || after == null || before.equals(after)) return List.of();
        Proc.Result r = Proc.git(dir, "diff-tree", "-r", "--name-only", "--no-commit-id", before, after);
        return r.ok() ? Proc.lines(r.stdout()) : List.of();
    }

    /**
     * Keel's checkpoint after a turn: everything, no hooks (a repo's pre-commit is code by a
     * stranger, runs on Keel's initiative, and re-runs the checks the gate already ran), no
     * signing prompt. Returns the commit, or null when there was nothing to commit.
     */
    public static String commitAll(Path dir, String message) {
        if (!Proc.git(dir, "add", "-A").ok()) return null;
        if (Proc.git(dir, "diff", "--cached", "--quiet").ok()) return null;
        Proc.Result r = Proc.git(dir, "-c", "commit.gpgsign=false", "-c", "user.useConfigOnly=false",
                "commit", "-q", "--no-verify", "-m", message);
        if (!r.ok()) {
            if (r.stderr().contains("Please tell me who you are") || r.stderr().contains("Author identity unknown")) {
                Proc.Result again = Proc.git(dir, "-c", "commit.gpgsign=false", "-c", "user.name=Keel", "-c", "user.email=keel@localhost",
                        "commit", "-q", "--no-verify", "-m", message);
                if (!again.ok()) throw new ApiError(500, "commit failed: " + again.stderr().strip());
            } else throw new ApiError(500, "commit failed: " + r.stderr().strip());
        }
        return head(dir);
    }

    public static String head(Path dir) {
        Proc.Result r = Proc.git(dir, "rev-parse", "--short", "HEAD");
        return r.ok() ? r.stdout().strip() : null;
    }

    public static String branch(Path dir) {
        Proc.Result r = Proc.git(dir, "rev-parse", "--abbrev-ref", "HEAD");
        return r.ok() ? r.stdout().strip() : null;
    }

    public record Change(String status, String path) {}

    public static List<Change> status(Path dir) {
        Proc.Result r = Proc.git(dir, "status", "--porcelain=v1", "--untracked-files=all");
        List<Change> out = new ArrayList<>();
        if (!r.ok()) return out;
        for (String l : r.stdout().split("\n")) {
            if (l.length() < 4) continue;
            out.add(new Change(l.substring(0, 2).strip(), l.substring(3)));
        }
        return out;
    }
}
