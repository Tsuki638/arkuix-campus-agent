package com.campusagent.calendar;

import com.campusagent.common.error.ApiException;
import com.campusagent.infrastructure.persistence.WorkspaceStore;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.StreamSupport;

import static com.campusagent.infrastructure.persistence.WorkspaceStore.array;
import static com.campusagent.infrastructure.persistence.WorkspaceStore.objects;

@Service
public class CalendarDraftService {

    public static final String TIME_ZONE = "Asia/Shanghai";
    private static final DateTimeFormatter DISPLAY_TIME = DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm")
            .withZone(ZoneOffset.ofHours(8));
    private static final Set<String> ATTEMPTED = Set.of("writing", "created", "uncertain");
    private static final List<String> EVENT_FIELDS = List.of("taskId", "title", "startTime", "endTime",
            "description", "reminderMinutes");

    private final WorkspaceStore store;
    private final JsonMapper json;

    public CalendarDraftService(WorkspaceStore store, JsonMapper json) {
        this.store = store;
        this.json = json;
    }

    public List<ObjectNode> list(String workspace, String conversationId) {
        return store.read(workspace, document -> StreamSupport.stream(objects(document, "drafts").spliterator(), false)
                .filter(draft -> conversationId == null || conversationId.equals(draft.path("conversationId").asText()))
                .sorted(Comparator.comparingLong((JsonNode draft) -> draft.path("createdAt").asLong()).reversed())
                .map(draft -> visible((ObjectNode) draft)).toList());
    }

    public ObjectNode prepare(String workspace, String conversationId, String planId, JsonNode inputs) {
        if (conversationId.isBlank() || !inputs.isArray() || inputs.isEmpty() || inputs.size() > 30) {
            throw invalid("每批需要 1–30 条日程。");
        }
        long now = System.currentTimeMillis();
        Set<String> tasks = new HashSet<>();
        Set<List<JsonNode>> fingerprints = new HashSet<>();
        var events = json.createArrayNode();
        for (JsonNode input : inputs) {
            ObjectNode event = event(input, now);
            String task = event.path("taskId").asText();
            if (!task.isEmpty() && !tasks.add(task)) {
                throw invalid("同一任务在一批草案中只能安排一次。");
            }
            if (!fingerprints.add(List.of(event.get("title"), event.get("startTime"), event.get("endTime")))) {
                throw invalid("同一批次包含重复的标题和时段，请合并后确认。");
            }
            events.add(event);
        }
        return store.update(workspace, document -> {
            if (!objects(document, "conversations").has(conversationId)) {
                throw invalid("当前会话不存在。");
            }
            var drafts = objects(document, "drafts");
            for (JsonNode draft : drafts) {
                if (is(draft, "status", "cancelled") || !is(draft, "conversationId", conversationId)
                        || !is(draft, "planId", planId) || draft.path("events").size() != events.size()) {
                    continue;
                }
                boolean equal = true;
                for (int i = 0; i < events.size(); i++) {
                    JsonNode stored = draft.path("events").get(i);
                    JsonNode current = events.get(i);
                    if (EVENT_FIELDS.stream().anyMatch(field -> !stored.path(field).equals(current.path(field)))) {
                        equal = false;
                        break;
                    }
                }
                if (equal) {
                    return visible((ObjectNode) draft);
                }
            }
            if (!planId.isEmpty()) {
                JsonNode plan = objects(document, "plans").path(planId);
                Set<String> pending = new HashSet<>();
                for (JsonNode task : plan.path("tasks")) {
                    if (!is(task, "status", "done")) {
                        pending.add(task.path("id").asText());
                    }
                }
                if (tasks.size() != events.size() || !pending.containsAll(tasks)) {
                    throw invalid("关联计划或待完成任务不存在。");
                }
                for (JsonNode draft : drafts) {
                    if (!is(draft, "planId", planId)) {
                        continue;
                    }
                    for (JsonNode event : draft.path("events")) {
                        if (tasks.contains(event.path("taskId").asText()) && (!is(draft, "status", "cancelled")
                                || ATTEMPTED.contains(event.path("state").asText()))) {
                            throw conflict("CALENDAR_DUPLICATE", "该计划的任务已有日程草案，请查看已有草案。");
                        }
                    }
                }
            }
            String id = "calendar-draft-" + UUID.randomUUID();
            ObjectNode draft = drafts.putObject(id).put("id", id).put("conversationId", conversationId)
                    .put("planId", planId).put("revision", 1).put("createdAt", now).put("status", "pending");
            draft.set("events", events);
            return visible(draft);
        });
    }

