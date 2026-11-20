package com.campusagent.web;

import com.campusagent.common.error.ApiException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.Locale;

@Service
public class WebResearchService {

    private static final String BASE_URL = "https://api.deepseek.com/v1/tools";
    private static final int MAX_RESULTS = 5;
    private static final int MAX_QUERY_LENGTH = 128;
    private static final int MAX_URL_LENGTH = 2_048;
    private static final int MAX_PAGE_LENGTH = 4_000;
    private static final int MAX_RESPONSE_BYTES = 512_000;

    private final JsonMapper json;
    private final RestClient client;
    private final String apiKey;

    @Autowired
    public WebResearchService(JsonMapper json, @Value("${app.web.api-key}") String apiKey) {
        this(json, apiKey, RestClient.builder().requestFactory(requestFactory()));
    }

    WebResearchService(JsonMapper json, String apiKey, RestClient.Builder builder) {
        this.json = json;
        this.apiKey = apiKey.strip();
        this.client = builder.baseUrl(BASE_URL).build();
    }

    public boolean configured() {
        return !apiKey.isEmpty();
    }

    public ObjectNode search(JsonNode input) {
        String query = text(input, "query").strip();
        if (query.isEmpty() || query.codePointCount(0, query.length()) > MAX_QUERY_LENGTH) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "WEB_QUERY", "搜索关键词应为 1–128 个字符。");
        }

        JsonNode matches = request("search", json.createObjectNode().put("query", query).put("count", MAX_RESULTS))
                .path("results");
        if (!matches.isArray()) {
            throw failure("WEB_RESPONSE", "搜索服务返回了无法读取的结果。");
        }
        ObjectNode result = json.createObjectNode().put("query", query);
        var results = result.putArray("results");
        var seen = new HashSet<String>();
        for (JsonNode match : matches) {
            String url = publicUrl(text(match, "url"));
            if (url.isEmpty() || !seen.add(url)) {
                continue;
            }
            results.addObject().put("url", url).put("title", excerpt(text(match, "title"), 160))
                    .put("snippet", excerpt(text(match, "snippet"), 300))
                    .put("publishedAt", excerpt(text(match, "date"), 64));
            if (results.size() == MAX_RESULTS) {
                break;
            }
        }
        return result;
    }

    public ObjectNode fetch(JsonNode input) {
        String url = publicUrl(text(input, "url").strip());
        if (url.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "WEB_URL", "请提供有效的公开 HTTP(S) 网页链接。");
        }

        JsonNode response = request("fetch", json.createObjectNode().put("url", url));
        String content = text(response, "content").strip();
        if (content.isEmpty()) {
            throw failure("WEB_PAGE_UNAVAILABLE", "该页面没有可读取的正文。");
        }
        String excerpt = excerpt(content, MAX_PAGE_LENGTH);
        return json.createObjectNode().put("url", url).put("title", excerpt(text(response, "title"), 160))
                .put("fetchedAt", Instant.now().toString()).put("truncated", excerpt.length() < content.length())
                .put("content", excerpt);
    }

    private JsonNode request(String operation, ObjectNode payload) {
        if (!configured()) {
            throw failure("WEB_CONFIG", "后端尚未配置网页工具的 DeepSeek API Key。");
        }
        try {
            return requestOnce(operation, payload);
        } catch (ApiException error) {
            if (!"WEB_TIMEOUT".equals(error.getCode()) || Thread.currentThread().isInterrupted()) {
                throw error;
            }
            return requestOnce(operation, payload);
        }
    }

    private JsonNode requestOnce(String operation, ObjectNode payload) {
        try {
            return client.post().uri("/" + operation).contentType(MediaType.APPLICATION_JSON)
                    .headers(headers -> headers.setBearerAuth(apiKey)).body(json.writeValueAsBytes(payload))
                    .exchange((request, response) -> {
                        int status = response.getStatusCode().value();
                        if (status != 200) {
                            throw upstreamFailure(operation, status);
                        }
                        byte[] body = response.getBody().readNBytes(MAX_RESPONSE_BYTES + 1);
                        if (body.length > MAX_RESPONSE_BYTES) {
                            throw failure("WEB_RESPONSE", "网页服务响应过大，请尝试更具体的页面。");
                        }
                        JsonNode parsed = json.readTree(body);
                        if (parsed == null || !parsed.isObject()) {
                            throw failure("WEB_RESPONSE", "网页服务返回了无法读取的响应。");
                        }
                        return parsed;
                    });
        } catch (JacksonException exception) {
            throw failure("WEB_RESPONSE", "网页服务返回了无法读取的响应。");
        } catch (RestClientException exception) {
            Throwable cause = exception.getMostSpecificCause();
            if (cause instanceof SocketTimeoutException) {
                throw failure("WEB_TIMEOUT", "网页服务请求超时，请稍后重试。");
            }
            throw failure("WEB_NETWORK", "无法连接或读取网页服务，请稍后重试。");
        }
    }

    private static ApiException upstreamFailure(String operation, int status) {
        return switch (status) {
            case 401 -> failure("WEB_AUTH", "网页服务鉴权失败，请检查后端的 DeepSeek API Key。");
            case 402 -> failure("WEB_BALANCE", "网页服务账户余额不足。");
            case 403, 404 -> "fetch".equals(operation)
                    ? failure("WEB_PAGE_UNAVAILABLE", "网页服务无法读取该页面，请尝试其他公开链接或提供正文。")
                    : failure("WEB_HTTP", "网页搜索暂时不可用，请稍后重试。");
            case 408, 504 -> failure("WEB_TIMEOUT", "网页服务请求超时，请稍后重试。");
            case 429 -> failure("WEB_RATE_LIMIT", "网页服务请求过于频繁，请稍后重试。");
            default -> failure("WEB_HTTP", "网页服务暂时不可用，请稍后重试。");
        };
    }

    private static String publicUrl(String value) {
        if (value.isEmpty() || value.length() > MAX_URL_LENGTH) {
            return "";
        }
        try {
            URI uri = URI.create(value);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            boolean http = "http".equalsIgnoreCase(uri.getScheme());
            boolean https = "https".equalsIgnoreCase(uri.getScheme());
            if ((!http && !https) || uri.getRawUserInfo() != null
                    || uri.getPort() != -1 && uri.getPort() != (https ? 443 : 80)
                    || !host.matches("(?:[a-z0-9-]+\\.)+[a-z][a-z0-9-]*")
                    || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
                return "";
            }
            return uri.toASCIIString();
        } catch (IllegalArgumentException exception) {
            return "";
        }
    }

    private static String text(JsonNode input, String field) {
        JsonNode value = input.path(field);
        return value.isString() ? value.asText() : "";
    }

    private static String excerpt(String value, int limit) {
        return value.codePointCount(0, value.length()) <= limit
                ? value : value.substring(0, value.offsetByCodePoints(0, limit));
    }

    private static SimpleClientHttpRequestFactory requestFactory() {
        var factory = new SimpleClientHttpRequestFactory() {
            @Override
            protected void prepareConnection(HttpURLConnection connection, String method) throws IOException {
                super.prepareConnection(connection, method);
                connection.setInstanceFollowRedirects(false);
            }
        };
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(12));
        return factory;
    }

    private static ApiException failure(String code, String message) {
        return new ApiException(HttpStatus.BAD_GATEWAY, code, message);
    }
}
