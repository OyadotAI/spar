package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
import ai.oya.keel.State;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The permissions Keel asks for, as three small policies instead of one large one.
 *
 * Read is the default and is genuinely read-only: with Author and Operate off, nothing in this
 * daemon can change an account. Each tier is generated for the account, region and buckets in
 * front of the user, because a policy with a wildcard in it is a policy nobody reads before
 * pasting.
 */
public final class Policies {
    private Policies() {}

    public record Tier(String id, String title, String why, List<String> actions, List<String> resources) {}

    public static List<String> read() {
        return List.of("glue:Get*", "glue:List*", "glue:BatchGet*", "glue:QuerySchemaVersionMetadata",
                "logs:DescribeLogGroups", "logs:DescribeLogStreams", "logs:GetLogEvents", "logs:FilterLogEvents", "logs:StartQuery", "logs:GetQueryResults",
                "cloudwatch:GetMetricData", "cloudwatch:GetMetricStatistics", "cloudwatch:ListMetrics",
                "s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation",
                "sts:GetCallerIdentity");
    }

    public static List<String> author() {
        return List.of("glue:CreateJob", "glue:UpdateJob", "glue:DeleteJob", "glue:TagResource", "glue:UntagResource",
                "glue:CreateTrigger", "glue:UpdateTrigger", "glue:DeleteTrigger",
                "glue:CreateConnection", "glue:UpdateConnection", "glue:DeleteConnection",
                "glue:CreateCustomEntityType", "glue:DeleteCustomEntityType",
                "glue:CreateUsageProfile", "glue:UpdateUsageProfile", "glue:DeleteUsageProfile",
                "glue:CreateDataQualityRuleset", "glue:UpdateDataQualityRuleset", "glue:DeleteDataQualityRuleset",
                "s3:PutObject", "s3:DeleteObject");
    }

    public static List<String> operate() {
        return List.of("glue:StartJobRun", "glue:BatchStopJobRun", "glue:ResetJobBookmark",
                "glue:StartTrigger", "glue:StopTrigger",
                "glue:CreateSession", "glue:DeleteSession", "glue:StopSession", "glue:RunStatement", "glue:CancelStatement",
                "glue:StartDataQualityRulesetEvaluationRun", "glue:StartCrawler",
                "iam:PassRole");
    }

    public static List<String> live() {
        return List.of("sqs:CreateQueue", "sqs:DeleteQueue", "sqs:GetQueueAttributes", "sqs:SetQueueAttributes",
                "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueUrl",
                "events:PutRule", "events:PutTargets", "events:DeleteRule", "events:RemoveTargets", "events:DescribeRule",
                "cloudtrail:DescribeTrails", "cloudtrail:LookupEvents");
    }

    public static List<String> roleGrant() {
        return List.of("iam:GetRole", "iam:GetRolePolicy", "iam:PutRolePolicy", "iam:ListAttachedRolePolicies");
    }

    public static List<String> actions(String tier) {
        return switch (tier) {
            case "read" -> read();
            case "author" -> author();
            case "operate" -> operate();
            case "live" -> live();
            case "roleGrant" -> roleGrant();
            default -> throw ApiError.badRequest("no such tier: " + tier);
        };
    }

    public static String title(String tier) {
        return switch (tier) {
            case "read" -> "Read";
            case "author" -> "Author";
            case "operate" -> "Operate";
            case "live" -> "Live events";
            case "roleGrant" -> "Grant the job role its logs";
            default -> tier;
        };
    }

    public static String why(String tier) {
        return switch (tier) {
            case "read" -> "List jobs, read their runs, logs and metrics. Nothing here can change anything.";
            case "author" -> "Create, update and delete jobs, triggers and connections, and write the script to S3.";
            case "operate" -> "Start and stop runs, reset bookmarks, and use interactive sessions.";
            case "live" -> "Receive job-state changes over EventBridge and SQS instead of polling for them.";
            case "roleGrant" -> "Attach the CloudWatch permissions a job role needs, when a run produces no logs at all.";
            default -> "";
        };
    }

    /** One IAM policy document, scoped to the region and account in use and the buckets we touch. */
    public static Map<String, Object> document(String tier, State state, String account, List<String> buckets) {
        String region = state.region() == null ? "*" : state.region();
        String acct = account == null || account.isBlank() ? "*" : account;
        List<String> glueLike = new ArrayList<>();
        List<String> s3 = new ArrayList<>();
        List<String> other = new ArrayList<>();
        for (String a : actions(tier)) {
            if (a.startsWith("s3:")) s3.add(a);
            else if (a.startsWith("glue:")) glueLike.add(a);
            else other.add(a);
        }
        List<Map<String, Object>> statements = new ArrayList<>();
        if (!glueLike.isEmpty())
            statements.add(statement("Keel" + cap(tier) + "Glue", glueLike, List.of("arn:aws:glue:" + region + ":" + acct + ":*")));
        if (!s3.isEmpty()) {
            List<String> arns = new ArrayList<>();
            for (String b : buckets == null || buckets.isEmpty() ? List.of("*") : buckets) {
                arns.add("arn:aws:s3:::" + b);
                arns.add("arn:aws:s3:::" + b + "/*");
            }
            statements.add(statement("Keel" + cap(tier) + "S3", s3, arns));
        }
        if (!other.isEmpty()) {
            List<String> arns = new ArrayList<>();
            for (String a : other) {
                if (a.startsWith("logs:")) arns.add("arn:aws:logs:" + region + ":" + acct + ":log-group:/aws-glue/*");
                else if (a.startsWith("sqs:")) arns.add("arn:aws:sqs:" + region + ":" + acct + ":keel-live-*");
                else if (a.startsWith("events:")) arns.add("arn:aws:events:" + region + ":" + acct + ":rule/keel-live-*");
                else if (a.startsWith("iam:")) arns.add("arn:aws:iam::" + acct + ":role/*");
                else arns.add("*"); // cloudwatch:GetMetricData and sts:GetCallerIdentity take no resource
            }
            statements.add(statement("Keel" + cap(tier) + "Other", other, arns.stream().distinct().toList()));
        }
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("Version", "2012-10-17");
        doc.put("Statement", statements);
        return doc;
    }

    private static Map<String, Object> statement(String sid, List<String> actions, List<String> resources) {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("Sid", sid);
        s.put("Effect", "Allow");
        s.put("Action", actions);
        s.put("Resource", resources);
        return s;
    }

    private static String cap(String s) { return s.substring(0, 1).toUpperCase() + s.substring(1); }
}
