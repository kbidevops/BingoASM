package com.bingoasm.web;

import com.bingoasm.auth.AuthInterceptor;
import com.bingoasm.common.AppProperties;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;
import org.springframework.http.CacheControl;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

@Configuration
public class WebConfig implements WebMvcConfigurer {
    private final AuthInterceptor authInterceptor;
    private final AppProperties props;

    public WebConfig(AuthInterceptor authInterceptor, AppProperties props) {
        this.authInterceptor = authInterceptor;
        this.props = props;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(authInterceptor).addPathPatterns("/api/**");
    }

    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        if (Files.isDirectory(Path.of(props.clientDist()))) registry.addViewController("/").setViewName("forward:/index.html");
        else registry.addRedirectViewController("/", "/swagger-ui.html");  // 화면이 없으면 API 문서로
    }

    /** 프런트엔드가 다른 포트·도메인에서 개발되므로 CORS를 연다. 토큰은 헤더로 보내므로 쿠키(credentials)는 쓰지 않는다. */
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        String[] origins = Arrays.stream(props.corsOrigins().split(",")).map(String::trim).filter(o -> !o.isEmpty()).toArray(String[]::new);
        registry.addMapping("/**")
                .allowedOriginPatterns(origins.length == 0 ? new String[]{"*"} : origins)
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .exposedHeaders("Content-Disposition")
                .maxAge(3600);
    }

    /**
     * Serves the built Next.js static export (client/dist), when it exists. Next writes /login as login.html,
     * so a path without an extension tries "{path}.html" before falling back to index.html.
     * <ul>
     *   <li>/_next/static/** — 파일 이름에 빌드 해시가 붙어 바뀌지 않으므로 1년 캐시(immutable).</li>
     *   <li>나머지(HTML 등) — no-cache: 배포 뒤 브라우저가 예전 HTML(없어진 예전 CSS · JS를 가리킴)을 쓰지 않게 매번 확인한다.</li>
     *   <li>없는 정적 파일(확장자가 있거나 _next/ 아래)은 index.html 대신 404 — CSS 자리에 HTML이 가서 화면이 깨지는 것을 막는다.</li>
     * </ul>
     */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        Path dist = Path.of(props.clientDist()).toAbsolutePath().normalize();
        if (!Files.isDirectory(dist)) return;
        Resource index = new FileSystemResource(dist.resolve("index.html"));
        Path assets = dist.resolve("_next").resolve("static");
        if (Files.isDirectory(assets))
            registry.addResourceHandler("/_next/static/**")
                    .addResourceLocations(assets.toUri().toString())
                    .setCacheControl(CacheControl.maxAge(365, TimeUnit.DAYS).cachePublic().immutable())
                    .resourceChain(true)
                    .addResolver(new PathResourceResolver());
        registry.addResourceHandler("/**")
                .addResourceLocations(dist.toUri().toString())
                .setCacheControl(CacheControl.noCache())
                .resourceChain(true)
                .addResolver(new PathResourceResolver() {
                    @Override
                    protected Resource getResource(String resourcePath, Resource location) throws IOException {
                        if (resourcePath.startsWith("api/") || resourcePath.startsWith("files/")) return null;
                        if (resourcePath.isEmpty()) return index;
                        Resource r = location.createRelative(resourcePath);
                        if (r.exists() && r.isReadable()) return r;
                        // 없는 정적 파일은 404 (페이지 경로만 index.html로)
                        String last = resourcePath.substring(resourcePath.lastIndexOf('/') + 1);
                        if (resourcePath.startsWith("_next/") || last.contains(".")) return null;
                        String page = resourcePath.endsWith("/") ? resourcePath.substring(0, resourcePath.length() - 1) : resourcePath;
                        Resource html = location.createRelative(page + ".html");
                        return html.exists() && html.isReadable() ? html : index;
                    }
                });
    }
}
