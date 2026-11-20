import type { CalendarDraft, CalendarEventInput } from '../contracts/Calendar';
import type { Conversation, ModelSettings } from '../contracts/Models';
import type { AgentService, SpeechService } from '../contracts/Ports';
import type { PlanVersion } from '../services/storage/StudyDataRepository';

export interface WorkspaceSessions {
  list(): Promise<Conversation[]>;
  get(id: string): Promise<Conversation | null>;
  delete(id: string): Promise<void>;
}

export interface WorkspaceStudy {
  listPlans(): Promise<PlanVersion[]>;
  setTaskCompletion(planId: string, taskId: string, completed: boolean): Promise<void>;
}

export interface WorkspaceCalendar {
  isAvailable(): boolean;
  unavailableReason(): string;
  list(): Promise<CalendarDraft[]>;
  prepare(conversationId: string, planId: string, inputs: CalendarEventInput[]): Promise<CalendarDraft>;
  edit(id: string, revision: number, eventId: string, input: CalendarEventInput): Promise<CalendarDraft>;
  cancel(id: string, revision: number): Promise<CalendarDraft>;
  confirm(id: string, revision: number): Promise<CalendarDraft>;
}

export type ConfigureWorkspaceModel = (settings: ModelSettings) => Promise<string>;
export type RecordCalendarResult = (draft: CalendarDraft) => Promise<Conversation | null>;

export interface ModelStatus { endpoint: string; model: string; configured: boolean; }
export type ModelMode = 'default' | 'custom';
export interface ModelPreference {
  mode: ModelMode;
  defaultModel: ModelStatus;
  customModel: ModelStatus | null;
}
export interface AccountModelSettings {
  preference: ModelPreference;
  save: (mode: ModelMode, custom: ModelSettings) => Promise<ModelPreference>;
}

export class WorkspaceRuntime {
  agent: AgentService;
  sessions: WorkspaceSessions;
  study: WorkspaceStudy;
  calendar: WorkspaceCalendar;
  speech: SpeechService;
  defaultModelSettings: ModelSettings;
  modelConfigured: boolean;
  modeLabel: string;
  configureModel: ConfigureWorkspaceModel;
  recordCalendarResult: RecordCalendarResult;
  accountModel: AccountModelSettings | null = null;

  constructor(agent: AgentService, sessions: WorkspaceSessions, study: WorkspaceStudy, calendar: WorkspaceCalendar,
    speech: SpeechService, defaults: ModelSettings, configured: boolean, configure: ConfigureWorkspaceModel,
    recordResult: RecordCalendarResult) {
    this.agent = agent;
    this.sessions = sessions;
    this.study = study;
    this.calendar = calendar;
    this.speech = speech;
    this.defaultModelSettings = defaults;
    this.modelConfigured = configured;
    this.modeLabel = configured ? defaults.model : '未配置密钥';
    this.configureModel = configure;
    this.recordCalendarResult = recordResult;
  }
}
