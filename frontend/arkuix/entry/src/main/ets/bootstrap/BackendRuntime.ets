import { BackendApiClient } from '../services/backend/BackendApiClient';
import { OhosBackendTransport } from '../platform/network/OhosBackendTransport';

/** 为系统信息与接口连通性检查提供装配入口。 */
export function createBackendClient(baseUrl: string): BackendApiClient {
  return new BackendApiClient(new OhosBackendTransport(), baseUrl);
}
