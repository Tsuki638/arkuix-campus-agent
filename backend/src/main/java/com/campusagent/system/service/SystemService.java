package com.campusagent.system.service;

import com.campusagent.config.AppProperties;
import com.campusagent.system.dto.SystemInfo;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class SystemService {

    private final String applicationName;
    private final AppProperties properties;

    public SystemService(@Value("${spring.application.name}") String applicationName,
            AppProperties properties) {
        this.applicationName = applicationName;
        this.properties = properties;
    }

    public SystemInfo getInfo() {
        return new SystemInfo(applicationName, properties.apiVersion(),
                "frontend-backend-separated", "business");
    }
}
