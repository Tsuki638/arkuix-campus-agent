package com.campusagent.auth;

import com.campusagent.common.error.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Semaphore;
import java.util.function.Supplier;

@Component
public class AccountAccess implements HandlerInterceptor {

    public static final String PRINCIPAL = "campusAccount";
    private static final Set<String> LOOPBACK = Set.of("127.0.0.1", "::1", "0:0:0:0:0:0:0:1");
    private static final long WINDOW = 60_000;
    private static final int MAX_ATTEMPTS = 15;

    private final AccountService accounts;
    private final Semaphore hashingSlots = new Semaphore(4);
    private final Map<String, Window> attempts = new HashMap<>();

    private record Window(long until, int count) {}

    public AccountAccess(AccountService accounts) {
        this.accounts = accounts;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if ("OPTIONS".equals(request.getMethod())) {
            return true;
        }
        requireSecure(request);
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        try {
            request.setAttribute(PRINCIPAL, accounts.authenticate(request.getHeader(HttpHeaders.AUTHORIZATION)));
        } catch (ApiException error) {
            if (error.getStatus() == HttpStatus.UNAUTHORIZED) {
                response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
            }
            throw error;
        }
        return true;
    }

    public <T> T withPassword(HttpServletRequest request, Supplier<T> action) {
        requireSecure(request);
        countAttempt(request.getRemoteAddr());
        if (!hashingSlots.tryAcquire()) {
            throw rateLimit();
        }
        try {
            return action.get();
        } finally {
            hashingSlots.release();
        }
    }

    private synchronized void countAttempt(String address) {
        long now = System.currentTimeMillis();
        attempts.values().removeIf(window -> window.until() <= now);
        Window window = attempts.getOrDefault(address, new Window(now + WINDOW, 0));
        if (window.count() >= MAX_ATTEMPTS || attempts.size() >= 10_000 && !attempts.containsKey(address)) {
            throw rateLimit();
        }
        attempts.put(address, new Window(window.until(), window.count() + 1));
    }

    private static void requireSecure(HttpServletRequest request) {
        if (!request.isSecure() && !LOOPBACK.contains(request.getRemoteAddr())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "HTTPS_REQUIRED", "账号接口需要使用 HTTPS，或通过本机回环地址调试。");
        }
    }

    private static ApiException rateLimit() {
        return new ApiException(HttpStatus.TOO_MANY_REQUESTS, "AUTH_RATE_LIMIT", "账号请求过于频繁，请稍后重试。");
    }
}
