package com.campusagent.auth;

import com.campusagent.common.api.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import static com.campusagent.auth.AccountAccess.PRINCIPAL;

@RestController
@RequestMapping("/api/v1/auth")
public class AccountController {

    public record Credentials(String username, String password, String deviceId) {}

    private final AccountService accounts;
    private final AccountAccess access;

    public AccountController(AccountService accounts, AccountAccess access) {
        this.accounts = accounts;
        this.access = access;
    }

    @PostMapping("/register")
    public ResponseEntity<ApiResponse<AccountService.Session>> register(HttpServletRequest request,
            @RequestBody Credentials input) {
        AccountService.Session session = access.withPassword(request,
                () -> accounts.register(input.username(), input.password(), input.deviceId()));
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore()).body(ApiResponse.success(session));
    }

    @PostMapping("/login")
    public ResponseEntity<ApiResponse<AccountService.Session>> login(HttpServletRequest request, @RequestBody Credentials input) {
        AccountService.Session session = access.withPassword(request,
                () -> accounts.login(input.username(), input.password(), input.deviceId()));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(ApiResponse.success(session));
    }

    @GetMapping("/me")
    public ApiResponse<AccountService.User> me(@RequestAttribute(PRINCIPAL) AccountService.Principal principal) {
        return ApiResponse.success(principal.user());
    }

    @PostMapping("/logout")
    public ApiResponse<Void> logout(@RequestAttribute(PRINCIPAL) AccountService.Principal principal) {
        accounts.logout(principal);
        return ApiResponse.success(null);
    }
}
