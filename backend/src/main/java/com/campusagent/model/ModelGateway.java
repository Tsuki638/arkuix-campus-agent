package com.campusagent.model;

import com.campusagent.common.error.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Component
public class ModelGateway {

    private static final String DEEPSEEK = "https://api.deepseek.com/chat/completions";
    private static final String QWEN = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
    private static final String KIMI = "https://api.moonshot.cn/v1/chat/completions";
    private static final String GLM = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
    private static final String OPENAI = "https://api.openai.com/v1/chat/completions";

    public record Settings(String endpoint, String model, String apiKey) {}
    public record Status(String endpoint, String model, boolean configured) {}
    public record Call(String id, String name, String input) {}
    public record Reply(String content, List<Call> toolCalls, String reasoningContent, String reasoningScope) {}

    private final JsonMapper json;
    private final Settings defaults;
    private final Set<String> allowed;

    public ModelGateway(JsonMapper json,
            @Value("${app.model.endpoint}") String endpoint,
            @Value("${app.model.name}") String model,
            @Value("${app.model.api-key}") String apiKey,
            @Value("${app.model.allowed-endpoints}") String allowedEndpoints) {
        this.json = json;
        this.defaults = new Settings(endpoint.strip(), model.strip(), apiKey.strip());
        this.allowed = new HashSet<>(Set.of(DEEPSEEK, QWEN, KIMI, GLM, OPENAI));
        allowed.add(defaults.endpoint());
        for (String extra : allowedEndpoints.split(",")) {
            allowed.add(extra.strip());
        }
    }

    public Status status() {
        return new Status(defaults.endpoint(), defaults.model(), !defaults.apiKey().isEmpty());
    }

    public Status validate(Settings requested) {
        Settings settings = resolve(requested);
        return new Status(settings.endpoint(), settings.model(), true);
    }

    public Settings resolve(Settings requested) {
        String endpoint = requested == null ? defaults.endpoint() : field(requested.endpoint());
        String model = requested == null ? defaults.model() : field(requested.model());
        String providedKey = requested == null ? "" : field(requested.apiKey());
        String key = providedKey.isEmpty() && endpoint.equals(defaults.endpoint()) ? defaults.apiKey() : providedKey;
        URI uri;
        try {
            uri = URI.create(endpoint);
        } catch (IllegalArgumentException exception) {
            throw config("请提供有效的模型接口地址。");
        }
        boolean localDefault = endpoint.equals(defaults.endpoint()) && "http".equals(uri.getScheme())
                && Set.of("localhost", "127.0.0.1", "[::1]").contains(uri.getHost() == null ? "" : uri.getHost());
        if (uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null
                || !("https".equalsIgnoreCase(uri.getScheme()) || localDefault) || !allowed.contains(endpoint)) {
            throw config("此模型接口未在 Java 后端启用，请检查接口地址及服务端配置。");
        }
        if (model.isEmpty() || model.length() > 160 || key.isEmpty() || key.length() > 4096
                || key.chars().anyMatch(character -> character < 33 || character > 126)) {
            throw config("请提供模型名称和有效的 API Key，或在 Java 后端配置默认模型。");
        }
        return new Settings(endpoint, model, key);
    }

    public Reply complete(Settings settings, List<JsonNode> messages, List<ObjectNode> tools) {
        String host = URI.create(settings.endpoint()).getHost().toLowerCase(java.util.Locale.ROOT);
        boolean kimi = host.equals("api.moonshot.cn");
        boolean glm = host.equals("open.bigmodel.cn");
        boolean preserveReasoning = kimi || glm;
        String scope = settings.endpoint() + "#" + settings.model();
        ObjectNode payload = json.createObjectNode().put("model", settings.model()).put("stream", false);
        var wireMessages = payload.putArray("messages");
        for (JsonNode message : messages) {
            String role = message.path("role").asText();
            ObjectNode wire = wireMessages.addObject().put("role", role).put("content", message.path("content").asText());
            if (!message.path("toolCalls").isEmpty()) {
                var calls = wire.putArray("tool_calls");
                for (JsonNode call : message.path("toolCalls")) {
                    calls.addObject().put("id", call.path("id").asText()).put("type", "function")
                            .putObject("function").put("name", call.path("name").asText())
                            .put("arguments", call.path("input").asText());
                }
            }
            if (role.equals("tool")) {
                wire.put("tool_call_id", message.path("toolCallId").asText());
            }
            if (preserveReasoning && role.equals("assistant")) {
                wire.put("reasoning_content", scope.equals(message.path("reasoningScope").asText())
                        ? message.path("reasoningContent").asText("") : "");
            }
        }
        if (!tools.isEmpty()) {
            payload.putArray("tools").addAll(tools);
        }
        if (host.equals("api.deepseek.com")) {
            payload.putObject("thinking").put("type", "disabled");
            payload.put("max_tokens", 2048);
        }
        if (host.matches("dashscope(?:-intl)?\\.aliyuncs\\.com|[a-z0-9-]+\\.[a-z0-9-]+\\.maas\\.aliyuncs\\.com")) {
            payload.put("enable_thinking", false);
        }
        if (preserveReasoning) {
            payload.put("reasoning_effort", "low");
        }
        if (glm && settings.model().equals("glm-5.3")) {
            payload.putObject("thinking").put("type", "enabled");
        }
        if (host.equals("api.openai.com") && settings.model().matches("gpt-6[.-].*")) {
            payload.put("reasoning_effort", "none");
        }

        String body = request(settings, payload);
        return parseResponse(body, preserveReasoning, scope);
    }

