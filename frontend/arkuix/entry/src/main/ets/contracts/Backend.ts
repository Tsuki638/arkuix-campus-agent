/** HTTP 协议以根目录 contracts/openapi.yaml 为准，与端内 Ports.ts 分开维护。 */
export interface BackendHttpResponse {
  statusCode: number;
  body: string;
}

export interface BackendTransport {
  get(url: string): Promise<BackendHttpResponse>;
}

export type WorkspaceMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface WorkspaceRequest {
  method: WorkspaceMethod;
  url: string;
  token: string;
  body: string;
}

export interface WorkspaceTransport extends BackendTransport {
  request(input: WorkspaceRequest): Promise<BackendHttpResponse>;
}

export interface WorkspaceResponse<T> {
  code: string;
  message: string;
  data: T;
}

export interface BackendSystemInfo {
  application: string;
  apiVersion: string;
  architecture: string;
  phase: string;
}

export interface BackendSystemInfoResponse {
  code: string;
  message: string;
  data: BackendSystemInfo | null;
}
