package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
import ai.oya.keel.State;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import software.amazon.awssdk.services.iam.model.EvaluationResult;
import software.amazon.awssdk.services.iam.model.SimulatePrincipalPolicyRequest;

/**
 * Read-only unless you say otherwise, enforced here rather than hoped for in IAM.
 *
 * Every call that would change an AWS account passes through one interceptor, which refuses it
 * before any client is built when its tier is off. The point is that a Keel install can be
 * genuinely safe to point at production, with credentials that would allow more, and the person
 * turning Author on knows exactly what they turned on.
 */
@RestController
public class Access implements HandlerInterceptor {
    private final State state;
    private final AwsClients aws;
    private final ObjectMapper json;
    private final Map<String, String> accountByProfile = new ConcurrentHashMap<>();

    public Access(State state, AwsClients aws, ObjectMapper json) { this.state = state; this.aws = aws; this.json = json; }

    @Configuration
    static class Wiring implements WebMvcConfigurer {
        private final Access access;
        Wiring(Access access) { this.access = access; }
        @Override public void addInterceptors(InterceptorRegistry r) { r.addInterceptor(access).addPathPatterns("/api/**"); }
    }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) {
        String tier = required(req.getMethod(), req.getRequestURI());
        if (tier == null || state.tier(tier)) return true;
        throw new ApiError(403, Policies.title(tier) + " is off, so Keel did not make that call",
                "Turn " + Policies.title(tier) + " on in Settings → AWS access. " + Policies.why(tier));
    }

    /**
     * Which tier a request needs, from its method and path alone. Anything not listed here is
     * either a read or a purely local operation, and neither needs a switch.
     */
    static String required(String method, String path) {
        boolean write = !("GET".equals(method) || "HEAD".equals(method) || "OPTIONS".equals(method));
        if (path.startsWith("/api/aws/tiers")) return null; // turning a tier on must not need the tier
        if (path.contains("/live") || path.startsWith("/api/glue/live")) return write ? "live" : null;
        if (path.endsWith("/role/grant") || path.contains("/role/attach")) return "roleGrant";
        if (!write) return null;
        // Running things, in someone's account, costing money.
        if (path.matches(".*/runs$") || path.contains("/runs/") || path.contains("/stop")
                || path.contains("/bookmark") && !path.contains("/bookmark/local")
                || path.contains("/sessions") || path.contains("/statements")
                || path.contains("/crawlers") || path.contains("/evaluate")) return "operate";
        // Changing what is in the account.
        if (path.contains("/deploy") || path.contains("/triggers") || path.contains("/schedules")
                || path.contains("/connections") || path.contains("/entities") || path.contains("/usage-profiles")
                || path.contains("/quality") || path.startsWith("/api/glue/jobs")) return "author";
        return null;
    }

    @GetMapping("/api/aws/tiers")
    public Map<String, Object> tiers() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (String t : new String[] {"read", "author", "operate", "live", "roleGrant"}) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", t);
            m.put("title", Policies.title(t));
            m.put("why", Policies.why(t));
            m.put("on", state.tier(t));
            m.put("required", "read".equals(t));
            m.put("actions", Policies.actions(t));
            out.add(m);
        }
        return Map.of("tiers", out);
    }

    @PostMapping("/api/aws/tiers/{name}")
    public Map<String, Object> setTier(@PathVariable String name, @RequestParam boolean on) {
        state.setTier(name, on);
        return tiers();
    }

    /** The policy to paste, generated for this account, this region and the buckets in use. */
    @GetMapping("/api/aws/policy")
    public Map<String, Object> policy(@RequestParam(defaultValue = "read") String tier) {
        List<String> buckets = new ArrayList<>();
        if (state.scriptBucket() != null) buckets.add(state.scriptBucket());
        Map<String, Object> doc = Policies.document(tier, state, account(), buckets);
        String body;
        try { body = json.writerWithDefaultPrettyPrinter().writeValueAsString(doc); }
        catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new ApiError(500, "cannot render the policy"); }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("tier", tier);
        m.put("title", Policies.title(tier));
        m.put("why", Policies.why(tier));
        m.put("json", body);
        m.put("terraform", "resource \"aws_iam_policy\" \"keel_" + tier + "\" {\n  name   = \"Keel" + Policies.title(tier).replace(" ", "") + "\"\n  policy = <<EOT\n"
                + body + "\nEOT\n}\n");
        m.put("cloudformation", "Resources:\n  Keel" + Policies.title(tier).replace(" ", "") + ":\n    Type: AWS::IAM::ManagedPolicy\n    Properties:\n      PolicyDocument:\n"
                + body.lines().map(l -> "        " + l).reduce("", (a, b) -> a.isEmpty() ? b : a + "\n" + b) + "\n");
        return m;
    }

    /**
     * What this identity can actually do, asked before anything is attempted.
     *
     * `iam:SimulatePrincipalPolicy` answers per action, so a missing permission is named up front
     * instead of surfacing as a failure four minutes into a deploy. When simulation itself is
     * denied — which is common — the answer is "unknown", never a guess.
     */
    @GetMapping("/api/aws/preflight")
    public Map<String, Object> preflight() {
        String arn;
        try { arn = aws.sts().getCallerIdentity().arn(); }
        catch (RuntimeException e) { throw new ApiError(400, "cannot read the caller identity: " + e.getMessage(), "check the profile in Settings"); }
        List<Map<String, Object>> tiers = new ArrayList<>();
        for (String t : new String[] {"read", "author", "operate", "live", "roleGrant"}) {
            List<String> actions = Policies.actions(t);
            Map<String, String> verdicts = simulate(arn, actions);
            List<String> denied = new ArrayList<>();
            List<String> unknown = new ArrayList<>();
            for (String a : actions) {
                String v = verdicts.get(a);
                if ("denied".equals(v)) denied.add(a);
                else if (v == null || "unknown".equals(v)) unknown.add(a);
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", t);
            m.put("title", Policies.title(t));
            m.put("on", state.tier(t));
            m.put("denied", denied);
            m.put("unknown", unknown);
            m.put("verdict", denied.isEmpty() ? (unknown.isEmpty() ? "allowed" : "unknown") : "partial");
            m.put("disables", disables(t, denied));
            tiers.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("identity", arn);
        out.put("account", account());
        out.put("region", state.region());
        out.put("tiers", tiers);
        return out;
    }

    /** Wildcards cannot be simulated, so `glue:Get*` is asked as a concrete call it stands for. */
    private static String concrete(String action) {
        return switch (action) {
            case "glue:Get*" -> "glue:GetJobs";
            case "glue:List*" -> "glue:ListJobs";
            case "glue:BatchGet*" -> "glue:BatchGetJobs";
            default -> action;
        };
    }

    private Map<String, String> simulate(String arn, List<String> actions) {
        Map<String, String> out = new LinkedHashMap<>();
        List<String> asked = actions.stream().map(Access::concrete).distinct().toList();
        try {
            var res = aws.iam().simulatePrincipalPolicy(SimulatePrincipalPolicyRequest.builder()
                    .policySourceArn(arn).actionNames(asked).build());
            Map<String, String> byAction = new LinkedHashMap<>();
            for (EvaluationResult r : res.evaluationResults())
                byAction.put(r.evalActionName(), r.evalDecisionAsString().startsWith("allowed") ? "allowed" : "denied");
            for (String a : actions) out.put(a, byAction.getOrDefault(concrete(a), "unknown"));
        } catch (RuntimeException e) {
            // Simulating needs iam:SimulatePrincipalPolicy, which read-only identities rarely have.
            for (String a : actions) out.put(a, "unknown");
        }
        return out;
    }

    /** What a person loses when an action is missing — the only part of a permission report that matters. */
    static List<String> disables(String tier, List<String> denied) {
        List<String> out = new ArrayList<>();
        for (String a : denied) {
            if (a.startsWith("logs:")) out.add("Logs for a run");
            else if (a.startsWith("cloudwatch:")) out.add("Metrics and the run charts");
            else if (a.startsWith("s3:")) out.add("Data previews and script upload");
            else if (a.equals("glue:StartJobRun")) out.add("Run");
            else if (a.equals("glue:UpdateJob") || a.equals("glue:CreateJob")) out.add("Deploy");
            else if (a.startsWith("glue:CreateSession") || a.startsWith("glue:RunStatement")) out.add("Interactive sessions");
            else if (a.startsWith("events:") || a.startsWith("sqs:")) out.add("Live push (it falls back to polling)");
            else if (a.startsWith("iam:")) out.add("Granting a job role its log permissions");
        }
        return out.stream().distinct().toList();
    }

    /** Cached per profile: this is on hot paths, and an account id does not change under a profile. */
    private String account() {
        String p = state.profile() == null ? "-" : state.profile();
        return accountByProfile.computeIfAbsent(p, k -> {
            try { return aws.sts().getCallerIdentity().account(); }
            catch (RuntimeException e) { return ""; }
        });
    }
}
