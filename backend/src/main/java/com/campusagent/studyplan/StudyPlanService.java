package com.campusagent.studyplan;

import com.campusagent.common.error.ApiException;
import com.campusagent.infrastructure.persistence.WorkspaceStore;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.stream.StreamSupport;

import static com.campusagent.infrastructure.persistence.WorkspaceStore.array;
import static com.campusagent.infrastructure.persistence.WorkspaceStore.objects;

@Service
public class StudyPlanService {

    private final WorkspaceStore store;

    public StudyPlanService(WorkspaceStore store) {
        this.store = store;
    }

    public List<JsonNode> list(String workspace) {
        return store.read(workspace, document -> StreamSupport.stream(objects(document, "plans").spliterator(), false)
                .sorted(Comparator.comparingLong((JsonNode plan) -> plan.path("createdAt").asLong()).reversed())
                .toList());
    }

    public String create(String workspace, JsonNode input) {
        String goal = input.path("goal").asText("").strip();
        JsonNode requestedDays = input.path("days");
        int days = requestedDays.asInt(0);
        if (!input.path("goal").isString() || goal.isEmpty() || input.path("goal").asText().length() > 200
                || !requestedDays.isIntegralNumber() || !requestedDays.canConvertToInt() || days < 1 || days > 30) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_INPUT", "goal 为 1–200 字的目标，days 为 1–30 的整数。");
        }
        return store.update(workspace, document -> {
            String id = "plan-" + UUID.randomUUID();
            ObjectNode plan = objects(document, "plans").putObject(id);
            plan.put("id", id).put("createdAt", System.currentTimeMillis());
            plan.putObject("conditions").put("goal", goal).put("dailyMinutes", 0).put("startDate", "");
            ArrayNode tasks = plan.putArray("tasks");
            StringBuilder result = new StringBuilder("学习目标：").append(goal);
            for (int day = 1; day <= days; day++) {
                String title = goal + "，完成第 " + day + "/" + days + " 部分，练习并记录疑问。";
                tasks.addObject().put("id", "task-" + UUID.randomUUID()).put("title", title)
                        .put("day", day).put("status", "pending");
                result.append("\n第 ").append(day).append(" 天：").append(title);
            }
            return result.append("\n已保存到应用内学习计划，可查看和标记完成；尚未安排具体时间或写入日历。").toString();
        });
    }

    public void setCompletion(String workspace, String planId, String taskId, boolean completed) {
        store.update(workspace, document -> {
            JsonNode plan = objects(document, "plans").path(planId);
            for (JsonNode task : plan.path("tasks")) {
                if (!task.path("id").asText().equals(taskId)) {
                    continue;
                }
                String status = completed ? "done" : "pending";
                if (completed && !status.equals(task.path("status").asText())) {
                    array(document, "records").addObject().put("planId", planId).put("taskId", taskId)
                            .put("completedAt", System.currentTimeMillis());
                }
                ((ObjectNode) task).put("status", status);
                return null;
            }
            throw new ApiException(HttpStatus.NOT_FOUND, "STUDY_NOT_FOUND", "学习计划或任务不存在，请刷新。");
        });
    }

    public List<JsonNode> records(String workspace, String planId) {
        return store.read(workspace, document -> StreamSupport.stream(array(document, "records").spliterator(), false)
                .filter(record -> planId.equals(record.path("planId").asText())).toList());
    }
}
