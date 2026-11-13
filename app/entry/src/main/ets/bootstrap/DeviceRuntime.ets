import common from '@ohos.app.ability.common';
import { ModelSettings } from '../contracts/Models';
import { ModelClient, SpeechService } from '../contracts/Ports';
import { MockModelClient } from '../services/model/MockModelClient';
import { CompatibleModelClient } from '../services/model/CompatibleModelClient';
import { FileKeyValueStore } from '../services/storage/FileKeyValueStore';
import { OhosJsonTransport } from '../platform/network/OhosJsonTransport';
import { UnavailableSpeechService } from '../platform/speech/UnavailableSpeechService';
import { AppRuntime, createRuntime } from './Runtime';
import { CalendarService } from '../contracts/Calendar';
import { UnavailableCalendarService } from '../platform/calendar/UnavailableCalendarService';

// 会话、基础计划和方向规划共用设备文件端口，分别保存。
// 不在共享 UI/Agent 中判断操作系统，也不复制两套业务。
export function createDeviceRuntime(context: common.Context, settings?: ModelSettings,
  speech?: SpeechService, calendar: CalendarService = new UnavailableCalendarService()): AppRuntime {
  let model: ModelClient = new MockModelClient();
  if (settings !== undefined) {
    model = new CompatibleModelClient(new OhosJsonTransport(), settings);
  }
  return createRuntime(model, new FileKeyValueStore(context.filesDir),
    speech === undefined ? new UnavailableSpeechService() : speech,
    settings === undefined ? '离线模拟模型 · 本地文件历史' : '云端模型 · 本地文件历史', calendar);
}

export function configureDeviceModel(runtime: AppRuntime, settings?: ModelSettings): void {
  // 先校验并构造成功，再替换；无效配置不会破坏当前可用模型。
  const model: ModelClient = settings === undefined ? new MockModelClient() :
    new CompatibleModelClient(new OhosJsonTransport(), settings);
  runtime.replaceModel(model, settings === undefined ? '离线模拟模型 · 本地文件历史' :
    '云端模型 · 本地文件历史');
}
