import common from '@ohos.app.ability.common';
import util from '@ohos.util';
import { CalendarDraft, CalendarService } from '../contracts/Calendar';
import { ChatMessage, Conversation, ModelReply, ModelSettings, ToolDefinition } from '../contracts/Models';
import { ModelClient, SpeechService } from '../contracts/Ports';
import { OhosBackendTransport } from '../platform/network/OhosBackendTransport';
import { CompatibleModelClient } from '../services/model/CompatibleModelClient';
import { makeCalendarNotice } from '../services/calendar/CalendarNotice';
import { FileKeyValueStore } from '../services/storage/FileKeyValueStore';
import { OhosJsonTransport } from '../platform/network/OhosJsonTransport';
import { UnavailableSpeechService } from '../platform/speech/UnavailableSpeechService';
import { AppRuntime, createRuntime } from './Runtime';
import { UnavailableCalendarService } from '../platform/calendar/UnavailableCalendarService';
import { readDefaultModelSettings } from './DefaultModelSettings';
import { WorkspaceRuntime } from './WorkspaceRuntime';
import { AccountConnection } from '../services/backend/AccountConnection';

export { createBackendClient } from './BackendRuntime';

interface BackendResource { baseUrl: string; }

function backendUrl(context: common.Context): string {
  let bytes: Uint8Array;
  try { bytes = context.resourceManager.getRawFileContentSync('local.backend.json'); }
  catch { return ''; }
  const settings: BackendResource = JSON.parse(util.TextDecoder.create('utf-8').decodeToString(bytes)) as BackendResource;
  if (settings === null || typeof settings.baseUrl !== 'string') {
    throw new Error('BACKEND_CONFIG: Java 后端地址配置无效。');
  }
  return settings.baseUrl.trim();
}

async function deviceIdentifier(store: FileKeyValueStore, key: string): Promise<string> {
  const saved: string = await store.get(key);
  if (saved.length > 0) { return saved; }
  const generated: string = util.generateRandomUUID();
  await store.set(key, generated);
  return generated;
}

class MissingModelCredentials implements ModelClient {
  async complete(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ModelReply> {
    throw new Error('MODEL_CONFIG: 请先在模型设置中填写 API Key。');
  }
}

export async function createDeviceAccount(context: common.Context, speech: SpeechService, calendar: CalendarService,
  onExpired: () => void): Promise<AccountConnection | null> {
  const baseUrl: string = backendUrl(context);
  if (baseUrl.length === 0) { return null; }
  const store: FileKeyValueStore = new FileKeyValueStore(context.filesDir);
  const device: string = await deviceIdentifier(store, 'backend_device_v1');
  return new AccountConnection(new OhosBackendTransport(), baseUrl, store, device, speech, calendar, onExpired);
}

export function createLocalDeviceRuntime(context: common.Context, speech: SpeechService = new UnavailableSpeechService(),
  calendar: CalendarService = new UnavailableCalendarService()): WorkspaceRuntime {
  const store: FileKeyValueStore = new FileKeyValueStore(context.filesDir);
  const settings: ModelSettings = readDefaultModelSettings(context);
  const model: ModelClient = settings.apiKey.trim().length > 0 ?
    new CompatibleModelClient(new OhosJsonTransport(), settings) : new MissingModelCredentials();
  const local: AppRuntime = createRuntime(model, store, speech, settings.model, calendar);
  const runtime: WorkspaceRuntime = new WorkspaceRuntime(local.agent, local.sessions, local.study, local.calendar,
    local.speech, settings, settings.apiKey.length > 0,
    async (next: ModelSettings): Promise<string> => {
      local.replaceModel(new CompatibleModelClient(new OhosJsonTransport(), next), next.model);
      runtime.agent = local.agent;
      return next.model;
    },
    async (draft: CalendarDraft): Promise<Conversation | null> => {
      const conversation: Conversation | null = await local.sessions.get(draft.conversationId);
      if (conversation !== null) {
        conversation.messages.push(makeCalendarNotice(local.calendar.summary(draft)));
        conversation.updatedAt = Date.now();
        await local.sessions.save(conversation);
      }
      return conversation;
    });
  return runtime;
}
