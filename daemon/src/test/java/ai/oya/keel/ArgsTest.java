package ai.oya.keel;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ArgsTest {
    @Test
    void cliFlagsBecomeSpringProperties() {
        assertThat(KeelApplication.rewrite(new String[] {"--port", "4321", "--project", "/x y", "--exit-with-parent", "--foo"}))
                .containsExactly("--server.port=4321", "--keel.project=/x y", "--keel.exit-with-parent=true", "--foo");
    }
}
