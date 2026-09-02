package ai.oya.keel;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Every error leaves as `{error, fix?}`. An expired SSO session is the one we can name the cure for. */
@RestControllerAdvice
public class Errors {
    private final State state;

    public Errors(State state) { this.state = state; }

    @ExceptionHandler(ApiError.class)
    ResponseEntity<Map<String, String>> api(ApiError e) {
        return ResponseEntity.status(e.status).body(body(e.getMessage(), e.fix));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String, String>> other(Exception e) {
        ApiError mapped = fromAws(e, state.profile());
        if (mapped != null) return api(mapped);
        String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        return ResponseEntity.status(500).body(body(m, null));
    }

    private static final Pattern SSO_EXPIRED = Pattern.compile(
            "(?i)(token.*expired|expired.*token|sso.*(login|session)|refresh.*(fail|token)|The SSO session)");
    private static final Pattern NO_CREDS = Pattern.compile(
            "(?i)(unable to load credentials|no credentials|profile file.*not found|Profile .* does not exist)");

    /** SDK exceptions are deep and chatty; we look through the chain for the two things a person can act on. */
    public static ApiError fromAws(Throwable t, String profile) {
        for (Throwable c = t; c != null; c = c.getCause()) {
            if (c instanceof software.amazon.awssdk.awscore.exception.AwsServiceException ase && ase.awsErrorDetails() != null) {
                String code = ase.awsErrorDetails().errorCode();
                if ("AccessDeniedException".equals(code) || "AccessDenied".equals(code) || ase.statusCode() == 403)
                    return new ApiError(403, "AWS refused: " + ase.awsErrorDetails().errorMessage(), null);
                if ("ThrottlingException".equals(code) || ase.statusCode() == 429)
                    return new ApiError(429, "AWS is throttling requests; Keel has slowed down", null);
                if ("EntityNotFoundException".equals(code)) return new ApiError(404, ase.awsErrorDetails().errorMessage(), null);
            }
            String m = c.getMessage();
            if (m == null) continue;
            if (SSO_EXPIRED.matcher(m).find())
                return new ApiError(401, "AWS SSO session expired", "aws sso login --profile " + profile);
            if (NO_CREDS.matcher(m).find())
                return new ApiError(401, "no AWS credentials for profile " + profile, "aws configure sso");
            if (m.contains("ThrottlingException") || m.contains("Rate exceeded"))
                return new ApiError(429, "AWS is throttling requests; Keel has slowed down", null);
        }
        return null;
    }

    static Map<String, String> body(String error, String fix) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("error", error);
        if (fix != null) m.put("fix", fix);
        return m;
    }
}
