import type { AgentService, KeyValueStore, ModelClient, SessionRepository, SpeechService } from '../contracts/Ports';
import { AgentEngine } from '../agent/AgentEngine';
import { ToolRegistry } from '../agent/ToolRegistry';
import { StudyPlanTool } from '../agent/tools/StudyPlanTool';
import { MockModelClient } from '../services/model/MockModelClient';
import { JsonSessionRepository } from '../services/storage/JsonSessionRepository';
import { MemoryKeyValueStore } from '../services/storage/MemoryKeyValueStore';
import { StudyDataRepository } from '../services/storage/StudyDataRepository';
import { UnavailableSpeechService } from '../platform/speech/UnavailableSpeechService';

export class AppRuntime {
  agent: AgentService;
  sessions: SessionRepository;
  speech: SpeechService;
  study: StudyDataRepository;
  modeLabel: string;

  constructor(model: ModelClient, sessions: SessionRepository, speech: SpeechService, modeLabel: string,
    study: StudyDataRepository = new StudyDataRepository(new MemoryKeyValueStore())) {
    this.sessions = sessions;
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
    return new AgentEngine(model, registry, this.sessions);
  }
}

export function createRuntime(model: ModelClient, store: KeyValueStore, speech: SpeechService,
  modeLabel: string): AppRuntime {
  return new AppRuntime(model, new JsonSessionRepository(store), speech, modeLabel,
    new StudyDataRepository(store));
}

export function createMockRuntime(): AppRuntime {
  return createRuntime(new MockModelClient(), new MemoryKeyValueStore(),
    new UnavailableSpeechService(), '离线模拟模型 · 内存存储');
}
