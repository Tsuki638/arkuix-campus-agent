package com.campusagent.common.error;

import com.campusagent.common.api.ApiResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiResponse<Void>> handleBusinessException(ApiException exception) {
        return ResponseEntity.status(exception.getStatus())
                .body(ApiResponse.failure(exception.getCode(), exception.getMessage()));
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception exception, Object body,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        String code;
        String message;
        if (status.value() == 404) {
            code = "NOT_FOUND";
            message = "请求的资源不存在。";
        } else if (status.value() == 405) {
            code = "METHOD_NOT_ALLOWED";
            message = "请求方法不受支持。";
        } else if (status.is4xxClientError()) {
            code = "INVALID_REQUEST";
            message = "请求参数或格式不正确。";
        } else {
            code = "INTERNAL_ERROR";
            message = "服务暂时不可用，请稍后重试。";
            log.error("请求处理失败", exception);
        }
        return new ResponseEntity<>(ApiResponse.failure(code, message), headers, status);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnexpectedException(Exception exception) {
        log.error("请求处理失败", exception);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.failure("INTERNAL_ERROR", "服务暂时不可用，请稍后重试。"));
    }
}
