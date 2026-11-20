package com.campusagent.infrastructure.persistence;

import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

final class AtomicJsonFile {

    private AtomicJsonFile() {}

    static void save(JsonMapper json, Path file, ObjectNode document) throws IOException {
        Path directory = file.getParent();
        Files.createDirectories(directory);
        Path pending = Files.createTempFile(directory, ".pending-", ".json");
        try {
            Files.write(pending, json.writeValueAsBytes(document));
            Files.move(pending, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } finally {
            Files.deleteIfExists(pending);
        }
    }
}
