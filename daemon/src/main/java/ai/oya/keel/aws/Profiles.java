package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
import ai.oya.keel.Events;
import ai.oya.keel.Proc;
import ai.oya.keel.State;
import ai.oya.keel.StateController;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import software.amazon.awssdk.profiles.Profile;
import software.amazon.awssdk.profiles.ProfileFile;

/**
 * What `~/.aws/config` says, and the one thing Keel writes into it: an SSO profile, the way v1
 * did — `aws configure set` for the profile keys (non-interactive) and a hand-written
 * `[sso-session keel]` block, because `configure set` only writes profile sections. Access keys
 * are never taken by Keel: that flow runs `aws configure` in the terminal so the secret hits the
 * CLI's stdin and nothing else.
 */
@RestController
public class Profiles implements StateController.StateContributor {
    public record Info(String name, String region, boolean sso) {}

    private static final String SESSION = "keel";
    private final State state;
    private final Events events;
    private final AwsClients clients;

    public Profiles(State state, Events events, AwsClients clients) {
        this.state = state; this.events = events; this.clients = clients;
    }

    public static List<Info> list() {
        List<Info> out = new ArrayList<>();
        try {
            ProfileFile f = ProfileFile.defaultProfileFile();
            for (Profile p : f.profiles().values()) {
                boolean sso = p.property("sso_session").isPresent() || p.property("sso_start_url").isPresent();
                out.add(new Info(p.name(), p.property("region").orElse(null), sso));
            }
        } catch (RuntimeException ignored) {
            // no config file, or one the SDK cannot parse: an empty list, and the UI says "add a profile"
        }
        out.sort((a, b) -> a.name().compareToIgnoreCase(b.name()));
        return out;
    }

    public static String region(String profile) {
        for (Info i : list()) if (i.name().equals(profile)) return i.region();
        return null;
    }

    @Override
    public void contribute(Map<String, Object> s) { s.put("profiles", list()); }

    public record SsoSetup(String startUrl, String ssoRegion, String account, String role, String profile, String region) {}

    @PostMapping("/api/aws/sso")
    public Map<String, String> sso(@RequestBody SsoSetup req) {
        String profile = plain(req.profile()) ? req.profile() : "keel";
        if (!req.startUrl().startsWith("https://")) throw ApiError.badRequest("the start URL must begin with https://");
        if (!req.account().matches("\\d{12}")) throw ApiError.badRequest("the account id is 12 digits");
        for (String v : new String[] {req.startUrl(), req.ssoRegion(), req.role(), profile})
            if (!plain(v)) throw ApiError.badRequest("a value contains characters the config file cannot hold");
        String region = plain(req.region()) ? req.region() : req.ssoRegion();
        set(profile, "sso_session", SESSION);
        set(profile, "sso_account_id", req.account());
        set(profile, "sso_role_name", req.role());
        set(profile, "region", region);
        writeSession(req.startUrl().trim(), req.ssoRegion().trim());
        state.set(profile, region, null);
        clients.reset();
        events.emit("state.changed", state.asMap());
        return Map.of("profile", profile, "login", "aws sso login --profile " + profile);
    }

    static boolean plain(String v) {
        return v != null && !v.isEmpty() && v.length() <= 200 && !v.contains("\n") && !v.contains("\r")
                && !v.contains("[") && !v.contains("]") && !v.contains("\"") && !v.startsWith("-");
    }

    private static void set(String profile, String key, String value) {
        Proc.Result r = Proc.run(null, 20, null, "aws", "configure", "set", key, value, "--profile", profile);
        if (!r.ok()) throw new ApiError(500, "`aws configure set " + key + "` failed: " + r.stderr().strip());
    }

    /** Append or replace `[sso-session keel]`; every other byte of the file stays as it was. */
    static void writeSession(String startUrl, String ssoRegion) {
        Path config = Path.of(System.getProperty("user.home"), ".aws", "config");
        String block = "[sso-session " + SESSION + "]\nsso_start_url = " + startUrl + "\nsso_region = " + ssoRegion
                + "\nsso_registration_scopes = sso:account:access\n";
        try {
            String existing = Files.exists(config) ? Files.readString(config) : "";
            Matcher m = Pattern.compile("(?ms)^\\[sso-session " + SESSION + "\\][^\\[]*").matcher(existing);
            String updated = m.find() ? existing.substring(0, m.start()) + block + existing.substring(m.end())
                    : (existing.isEmpty() || existing.endsWith("\n") ? existing : existing + "\n") + "\n" + block;
            Files.createDirectories(config.getParent());
            Files.writeString(config, updated);
        } catch (IOException e) {
            throw new ApiError(500, "cannot write " + config + ": " + e.getMessage());
        }
    }
}
