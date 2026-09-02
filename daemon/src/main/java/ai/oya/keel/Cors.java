package ai.oya.keel;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * The renderer's origin is Vite in dev (`http://localhost:*`) and `file://` (origin `null`) in the
 * packaged app; the daemon is `http://127.0.0.1:<port>`. Only those origins are let in — a web page
 * in the person's browser is not, which is the point of an origin check on a loopback service.
 */
@Configuration
public class Cors implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOriginPatterns("http://localhost:*", "http://127.0.0.1:*", "null", "file://*", "app://*")
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .maxAge(3600);
    }
}