    private String request(Settings settings, ObjectNode payload) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) URI.create(settings.endpoint()).toURL().openConnection();
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(60_000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + settings.apiKey());
            byte[] bytes = json.writeValueAsBytes(payload);
            connection.setFixedLengthStreamingMode(bytes.length);
            connection.setDoOutput(true);
            try (var output = connection.getOutputStream()) {
                output.write(bytes);
            }
            int status = connection.getResponseCode();
            switch (status) {
                case 401, 403 -> throw failure("MODEL_AUTH", "模型鉴权失败，请检查 API Key。");
                case 429 -> throw failure("MODEL_RATE_LIMIT", "模型服务限流，请稍后重试。");
                default -> {
                    if (status < 200 || status >= 300) {
                        throw failure("MODEL_HTTP", "模型请求失败，服务暂时不可用，请稍后重试。");
                    }
                }
            }
            try (var input = connection.getInputStream()) {
                byte[] response = input.readNBytes(2_000_001);
                if (response.length > 2_000_000) {
                    throw failure("MODEL_RESPONSE", "模型响应超出长度限制。");
                }
                return new String(response, StandardCharsets.UTF_8);
            }
        } catch (SocketTimeoutException exception) {
            throw failure("MODEL_TIMEOUT", "模型请求超时，请检查网络后重试。");
        } catch (IOException exception) {
            throw failure("MODEL_TRANSPORT", "无法连接模型服务，请检查网络后重试。");
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private Reply parseResponse(String response, boolean preserveReasoning, String scope) {
        try {
            JsonNode message = json.readTree(response).path("choices").path(0).path("message");
            JsonNode content = message.path("content");
            JsonNode calls = message.path("tool_calls");
            if (!"assistant".equals(message.path("role").asText())
                    || !content.isMissingNode() && !content.isNull() && !content.isString()
                    || !calls.isMissingNode() && !calls.isArray()) {
                throw new IllegalArgumentException();
            }
            Set<String> ids = new HashSet<>();
            var parsed = new java.util.ArrayList<Call>();
            for (JsonNode call : calls) {
                JsonNode function = call.path("function");
                String id = call.path("id").asText("");
                String name = function.path("name").asText("");
                if (!"function".equals(call.path("type").asText()) || !call.path("id").isString()
                        || id.isEmpty() || !ids.add(id) || !function.path("name").isString()
                        || name.isEmpty() || !function.path("arguments").isString()) {
                    throw new IllegalArgumentException();
                }
                parsed.add(new Call(id, name, function.path("arguments").asText()));
            }
            String text = content.asText("");
            if (parsed.isEmpty() && text.isBlank()) {
                throw new IllegalArgumentException();
            }
            String reasoning = preserveReasoning && message.path("reasoning_content").isString()
                    ? message.path("reasoning_content").asText() : null;
            return new Reply(text, parsed, reasoning, reasoning == null ? null : scope);
        } catch (RuntimeException exception) {
            throw failure("MODEL_RESPONSE", "模型响应为空或格式不兼容，请检查模型与工具调用支持。");
        }
    }

    private static String field(String value) {
        return value == null ? "" : value.strip();
    }

    private static ApiException config(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "MODEL_CONFIG", message);
    }

    private static ApiException failure(String code, String message) {
        return new ApiException(HttpStatus.BAD_GATEWAY, code, message);
    }
}
