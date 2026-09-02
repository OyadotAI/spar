package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import software.amazon.awssdk.services.cloudwatchlogs.model.ResourceNotFoundException;

/**
 * Why a run wrote no logs, no metrics and no insights is almost always the job's IAM role, not the
 * job. This checks what the account actually has and hands back the exact policy that fixes it —
 * and, if the person's own credentials may, attaches it on one explicit click.
 */
@RestController
public class RoleCheck {
    static final String POLICY_NAME = "KeelGlueObservability";

    private final AwsClients aws;
    private final GlueService glue;

    public RoleCheck(AwsClients aws, GlueService glue) { this.aws = aws; this.glue = glue; }

    @GetMapping("/api/glue/jobs/{name}/role")
    public Map<String, Object> check(@PathVariable String name) {
        var job = glue.getJobJson(name);
        String roleArn = job.path("Role").asText("");
        String role = roleArn.contains("/") ? roleArn.substring(roleArn.lastIndexOf('/') + 1) : roleArn;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("role", role);
        m.put("roleArn", roleArn);

        List<String> groups = new ArrayList<>();
        for (String g : LogsService.GROUPS) {
            try { aws.logs().describeLogStreams(b -> b.logGroupName(g).limit(1)); groups.add(g); }
            catch (ResourceNotFoundException ignored) { } catch (RuntimeException ignored) { }
        }
        m.put("logGroups", groups);
        m.put("canWriteLogs", !groups.isEmpty());
        int metrics = 0;
        try { metrics = aws.cloudWatch().listMetrics(b -> b.namespace("Glue").dimensions(d -> d.name("JobName").value(name))).metrics().size(); }
        catch (RuntimeException ignored) { }
        m.put("metricCount", metrics);

        List<String> attached = new ArrayList<>(), inline = new ArrayList<>();
        boolean readable = false;
        try {
            aws.iam().listAttachedRolePolicies(b -> b.roleName(role)).attachedPolicies().forEach(p -> attached.add(p.policyName()));
            inline.addAll(aws.iam().listRolePolicies(b -> b.roleName(role)).policyNames());
            readable = true;
        } catch (RuntimeException e) {
            m.put("iamNote", "Keel cannot read the role (" + short_(e) + "); the policy below is still the one to add.");
        }
        m.put("attachedPolicies", attached);
        m.put("inlinePolicies", inline);
        m.put("readable", readable);
        m.put("hasKeelPolicy", inline.contains(POLICY_NAME));
        m.put("policyName", POLICY_NAME);
        m.put("policy", policy());
        List<String> missing = new ArrayList<>();
        if (groups.isEmpty()) missing.add("CloudWatch Logs: no /aws-glue/jobs/* log group exists, so Glue could not create one. Without logs there is no log console, no insights and no Spark event history.");
        if (metrics == 0) missing.add("CloudWatch metrics: nothing published in the Glue namespace for this job. The Metrics tab needs cloudwatch:PutMetricData plus --enable-metrics on the job.");
        m.put("missing", missing);
        return m;
    }

    /** The smallest policy that makes logs, metrics and the Spark UI work. */
    static String policy() {
        return """
                {
                  "Version": "2012-10-17",
                  "Statement": [
                    {
                      "Sid": "GlueJobLogs",
                      "Effect": "Allow",
                      "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:AssociateKmsKey"],
                      "Resource": "arn:aws:logs:*:*:log-group:/aws-glue/*"
                    },
                    {
                      "Sid": "GlueJobMetrics",
                      "Effect": "Allow",
                      "Action": "cloudwatch:PutMetricData",
                      "Resource": "*",
                      "Condition": {"StringEquals": {"cloudwatch:namespace": ["Glue", "Glue/Job", "AWS/Glue"]}}
                    }
                  ]
                }""";
    }

    /** Attaches the policy to the job's role. An explicit, reversible act: it is one named inline policy. */
    @PostMapping("/api/glue/jobs/{name}/role/grant")
    public Map<String, Object> grant(@PathVariable String name) {
        var job = glue.getJobJson(name);
        String roleArn = job.path("Role").asText("");
        String role = roleArn.contains("/") ? roleArn.substring(roleArn.lastIndexOf('/') + 1) : roleArn;
        if (role.isBlank()) throw ApiError.badRequest("the job has no role");
        try {
            aws.iam().putRolePolicy(b -> b.roleName(role).policyName(POLICY_NAME).policyDocument(policy()));
        } catch (RuntimeException e) {
            throw new ApiError(403, "could not attach the policy: " + short_(e),
                    "your own credentials need iam:PutRolePolicy on " + role + ", or paste the policy into the role by hand");
        }
        return Map.of("role", role, "policy", POLICY_NAME, "attached", true,
                "note", "Added as an inline policy on " + role + ". New runs write logs and metrics; runs that already finished have none.");
    }

    private static String short_(Throwable e) {
        String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        return m.length() > 200 ? m.substring(0, 200) : m;
    }
}
