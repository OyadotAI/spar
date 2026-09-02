package ai.oya.keel;

/** An error the app can show: a status, a sentence, and when we know it, what to do about it. */
public class ApiError extends RuntimeException {
    public final int status;
    public final String fix;

    public ApiError(int status, String message) { this(status, message, null); }

    public ApiError(int status, String message, String fix) {
        super(message);
        this.status = status;
        this.fix = fix;
    }

    public static ApiError badRequest(String m) { return new ApiError(400, m); }
    public static ApiError notFound(String m) { return new ApiError(404, m); }
    public static ApiError conflict(String m) { return new ApiError(409, m); }
}
