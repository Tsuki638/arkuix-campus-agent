package com.campusagent.conversation;

import com.campusagent.agent.AgentService;
import com.campusagent.auth.AccountService.Principal;
import com.campusagent.calendar.CalendarDraftService;
import com.campusagent.common.api.ApiResponse;
import com.campusagent.model.ModelGateway;
import com.campusagent.model.ModelPreferences;
import com.campusagent.studyplan.StudyPlanService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.List;

import static com.campusagent.auth.AccountAccess.PRINCIPAL;

@RestController
@RequestMapping("/api/v1/workspace")
public class WorkspaceController {

    private final AgentService agent;
    private final StudyPlanService study;
    private final ModelGateway models;
    private final ModelPreferences modelPreferences;
    private final CalendarDraftService calendar;
    private final LegacyImportService importer;

    public WorkspaceController(AgentService agent, StudyPlanService study, ModelGateway models,
            ModelPreferences modelPreferences, CalendarDraftService calendar, LegacyImportService importer) {
        this.agent = agent;
        this.study = study;
        this.models = models;
        this.modelPreferences = modelPreferences;
        this.calendar = calendar;
        this.importer = importer;
    }

    @GetMapping("/model")
    public ApiResponse<ModelGateway.Status> model() {
        return ApiResponse.success(models.status());
    }

    @PostMapping("/model/validate")
    public ApiResponse<ModelGateway.Status> validateModel(@RequestBody ModelGateway.Settings settings) {
        return ApiResponse.success(models.validate(settings));
    }

    @GetMapping("/model/preference")
    public ApiResponse<ModelPreferences.Preference> modelPreference(@RequestAttribute(PRINCIPAL) Principal account) {
        return ApiResponse.success(modelPreferences.get(account.workspace()));
    }

    @PutMapping("/model/preference")
    public ApiResponse<ModelPreferences.Preference> updateModelPreference(@RequestAttribute(PRINCIPAL) Principal account,
            @RequestBody ModelPreferences.Update input) {
        return ApiResponse.success(modelPreferences.update(account.workspace(), input));
    }

    @PostMapping("/import")
    public ApiResponse<Void> importData(@RequestAttribute(PRINCIPAL) Principal account, @RequestBody JsonNode data) {
        importer.importData(account, data);
        return ApiResponse.success(null);
    }

    @GetMapping("/import")
    public ApiResponse<Boolean> importStatus(@RequestAttribute(PRINCIPAL) Principal account) {
        return ApiResponse.success(importer.imported(account.workspace(), account.deviceId()));
    }

    @GetMapping("/conversations")
    public ApiResponse<List<ObjectNode>> conversations(@RequestAttribute(PRINCIPAL) Principal account) {
        return ApiResponse.success(agent.list(account.workspace()));
    }

    @PostMapping("/conversations")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<ObjectNode> create(@RequestAttribute(PRINCIPAL) Principal account) {
        return ApiResponse.success(agent.create(account.workspace()));
    }

    @GetMapping("/conversations/{id}")
    public ApiResponse<ObjectNode> conversation(@RequestAttribute(PRINCIPAL) Principal account, @PathVariable String id) {
        return ApiResponse.success(agent.get(account.workspace(), id));
    }

    @DeleteMapping("/conversations/{id}")
    public ApiResponse<Void> delete(@RequestAttribute(PRINCIPAL) Principal account, @PathVariable String id) {
        agent.delete(account.workspace(), id);
        return ApiResponse.success(null);
    }

    public record Send(String requestId, String text, ModelGateway.Settings settings, Boolean useSavedModel) {}

    @PostMapping("/conversations/{id}/turns")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ApiResponse<AgentService.Turn> send(@RequestAttribute(PRINCIPAL) Principal account, @PathVariable String id,
            @RequestBody Send input) {
        String workspace = account.workspace();
        return ApiResponse.success(agent.submit(workspace, id, input.requestId(), input.text(),
                () -> Boolean.TRUE.equals(input.useSavedModel()) ?
                        modelPreferences.settingsForTurn(workspace) : input.settings()));
    }

