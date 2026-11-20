import http from '@ohos.net.http';
import { BackendHttpResponse, WorkspaceMethod, WorkspaceRequest, WorkspaceTransport } from '../../contracts/Backend';

interface WorkspaceHeaders {
  'Accept': string;
  'Content-Type': string;
  'Authorization'?: string;
}

/** 独立的业务后端传输端口，不复用携带模型供应商凭据的 OhosJsonTransport。 */
export class OhosBackendTransport implements WorkspaceTransport {
  async get(url: string): Promise<BackendHttpResponse> {
    const request: http.HttpRequest = http.createHttp();
    try {
      const response: http.HttpResponse = await request.request(url, {
        method: http.RequestMethod.GET,
        header: { 'Accept': 'application/json' },
        expectDataType: http.HttpDataType.STRING,
        usingCache: false,
        connectTimeout: 10000,
        readTimeout: 15000
      });
      return { statusCode: response.responseCode, body: response.result as string };
    } finally {
      request.destroy();
    }
  }

  async request(input: WorkspaceRequest): Promise<BackendHttpResponse> {
    const request: http.HttpRequest = http.createHttp();
    const headers: WorkspaceHeaders = {
      'Accept': 'application/json', 'Content-Type': 'application/json'
    };
    if (input.token.length > 0) { headers.Authorization = 'Bearer ' + input.token; }
    const options: http.HttpRequestOptions = {
      method: this.method(input.method), header: headers,
      expectDataType: http.HttpDataType.STRING, usingCache: false, maxRedirects: 0, connectTimeout: 10000, readTimeout: 30000
    };
    if (input.body.length > 0) { options.extraData = input.body; }
    try {
      const response: http.HttpResponse = await request.request(input.url, options);
      return { statusCode: response.responseCode, body: response.result as string };
    } finally { request.destroy(); }
  }

  private method(method: WorkspaceMethod): http.RequestMethod {
    switch (method) {
      case 'POST': return http.RequestMethod.POST;
      case 'PUT': return http.RequestMethod.PUT;
      case 'DELETE': return http.RequestMethod.DELETE;
      default: return http.RequestMethod.GET;
    }
  }
}
