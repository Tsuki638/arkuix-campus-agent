import http from '@ohos.net.http';
import { JsonTransport } from '../../contracts/Ports';
import { JsonRequest } from '../../contracts/Models';

interface HttpHeaders { 'Content-Type': string; 'Authorization': string; }

export class OhosJsonTransport implements JsonTransport {
  async post(input: JsonRequest): Promise<string> {
    const request: http.HttpRequest = http.createHttp();
    const headers: HttpHeaders = {
      'Content-Type': 'application/json', 'Authorization': 'Bearer ' + input.bearerToken
    };
    try {
      const response: http.HttpResponse = await request.request(input.url, {
        method: http.RequestMethod.POST, header: headers, extraData: input.body,
        expectDataType: http.HttpDataType.STRING, usingCache: false,
        connectTimeout: 15000, readTimeout: 60000
      });
      if (response.responseCode === 401 || response.responseCode === 403) {
        throw new Error('MODEL_AUTH: 模型鉴权失败，请检查运行时密钥。');
      }
      if (response.responseCode === 429) {
        throw new Error('MODEL_RATE_LIMIT: 模型服务限流，请稍后重试。');
      }
      if (response.responseCode < 200 || response.responseCode >= 300) {
        throw new Error('MODEL_HTTP: 模型请求失败，HTTP ' + response.responseCode);
      }
      return response.result as string;
    } finally {
      request.destroy();
    }
  }
}