    @GetMapping("/conversations/{id}/turns/{requestId}")
    public ApiResponse<AgentService.Turn> turn(@RequestAttribute(PRINCIPAL) Principal account, @PathVariable String id,
            @PathVariable String requestId) {
        return ApiResponse.success(agent.status(account.workspace(), id, requestId));
    }

    @GetMapping("/plans")
    public ApiResponse<List<JsonNode>> plans(@RequestAttribute(PRINCIPAL) Principal account) {
        return ApiResponse.success(study.list(account.workspace()));
    }

    public record Completion(@NotNull Boolean completed) {}

    @PutMapping("/plans/{id}/tasks/{taskId}/completion")
    public ApiResponse<Void> completion(@RequestAttribute(PRINCIPAL) Principal account, @PathVariable String id,
            @PathVariable String taskId, @Valid @RequestBody Completion input) {
        study.setCompletion(account.workspace(), id, taskId, input.completed());
        return ApiResponse.success(null);
    }

    @GetMapping("/plans/{id}/records")
    public ApiResponse<List<JsonNode>> records(@RequestAttribute(PRINCIPAL) Principal account, @PathVariable String id) {
        return ApiResponse.success(study.records(account.workspace(), id));
    }

    @GetMapping("/calendar/drafts")
    public ApiResponse<List<ObjectNode>> drafts(@RequestAttribute(PRINCIPAL) Principal account) {
        return ApiResponse.success(calendar.list(account.workspace(), null));
    }

    public record Prepare(@NotBlank String conversationId, String planId, @NotNull JsonNode events) {}
    public record Edit(@Positive int revision, @NotNull JsonNode input) {}
    public record Revision(@Positive int revision) {}
    public record Receipt(@Positive int revision, @NotBlank String state, Long calendarId, Long eventId) {}

    @PostMapping("/calendar/drafts")
    public ApiResponse<ObjectNode> prepare(@RequestAttribute(PRINCIPAL) Principal account, @Valid @RequestBody Prepare input) {
        return ApiResponse.success(calendar.prepare(account.workspace(), input.conversationId(),
                input.planId() == null ? "" : input.planId(), input.events()));
    }

    @PutMapping("/calendar/drafts/{id}/events/{eventId}")
    public ApiResponse<ObjectNode> edit(@RequestAttribute(PRINCIPAL) Principal account, @PathVariable String id,
            @PathVariable String eventId, @Valid @RequestBody Edit input) {
        return ApiResponse.success(calendar.edit(account.workspace(), id, input.revision(), eventId, input.input()));
    }

    @PostMapping("/calendar/drafts/{id}/cancel")
    public ApiResponse<ObjectNode> cancel(@RequestAttribute(PRINCIPAL) Principal account,
            @PathVariable String id, @Valid @RequestBody Revision input) {
        return ApiResponse.success(calendar.cancel(account.workspace(), account.deviceId(), id, input.revision()));
    }

    @PostMapping("/calendar/drafts/{id}/events/{eventId}/claim")
    public ApiResponse<ObjectNode> claim(@RequestAttribute(PRINCIPAL) Principal account,
            @PathVariable String id, @PathVariable String eventId, @Valid @RequestBody Revision input) {
        return ApiResponse.success(calendar.claim(account.workspace(), account.deviceId(), id, input.revision(), eventId));
    }

    @PostMapping("/calendar/drafts/{id}/events/{eventId}/receipt")
    public ApiResponse<ObjectNode> receipt(@RequestAttribute(PRINCIPAL) Principal account,
            @PathVariable String id, @PathVariable String eventId, @Valid @RequestBody Receipt input) {
        return ApiResponse.success(calendar.receipt(account.workspace(), account.deviceId(), id, input.revision(), eventId,
                input.state(), input.calendarId() == null ? -1 : input.calendarId(),
                input.eventId() == null ? -1 : input.eventId()));
    }

    @PostMapping("/calendar/drafts/{id}/result")
    public ApiResponse<ObjectNode> result(@RequestAttribute(PRINCIPAL) Principal account,
            @PathVariable String id, @Valid @RequestBody Revision input) {
        return ApiResponse.success(calendar.recordResult(account.workspace(), account.deviceId(), id, input.revision()));
    }
}
