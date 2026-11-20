package com.campusagent.system.controller;

import com.campusagent.common.api.ApiResponse;
import com.campusagent.system.dto.SystemInfo;
import com.campusagent.system.service.SystemService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/system")
public class SystemController {

    private final SystemService service;

    public SystemController(SystemService service) {
        this.service = service;
    }

    @GetMapping("/info")
    public ApiResponse<SystemInfo> info() {
        return ApiResponse.success(service.getInfo());
    }
}
