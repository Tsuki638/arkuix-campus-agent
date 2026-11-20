import type { SpeechService } from '../../contracts/Ports';

// 诚实的能力占位。成员 D 用鸿蒙 ASR/TTS 实现替换；Android 初期可继续使用。
export class UnavailableSpeechService implements SpeechService {
  private reason: string;
  constructor(reason: string = '当前设备语音不可用，或语音服务尚未接入。') { this.reason = reason; }
  isAvailable(): boolean { return false; }
  async recognizeOnce(): Promise<string> { throw new Error('SPEECH_UNAVAILABLE: ' + this.reason); }
  async speak(_text: string): Promise<void> { throw new Error('SPEECH_UNAVAILABLE: ' + this.reason); }
  async stop(): Promise<void> {}
}
