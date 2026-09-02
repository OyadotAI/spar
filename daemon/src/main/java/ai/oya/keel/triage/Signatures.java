package ai.oya.keel.triage;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * What a Glue failure actually means.
 *
 * The most-viewed questions about Glue are not about transformations. They are about errors that
 * name the wrong subsystem: an IAM-worded crawler failure fixed by configuring a VPC, an "illegal
 * empty schema" on the write that is really an empty read, a NullPointerException that is a
 * missing Lake Formation grant. Each signature here matches the text Glue produces, says what it
 * really is, quotes the line it matched, and gives the fix — offline, with no model call.
 *
 * Py4J handles (`o123`) are normalised out before matching, so a signature is stable across runs.
 */
public final class Signatures {
    private Signatures() {}

    /**
     * @param id        stable slug, so the app can link to a longer explanation
     * @param pattern   what to look for in the error message and the log tail
     * @param unless    when this also matches, the signature is the wrong one (a more specific rule owns it)
     * @param cause     what actually went wrong, in one sentence, naming the real subsystem
     * @param fix       what to do about it
     * @param confidence 0..1, ranked highest first
     */
    public record Signature(String id, Pattern pattern, Pattern unless, String cause, String fix, double confidence) {}

    public record Match(String id, String cause, String fix, String evidence, double confidence) {
        public Map<String, Object> asMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", id); m.put("cause", cause); m.put("fix", fix); m.put("evidence", evidence); m.put("confidence", confidence);
            return m;
        }
    }

    private static Pattern p(String re) { return Pattern.compile(re, Pattern.CASE_INSENSITIVE | Pattern.MULTILINE); }

    static Signature sig(String id, String re, String cause, String fix, double c) { return new Signature(id, p(re), null, cause, fix, c); }

    static Signature sig(String id, String re, String unless, String cause, String fix, double c) {
        return new Signature(id, p(re), p(unless), cause, fix, c);
    }

    /** Every rule, most specific first. Ranking is by confidence, so order here is only for reading. */
    public static final List<Signature> ALL = List.of(
        sig("empty-read",
            "Illegal empty schema|does not support writing empty or nested empty schemas",
            "The write failed because the read produced nothing. Glue reports this at the target, which is the last place to look.",
            "Check the source: an empty S3 prefix, a bookmark that has already consumed every file, or a push-down predicate that matched no partition. Run the source node's preview to see what it returns.",
            0.9),
        sig("lakeformation-npe",
            "NullPointerException.*(getCatalogSource|GlueCatalog|writeDynamicFrame)|java\\.lang\\.NullPointerException.*catalog",
            "A NullPointerException from a catalog read or write is almost always a missing Lake Formation grant, not a bug in the job.",
            "Grant the job role SELECT (and INSERT for a target) on the database and table in Lake Formation, and check that the role is not filtered by a data-cell filter.",
            0.7),
        sig("passrole",
            "is not authorized to perform: iam:PassRole",
            "The identity *you* are running as cannot pass the job's role. The error names your user or role, not the job role, which is what makes it read like the job role is wrong.",
            "Add iam:PassRole for the job role's ARN to the identity starting the run, with iam:PassedToService glue.amazonaws.com.",
            0.95),
        sig("vpc-endpoint",
            "Could not find S3 endpoint or NAT gateway|VPC S3 endpoint validation failed",
            "The job runs in a VPC with no route to S3. It needs one even when the job reads no S3 data at all, because Glue downloads the job's own script from S3.",
            "Add a gateway VPC endpoint for S3 to the route table of every subnet the connection uses, or give the subnet a NAT gateway.",
            0.95),
        sig("sg-self-ref",
            "At least one security group must open all ingress ports|security group.*self.referencing",
            "The connection's security group needs a self-referencing rule for ALL TCP, which people read as \"open port 0\" and then write a single-port rule that does not satisfy it.",
            "On the security group used by the connection, add an inbound rule: type All TCP, source the same security group.",
            0.9),
        sig("eni-exhausted",
            "InsufficientFreeAddressesInSubnet|Insufficient free addresses|not enough free addresses",
            "Each worker takes an elastic network interface in the connection's subnet, so a big job exhausts a small subnet.",
            "Use a subnet with at least as many free addresses as workers (plus headroom), or reduce the worker count.",
            0.9),
        sig("disk-not-memory",
            "No space left on device|SparkOutOfMemoryError.*spill",
            "This is the worker's local disk filling up during a shuffle, not memory — the message says OutOfMemory because Spark reports a failed spill.",
            "Turn on --write-shuffle-files-to-s3, or move to a worker type with more local storage (G.2X/G.4X), or reduce the shuffle with a broadcast join.",
            0.85),
        sig("driver-oom",
            "java\\.lang\\.OutOfMemoryError.*(Java heap space|GC overhead).*driver|Container killed.*driver|driver.*exceeded memory",
            "The driver ran out of memory. That is usually collect(), toPandas(), a huge broadcast, or listing millions of S3 keys — not the size of the data being transformed.",
            "Avoid collecting to the driver, cap the broadcast threshold, and use bookmarks or partition pruning to shrink the file listing.",
            0.75),
        sig("executor-oom",
            "Container killed by YARN for exceeding memory limits|ExecutorLostFailure.*memory",
            "An executor exceeded its memory limit, usually skew: one key holds most of the rows.",
            "Check the distribution of the join or group key, salt the hot key, or move to a larger worker type.",
            0.75),
        sig("access-denied-tempdir",
            "(AccessDenied|Access Denied|403).*(TempDir|temporary|/temp/)",
            "The denial is on the job's temp bucket (--TempDir), not on the source or the target.",
            "Give the job role s3:GetObject/PutObject/DeleteObject on the --TempDir prefix, or point --TempDir somewhere the role can write.",
            0.85),
        sig("access-denied",
            "AccessDenied|Access Denied|s3:GetObject.*denied|403 Forbidden",
            "(TempDir|temporary)",
            "S3 refused the job role. The message names the operation but not always the bucket, and the bucket policy or a KMS key can be the one refusing.",
            "Check, in order: the role's S3 policy, the bucket policy, and the KMS key policy if the bucket is encrypted with a customer key.",
            0.6),
        sig("entity-not-found",
            "EntityNotFoundException|Table .* not found|Database .* not found",
            "Either the table really does not exist, or the role cannot call glue:GetTable — Glue returns the same error for both.",
            "Confirm the database and table name in the Data Catalog, then confirm the role has glue:GetTable and glue:GetPartitions on it.",
            0.7),
        sig("job-name-arg",
            "GlueArgumentError.*JOB_NAME|the following arguments are required: --JOB_NAME",
            "The script is being run outside a Glue job run, so getResolvedOptions cannot find --JOB_NAME.",
            "Locally, pass a JOB_NAME argument (Keel's tests and local runs already do). In Glue, this means the script was started by something other than a job run.",
            0.9),
        sig("bookmark-empty",
            "bookmark.*(no new|empty)|processed 0 files.*bookmark",
            "The bookmark has already consumed every file, so this run read nothing. The run is green and the output is unchanged.",
            "Reset the bookmark to reprocess, or check that new files really landed under the source prefix since the last run.",
            0.7),
        sig("glueparquet-local",
            "glueparquet.*not supported|format glueparquet",
            "glueparquet is a Glue-only writer; the container and any local runtime cannot use it.",
            "For local runs and tests, write parquet instead. The difference is Glue's schema-merging writer, not the file format.",
            0.8),
        sig("unresolved-column",
            "UNRESOLVED_COLUMN|cannot be resolved|A column or function parameter with name",
            "A column the code names is not in the frame at that point. When the frame is empty, this is a *schema* loss, not a typo: an empty DynamicFrame has no columns at all.",
            "Check the row count of the upstream node first. If it is zero, fix the read (bookmark, prefix, predicate). If it is not, the column was renamed or dropped upstream.",
            0.8),
        sig("py4j-wall",
            "Py4JJavaError|py4j\\.protocol\\.Py4JError|An error occurred while calling",
            "A Java exception surfaced through Py4J. The Python traceback above it is the call site; the cause is in the Java stack below.",
            "Read the last 'Caused by:' in the Java stack, not the Python frames. The Python line only says which call crossed into the JVM.",
            0.4),
        sig("exit-code",
            "Command failed with exit code (1|10|137|139)",
            "(OutOfMemory|No space left|AccessDenied|Py4J)",
            "This is Glue's generic wrapper, not a cause. Exit 1 is a Python error, 10 a Spark failure, 137 an out-of-memory kill by the container.",
            "Open the error log stream for this run: the real exception is above this line. If there is no log at all, the job role cannot write logs.",
            0.5),
        sig("no-logs",
            "no log streams|log group does not exist|ResourceNotFoundException.*log",
            "The run produced no logs, which almost always means the job role lacks CloudWatch permissions rather than that the job printed nothing.",
            "Give the job role logs:CreateLogStream, logs:PutLogEvents and logs:AssociateKmsKey on /aws-glue/jobs/*. Keel can attach this for you from the Runs tab.",
            0.8),
        sig("concurrent-runs",
            "ConcurrentRunsExceededException",
            "The job is already running as many times as it is allowed to.",
            "Raise Maximum concurrency on the Job details tab, or wait for the running attempt to finish.",
            0.95),
        sig("resource-unavailable",
            "ResourceNumberLimitExceededException|Resource unavailable|capacity",
            "The account hit a Glue limit: DPUs, concurrent runs, or capacity in the region.",
            "Check the Glue service quotas for the region, and stagger triggers so runs do not all start on the same minute.",
            0.6),
        sig("crawler-vpc",
            "Verify the permissions in the policies attached to the IAM role|crawler.*permission",
            "For a crawler against a JDBC or VPC source, this IAM-worded message is usually a network problem, not a policy one. It is the single most mis-signposted error in Glue.",
            "Check the connection first: subnet, security group (self-referencing all-TCP) and a route to the data. Test the connection before touching the role.",
            0.6),
        sig("jdbc-driver",
            "No suitable driver|ClassNotFoundException.*Driver",
            "The JDBC driver class is not on the classpath of this run.",
            "Attach the driver JAR with --extra-jars and set the driver class on the connection, or use the built-in connector for that engine.",
            0.85),
        sig("kms",
            "KMS\\.|AccessDeniedException.*kms|not authorized to perform: kms:",
            "A KMS key refused the job role. Encryption denials often read as S3 denials.",
            "Add kms:Decrypt (and kms:GenerateDataKey for writes) for that key to the job role, and add the role to the key policy.",
            0.8),
        sig("throttling",
            "ThrottlingException|Rate exceeded|SlowDown",
            "AWS throttled the job: usually the Data Catalog (GetPartitions) or S3 on a prefix with too many requests.",
            "Reduce partition listing with a push-down predicate, spread writes over more prefixes, and retry with backoff.",
            0.7),
        sig("timeout",
            "Job run timed out|exceeded the timeout|Execution timed out",
            "The run hit the job's timeout, so nothing after that point ran, and the failure has no exception of its own.",
            "Raise the timeout on the Job details tab if the work genuinely takes this long, or find the stage that stalled in the Spark UI.",
            0.9),
        sig("connection-timeout",
            "Connection timed out|connect timed out|Communications link failure",
            "The job could not reach the data source over the network, which is a VPC, subnet or security-group problem rather than a credentials one.",
            "Check the connection's subnet route to the source, the source's security group, and that the job actually uses the connection.",
            0.75),
        sig("csv-schema",
            "cannot resolve.*given input columns|Malformed.*CSV|Number of columns",
            "The file's columns are not what the job expects, usually a header row that is present in some files and missing in others.",
            "Preview the source node here to see what Spark reads, then fix withHeader or the mapping rather than the downstream transform.",
            0.6),
        sig("version-mismatch",
            "requires Glue version|not supported in Glue|Unsupported.*version",
            "Something in the job needs a different Glue version than the one it is running on.",
            "Check the Upgrade tab: it names the features whose behaviour changed between versions.",
            0.7)
    );

    /** Every rule that matches, most confident first, each with the line that matched it. */
    public static List<Match> match(String errorMessage, String logTail, String state) {
        String text = String.join("\n",
                errorMessage == null ? "" : errorMessage,
                logTail == null ? "" : logTail,
                state == null ? "" : "STATE=" + state);
        String normalised = text.replaceAll("\\bo\\d{2,}\\b", "o…"); // Py4J handles change every run
        List<Match> out = new ArrayList<>();
        for (Signature s : ALL) {
            Matcher m = s.pattern().matcher(normalised);
            if (!m.find()) continue;
            if (s.unless() != null && s.unless().matcher(normalised).find()) continue;
            out.add(new Match(s.id(), s.cause(), s.fix(), line(normalised, m.start()), s.confidence()));
        }
        out.sort((a, b) -> Double.compare(b.confidence(), a.confidence()));
        return out;
    }

    /** The whole line a match landed on: evidence you can find again in the log. */
    static String line(String text, int at) {
        int start = text.lastIndexOf('\n', Math.max(0, at - 1)) + 1;
        int end = text.indexOf('\n', at);
        String l = (end < 0 ? text.substring(start) : text.substring(start, end)).strip();
        return l.length() > 400 ? l.substring(0, 400) + "…" : l;
    }
}
