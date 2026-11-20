import type { CalendarDraft, CalendarEntry, CalendarEventInput, CalendarService } from '../../contracts/Calendar';
import type { AgentResult, AgentState, Conversation, ModelSettings } from '../../contracts/Models';
import { newId } from '../../contracts/Models';
import type { AgentService, KeyValueStore, SpeechService, StateListener } from '../../contracts/Ports';
import type { ModelMode, ModelPreference, ModelStatus, WorkspaceCalendar, WorkspaceSessions,
  WorkspaceStudy } from '../../bootstrap/WorkspaceRuntime';
import { WorkspaceRuntime } from '../../bootstrap/WorkspaceRuntime';
import { CalendarCoordinator } from '../calendar/CalendarCoordinator';
import type { CalendarWriteResult } from '../calendar/DeviceCalendarWrite';
import { requireCalendarPermission, writeCalendarEntry } from '../calendar/DeviceCalendarWrite';
import { JsonSessionRepository } from '../storage/JsonSessionRepository';
import { StudyDataRepository } from '../storage/StudyDataRepository';
import type { PlanVersion, StudyDocument, StudyRecord } from '../storage/StudyDataRepository';
import { BackendError } from './BackendApiClient';
import { WorkspaceApi } from './WorkspaceApi';

interface RemoteTurn { state: AgentState; reply: string; error: string; conversation: Conversation | null; }
interface PendingTurn { requestId: string; text: string; }
interface SendTurn { requestId: string; text: string; settings?: ModelSettings; useSavedModel?: boolean; }
interface UpdateModelPreference { mode: ModelMode; customModel?: ModelSettings; }
interface TaskCompletion { completed: boolean; }
interface Revision { revision: number; }
interface PrepareDraft { conversationId: string; planId: string; events: CalendarEventInput[]; }
interface EditDraft { revision: number; input: CalendarEventInput; }
interface Receipt { revision: number; state: string; calendarId: number; eventId: number; }
interface LegacyData {
  conversations: Conversation[];
  plans: PlanVersion[];
  records: StudyRecord[];
  drafts: CalendarDraft[];
  legacyWorkspaceKey: string;
}

function conversationPath(id: string): string { return '/conversations/' + encodeURIComponent(id); }
function calendarPath(id: string): string { return '/calendar/drafts/' + encodeURIComponent(id); }

export class RemoteAgent implements AgentService {
  private api: WorkspaceApi;
  private useSavedModel: boolean;
  private settings: ModelSettings | undefined = undefined;
  private pending: Map<string, PendingTurn> = new Map<string, PendingTurn>();

  constructor(api: WorkspaceApi, useSavedModel: boolean = false) {
    this.api = api;
    this.useSavedModel = useSavedModel;
  }

  async configure(settings: ModelSettings): Promise<string> {
    const result: ModelStatus = await this.api.request<ModelStatus>('POST', '/model/validate', JSON.stringify(settings));
    this.settings = settings;
    return result.model;
  }

  createConversation(): Promise<Conversation> {
    return this.api.request<Conversation>('POST', '/conversations');
  }

  async send(conversationId: string, text: string, onState?: StateListener): Promise<AgentResult> {
    const pending: PendingTurn | undefined = this.pending.get(conversationId);
    const requestId: string = pending !== undefined && pending.text === text ? pending.requestId : newId('turn');
    this.pending.set(conversationId, { requestId: requestId, text: text });
    const path: string = conversationPath(conversationId) + '/turns';
    const input: SendTurn = { requestId: requestId, text: text, settings: this.settings };
    if (this.useSavedModel) { input.useSavedModel = true; }
    let turn: RemoteTurn;
    try {
      turn = await this.api.request<RemoteTurn>('POST', path, JSON.stringify(input));
    } catch (error) {
      if (!(error instanceof BackendError) || error.code !== 'BACKEND_TRANSPORT') {
        this.pending.delete(conversationId);
        throw error;
      }
      // 同一 requestId 可安全补发，服务端只保存一次输入并执行一次工具。
      turn = await this.api.request<RemoteTurn>('POST', path, JSON.stringify(input));
    }
    const statusPath: string = path + '/' + encodeURIComponent(requestId);
    let state: AgentState = 'idle';
    let readFailures: number = 0;
    const deadline: number = Date.now() + 420000;
    while (turn.state === 'thinking' || turn.state === 'using_tool') {
      if (turn.state !== state) { state = turn.state; this.notify(onState, state); }
      if (Date.now() >= deadline) {
        throw new BackendError('BACKEND_TIMEOUT', '等待回复超时。相同内容可继续查询这次请求。');
      }
      await new Promise<void>((resolve) => { setTimeout(() => { resolve(); }, 400); });
      try {
        turn = await this.api.request<RemoteTurn>('GET', statusPath);
        readFailures = 0;
      } catch (error) {
        readFailures += 1;
        if (!(error instanceof BackendError) || error.code !== 'BACKEND_TRANSPORT' || readFailures >= 3) {
          throw error;
        }
      }
    }
    if ((turn.state !== 'completed' && turn.state !== 'failed') || turn.conversation === null) {
      throw new BackendError('BACKEND_RESPONSE', 'Java 后端未返回有效的对话处理结果。');
    }
    this.pending.delete(conversationId);
    this.notify(onState, turn.state);
    return { conversation: turn.conversation, reply: turn.reply, state: turn.state, error: turn.error };
  }

