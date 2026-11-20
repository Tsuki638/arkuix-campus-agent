package com.campusagent.conversation;

import com.campusagent.auth.AccountService;
import com.campusagent.auth.AccountService.Principal;
import com.campusagent.common.error.ApiException;
import com.campusagent.infrastructure.persistence.WorkspaceStore;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Predicate;
import java.util.stream.StreamSupport;

import static com.campusagent.infrastructure.persistence.WorkspaceStore.array;
import static com.campusagent.infrastructure.persistence.WorkspaceStore.objects;

@Service
public class LegacyImportService {

    private final WorkspaceStore store;
    private final AccountService accounts;

    public LegacyImportService(WorkspaceStore store, AccountService accounts) {
        this.store = store;
        this.accounts = accounts;
    }

    public boolean imported(String workspace, String device) {
        return store.read(workspace, document -> objects(document, "imports").has(device));
    }

    public void importData(Principal account, JsonNode payload) {
        if (payload.has("legacyWorkspaceKey") && !payload.path("legacyWorkspaceKey").isString()) {
            throw invalid();
        }
        String legacy = payload.path("legacyWorkspaceKey").asText("");
        JsonNode previous = legacy.isEmpty() ? null : snapshot(AccountService.identifier(legacy, "LEGACY_KEY"));
        accounts.claimLegacy(account, legacy);
        store.update(account.workspace(), document -> {
            var imports = objects(document, "imports");
            if (!imports.has(account.deviceId())) {
                if (previous != null) {
                    mergeDocument(document, previous, account.deviceId(), true);
                }
                mergeDocument(document, payload, account.deviceId(), false);
                imports.put(account.deviceId(), true);
            }
            return null;
        });
    }

    private JsonNode snapshot(String legacy) {
        return store.read(legacy, source -> {
            ObjectNode result = source.objectNode();
            for (String name : List.of("conversations", "plans", "drafts")) {
                var items = result.putArray(name);
                objects(source, name).forEach(items::add);
            }
            result.set("records", source.path("records"));
            return result;
        });
    }

    private void mergeDocument(ObjectNode document, JsonNode payload, String device, boolean serverSnapshot) {
        merge(document, payload, "conversations", device, serverSnapshot,
                item -> strings(item, "title") && number(item, "updatedAt") && every(item.path("messages"), this::message));
        merge(document, payload, "plans", device, serverSnapshot, item -> number(item, "createdAt")
                && strings(item.path("conditions"), "goal", "startDate") && number(item.path("conditions"), "dailyMinutes")
                && every(item.path("tasks"), task -> strings(task, "id", "title") && number(task, "day")
                        && oneOf(task, "status", "pending", "done")));
        merge(document, payload, "drafts", device, serverSnapshot, item -> strings(item, "conversationId", "planId")
                && number(item, "revision") && item.path("revision").asLong() > 0 && number(item, "createdAt")
                && oneOf(item, "status", "pending", "completed", "cancelled")
                && item.path("events").size() > 0 && item.path("events").size() <= 30
                && every(item.path("events"), this::event));
        JsonNode records = payload.path("records");
        if (!every(records, record -> strings(record, "planId", "taskId") && number(record, "completedAt"))) {
            throw invalid();
        }
        var alreadySaved = new HashMap<List<JsonNode>, Integer>();
        var saved = array(document, "records");
        saved.forEach(record -> alreadySaved.merge(recordKey(record), 1, Integer::sum));
        records.forEach(record -> {
            var key = recordKey(record);
            int count = alreadySaved.getOrDefault(key, 0);
            if (count == 0) {
                saved.add(record);
            } else {
                alreadySaved.put(key, count - 1);
            }
        });
    }

    private void merge(ObjectNode document, JsonNode payload, String name, String device, boolean serverSnapshot,
            Predicate<JsonNode> valid) {
        Set<String> ids = new HashSet<>();
        JsonNode incoming = payload.path(name);
        if (!every(incoming, item -> strings(item, "id") && !item.path("id").asText().isBlank()
                && ids.add(item.path("id").asText()) && valid.test(item))) {
            throw invalid();
        }
        ObjectNode existing = objects(document, name);
        incoming.forEach(item -> {
            String id = item.path("id").asText();
            if (!existing.has(id)) {
                ObjectNode copy = ((ObjectNode) item).deepCopy();
                copy.remove(List.of("_turns", "device"));
                if (name.equals("drafts") && StreamSupport.stream(copy.path("events").spliterator(), false)
                        .anyMatch(event -> !oneOf(event, "state", "pending"))) {
                    copy.put("device", serverSnapshot ? item.path("device").asText(device) : device);
                }
                existing.set(id, copy);
            }
        });
    }

    private boolean message(JsonNode message) {
        return strings(message, "id", "content", "toolCallId") && number(message, "createdAt")
                && oneOf(message, "role", "system", "user", "assistant", "tool")
                && every(message.path("toolCalls"), call -> strings(call, "id", "name", "input"));
    }

    private boolean event(JsonNode event) {
        return strings(event, "id", "taskId", "title", "timeZone", "description", "error")
                && number(event, "startTime") && number(event, "endTime") && number(event, "calendarId")
                && number(event, "eventId") && every(event.path("reminderMinutes"), JsonNode::isIntegralNumber)
                && oneOf(event, "state", "pending", "writing", "created", "failed", "uncertain");
    }

    private static List<JsonNode> recordKey(JsonNode record) {
        return List.of(record.path("planId"), record.path("taskId"), record.path("completedAt"));
    }

    private static boolean strings(JsonNode node, String... fields) {
        for (String field : fields) {
            if (!node.path(field).isString()) {
                return false;
            }
        }
        return true;
    }

    private static boolean number(JsonNode node, String field) {
        return node.path(field).isIntegralNumber() && node.path(field).canConvertToLong();
    }

    private static boolean oneOf(JsonNode node, String field, String... values) {
        return List.of(values).contains(node.path(field).asText());
    }

    private static boolean every(JsonNode items, Predicate<JsonNode> test) {
        if (!items.isArray()) {
            return false;
        }
        for (JsonNode item : items) {
            if (!test.test(item)) {
                return false;
            }
        }
        return true;
    }

    private static ApiException invalid() {
        return new ApiException(HttpStatus.BAD_REQUEST, "IMPORT_INVALID", "历史数据格式不正确，设备原始数据已保留。");
    }
}