    public ObjectNode edit(String workspace, String id, int revision, String eventId, JsonNode input) {
        return store.update(workspace, document -> {
            ObjectNode draft = requireDraft(document, id, revision);
            if (!is(draft, "status", "pending") || StreamSupport.stream(draft.path("events").spliterator(), false)
                    .anyMatch(event -> !is(event, "state", "pending"))) {
                throw conflict("CALENDAR_LOCKED", "已尝试写入的草案不能修改，可重试或取消剩余日程。");
            }
            var events = array(draft, "events");
            for (int index = 0; index < events.size(); index++) {
                JsonNode previous = events.get(index);
                if (is(previous, "id", eventId)) {
                    ObjectNode replacement = event(input, System.currentTimeMillis()).put("id", eventId)
                            .put("taskId", previous.path("taskId").asText());
                    events.set(index, replacement);
                    advance(draft);
                    return visible(draft);
                }
            }
            throw missing();
        });
    }

    public ObjectNode cancel(String workspace, String device, String id, int revision) {
        return store.update(workspace, document -> {
            ObjectNode draft = requireDraft(document, id, revision);
            if (is(draft, "status", "completed")) {
                throw conflict("CALENDAR_LOCKED", "已创建的日程不会通过取消草案删除。");
            }
            requireDevice(draft, device);
            if (!is(draft, "status", "cancelled")) {
                draft.put("status", "cancelled");
                advance(draft);
                appendNotice(document, draft);
            }
            return visible(draft);
        });
    }

    public ObjectNode claim(String workspace, String device, String id, int revision, String eventId) {
        return store.update(workspace, document -> {
            ObjectNode draft = requireDraft(document, id, revision);
            requireDevice(draft, device);
            if (!is(draft, "status", "pending")) {
                throw conflict("CALENDAR_LOCKED", "草案已结束，请刷新预览。");
            }
            ObjectNode event = requireEvent(draft, eventId);
            if (is(event, "state", "created")) {
                throw conflict("CALENDAR_LOCKED", "该日程已经写入。");
            }
            draft.put("device", device);
            event.put("state", "writing").put("error", "");
            advance(draft);
            return visible(draft);
        });
    }

    public ObjectNode receipt(String workspace, String device, String id, int revision, String eventId,
            String state, long calendarId, long systemEventId) {
        return store.update(workspace, document -> {
            ObjectNode draft = requireDraft(document, id, revision);
            if (!is(draft, "device", device) || !is(draft, "status", "pending")) {
                throw conflict("CALENDAR_LOCKED", "当前设备没有进行中的日历写入。");
            }
            ObjectNode event = requireEvent(draft, eventId);
            if (!is(event, "state", "writing")) {
                throw conflict("CALENDAR_LOCKED", "该日程没有进行中的日历写入。");
            }
            switch (state) {
                case "created" -> {
                    if (calendarId < 0 || systemEventId <= 0) {
                        throw invalid("系统日程编号无效。");
                    }
                    event.put("calendarId", calendarId).put("eventId", systemEventId);
                }
                case "failed" -> event.put("error", "开始时间已过，请取消此草案并重新安排。");
                case "uncertain" -> event.put("error", "系统结果未确认；重试时会先查询已有日程，避免重复创建。");
                default -> throw invalid("系统日程结果无效。");
            }
            event.put("state", state);
            advance(draft);
            if (StreamSupport.stream(draft.path("events").spliterator(), false)
                    .allMatch(item -> is(item, "state", "created"))) {
                draft.put("status", "completed");
                appendNotice(document, draft);
            }
            return visible(draft);
        });
    }

    public ObjectNode recordResult(String workspace, String device, String id, int revision) {
        return store.update(workspace, document -> {
            ObjectNode draft = requireDraft(document, id, revision);
            requireDevice(draft, device);
            if (is(draft, "status", "pending") && StreamSupport.stream(draft.path("events").spliterator(), false)
                    .noneMatch(event -> Set.of("failed", "uncertain", "created").contains(event.path("state").asText()))) {
                throw invalid("草案尚无设备执行结果。");
            }
            appendNotice(document, draft);
            return visible(draft);
        });
    }

