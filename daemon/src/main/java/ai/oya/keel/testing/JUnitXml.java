package ai.oya.keel.testing;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/** pytest's `--junitxml` output → the result object the app draws and the turn records. */
public final class JUnitXml {
    private JUnitXml() {}

    public static Map<String, Object> parse(Path file) {
        Map<String, Object> out = new LinkedHashMap<>();
        List<Map<String, Object>> cases = new ArrayList<>();
        int passed = 0, failed = 0, errors = 0, skipped = 0;
        try {
            DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
            f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            Document doc = f.newDocumentBuilder().parse(Files.newInputStream(file));
            NodeList tcs = doc.getElementsByTagName("testcase");
            for (int i = 0; i < tcs.getLength(); i++) {
                Element tc = (Element) tcs.item(i);
                String cls = tc.getAttribute("classname");
                String name = tc.getAttribute("name");
                String status = "pass"; String message = null;
                for (String tag : new String[] {"failure", "error", "skipped"}) {
                    NodeList k = tc.getElementsByTagName(tag);
                    if (k.getLength() > 0) {
                        Element e = (Element) k.item(0);
                        status = tag.equals("failure") ? "fail" : tag.equals("error") ? "error" : "skip";
                        message = e.getAttribute("message");
                        if ((message == null || message.isEmpty()) && e.getTextContent() != null) message = e.getTextContent().strip();
                        if (message != null && message.length() > 2000) message = message.substring(0, 2000) + "…";
                        break;
                    }
                }
                switch (status) { case "pass" -> passed++; case "fail" -> failed++; case "error" -> errors++; default -> skipped++; }
                Map<String, Object> c = new LinkedHashMap<>();
                c.put("name", (cls.isEmpty() ? "" : cls.replaceFirst("^tests\\.", "") + "::") + name);
                c.put("node", node(cls));
                c.put("status", status);
                if (message != null) c.put("message", message);
                c.put("ms", Math.round(parseDouble(tc.getAttribute("time")) * 1000));
                cases.add(c);
            }
        } catch (Exception e) {
            out.put("status", "error");
            out.put("message", "could not read the test report: " + e.getMessage());
        }
        out.put("passed", passed); out.put("failed", failed); out.put("errors", errors); out.put("skipped", skipped);
        out.put("cases", cases);
        out.putIfAbsent("status", failed + errors > 0 ? "failed" : cases.isEmpty() ? "none" : "passed");
        return out;
    }

    /** `tests.test_orders_csv` → `orders_csv`; `test_pipeline` → `pipeline`. */
    static String node(String classname) {
        String s = classname.replaceFirst("^tests\\.", "");
        return s.startsWith("test_") ? s.substring(5) : s;
    }

    private static double parseDouble(String s) { try { return Double.parseDouble(s); } catch (RuntimeException e) { return 0; } }
}
