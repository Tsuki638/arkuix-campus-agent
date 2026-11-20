package com.campusagent.infrastructure.persistence;

import com.campusagent.common.error.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.function.Function;

@Repository
public class AccountStore {

    private final Path file;
    private final JsonMapper json;

    public AccountStore(@Value("${app.data-directory}") String directory, JsonMapper json) {
        this.file = Path.of(directory).toAbsolutePath().normalize().resolve("accounts.json");
        this.json = json;
    }

    public synchronized <T> T read(Function<ObjectNode, T> action) {
        return action.apply(load());
    }

    public synchronized <T> T update(Function<ObjectNode, T> action) {
        ObjectNode document = load();
        T result = action.apply(document);
        try {
            AtomicJsonFile.save(json, file, document);
        } catch (IOException | RuntimeException error) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "ACCOUNT_STORAGE", "账号存储写入失败，请重试。");
        }
        return result;
    }

    private ObjectNode load() {
        if (Files.notExists(file)) {
            ObjectNode document = json.createObjectNode().put("version", 1);
            document.putObject("users");
            document.putObject("sessions");
            document.putObject("legacyClaims");
            return document;
        }
        try {
            if (json.readTree(Files.readAllBytes(file)) instanceof ObjectNode document
                    && document.path("version").asInt() == 1 && document.path("users").isObject()
                    && document.path("sessions").isObject() && document.path("legacyClaims").isObject()) {
                return document;
            }
        } catch (IOException | RuntimeException ignored) {
            // 保留无法读取的账号文件。
        }
        throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "ACCOUNT_STORAGE", "账号存储不可用，请联系管理员。");
    }
}
