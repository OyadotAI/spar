package ai.oya.keel.testing;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class JUnitXmlTest {
    @Test
    void countsAndFailures(@TempDir Path dir) throws Exception {
        Path f = dir.resolve("junit.xml");
        Files.writeString(f, "<?xml version=\"1.0\"?><testsuites><testsuite name=\"pytest\" tests=\"5\">"
                + "<testcase classname=\"tests.test_orders_csv\" name=\"test_orders_csv_reads_csv\" time=\"1.5\"/>"
                + "<testcase classname=\"tests.test_only_paid\" name=\"test_only_paid\" time=\"0.2\"/>"
                + "<testcase classname=\"tests.test_pipeline\" name=\"test_pipeline\" time=\"2\"/>"
                + "<testcase classname=\"tests.test_join\" name=\"test_join\" time=\"0.1\"><failure message=\"assert 2 == 3\">boom</failure></testcase>"
                + "<testcase classname=\"tests.test_catalog\" name=\"test_catalog\" time=\"0\"><skipped message=\"needs catalog\"/></testcase>"
                + "</testsuite></testsuites>");
        Map<String, Object> r = JUnitXml.parse(f);
        assertThat(r.get("passed")).isEqualTo(3);
        assertThat(r.get("failed")).isEqualTo(1);
        assertThat(r.get("skipped")).isEqualTo(1);
        assertThat(r.get("status")).isEqualTo("failed");
        @SuppressWarnings("unchecked") List<Map<String, Object>> cases = (List<Map<String, Object>>) r.get("cases");
        assertThat(cases).extracting(c -> c.get("node")).containsExactly("orders_csv", "only_paid", "pipeline", "join", "catalog");
        assertThat(cases.get(3).get("message")).isEqualTo("assert 2 == 3");
    }
}
