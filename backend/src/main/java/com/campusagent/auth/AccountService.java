package com.campusagent.auth;

import com.campusagent.common.error.ApiException;
import com.campusagent.infrastructure.persistence.AccountStore;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.text.Normalizer;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import static com.campusagent.infrastructure.persistence.WorkspaceStore.objects;

@Service
public class AccountService {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Base64.Encoder BASE64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();
    private static final int ITERATIONS = 600_000;
    private static final Duration SESSION_LIFETIME = Duration.ofDays(30);
    private static final byte[] UNKNOWN_USER_SALT = randomBytes(16);

    public record User(String username) {}
    public record Session(User user, String token, long expiresAt) {}
    public record Principal(String accountId, User user, String deviceId, String tokenHash) {
        public String workspace() {
            return "account-" + accountId;
        }
    }

    private final AccountStore store;

    public AccountService(AccountStore store) {
        this.store = store;
    }

    public Session register(String username, String password, String deviceId) {
        String handle = username(username);
        String secret = password(password);
        String device = identifier(deviceId, "DEVICE_ID");
        byte[] salt = randomBytes(16);
        byte[] hash = derive(secret, salt);
        return store.update(document -> {
            var users = objects(document, "users");
            String key = handle.toLowerCase(Locale.ROOT);
            if (users.has(key)) {
                throw new ApiException(HttpStatus.CONFLICT, "USERNAME_TAKEN", "该用户名已注册，请登录或换一个用户名。");
            }
            String id = UUID.randomUUID().toString();
            users.putObject(key).put("id", id).put("username", handle)
                    .put("salt", BASE64.encodeToString(salt)).put("passwordHash", BASE64.encodeToString(hash));
            return issue(document, id, handle, device);
        });
    }

    public Session login(String username, String password, String deviceId) {
        String handle;
        String secret;
        try {
            handle = username(username);
            secret = password(password);
        } catch (ApiException error) {
            throw invalidCredentials();
        }
        String device = identifier(deviceId, "DEVICE_ID");
        JsonNode user = store.read(document -> objects(document, "users").path(handle.toLowerCase(Locale.ROOT)));
        byte[] salt = user.isMissingNode() ? UNKNOWN_USER_SALT : DECODER.decode(user.path("salt").asText());
        byte[] actual = derive(secret, salt);
        byte[] expected = user.isMissingNode() ? new byte[32] : DECODER.decode(user.path("passwordHash").asText());
        if (!MessageDigest.isEqual(expected, actual) || user.isMissingNode()) {
            throw invalidCredentials();
        }
        return store.update(document -> issue(document, user.path("id").asText(), user.path("username").asText(), device));
    }

    public Principal authenticate(String header) {
        if (header == null || !header.matches("(?i)Bearer [A-Za-z0-9_-]{43}")) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", "请登录后访问账号数据。");
        }
        String hash = tokenHash(header.substring(7));
        return store.read(document -> {
            JsonNode session = objects(document, "sessions").path(hash);
            if (session.isMissingNode() || session.path("expiresAt").asLong() <= System.currentTimeMillis()) {
                throw new ApiException(HttpStatus.UNAUTHORIZED, "AUTH_EXPIRED", "登录已失效，请重新登录。");
            }
            return new Principal(session.path("accountId").asText(), new User(session.path("username").asText()),
                    session.path("deviceId").asText(), hash);
        });
    }

    public void logout(Principal principal) {
        store.update(document -> objects(document, "sessions").remove(principal.tokenHash()));
    }

    public void claimLegacy(Principal principal, String legacyWorkspace) {
        List<String> keys = new ArrayList<>();
        keys.add("device:" + principal.deviceId());
        if (legacyWorkspace != null && !legacyWorkspace.isEmpty()) {
            keys.add("workspace:" + identifier(legacyWorkspace, "LEGACY_KEY"));
        }
        store.update(document -> {
            var claims = objects(document, "legacyClaims");
            for (String key : keys) {
                if (claims.has(key) && !principal.accountId().equals(claims.path(key).asText())) {
                    throw new ApiException(HttpStatus.CONFLICT, "LEGACY_ALREADY_IMPORTED", "这份旧记录已关联其他账号。");
                }
                claims.put(key, principal.accountId());
            }
            return null;
        });
    }

    public static String identifier(String value, String code) {
        try {
            if (value != null && value.length() == 36 && UUID.fromString(value).toString().equals(value)) {
                return value;
            }
        } catch (IllegalArgumentException ignored) {
            // 格式错误使用统一响应。
        }
        throw new ApiException(HttpStatus.BAD_REQUEST, code, "设备或旧工作区标识无效。");
    }

    private Session issue(ObjectNode document, String id, String username, String device) {
        String raw = BASE64.encodeToString(randomBytes(32));
        long now = System.currentTimeMillis();
        long expiresAt = now + SESSION_LIFETIME.toMillis();
        var sessions = objects(document, "sessions");
        var inactive = new ArrayList<String>();
        sessions.properties().forEach(entry -> {
            JsonNode item = entry.getValue();
            if (item.path("expiresAt").asLong() <= now || id.equals(item.path("accountId").asText())
                    && device.equals(item.path("deviceId").asText())) {
                inactive.add(entry.getKey());
            }
        });
        sessions.remove(inactive);
        sessions.putObject(tokenHash(raw)).put("accountId", id).put("username", username)
                .put("deviceId", device).put("expiresAt", expiresAt);
        return new Session(new User(username), raw, expiresAt);
    }

    private static String username(String value) {
        String handle = value == null ? "" : value.strip();
        if (!handle.matches("[A-Za-z0-9_-]{3,32}")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "USERNAME_INVALID", "用户名须为 3–32 位字母、数字、下划线或短横线。");
        }
        return handle;
    }

    private static String password(String value) {
        String normalized = value == null || value.length() > 256 ? "" : Normalizer.normalize(value, Normalizer.Form.NFC);
        int length = normalized.codePointCount(0, normalized.length());
        if (length < 8 || length > 128 || normalized.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PASSWORD_INVALID", "密码须为 8–128 个字符。");
        }
        return normalized;
    }

    private static byte[] derive(String password, byte[] salt) {
        char[] characters = password.toCharArray();
        PBEKeySpec spec = new PBEKeySpec(characters, salt, ITERATIONS, 256);
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        } catch (GeneralSecurityException error) {
            throw new IllegalStateException("Password hashing is unavailable", error);
        } finally {
            spec.clearPassword();
            Arrays.fill(characters, '\0');
        }
    }

    private static String tokenHash(String token) {
        try {
            return BASE64.encodeToString(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.US_ASCII)));
        } catch (GeneralSecurityException error) {
            throw new IllegalStateException("Session hashing is unavailable", error);
        }
    }

    private static byte[] randomBytes(int length) {
        byte[] bytes = new byte[length];
        RANDOM.nextBytes(bytes);
        return bytes;
    }

    private static ApiException invalidCredentials() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "用户名或密码不正确。");
    }
}