  private notify(listener: StateListener | undefined, state: AgentState): void {
    if (listener !== undefined) {
      try { listener(state); } catch { /* UI 状态通知不改变已提交的对话。 */ }
    }
  }
}

export class RemoteSessions implements WorkspaceSessions {
  private api: WorkspaceApi;
  constructor(api: WorkspaceApi) { this.api = api; }

  list(): Promise<Conversation[]> { return this.api.request<Conversation[]>('GET', '/conversations'); }

  async get(id: string): Promise<Conversation | null> {
    try { return await this.api.request<Conversation>('GET', conversationPath(id)); }
    catch (error) {
      if (error instanceof BackendError && error.code === 'SESSION_NOT_FOUND') { return null; }
      throw error;
    }
  }

  async delete(id: string): Promise<void> { await this.api.request<null>('DELETE', conversationPath(id)); }
}

export class RemoteStudy implements WorkspaceStudy {
  private api: WorkspaceApi;
  constructor(api: WorkspaceApi) { this.api = api; }

  listPlans(): Promise<PlanVersion[]> { return this.api.request<PlanVersion[]>('GET', '/plans'); }

  async setTaskCompletion(planId: string, taskId: string, completed: boolean): Promise<void> {
    const path: string = '/plans/' + encodeURIComponent(planId) + '/tasks/' + encodeURIComponent(taskId) + '/completion';
    const input: TaskCompletion = { completed: completed };
    await this.api.request<null>('PUT', path, JSON.stringify(input));
  }
}

export class RemoteCalendar implements WorkspaceCalendar {
  private api: WorkspaceApi;
  private service: CalendarService;
  private confirming: Set<string> = new Set<string>();

  constructor(api: WorkspaceApi, service: CalendarService) { this.api = api; this.service = service; }

  isAvailable(): boolean { return this.service.isAvailable(); }
  unavailableReason(): string { return this.service.unavailableReason(); }
  list(): Promise<CalendarDraft[]> { return this.api.request<CalendarDraft[]>('GET', '/calendar/drafts'); }

  prepare(conversationId: string, planId: string, inputs: CalendarEventInput[]): Promise<CalendarDraft> {
    const body: PrepareDraft = { conversationId: conversationId, planId: planId, events: inputs };
    return this.api.request<CalendarDraft>('POST', '/calendar/drafts', JSON.stringify(body));
  }

  edit(id: string, revision: number, eventId: string, input: CalendarEventInput): Promise<CalendarDraft> {
    const body: EditDraft = { revision: revision, input: input };
    const path: string = calendarPath(id) + '/events/' + encodeURIComponent(eventId);
    return this.api.request<CalendarDraft>('PUT', path, JSON.stringify(body));
  }

  cancel(id: string, revision: number): Promise<CalendarDraft> {
    const body: Revision = { revision: revision };
    return this.api.request<CalendarDraft>('POST', calendarPath(id) + '/cancel', JSON.stringify(body));
  }

