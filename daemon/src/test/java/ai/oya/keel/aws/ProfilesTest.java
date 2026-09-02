package ai.oya.keel.aws;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ProfilesTest {
    @Test
    void ssoSessionBlockIsReplacedNotAppendedAndTheRestIsUntouched(@TempDir Path home) throws Exception {
        String old = System.getProperty("user.home");
        System.setProperty("user.home", home.toString());
        try {
            Path config = home.resolve(".aws/config");
            Files.createDirectories(config.getParent());
            Files.writeString(config, "[profile mine]\nregion = eu-west-1\n\n[sso-session keel]\nsso_start_url = https://old/start\nsso_region = eu-west-1\n\n[profile other]\nregion = us-east-1\n");
            Profiles.writeSession("https://new/start", "us-east-2");
            String text = Files.readString(config);
            assertThat(text).startsWith("[profile mine]\nregion = eu-west-1\n");
            assertThat(text).contains("[profile other]\nregion = us-east-1\n");
            assertThat(text).containsOnlyOnce("[sso-session keel]");
            assertThat(text).contains("sso_start_url = https://new/start\nsso_region = us-east-2\n");
            assertThat(text).doesNotContain("https://old/start");
        } finally {
            System.setProperty("user.home", old);
        }
    }

    @Test
    void plainRejectsWhatWouldBreakTheIniOrTheArgv() {
        assertThat(Profiles.plain("dev-account")).isTrue();
        assertThat(Profiles.plain("x\n[sso-session evil]")).isFalse();
        assertThat(Profiles.plain("--profile")).isFalse();
        assertThat(Profiles.plain("")).isFalse();
    }
}
