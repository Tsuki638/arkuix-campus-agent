import type { BackendHttpResponse, BackendSystemInfo, BackendSystemInfoResponse, BackendTransport } from '../../contracts/Backend';

export class BackendError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BackendError';
    this.code = code;
  }
}

export function normalizeBackendUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/?#\s@]+(?:\/[^?#\s]*)?$/.test(normalized)) {
    throw new BackendError('BACKEND_CONFIG', '请提供有效的 HTTP 或 HTTPS 后端根地址。');
  }
  return normalized;
}

/** baseUrl 是后端根地址。设备地址由装配方传入，不内置 localhost。 */
export class BackendApiClient {
  private transport: BackendTransport;
  private baseUrl: string;

  constructor(transport: BackendTransport, baseUrl: string) {
    this.transport = transport;
    this.baseUrl = normalizeBackendUrl(baseUrl);
  }

  async getSystemInfo(): Promise<BackendSystemInfo> {
    let response: BackendHttpResponse;
    try {
      response = await this.transport.get(this.baseUrl + '/api/v1/system/info');
    } catch (_error) {
      throw new BackendError('BACKEND_TRANSPORT', '无法连接后端服务，请检查地址与网络。');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new BackendError('BACKEND_HTTP', '后端请求失败，HTTP ' + response.statusCode);
    }
    let envelope: BackendSystemInfoResponse;
    try {
      envelope = JSON.parse(response.body) as BackendSystemInfoResponse;
    } catch (_error) {
      throw new BackendError('BACKEND_RESPONSE', '后端响应格式不正确。');
    }
    if (envelope === null || typeof envelope !== 'object' ||
      typeof envelope.code !== 'string' || typeof envelope.message !== 'string') {
      throw new BackendError('BACKEND_RESPONSE', '后端响应格式不正确。');
    }
    if (envelope.code !== 'OK') {
      throw new BackendError('BACKEND_RESPONSE', '后端未返回成功结果。');
    }
    const data = envelope.data;
    if (data === null || typeof data !== 'object' ||
      typeof data.application !== 'string' || data.apiVersion !== 'v1' ||
      typeof data.architecture !== 'string' || typeof data.phase !== 'string') {
      throw new BackendError('BACKEND_RESPONSE', '后端接口版本或数据格式不兼容。');
    }
    return data;
  }
}
