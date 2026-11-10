import type { AgentService, KeyValueStore, ModelClient, SessionRepository, SpeechService } from '../contracts/Ports';
import { AgentEngine } from '../agent/AgentEngine';
import { ToolRegistry } from '../agent/ToolRegistry';
import { StudyPlanTool } from '../agent/tools/StudyPlanTool';
import { MockModelClient } from '../services/model/MockModelClient';
import { JsonSessionRepository } from '../services/storage/JsonSessionRepository';
import { MemoryKeyValueStore } from '../services/storage/MemoryKeyValueStore';
import { StudyDataRepository } from '../services/storage/StudyDataRepository';
import { UnavailableSpeechService } from '../platform/speech/UnavailableSpeechService';
import type { CalendarPort, LearningRepository } from '../contracts/LearningPorts';
import { LearningPlanner } from '../agent/learning/LearningPlanner';
import { createLearningTools } from '../agent/learning/LearningTools';
import { JsonLearningRepository } from '../services/storage/JsonLearningRepository';
import { UnavailableCalendarPort } from '../platform/calendar/UnavailableCalendarPort';

export class AppRuntime {
  agent: AgentService;
  sessions: SessionRepository;
  speech: SpeechService;
  study: StudyDataRepository;
  modeLabel: string;
  learning: LearningPlanner;
  private active: Set<string> = new Set<string>();

  constructor(model: ModelClient, sessions: SessionRepository, speech: SpeechService, modeLabel: string,
    learningRepository: LearningRepository = new JsonLearningRepository(new MemoryKeyValueStore()),
    calendar: CalendarPort = new UnavailableCalendarPort(),
    study: StudyDataRepository = new StudyDataRepository(new MemoryKeyValueStore())) {
    this.learning = new LearningPlanner(learningRepository, calendar, Date.now,
      async (id) => await sessions.get(id) !== null);
    this.sessions = {
      list: () => sessions.list(), get: (id) => sessions.get(id), save: (conversation) => sessions.save(conversation),
      delete: async (id) => {
        this.enter(id);
        try {
          const saved = await sessions.get(id);
          if (saved === null) { return; }
          await this.learning.deleteLocalState(id, () => sessions.delete(id), () => sessions.save(saved));
        } finally { this.active.delete(id); }
      }
    };
    this.speech = speech;
    this.study = study;
    this.modeLabel = modeLabel;
    this.agent = this.createAgent(model);
  }

  // 只在界面空闲时切换模型；会话、计划和语音服务实例保持一致。
  replaceModel(model: ModelClient, modeLabel: string): void {
    this.agent = this.createAgent(model);
    this.modeLabel = modeLabel;
  }

  private createAgent(model: ModelClient): AgentService {
    const registry: ToolRegistry = new ToolRegistry();
    registry.register(new StudyPlanTool(this.study));
    createLearningTools(this.learning).forEach((tool) => registry.register(tool));
    const engine = new AgentEngine(model, registry, this.sessions, 4, this.learning);
    return {
      createConversation: () => engine.createConversation(),
      send: async (id, text, listener) => {
        this.enter(id);
        try { return await engine.send(id, text, listener); }
        finally { this.active.delete(id); }
      }
    };
  }

  private enter(id: string): void {
    if (this.active.has(id)) { throw new Error('SESSION_BUSY: 当前会话正在处理，请稍候。'); }
    this.active.add(id);
  }
}

export function createRuntime(model: ModelClient, store: KeyValueStore, speech: SpeechService,
  modeLabel: string, calendar?: CalendarPort): AppRuntime {
  return new AppRuntime(model, new JsonSessionRepository(store), speech, modeLabel,
    new JsonLearningRepository(store), calendar, new StudyDataRepository(store));
}

export function createMockRuntime(): AppRuntime {
  return createRuntime(new MockModelClient(), new MemoryKeyValueStore(),
    new UnavailableSpeechService(), '离线模拟模型 · 内存存储');
}
