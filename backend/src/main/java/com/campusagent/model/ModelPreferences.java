package com.campusagent.model;

import com.campusagent.common.error.ApiException;
import com.campusagent.infrastructure.persistence.WorkspaceStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

@Service
public class ModelPreferences {
    private static final String PROPERTY = "modelPreference";
    private static final String DEFAULT = "default";
    private static final String CUSTOM = "custom";
    private static final int NONCE_LENGTH = 12;
    private static final int TAG_BITS = 128;
    private static final SecureRandom RANDOM = new SecureRandom();

    public record Update(String mode, ModelGateway.Settings customModel) {}
    public record Preference(String mode, ModelGateway.Status defaultModel, ModelGateway.Status customModel) {}

    private final WorkspaceStore store;
    private final ModelGateway models;
    private final SecretKeySpec encryptionKey;

    public ModelPreferences(WorkspaceStore store, ModelGateway models,
            @Value("${app.model.credential-key}") String encodedKey) {
        this.store = store;
        this.models = models;
        String value = encodedKey.strip();
        this.encryptionKey = value.isEmpty() ? null : parseKey(value);
    }

    public Preference get(String workspace) {
        return store.read(workspace, document -> describe(workspace, document.path(PROPERTY)));
    }

    public Preference update(String workspace, Update input) {
        if (input == null || !(DEFAULT.equals(input.mode()) || CUSTOM.equals(input.mode()))) {
            throw config("请选择服务器默认模型或自定义模型。");
        }
        return store.update(workspace, document -> {
            ObjectNode preference = document.withObjectProperty(PROPERTY);
            if (CUSTOM.equals(input.mode())) {
                saveCustom(workspace, preference.path(CUSTOM), input.customModel(), preference);
            }
            preference.put("mode", input.mode());
            return describe(workspace, preference);
        });
    }

    public ModelGateway.Settings settingsForTurn(String workspace) {
        return store.read(workspace, document -> {
            JsonNode preference = document.path(PROPERTY);
            if (!CUSTOM.equals(preference.path("mode").asText())) {
                return null;
            }
            JsonNode custom = preference.path(CUSTOM);
            String endpoint = custom.path("endpoint").asText();
            String key = open(workspace, endpoint, custom.path("encryptedKey").asText());
            return new ModelGateway.Settings(endpoint, custom.path("model").asText(), key);
        });
    }

    private void saveCustom(String workspace, JsonNode previous, ModelGateway.Settings input, ObjectNode preference) {
        requireEncryptionKey();
        if (input == null) {
            throw config("请填写自定义模型的接口地址、模型和 API Key。");
        }
        String endpoint = input.endpoint() == null ? "" : input.endpoint().strip();
        String key = input.apiKey() == null ? "" : input.apiKey().strip();
        if (key.isEmpty() && endpoint.equals(previous.path("endpoint").asText()) && previous.has("encryptedKey")) {
            key = open(workspace, endpoint, previous.path("encryptedKey").asText());
        }
        if (key.isEmpty()) {
            throw config("请填写该服务商的 API Key。");
        }
        ModelGateway.Settings checked = models.resolve(new ModelGateway.Settings(endpoint, input.model(), key));
        preference.putObject(CUSTOM).put("endpoint", checked.endpoint()).put("model", checked.model())
                .put("encryptedKey", seal(workspace, checked.endpoint(), checked.apiKey()));
    }

    private Preference describe(String workspace, JsonNode preference) {
        JsonNode custom = preference.path(CUSTOM);
        ModelGateway.Status customStatus = null;
        if (custom.isObject()) {
            String endpoint = custom.path("endpoint").asText();
            String model = custom.path("model").asText();
            boolean configured;
            try {
                models.resolve(new ModelGateway.Settings(endpoint, model,
                        open(workspace, endpoint, custom.path("encryptedKey").asText())));
                configured = true;
            } catch (ApiException exception) {
                configured = false;
            }
            customStatus = new ModelGateway.Status(endpoint, model, configured);
        }
        String mode = CUSTOM.equals(preference.path("mode").asText()) ? CUSTOM : DEFAULT;
        return new Preference(mode, models.status(), customStatus);
    }

    private String seal(String workspace, String endpoint, String key) {
        byte[] nonce = new byte[NONCE_LENGTH];
        RANDOM.nextBytes(nonce);
        try {
            byte[] encrypted = cipher(Cipher.ENCRYPT_MODE, workspace, endpoint, nonce)
                    .doFinal(key.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(ByteBuffer.allocate(nonce.length + encrypted.length)
                    .put(nonce).put(encrypted).array());
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Model credential encryption failed", exception);
        }
    }

    private String open(String workspace, String endpoint, String encryptedKey) {
        requireEncryptionKey();
        try {
            ByteBuffer buffer = ByteBuffer.wrap(Base64.getDecoder().decode(encryptedKey));
            if (buffer.remaining() <= NONCE_LENGTH + TAG_BITS / Byte.SIZE) {
                throw new IllegalArgumentException();
            }
            byte[] nonce = new byte[NONCE_LENGTH];
            buffer.get(nonce);
            byte[] encrypted = new byte[buffer.remaining()];
            buffer.get(encrypted);
            return new String(cipher(Cipher.DECRYPT_MODE, workspace, endpoint, nonce).doFinal(encrypted),
                    StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException exception) {
            throw config("无法读取已保存的自定义密钥，请重新填写。");
        }
    }

    private Cipher cipher(int mode, String workspace, String endpoint, byte[] nonce) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, encryptionKey, new GCMParameterSpec(TAG_BITS, nonce));
        cipher.updateAAD((workspace + "\n" + endpoint).getBytes(StandardCharsets.UTF_8));
        return cipher;
    }

    private void requireEncryptionKey() {
        if (encryptionKey == null) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "MODEL_CREDENTIAL_STORAGE",
                    "服务器尚未配置自定义密钥存储，请使用服务器默认模型或联系管理员。");
        }
    }

    private static SecretKeySpec parseKey(String value) {
        try {
            byte[] key = Base64.getDecoder().decode(value);
            if (key.length == 32) {
                return new SecretKeySpec(key, "AES");
            }
        } catch (IllegalArgumentException ignored) {
        }
        throw new IllegalArgumentException("APP_MODEL_CREDENTIAL_KEY must be a Base64-encoded 32-byte key");
    }

    private static ApiException config(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "MODEL_CONFIG", message);
    }
}
