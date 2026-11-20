package com.campusagent.infrastructure.persistence;

import com.campusagent.common.error.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;

@Repository
public class WorkspaceStore {

    private static final List<String> COLLECTIONS = List.of("conversations", "plans", "drafts", "imports");

    private final Path directory;
    private final JsonMapper json;

    public WorkspaceStore(@Value("${app.data-directory}") String directory, JsonMapper json) {
        this.directory = Path.of(directory).toAbsolutePath().normalize();
        this.json = json;
    }

    public synchronized <T> T read(String workspace, Function<ObjectNode, T> action) {
        return action.apply(load(file(workspace)));
    }

    public synchronized <T> T update(String workspace, Function<ObjectNode, T> action) {
        Path file = file(workspace);
        ObjectNode document = load(file);
        T result = action.apply(document);
        save(file, document);
        return result;
    }

    private Path file(String workspace) {
        String id = workspace.startsWith("account-") ? workspace.substring("account-".length()) : workspace;
        try {
            if (id.length() != 36 || !UUID.fromString(id).toString().equals(id)) {
                throw new IllegalArgumentException();
            }
            return directory.resolve(workspace + ".json");
        } catch (IllegalArgumentException exception) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "WORKSPACE_KEY", "工作区标识无效。");
        }
    }

    private ObjectNode load(Path file) {
        if (Files.notExists(file)) {
            ObjectNode empty = json.createObjectNode().put("version", 1);
            COLLECTIONS.forEach(empty::putObject);
            empty.putArray("records");
            return empty;
        }
        try {
            if (json.readTree(Files.readAllBytes(file)) instanceof ObjectNode document
                    && document.path("version").asInt() == 1 && document.path("records").isArray()
                    && COLLECTIONS.stream().allMatch(name -> document.path(name).isObject())) {
                return document;
            }
            throw new IOException("Invalid workspace document");
        } catch (IOException | RuntimeException exception) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "STORAGE_CORRUPT", "工作区无法读取，原始数据已保留。");
        }
    }

    private void save(Path file, ObjectNode document) {
        try {
            AtomicJsonFile.save(json, file, document);
        } catch (IOException | RuntimeException exception) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "STORAGE_WRITE", "工作区保存失败，请重试。");
        }
    }

    public static ObjectNode objects(ObjectNode document, String name) {
        return (ObjectNode) document.get(name);
    }

    public static ArrayNode array(JsonNode object, String name) {
        return (ArrayNode) object.get(name);
    }
}
