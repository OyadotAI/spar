package ai.oya.keel.git;

import static org.assertj.core.api.Assertions.assertThat;

import ai.oya.keel.Proc;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class GitTest {
    @Test
    void snapshotAndCommit(@TempDir Path dir) throws Exception {
        Git.init(dir);
        Files.writeString(dir.resolve("a.txt"), "one\n");
        String before = Git.snapshot(dir);
        assertThat(before).hasSize(40);
        Files.writeString(dir.resolve("a.txt"), "two\n");
        Files.writeString(dir.resolve("b.txt"), "new\n");
        String after = Git.snapshot(dir);
        assertThat(Git.changed(dir, before, after)).containsExactlyInAnyOrder("a.txt", "b.txt");
        // a hostile pre-commit hook does not stop Keel's checkpoint
        Path hooks = dir.resolve(".git/hooks");
        Files.createDirectories(hooks);
        Files.writeString(hooks.resolve("pre-commit"), "#!/bin/sh\nexit 1\n");
        hooks.resolve("pre-commit").toFile().setExecutable(true);
        String commit = Git.commitAll(dir, "keel: test");
        assertThat(commit).isNotNull();
        assertThat(Git.commitAll(dir, "keel: nothing")).isNull();
        assertThat(Proc.git(dir, "log", "--oneline").stdout()).contains("keel: test");

        // Stale index.lock is cleared automatically and commit succeeds
        Files.writeString(dir.resolve("a.txt"), "three\n");
        Files.writeString(dir.resolve(".git/index.lock"), "stale lock file");
        String recoveredCommit = Git.commitAll(dir, "keel: recovered lock");
        assertThat(recoveredCommit).isNotNull();
        assertThat(Files.exists(dir.resolve(".git/index.lock"))).isFalse();
    }
}
