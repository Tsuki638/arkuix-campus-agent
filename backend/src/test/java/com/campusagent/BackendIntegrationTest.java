package com.campusagent;

import com.campusagent.common.error.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.context.TestComponent;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Import(BackendIntegrationTest.FailureConfiguration.class)
class BackendIntegrationTest {

    @Autowired
    private MockMvc mvc;

    @Test
    void systemInfoUsesVersionedApiAndResponseEnvelope() throws Exception {
        mvc.perform(get("/api/v1/system/info"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value("OK"))
                .andExpect(jsonPath("$.data.application").value("campus-agent-backend"))
                .andExpect(jsonPath("$.data.apiVersion").value("v1"))
                .andExpect(jsonPath("$.data.phase").value("business"));
    }

    @Test
    void healthEndpointIsAvailable() throws Exception {
        mvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.components").doesNotExist());
    }

    @Test
    void unknownRouteKeepsHttp404AndUsesEnvelope() throws Exception {
        mvc.perform(get("/api/v1/missing"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    void unsupportedMethodKeepsHttp405AndAllowHeader() throws Exception {
        mvc.perform(post("/api/v1/system/info"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(header().exists("Allow"))
                .andExpect(jsonPath("$.code").value("METHOD_NOT_ALLOWED"));
    }

    @Test
    void corsAllowsConfiguredOrigin() throws Exception {
        mvc.perform(options("/api/v1/system/info")
                        .header("Origin", "http://localhost:5173")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5173"));
    }

    @Test
    void corsRejectsUnconfiguredOrigin() throws Exception {
        mvc.perform(options("/api/v1/system/info")
                        .header("Origin", "https://unconfigured.example")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    @Test
    void businessErrorPreservesStatusAndCode() throws Exception {
        mvc.perform(get("/api/v1/test/business-error"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONVERSATION_BUSY"));
    }

    @Test
    void unexpectedErrorDoesNotExposeExceptionMessage() throws Exception {
        mvc.perform(get("/api/v1/test/unexpected-error"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                .andExpect(jsonPath("$.message").value("服务暂时不可用，请稍后重试。"))
                .andExpect(jsonPath("$.trace").doesNotExist());
    }

    @TestConfiguration
    static class FailureConfiguration {

        @Bean
        FailureController failureController() {
            return new FailureController();
        }
    }

    @TestComponent
    @RestController
    static class FailureController {

        @GetMapping("/api/v1/test/business-error")
        void businessError() {
            throw new ApiException(HttpStatus.CONFLICT, "CONVERSATION_BUSY", "会话正在处理中。");
        }

        @GetMapping("/api/v1/test/unexpected-error")
        void unexpectedError() {
            throw new IllegalStateException("internal diagnostic detail");
        }
    }
}
