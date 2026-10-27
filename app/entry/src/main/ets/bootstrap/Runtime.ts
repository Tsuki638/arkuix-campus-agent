import type { AgentService, ModelClient, SessionRepository, SpeechService } from '../contracts/Ports';
import { AgentEngine } from '../agent/AgentEngine';
import { ToolRegistry } from '../agent/ToolRegistry';
import { StudyPlanTool } from '../agent/tools/StudyPlanTool';
import { MockModelClient } from '../services/model/MockModelClient';
import { JsonSessionRepository } from '../services/storage/JsonSessionRepository';
import { MemoryKeyValueStore } from '../services/storage/MemoryKeyValueStore';
import { UnavailableSpeechService } from '../platform/speech/UnavailableSpeechService';

export class AppRuntime {
  agent: AgentService;
  sessions: SessionRepository;
  speech: SpeechService;
  modeLabel: string;

  constructor(model: ModelClient, sessions: SessionRepository, speech: SpeechService, modeLabel: string) {
    const registry: ToolRegistry = new ToolRegistry();
    registry.register(new StudyPlanTool());
    this.agent = new AgentEngine(model, registry, sessions);
    this.sessions = sessions;
    this.speech = speech;
    this.modeLabel = modeLabel;
  }
}

export function createMockRuntime(): AppRuntime {
  return new AppRuntime(new MockModelClient(), new JsonSessionRepository(new MemoryKeyValueStore()),
    new UnavailableSpeechService(), '离线模拟模型 · 内存存储');
}