  async confirm(id: string, revision: number): Promise<CalendarDraft> {
    if (this.confirming.has(id)) { throw new Error('CALENDAR_STALE: 日程正在写入，请稍候。'); }
    this.confirming.add(id);
    try {
      const saved: CalendarDraft | undefined = (await this.list()).find((draft: CalendarDraft) => draft.id === id);
      if (saved === undefined) { throw new Error('CALENDAR_NOT_FOUND: 日程草案不存在。'); }
      if (saved.revision !== revision) { throw new Error('CALENDAR_STALE: 草案已变化，请刷新预览后重新确认。'); }
      if (saved.status === 'completed') { return saved; }
      if (saved.status === 'cancelled') { throw new Error('CALENDAR_CANCELLED: 草案已取消。'); }
      await requireCalendarPermission(this.service);
      let current: CalendarDraft = saved;
      for (const event of saved.events) {
        if (event.state === 'created') { continue; }
        const path: string = calendarPath(id) + '/events/' + encodeURIComponent(event.id);
        const claim: Revision = { revision: current.revision };
        current = await this.api.request<CalendarDraft>('POST', path + '/claim', JSON.stringify(claim));
        const claimed: CalendarEntry | undefined = current.events.find((entry: CalendarEntry) => entry.id === event.id);
        if (claimed === undefined || claimed.state !== 'writing') {
          throw new BackendError('BACKEND_RESPONSE', 'Java 后端未确认写入意图，日程仍待处理。');
        }
        const result: CalendarWriteResult = await writeCalendarEntry(this.service, claimed);
        const receipt: Receipt = { revision: current.revision, state: result.state,
          calendarId: result.calendarId, eventId: result.eventId };
        current = await this.api.request<CalendarDraft>('POST', path + '/receipt', JSON.stringify(receipt));
      }
      return current;
    } finally { this.confirming.delete(id); }
  }

  async recordResult(draft: CalendarDraft): Promise<void> {
    const body: Revision = { revision: draft.revision };
    await this.api.request<CalendarDraft>('POST', calendarPath(draft.id) + '/result', JSON.stringify(body));
  }
}

export async function importLocalWorkspace(api: WorkspaceApi, store: KeyValueStore,
  calendar: CalendarService): Promise<void> {
  if (await api.request<boolean>('GET', '/import')) { return; }
  const study: StudyDocument = await new StudyDataRepository(store).snapshot();
  const data: LegacyData = {
    conversations: await new JsonSessionRepository(store).list(), plans: study.plans, records: study.records,
    drafts: await new CalendarCoordinator(store, calendar).list(),
    legacyWorkspaceKey: await store.get('backend_workspace_v1')
  };
  await api.request<null>('POST', '/import', JSON.stringify(data));
}

export async function createRemoteWorkspace(api: WorkspaceApi, speech: SpeechService,
  calendar: CalendarService): Promise<WorkspaceRuntime> {
  let preference: ModelPreference | null = null;
  try {
    preference = await api.request<ModelPreference>('GET', '/model/preference');
  } catch (error) {
    if (!(error instanceof BackendError) || error.code !== 'NOT_FOUND') { throw error; }
  }
  const status: ModelStatus = preference === null ? await api.request<ModelStatus>('GET', '/model') : preference.defaultModel;
  const active: ModelStatus = preference?.mode === 'custom' && preference.customModel !== null ?
    preference.customModel : status;
  const agent: RemoteAgent = new RemoteAgent(api, preference !== null);
  const sessions: RemoteSessions = new RemoteSessions(api);
  const coordinator: RemoteCalendar = new RemoteCalendar(api, calendar);
  const settings: ModelSettings = { endpoint: status.endpoint, model: status.model, apiKey: '' };
  const runtime: WorkspaceRuntime = new WorkspaceRuntime(agent, sessions, new RemoteStudy(api), coordinator,
    speech, settings, active.configured,
    (next: ModelSettings) => agent.configure(next),
    async (draft: CalendarDraft): Promise<Conversation | null> => {
      await coordinator.recordResult(draft);
      return sessions.get(draft.conversationId);
    });
  runtime.modeLabel = active.configured ? active.model : '未配置密钥';
  if (preference !== null) {
    runtime.accountModel = {
      preference: preference,
      save: (mode: ModelMode, custom: ModelSettings): Promise<ModelPreference> => {
        const choice: UpdateModelPreference = { mode: mode };
        if (mode === 'custom') { choice.customModel = custom; }
        return api.request<ModelPreference>('PUT', '/model/preference', JSON.stringify(choice));
      }
    };
  }
  return runtime;
}
