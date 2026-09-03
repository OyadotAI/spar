package ai.oya.keel.git;

import ai.oya.keel.ApiError;
import ai.oya.keel.Proc;
import ai.oya.keel.State;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.stereotype.Component;

/**
 * One checkout per job: `.keel/worktrees/<job>` on branch `keel/<job>`, cut from HEAD the first
 * time. An agent writing in a job's lane cannot disturb another job's files, and the lane's
 * commits merge back as one reviewable branch.
 */
@Component
public class Lanes {
    private final State state;

    public Lanes(State state) { this.state = state; }

    public Path root() { return state.project(); }
    public Path dir(String job) {
        Path sparDir = state.sparDir().resolve("worktrees").resolve(job);
        Path legacyDir = state.project().resolve(".keel").resolve("worktrees").resolve(job);
        return Files.isDirectory(sparDir) || !Files.isDirectory(legacyDir) ? sparDir : legacyDir;
    }
    public static String branch(String job) { return "spar/" + job; }

    public boolean exists(String job) { return Files.isDirectory(dir(job).resolve(".git")) || Files.isRegularFile(dir(job).resolve(".git")); }

    /** The lane's checkout, created on demand. */
    public synchronized Path ensure(String job) {
        Path root = root();
        Git.clearStaleLocks(root);
        Git.init(root);
        if (Git.head(root) == null) {
            // a repository with no commit cannot have a worktree; give it an empty first one
            Git.commitAll(root, "keel: initial");
            if (Git.head(root) == null) {
                Proc.git(root, "-c", "user.name=Keel", "-c", "user.email=keel@localhost", "commit", "-q", "--allow-empty", "--no-verify", "-m", "keel: initial");
            }
        }
        Path d = dir(job);
        if (exists(job)) {
            Git.clearStaleLocks(d);
            return d;
        }
        try {
            Files.createDirectories(d.getParent());
            Path gi = d.getParent().resolve(".gitignore");
            if (!Files.exists(gi)) Files.writeString(gi, "*\n");
        } catch (IOException e) { throw new ApiError(500, "cannot create " + d.getParent()); }
        Git.clearStaleLocks(root);
        Proc.git(root, "worktree", "prune");
        boolean branchExists = Proc.git(root, "rev-parse", "--verify", "--quiet", "refs/heads/" + branch(job)).ok()
                || Proc.git(root, "rev-parse", "--verify", "--quiet", "refs/heads/keel/" + job).ok();
        String targetBranch = Proc.git(root, "rev-parse", "--verify", "--quiet", "refs/heads/" + branch(job)).ok()
                ? branch(job)
                : Proc.git(root, "rev-parse", "--verify", "--quiet", "refs/heads/keel/" + job).ok() ? "keel/" + job : branch(job);
        Proc.Result r = branchExists
                ? Proc.git(root, "worktree", "add", d.toString(), targetBranch)
                : Proc.git(root, "worktree", "add", "-b", targetBranch, d.toString(), "HEAD");
        if (!r.ok() && r.stderr().contains("lock': File exists")) {
            Git.clearStaleLocks(root);
            r = branchExists
                    ? Proc.git(root, "worktree", "add", d.toString(), targetBranch)
                    : Proc.git(root, "worktree", "add", "-b", targetBranch, d.toString(), "HEAD");
        }
        if (!r.ok()) throw new ApiError(500, "git worktree add failed: " + r.stderr().strip());
        Git.clearStaleLocks(d);
        return d;
    }

    /** Where a job's files are read from: its lane if it has one, else the project root. */
    public Path dirFor(String job) { return exists(job) ? dir(job) : root(); }
}