    private ObjectNode event(JsonNode input, long now) {
        String title = input.path("title").asText("");
        JsonNode reminders = input.path("reminderMinutes");
        if (!input.path("title").isString() || title.isBlank() || title.length() > 200
                || !reminders.isArray() || reminders.size() > 3 || !optionalText(input, "taskId", 150)
                || !optionalText(input, "description", 2000)) {
            throw invalid("请填写日程标题和有效提醒时间（0–10080 分钟，最多 3 个）。");
        }
        Set<Integer> minutes = new LinkedHashSet<>();
        for (JsonNode reminder : reminders) {
            if (!reminder.isIntegralNumber() || !reminder.canConvertToInt()
                    || reminder.asInt() < 0 || reminder.asInt() > 10080) {
                throw invalid("请填写日程标题和有效提醒时间（0–10080 分钟，最多 3 个）。");
            }
            minutes.add(reminder.asInt());
        }
        long start = parseTime(input.path("startTime").asText(""));
        long end = parseTime(input.path("endTime").asText(""));
        if (start <= now || end <= start || end - start > 86_400_000) {
            throw invalid("开始时间须晚于当前时间，结束时间须更晚，单项最长 24 小时。");
        }
        ObjectNode event = json.createObjectNode().put("id", "campus-event-" + UUID.randomUUID())
                .put("title", title.strip()).put("taskId", input.path("taskId").asText(""))
                .put("startTime", start).put("endTime", end).put("timeZone", TIME_ZONE)
                .put("description", input.path("description").asText("")).put("state", "pending")
                .put("calendarId", 0).put("eventId", 0).put("error", "");
        var values = event.putArray("reminderMinutes");
        minutes.forEach(values::add);
        return event;
    }

    private static boolean optionalText(JsonNode input, String name, int maxLength) {
        return !input.has(name) || input.path(name).isString() && input.path(name).asText().length() <= maxLength;
    }

    private static long parseTime(String text) {
        if (!text.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2})?\\+08:00")) {
            throw invalid("请使用带 +08:00 的明确日期和时间。");
        }
        try {
            return OffsetDateTime.parse(text).toInstant().toEpochMilli();
        } catch (DateTimeParseException exception) {
            throw invalid("日期或时间无效，请检查后重试。");
        }
    }

    private void appendNotice(ObjectNode document, ObjectNode draft) {
        JsonNode conversation = objects(document, "conversations").path(draft.path("conversationId").asText());
        if (conversation.isMissingNode()) {
            return;
        }
        String id = "calendar-notice-" + draft.path("id").asText() + "-" + draft.path("revision").asInt();
        var messages = array(conversation, "messages");
        for (JsonNode message : messages) {
            if (is(message, "id", id)) {
                return;
            }
        }
        var events = draft.path("events");
        long created = StreamSupport.stream(events.spliterator(), false).filter(event -> is(event, "state", "created")).count();
        StringBuilder content = new StringBuilder("【应用执行结果】\n系统日历执行结果：已创建 ")
                .append(created).append("/").append(events.size()).append(" 条。");
        if (is(draft, "status", "cancelled")) {
            content.append("剩余日程已取消；已创建的日程继续保留。");
        }
        for (JsonNode event : events) {
            String error = event.path("error").asText();
            content.append("\n").append(event.path("title").asText()).append(" · ")
                    .append(displayTime(event.path("startTime").asLong())).append("（北京时间） · ")
                    .append(is(event, "state", "created") ? "已创建到系统日历" : error.isBlank() ? "尚未写入" : error);
        }
        long now = System.currentTimeMillis();
        messages.addObject().put("id", id).put("role", "assistant").put("content", content.toString())
                .put("createdAt", now).put("toolCallId", "").putArray("toolCalls");
        ((ObjectNode) conversation).put("updatedAt", now);
    }

    public static String displayTime(long timestamp) {
        return DISPLAY_TIME.format(Instant.ofEpochMilli(timestamp));
    }

    private static ObjectNode requireDraft(ObjectNode document, String id, int revision) {
        if (!(objects(document, "drafts").get(id) instanceof ObjectNode draft)) {
            throw missing();
        }
        if (revision != draft.path("revision").asInt()) {
            throw conflict("CALENDAR_STALE", "草案已变化，请刷新预览后重新确认。");
        }
        return draft;
    }

    private static ObjectNode requireEvent(ObjectNode draft, String eventId) {
        for (JsonNode event : draft.path("events")) {
            if (is(event, "id", eventId)) {
                return (ObjectNode) event;
            }
        }
        throw missing();
    }

    private static void requireDevice(ObjectNode draft, String device) {
        if (draft.has("device") && !is(draft, "device", device)) {
            throw conflict("CALENDAR_DEVICE", "此草案已在另一台设备开始写入，请在原设备继续处理。");
        }
    }

    private static void advance(ObjectNode draft) {
        draft.put("revision", draft.path("revision").asInt() + 1);
    }

    private static ObjectNode visible(ObjectNode draft) {
        ObjectNode copy = draft.deepCopy();
        copy.remove("device");
        return copy;
    }

    private static boolean is(JsonNode object, String field, String value) {
        return value.equals(object.path(field).asText());
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "CALENDAR_INPUT", message);
    }

    private static ApiException conflict(String code, String message) {
        return new ApiException(HttpStatus.CONFLICT, code, message);
    }

    private static ApiException missing() {
        return new ApiException(HttpStatus.NOT_FOUND, "CALENDAR_NOT_FOUND", "日程或草案不存在。");
    }
}
