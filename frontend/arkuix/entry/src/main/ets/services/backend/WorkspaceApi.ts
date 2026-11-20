import type { WorkspaceMethod, WorkspaceRequest, WorkspaceResponse, WorkspaceTransport,
  BackendHttpResponse } from '../../contracts/Backend';
import { BackendError, normalizeBackendUrl } from './BackendApiClient';

export class WorkspaceApi {
  private transport: WorkspaceTransport;
  private baseUrl: string;
  private token: string;
  private onExpired?: () => void;

  constructor(transport: WorkspaceTransport, baseUrl: string, token: string = '', onExpired?: () => void) {
    this.transport = transport;
    this.baseUrl = normalizeBackendUrl(baseUrl);
    this.token = token;
    this.onExpired = onExpired;
  }

  isSecureConnection(): boolean {
    return /^https:\/\//.test(this.baseUrl) || /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(this.baseUrl);
  }

  request<T>(method: WorkspaceMethod, path: string, body: string = ''): Promise<T> {
    return this.send<T>(method, '/workspace' + path, body);
  }

  account<T>(method: WorkspaceMethod, path: string, body: string = ''): Promise<T> {
    return this.send<T>(method, '/auth' + path, body);
  }

  private async send<T>(method: WorkspaceMethod, path: string, body: string): Promise<T> {
    if (!this.isSecureConnection()) {
      throw new BackendError('HTTPS_REQUIRED', '登录和账号同步需要 HTTPS 后端地址，本机回环地址可用于调试。');
    }
    let response: BackendHttpResponse;
    const input: WorkspaceRequest = { method: method, url: this.baseUrl + '/api/v1' + path,
      token: this.token, body: body };
    try { response = await this.transport.request(input); }
    catch { throw new BackendError('BACKEND_TRANSPORT', '无法连接 Java 后端，请检查网络或服务状态。'); }

    let envelope: WorkspaceResponse<T>;
    try {
      envelope = JSON.parse(response.body) as WorkspaceResponse<T>;
      if (envelope === null || typeof envelope.code !== 'string' || typeof envelope.message !== 'string') {
        throw new Error('Invalid response');
      }
    } catch {
      throw new BackendError('BACKEND_RESPONSE', 'Java 后端响应格式不正确（HTTP ' + response.statusCode + '）。');
    }
    if (response.statusCode < 200 || response.statusCode >= 300 || envelope.code !== 'OK') {
      if (response.statusCode === 401 && (envelope.code === 'AUTH_REQUIRED' || envelope.code === 'AUTH_EXPIRED') &&
        this.onExpired !== undefined) { this.onExpired(); }
      throw new BackendError(envelope.code, envelope.message);
    }
    if (envelope.data === undefined) { throw new BackendError('BACKEND_RESPONSE', 'Java 后端未返回业务数据。'); }
    return envelope.data;
  }
}
