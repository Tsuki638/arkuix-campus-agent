import type { SpeechService } from '../../contracts/Ports';

// 诚实的能力占位。成员 D 用鸿蒙 ASR/TTS 实现替换；Android 初期可继续使用。
export class UnavailableSpeechService implements SpeechService {
  isAvailable(): boolean { return false; }
  async recognizeOnce(): Promise<string> { throw new Error('SPEECH_UNAVAILABLE: 语音识别尚未接入。'); }
  async speak(_text: string): Promise<void> { throw new Error('SPEECH_UNAVAILABLE: 语音播报尚未接入。'); }
  async stop(): Promise<void> {}
}
