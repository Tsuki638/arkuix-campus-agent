package com.campusagent.web;

import com.campusagent.common.error.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class WebResearchServiceTest {

    private final JsonMapper json = JsonMapper.builder().build();
    private final RestClient.Builder builder = RestClient.builder();
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    private final WebResearchService web = new WebResearchService(json, "server-key", builder);

    @Test
    void searchAndFetchKeepSourceAndReturnBoundedText() {
        String url = "https://example.com/jobs?job=123";
        server.expect(requestTo("https://api.deepseek.com/v1/tools/search")).andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", "Bearer server-key"))
                .andExpect(content().string("{\"query\":\"Java 实习\",\"count\":5}"))
                .andRespond(withSuccess("""
                        {"results":[{"url":"https://example.com/jobs?job=123","title":"Java 实习","snippet":"岗位摘要"},
                                    {"url":"https://example.com/jobs?job=123"},{"url":"file:///secret"}]}
                        """, MediaType.APPLICATION_JSON));
        String page = json.createObjectNode().put("title", "Java 实习").put("content", "要求：" + "甲".repeat(4_100)).toString();
        server.expect(requestTo("https://api.deepseek.com/v1/tools/fetch")).andExpect(method(HttpMethod.POST))
                .andExpect(content().string(json.createObjectNode().put("url", url).toString()))
                .andRespond(withSuccess(page, MediaType.APPLICATION_JSON));

        var search = web.search(json.createObjectNode().put("query", " Java 实习 "));
        assertThat(search.path("results")).hasSize(1);
        assertThat(search.path("results").path(0).path("url").asText()).isEqualTo(url);
        var fetched = web.fetch(json.createObjectNode().put("url", url));
        assertThat(fetched.path("url").asText()).isEqualTo(url);
        assertThat(fetched.path("title").asText()).isEqualTo("Java 实习");
        assertThat(fetched.path("content").asText()).startsWith("要求：").hasSize(4_000);
        assertThat(fetched.path("truncated").asBoolean()).isTrue();
        assertThat(fetched.path("fetchedAt").asText()).isNotBlank();
        server.verify();
    }

    @Test
    void validatesUrlAndReportsUnavailablePage() {
        for (String invalid : new String[] {"file:///etc/passwd", "http://127.0.0.1/", "http://localhost/",
                "https://user@example.com/", "https://example.com:8080/"}) {
            assertThatThrownBy(() -> web.fetch(json.createObjectNode().put("url", invalid)))
                    .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.getCode()).isEqualTo("WEB_URL"));
        }
        server.expect(requestTo("https://api.deepseek.com/v1/tools/fetch")).andRespond(withStatus(HttpStatus.NOT_FOUND));

        assertThatThrownBy(() -> web.fetch(json.createObjectNode().put("url", "https://example.com/missing")))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.getCode()).isEqualTo("WEB_PAGE_UNAVAILABLE"));
        server.verify();
    }

    @Test
    void retriesTimedOutSearchOnce() {
        String endpoint = "https://api.deepseek.com/v1/tools/search";
        server.expect(requestTo(endpoint)).andRespond(withStatus(HttpStatus.GATEWAY_TIMEOUT));
        server.expect(requestTo(endpoint)).andRespond(withSuccess("{\"results\":[]}", MediaType.APPLICATION_JSON));

        assertThat(web.search(json.createObjectNode().put("query", "Java 实习")).path("results")).isEmpty();
        server.verify();
    }
}
