package com.campusagent;

import com.campusagent.auth.AccountService;
import com.campusagent.common.error.ApiException;
import com.campusagent.infrastructure.persistence.AccountStore;
import com.campusagent.infrastructure.persistence.WorkspaceStore;
import com.campusagent.model.ModelGateway;
import com.campusagent.model.ModelPreferences;
import com.campusagent.web.WebResearchService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class WorkspaceIntegrationTest {

    private static final String CREDENTIAL_KEY = Base64.getEncoder().encodeToString(new byte[32]);

    @TempDir
    static Path data;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("app.data-directory", () -> data.toString());
        registry.add("app.model.credential-key", () -> CREDENTIAL_KEY);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JsonMapper json;

    @Autowired
    AccountService accounts;

    @MockitoBean
    ModelGateway model;

    @MockitoBean
    WebResearchService web;

    private static final String PASSWORD = "working-space-passphrase";
    private final String username = newUsername();
    private final String device = UUID.randomUUID().toString();
    private String token;
    private String workspace;

    @BeforeEach
    void signIn() throws Exception {
        token = credentials("/register", username, PASSWORD, device, 201).path("token").asText();
        workspace = accounts.authenticate("Bearer " + token).workspace();
    }

    @Test
    void chatToolsAndCheckInsSurviveRepositoryRestart() throws Exception {
        var calls = new AtomicInteger();
        var settings = new ModelGateway.Settings("https://api.deepseek.com/chat/completions", "test-model", "test-key");
        when(model.resolve(isNull())).thenReturn(settings);
        when(model.complete(any(), anyList(), anyList())).thenAnswer(invocation -> {
            List<JsonNode> messages = invocation.getArgument(1);
            List<ObjectNode> tools = invocation.getArgument(2);
            assertThat(tools).hasSize(4).noneMatch(tool -> tool.path("function").path("name").asText().contains("confirm"));
            return switch (calls.incrementAndGet()) {
                case 1 -> new ModelGateway.Reply("", List.of(new ModelGateway.Call(
                        "call-1", "create_study_plan", "{\"goal\":\"高数\",\"days\":2}")), null, null);
                case 2 -> {
                    assertThat(messages.getLast().path("toolCallId").asText()).isEqualTo("call-1");
                    yield new ModelGateway.Reply("已生成高数计划。", List.of(), null, null);
                }
                default -> {
                    assertThat(messages).anyMatch(message -> message.path("content").asText().equals("制定学习计划"));
                    yield new ModelGateway.Reply("继续复习高数。", List.of(), null, null);
                }
            };
        });
        String id = createConversation();
        String first = "{\"requestId\":\"turn-1\",\"text\":\"制定学习计划\"}";
        call(HttpMethod.POST, "/conversations/" + id + "/turns", first, 202);
        JsonNode result = awaitTurn(id, "turn-1");
        assertThat(result.path("reply").asText()).isEqualTo("已生成高数计划。");
        var messages = result.path("conversation").path("messages");
        assertThat(messages).hasSize(4);
        assertThat(messages.path(2).path("toolCallId").asText()).isEqualTo("call-1");
        assertThat(call(HttpMethod.POST, "/conversations/" + id + "/turns", first, 202).path("reply").asText())
                .isEqualTo("已生成高数计划。");
        assertThat(calls.get()).isEqualTo(2);

        JsonNode list = call(HttpMethod.GET, "/plans", null, 200);
        assertThat(list).hasSize(1);
        String plan = list.path(0).path("id").asText();
        String task = list.path(0).path("tasks").path(0).path("id").asText();
        String check = "/plans/" + plan + "/tasks/" + task + "/completion";
        call(HttpMethod.PUT, check, "{\"completed\":true}", 200);
        call(HttpMethod.PUT, check, "{\"completed\":true}", 200);
        call(HttpMethod.PUT, check, "{\"completed\":false}", 200);
        assertThat(call(HttpMethod.GET, "/plans/" + plan + "/records", null, 200)).hasSize(1);

        call(HttpMethod.POST, "/conversations/" + id + "/turns", "{\"requestId\":\"turn-2\",\"text\":\"接着聊\"}", 202);
        assertThat(awaitTurn(id, "turn-2").path("reply").asText()).isEqualTo("继续复习高数。");
        var reopened = new WorkspaceStore(data.toString(), json);
        JsonNode persisted = reopened.read(workspace, doc -> doc.path("conversations").path(id));
        assertThat(persisted.path("messages")).hasSize(6);
        assertThat(persisted.toString()).doesNotContain("test-key");

        String tablet = secondDevice();
        String computer = secondDevice();
        for (String session : List.of(tablet, computer)) {
            assertThat(call(HttpMethod.GET, "/conversations/" + id, null, 200, session).path("messages")).hasSize(6);
            assertThat(call(HttpMethod.GET, "/plans", null, 200, session).path(0).path("tasks").path(0).path("status").asText())
                    .isEqualTo("pending");
            assertThat(call(HttpMethod.GET, "/plans/" + plan + "/records", null, 200, session)).hasSize(1);
        }
        auth(HttpMethod.POST, "/logout", null, 200, tablet);
        call(HttpMethod.GET, "/conversations/" + id, null, 401, tablet);
        assertThat(call(HttpMethod.GET, "/conversations/" + id, null, 200, computer).path("messages")).hasSize(6);
        call(HttpMethod.DELETE, "/conversations/" + id, null, 200);
        call(HttpMethod.GET, "/conversations/" + id, null, 404, computer);
    }

    @Test
    void agentReadsSearchResultsAndAnswersFromPageContent() throws Exception {
        var calls = new AtomicInteger();
        String source = "https://example.com/jobs/java?position=123";
        when(web.configured()).thenReturn(true);
        ObjectNode search = json.createObjectNode();
        search.putArray("results").addObject().put("url", source).put("title", "Java 实习");
        when(web.search(any())).thenReturn(search);
        when(web.fetch(any())).thenAnswer(invocation -> {
            JsonNode input = invocation.getArgument(0);
            String url = input.path("url").asText();
            if (url.endsWith("page=3")) {
                throw new ApiException(HttpStatus.BAD_GATEWAY, "WEB_PAGE_UNAVAILABLE", "该页面无法读取。");
            }
            return json.createObjectNode().put("url", url).put("title", "Java 实习").put("content", "要求编写 Spring Boot 接口。");
        });
        when(model.resolve(isNull())).thenReturn(new ModelGateway.Settings("", "test-model", ""));
        when(model.complete(any(), anyList(), anyList())).thenAnswer(invocation -> {
            List<JsonNode> messages = invocation.getArgument(1);
            List<ObjectNode> tools = invocation.getArgument(2);
            List<String> names = tools.stream().map(tool -> tool.path("function").path("name").asText()).toList();
            return switch (calls.incrementAndGet()) {
                case 1 -> {
                    assertThat(names).contains("search_web", "read_web_page");
                    var searches = new java.util.ArrayList<ModelGateway.Call>();
                    for (int index = 1; index <= 4; index++) {
                        searches.add(new ModelGateway.Call("search-" + index, "search_web",
                                json.createObjectNode().put("query", "北京 Java 实习 " + index).toString()));
                    }
                    yield new ModelGateway.Reply("", searches, null, null);
                }
                case 2 -> {
                    assertThat(names).contains("read_web_page").doesNotContain("search_web", "create_study_plan");
                    for (int index = 1; index <= 3; index++) {
                        JsonNode message = messages.get(messages.size() - 5 + index);
                        assertThat(message.path("toolCallId").asText()).isEqualTo("search-" + index);
                        JsonNode searchResult = json.readTree(message.path("content").asText());
                        assertThat(searchResult.path("success").asBoolean()).isTrue();
                        assertThat(json.readTree(searchResult.path("content").asText()).path("results").path(0)
                                .path("url").asText()).isEqualTo(source);
                    }
                    assertThat(messages.getLast().path("content").asText()).contains("WEB_LIMIT");
                    var pages = new java.util.ArrayList<ModelGateway.Call>();
                    for (int index = 1; index <= 7; index++) {
                        pages.add(new ModelGateway.Call("fetch-" + index, "read_web_page",
                                json.createObjectNode().put("url", source + "&page=" + index).toString()));
                    }
                    pages.add(new ModelGateway.Call("write-1", "create_study_plan", "{\"goal\":\"Java\",\"days\":1}"));
                    yield new ModelGateway.Reply("", pages, null, null);
                }
                case 3 -> {
                    assertThat(names).doesNotContain("search_web", "read_web_page");
                    for (int index = 1; index <= 6; index++) {
                        JsonNode message = messages.get(messages.size() - 9 + index);
                        assertThat(message.path("toolCallId").asText()).isEqualTo("fetch-" + index);
                        JsonNode pageResult = json.readTree(message.path("content").asText());
                        assertThat(pageResult.path("success").asBoolean()).isEqualTo(index != 3);
                        if (index == 3) {
                            assertThat(pageResult.path("content").asText()).contains("WEB_PAGE_UNAVAILABLE");
                        } else {
                            assertThat(json.readTree(pageResult.path("content").asText()).path("content").asText())
                                    .isEqualTo("要求编写 Spring Boot 接口。");
                        }
                    }
                    assertThat(messages.get(messages.size() - 2).path("content").asText()).contains("WEB_LIMIT");
                    assertThat(messages.getLast().path("content").asText()).contains("WEB_READ_ONLY");
                    yield new ModelGateway.Reply("岗位要求编写 Spring Boot 接口。来源：" + source, List.of(), null, null);
                }
                default -> throw new AssertionError("Unexpected model request");
            };
        });

        String id = createConversation();
        call(HttpMethod.POST, "/conversations/" + id + "/turns",
                "{\"requestId\":\"job-search\",\"text\":\"搜索北京 Java 实习并查看岗位要求\"}", 202);
        JsonNode result = awaitTurn(id, "job-search");
        assertThat(result.path("state").asText()).isEqualTo("completed");
        assertThat(result.path("reply").asText()).contains("Spring Boot", source);
        assertThat(call(HttpMethod.GET, "/plans", null, 200)).isEmpty();
    }

    @Test
    void modelFailureKeepsInputAndWorkspaceIsolation() throws Exception {
        when(model.resolve(isNull())).thenThrow(new ApiException(HttpStatus.BAD_REQUEST, "MODEL_CONFIG", "请配置模型。"));
        String id = createConversation();
        call(HttpMethod.POST, "/conversations/" + id + "/turns", "{\"requestId\":\"turn-1\",\"text\":\"保留输入\"}", 202);
        JsonNode result = awaitTurn(id, "turn-1");
        assertThat(result.path("state").asText()).isEqualTo("failed");
        assertThat(result.path("error").asText()).startsWith("MODEL_CONFIG");
        assertThat(result.path("conversation").path("messages").path(0).path("content").asText()).isEqualTo("保留输入");
        String other = credentials("/register", newUsername(), PASSWORD, UUID.randomUUID().toString(), 201).path("token").asText();
        call(HttpMethod.GET, "/conversations/" + id, null, 404, other);
        assertThat(call(HttpMethod.GET, "/conversations", null, 200, other)).isEmpty();
        assertThat(call(HttpMethod.GET, "/plans", null, 200, other)).isEmpty();
        mvc.perform(request(HttpMethod.GET, "/api/v1/workspace/conversations/" + id)
                        .header("X-Workspace-Key", workspace).header("X-Device-Id", device))
                .andExpect(status().isUnauthorized());
        mvc.perform(request(HttpMethod.GET, "/api/v1/workspace/model").with(input -> {
            input.setRemoteAddr("192.0.2.1");
            return input;
        }).header("Authorization", "Bearer " + token)).andExpect(status().isForbidden());
    }

    @Test
    void importKeepsIdsAndCalendarReceiptsRequireCurrentRevisionAndDevice() throws Exception {
        String legacyKey = UUID.randomUUID().toString();
        var original = new WorkspaceStore(data.toString(), json);
        original.update(legacyKey, document -> {
            var prior = WorkspaceStore.objects(document, "conversations").putObject("legacy");
            prior.put("id", "legacy").put("title", "服务器上的最新历史").put("updatedAt", 2000);
            prior.putArray("messages");
            return null;
        });
        String payload = """
                {"conversations":[{"id":"legacy", "title":"已有历史", "messages":[], "updatedAt":1000}],
                 "plans":[{"id":"old-plan", "conditions":{"goal":"英语","startDate":"","dailyMinutes":0},
                   "tasks":[{"id":"old-task","title":"单词","day":1,"status":"pending"}],"createdAt":1000}],
                 "records":[{"planId":"old-plan","taskId":"old-task","completedAt":1000},
                   {"planId":"old-plan","taskId":"old-task","completedAt":1000}], "drafts":[],
                 "legacyWorkspaceKey":"%s"}
                """.formatted(legacyKey);
        assertThat(call(HttpMethod.GET, "/import", null, 200).asBoolean()).isFalse();
        call(HttpMethod.POST, "/import", payload, 200);
        call(HttpMethod.POST, "/import", payload, 200);
        assertThat(call(HttpMethod.GET, "/import", null, 200).asBoolean()).isTrue();
        assertThat(call(HttpMethod.GET, "/plans/old-plan/records", null, 200)).hasSize(2);
        assertThat(call(HttpMethod.GET, "/conversations/legacy", null, 200).path("title").asText()).isEqualTo("服务器上的最新历史");
        String stranger = credentials("/register", newUsername(), PASSWORD, UUID.randomUUID().toString(), 201).path("token").asText();
        call(HttpMethod.POST, "/import", payload, 409, stranger);
        call(HttpMethod.GET, "/conversations/legacy", null, 404, stranger);
        String originalTitle = original.read(legacyKey, doc -> doc.path("conversations").path("legacy").path("title").asText());
        assertThat(originalTitle).isEqualTo("服务器上的最新历史");

        DateTimeFormatter time = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ssXXX");
        OffsetDateTime start = OffsetDateTime.now(ZoneOffset.ofHours(8)).plusDays(1);
        ObjectNode event = json.createObjectNode().put("title", "单词").put("taskId", "old-task")
                .put("startTime", time.format(start)).put("endTime", time.format(start.plusHours(1)));
        event.putArray("reminderMinutes").add(10);
        ObjectNode prepare = json.createObjectNode().put("conversationId", "legacy").put("planId", "old-plan");
        prepare.putArray("events").add(event);
        JsonNode draft = call(HttpMethod.POST, "/calendar/drafts", prepare.toString(), 200);
        assertThat(draft.path("events").path(0).path("state").asText()).isEqualTo("pending");
        assertThat(call(HttpMethod.POST, "/calendar/drafts", prepare.toString(), 200).path("id").asText())
                .isEqualTo(draft.path("id").asText());
        String draftPath = "/calendar/drafts/" + draft.path("id").asText();
        String path = draftPath + "/events/" + draft.path("events").path(0).path("id").asText();
        ObjectNode edit = json.createObjectNode().put("revision", 1);
        edit.set("input", event.put("title", "背单词"));
        call(HttpMethod.PUT, path, edit.toString(), 200);
        call(HttpMethod.POST, path + "/claim", "{\"revision\":1}", 409);
        call(HttpMethod.POST, path + "/claim", "{\"revision\":2}", 200);
        String otherDevice = secondDevice();
        call(HttpMethod.POST, path + "/claim", "{\"revision\":3}", 409, otherDevice);
        call(HttpMethod.POST, path + "/receipt", "{\"revision\":3,\"state\":\"uncertain\"}", 200);
        call(HttpMethod.POST, path + "/claim", "{\"revision\":4}", 200);
        JsonNode complete = call(HttpMethod.POST, path + "/receipt",
                "{\"revision\":5,\"state\":\"created\",\"eventId\":42,\"calendarId\":7}", 200);
        assertThat(complete.path("status").asText()).isEqualTo("completed");
        assertThat(complete.path("events").path(0).path("eventId").asInt()).isEqualTo(42);
        assertThat(call(HttpMethod.GET, "/calendar/drafts", null, 200, otherDevice)
                .path(0).path("events").path(0).path("eventId").asInt()).isEqualTo(42);
        call(HttpMethod.POST, draftPath + "/result", "{\"revision\":6}", 200);
        assertThat(call(HttpMethod.GET, "/conversations/legacy", null, 200).path("messages")).hasSize(1);
    }

    @Test
    void accountCredentialsAndSessionSurviveServerRestartWithoutStoringSecrets() throws Exception {
        credentials("/register", username.toUpperCase(java.util.Locale.ROOT), PASSWORD, UUID.randomUUID().toString(), 409);
        credentials("/login", username, "incorrect-long-password", UUID.randomUUID().toString(), 401);
        assertThat(auth(HttpMethod.GET, "/me", null, 200, token).path("username").asText()).isEqualTo(username);
        var reopened = new AccountService(new AccountStore(data.toString(), json));
        assertThat(reopened.authenticate("Bearer " + token).workspace()).isEqualTo(workspace);
        assertThat(Files.readString(data.resolve("accounts.json"))).doesNotContain(PASSWORD, token)
                .contains("passwordHash", "salt");
    }

    @Test
    void accountPasswordRequiresAtLeastEightCharacters() {
        String newUser = newUsername();
        String newDevice = UUID.randomUUID().toString();
        assertThatThrownBy(() -> accounts.register(newUser, "Study!7", newDevice))
                .isInstanceOfSatisfying(ApiException.class,
                        error -> assertThat(error.getCode()).isEqualTo("PASSWORD_INVALID"));
        accounts.register(newUser, "Study!78", newDevice);
        assertThat(accounts.login(newUser, "Study!78", newDevice).user().username()).isEqualTo(newUser);
    }

    @Test
    void savedModelFollowsAccountWithoutExposingCredentials() throws Exception {
        String path = "/model/preference";
        String endpoint = "https://api.deepseek.com/chat/completions";
        String defaultKey = "fixture-server-model-key";
        String customKey = "fixture-user-model-key";
        var gateway = new ModelGateway(json, endpoint, "server-default", defaultKey, "");
        when(model.status()).thenReturn(gateway.status());
        when(model.resolve(any())).thenAnswer(call -> gateway.resolve(call.getArgument(0)));
        when(model.complete(any(), anyList(), anyList())).thenAnswer(call -> {
            ModelGateway.Settings settings = call.getArgument(0);
            assertThat(settings.apiKey()).isEqualTo("my-model".equals(settings.model()) ? customKey : defaultKey);
            return new ModelGateway.Reply(settings.model(), List.of(), null, null);
        });

        assertThat(call(HttpMethod.GET, path, null, 200).path("mode").asText()).isEqualTo("default");
        assertThat(call(HttpMethod.GET, path, null, 401, null).isNull()).isTrue();
        var change = json.createObjectNode().put("mode", "custom");
        var custom = change.putObject("customModel").put("endpoint", endpoint).put("model", "my-model");
        call(HttpMethod.PUT, path, change.toString(), 400);
        custom.put("apiKey", customKey);
        JsonNode saved = call(HttpMethod.PUT, path, change.toString(), 200);
        assertThat(saved.path("customModel").path("configured").asBoolean()).isTrue();
        assertThat(saved.toString()).doesNotContain(defaultKey, customKey, "encryptedKey", "apiKey");
        assertThat(Files.readString(data.resolve(workspace + ".json")))
                .contains("encryptedKey").doesNotContain(defaultKey, customKey);
        var reopened = new ModelPreferences(new WorkspaceStore(data.toString(), json), gateway, CREDENTIAL_KEY);
        assertThat(reopened.settingsForTurn(workspace).apiKey()).isEqualTo(customKey);

        String otherDevice = accounts.login(username, PASSWORD, UUID.randomUUID().toString()).token();
        String otherAccount = accounts.register(newUsername(), PASSWORD, UUID.randomUUID().toString()).token();
        assertThat(call(HttpMethod.GET, path, null, 200, otherDevice)).isEqualTo(saved);
        assertThat(call(HttpMethod.GET, path, null, 200, otherAccount).path("customModel").isNull()).isTrue();

        String chat = createConversation();
        String turn = "/conversations/" + chat + "/turns";
        call(HttpMethod.POST, turn, "{\"requestId\":\"custom-model\",\"text\":\"hi\",\"useSavedModel\":true}",
                202, otherDevice);
        assertThat(awaitTurn(chat, "custom-model").path("reply").asText()).isEqualTo("my-model");

        call(HttpMethod.PUT, path, "{\"mode\":\"default\"}", 200);
        call(HttpMethod.POST, turn, "{\"requestId\":\"default-model\",\"text\":\"hi\",\"useSavedModel\":true}", 202);
        assertThat(awaitTurn(chat, "default-model").path("reply").asText()).isEqualTo("server-default");
        custom.remove("apiKey");
        assertThat(call(HttpMethod.PUT, path, change.toString(), 200)).isEqualTo(saved);
    }

    @Test
    void longConversationUsesSummaryAndKeepsFullHistory() throws Exception {
        String id = "long-history";
        var legacy = json.createObjectNode();
        legacy.putArray("plans");
        legacy.putArray("records");
        legacy.putArray("drafts");
        var conversation = legacy.putArray("conversations").addObject().put("id", id).put("title", "学习目标")
                .put("updatedAt", 1000);
        var history = conversation.putArray("messages");
        for (int turn = 0; turn < 4; turn++) {
            history.addObject().put("id", "u-" + turn).put("role", "user")
                    .put("content", "学习目标" + turn + "计划".repeat(1500)).put("createdAt", 1000 + turn)
                    .put("toolCallId", "").putArray("toolCalls");
            history.addObject().put("id", "a-" + turn).put("role", "assistant").put("content", "阶段复习".repeat(750))
                    .put("createdAt", 1010 + turn).put("toolCallId", "").putArray("toolCalls");
        }
        call(HttpMethod.POST, "/import", legacy.toString(), 200);
        when(model.resolve(isNull())).thenReturn(new ModelGateway.Settings("", "", ""));
        when(model.complete(any(), anyList(), anyList())).thenAnswer(invocation -> {
            List<ObjectNode> tools = invocation.getArgument(2);
            List<JsonNode> messages = invocation.getArgument(1);
            if (tools.isEmpty()) {
                assertThat(messages.getLast().path("content").asText()).contains("新增旧轮次");
                return new ModelGateway.Reply("保留考研目标", List.of(), null, null);
            }
            assertThat(messages.get(1).path("content").asText()).contains("保留考研目标");
            assertThat(messages.getLast().path("content").asText()).isEqualTo("再调整一次");
            return new ModelGateway.Reply("已调整", List.of(), null, null);
        });
        call(HttpMethod.POST, "/conversations/" + id + "/turns", "{\"requestId\":\"summary\",\"text\":\"再调整一次\"}", 202);
        JsonNode result = awaitTurn(id, "summary").path("conversation");
        assertThat(result.path("messages")).hasSize(10);
        assertThat(result.path("summary").path("throughMessageId").asText()).isEqualTo("a-1");
    }

    private String createConversation() throws Exception {
        return call(HttpMethod.POST, "/conversations", null, 201).path("id").asText();
    }

    private JsonNode awaitTurn(String conversation, String turn) throws Exception {
        long deadline = System.nanoTime() + 5_000_000_000L;
        do {
            JsonNode value = call(HttpMethod.GET, "/conversations/" + conversation + "/turns/" + turn, null, 200);
            if (List.of("completed", "failed").contains(value.path("state").asText())) {
                return value;
            }
            Thread.sleep(15);
        } while (System.nanoTime() < deadline);
        throw new AssertionError("Turn did not finish");
    }

    private JsonNode call(HttpMethod method, String path, String body, int expected) throws Exception {
        return call(method, path, body, expected, token);
    }

    private JsonNode call(HttpMethod method, String path, String body, int expected, String session) throws Exception {
        return execute(method, "/api/v1/workspace" + path, body, expected, session);
    }

    private JsonNode auth(HttpMethod method, String path, String body, int expected, String session) throws Exception {
        return execute(method, "/api/v1/auth" + path, body, expected, session);
    }

    private String secondDevice() throws Exception {
        return credentials("/login", username, PASSWORD, UUID.randomUUID().toString(), 200).path("token").asText();
    }

    private JsonNode credentials(String path, String name, String password, String deviceId, int expected) throws Exception {
        String body = json.createObjectNode().put("username", name).put("password", password).put("deviceId", deviceId).toString();
        return auth(HttpMethod.POST, path, body, expected, null);
    }

    private JsonNode execute(HttpMethod method, String path, String body, int expected, String session) throws Exception {
        var input = request(method, path);
        if (session != null) {
            input.header("Authorization", "Bearer " + session);
        }
        if (body != null) {
            input.contentType("application/json").content(body);
        }
        var result = mvc.perform(input).andExpect(status().is(expected)).andReturn();
        return json.readTree(result.getResponse().getContentAsByteArray()).path("data");
    }

    private static String newUsername() {
        return "user-" + UUID.randomUUID().toString().substring(0, 12);
    }
}
