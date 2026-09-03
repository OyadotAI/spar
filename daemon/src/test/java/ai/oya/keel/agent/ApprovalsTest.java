package ai.oya.keel.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import ai.oya.keel.Events;
import ai.oya.keel.State;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ApprovalsTest {
    Approvals fresh(Path dir) {
        State state = new State(dir.toString(), new ObjectMapper());
        return new Approvals(state, new Events(), new ObjectMapper());
    }

    @Test
    void rulesAreDerivedFromTheFirstWords() {
        ObjectMapper om = new ObjectMapper();
        assertThat(Approvals.rulesFor("Bash", om.createObjectNode().put("command", "aws glue get-job --job-name x")))
                .containsExactly("Bash(aws glue*)", "Bash(aws*)");
        assertThat(Approvals.rulesFor("Bash", om.createObjectNode().put("command", "ls -la"))).containsExactly("Bash(ls*)");
        assertThat(Approvals.rulesFor("WebFetch", om.createObjectNode())).containsExactly("WebFetch");
        assertThat(Approvals.matches("Bash(aws glue*)", "Bash", "aws glue get-jobs")).isTrue();
        assertThat(Approvals.matches("Bash(aws glue*)", "Bash", "aws s3 ls")).isFalse();
        assertThat(Approvals.matches("WebFetch", "WebFetch", "")).isTrue();
    }

    @Test
    void answerReleasesTheWaiterAndRemembersTheRule(@TempDir Path dir) throws Exception {
        Approvals a = fresh(dir);
        ObjectMapper om = new ObjectMapper();
        Approvals.HookInput in = new Approvals.HookInput("Bash", om.createObjectNode().put("command", "docker ps"), "t1", "s1");
        CompletableFuture<String> body = CompletableFuture.supplyAsync(() -> a.ask("orders", in).getBody());
        // wait until the question is queued
        for (int i = 0; i < 100 && a.poll("orders").isEmpty(); i++) Thread.sleep(20);
        List<Approvals.Pending> q = a.poll("orders");
        assertThat(q).hasSize(1);
        assertThat(q.get(0).command()).isEqualTo("docker ps");
        a.answer(new Approvals.Answer(q.get(0).id(), "allow", List.of("Bash(docker*)"), "project", null));
        assertThat(body.get()).contains("\"permissionDecision\":\"allow\"");
        assertThat(a.projectRules()).contains("Bash(docker*)");
        assertThat(Files.readString(dir.resolve(".spar/permissions.json"))).contains("Bash(docker*)");
        assertThat(Files.readString(dir.resolve(".spar/.gitignore"))).isEqualTo("*\n"); // never in the project's commits
        // the same command is now allowed without asking
        assertThat(a.ask("orders", in).getBody()).contains("allowed by rule");
        assertThat(a.poll("orders")).isEmpty();
    }

    @Test
    void aQuestionComesBackAsADenyWhoseReasonIsTheAnswer(@TempDir Path dir) throws Exception {
        Approvals a = fresh(dir);
        ObjectMapper om = new ObjectMapper();
        Approvals.HookInput in = new Approvals.HookInput("AskUserQuestion", om.createObjectNode(), "t2", "s1");
        CompletableFuture<String> body = CompletableFuture.supplyAsync(() -> a.ask("orders", in).getBody());
        for (int i = 0; i < 100 && a.poll("orders").isEmpty(); i++) Thread.sleep(20);
        a.answer(new Approvals.Answer(a.poll("orders").get(0).id(), "deny", List.of(), "", "Use the parquet bucket"));
        assertThat(body.get()).contains("\"permissionDecision\":\"deny\"").contains("Use the parquet bucket");
    }

    @Test
    void trustedProjectsAreNotAsked(@TempDir Path dir) {
        Approvals a = fresh(dir);
        a.setTrusted(true);
        assertThat(a.ask("x", new Approvals.HookInput("Bash", new ObjectMapper().createObjectNode().put("command", "rm -rf /"), "t", "s")).getBody()).isEmpty();
    }
}
