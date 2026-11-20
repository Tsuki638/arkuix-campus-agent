package com.campusagent.config;

import java.util.List;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "app")
public record AppProperties(@NotBlank String apiVersion, @NotNull @Valid Cors cors) {

    public record Cors(@NotNull List<String> allowedOrigins) {
    }
}
