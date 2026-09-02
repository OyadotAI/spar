package ai.oya.keel.triage;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class SignaturesTest {
    private static List<String> ids(String error, String log) {
        return Signatures.match(error, log, "FAILED").stream().map(Signatures.Match::id).toList();
    }

    @Test
    void namesTheRealSubsystemNotTheOneInTheMessage() {
        // The write reports it; the read caused it.
        assertThat(ids("An error occurred while calling o123.pyWriteDynamicFrame. Illegal empty schema", ""))
                .startsWith("empty-read");
        // The generic wrapper defers to whatever else is in the log.
        assertThat(ids("Command failed with exit code 10", "java.lang.OutOfMemoryError: Java heap space in driver"))
                .doesNotContain("exit-code").contains("driver-oom");
        assertThat(ids("Command failed with exit code 1", "")).contains("exit-code");
        // Disk, not memory.
        List<String> disk = ids("", "org.apache.spark.memory.SparkOutOfMemoryError: error while calling spill()");
        assertThat(disk).contains("disk-not-memory");
        // The identity that cannot pass the role is yours, not the job's.
        assertThat(ids("User: arn:aws:iam::1:user/me is not authorized to perform: iam:PassRole", "")).contains("passrole");
        // A VPC job needs an S3 route even when it reads no S3.
        assertThat(ids("Could not find S3 endpoint or NAT gateway for subnetId in Vpc", "")).contains("vpc-endpoint");
        // The real failure this account produced, which was a schema loss and not a typo.
        assertThat(ids("AnalysisException: [UNRESOLVED_COLUMN.WITHOUT_SUGGESTION] A column or function parameter with name `country` cannot be resolved", ""))
                .contains("unresolved-column");
    }

    @Test
    void py4jHandlesDoNotChangeTheMatch() {
        List<Signatures.Match> a = Signatures.match("An error occurred while calling o412.getDynamicFrame", "", "FAILED");
        List<Signatures.Match> b = Signatures.match("An error occurred while calling o98765.getDynamicFrame", "", "FAILED");
        assertThat(a.stream().map(Signatures.Match::id).toList()).isEqualTo(b.stream().map(Signatures.Match::id).toList());
        assertThat(a).isNotEmpty();
        assertThat(a.get(0).evidence()).contains("o…");
    }

    @Test
    void everySignatureCarriesACauseAndAFixAndMatchesItsOwnExample() {
        for (Signatures.Signature s : Signatures.ALL) {
            assertThat(s.cause()).as(s.id()).isNotBlank();
            assertThat(s.fix()).as(s.id()).isNotBlank();
            assertThat(s.confidence()).as(s.id()).isBetween(0.1, 1.0);
        }
        assertThat(Signatures.ALL.stream().map(Signatures.Signature::id).distinct().count()).isEqualTo(Signatures.ALL.size());
        assertThat(Signatures.match(null, null, null)).isEmpty();
    }

    @Test
    void evidenceIsTheLineThatMatched() {
        String log = "26/01/01 INFO before\n26/01/01 ERROR No space left on device on /mnt/tmp\n26/01/01 INFO after";
        Signatures.Match m = Signatures.match("", log, "FAILED").stream().filter(x -> x.id().equals("disk-not-memory")).findFirst().orElseThrow();
        assertThat(m.evidence()).isEqualTo("26/01/01 ERROR No space left on device on /mnt/tmp");
    }
}
