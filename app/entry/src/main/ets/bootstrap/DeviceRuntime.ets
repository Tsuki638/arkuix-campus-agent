import common from '@ohos.app.ability.common';
import { ModelSettings } from '../contracts/Models';
import { ModelClient, SpeechService } from '../contracts/Ports';
import { MockModelClient } from '../services/model/MockModelClient';
import { CompatibleModelClient } from '../services/model/CompatibleModelClient';
import { JsonSessionRepository } from '../services/storage/JsonSessionRepository';
import { FileKeyValueStore } from '../services/storage/FileKeyValueStore';
import { OhosJsonTransport } from '../platform/network/OhosJsonTransport';
import { UnavailableSpeechService } from '../platform/speech/UnavailableSpeechService';
import { AppRuntime } from './Runtime';

// 唯一装配点：成员 C 提供 settings，成员 D 注入已实现的语音服务。
// 不在共享 UI/Agent 中判断操作系统，也不复制两套业务。
export function createDeviceRuntime(context: common.Context, settings?: ModelSettings,
  speech?: SpeechService): AppRuntime {
  let model: ModelClient = new MockModelClient();
  if (settings !== undefined) {
    model = new CompatibleModelClient(new OhosJsonTransport(), settings);
  }
  return new AppRuntime(model,
    new JsonSessionRepository(new FileKeyValueStore(context.filesDir)),
    speech === undefined ? new UnavailableSpeechService() : speech,
    settings === undefined ? '离线模拟模型 · 本地文件历史' : '云端模型 · 本地文件历史');
}
