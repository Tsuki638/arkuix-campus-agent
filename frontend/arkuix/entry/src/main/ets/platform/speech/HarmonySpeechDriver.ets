import common from '@ohos.app.ability.common';
import abilityAccessCtrl from '@ohos.abilityAccessCtrl';
import { speechRecognizer, textToSpeech } from '@kit.CoreSpeechKit';
import { RecognitionCallbacks, SpeechDriver, SynthesisCallbacks } from './ManagedSpeechService';

// 仅通过平台工厂延迟加载；Android 不创建或调用此驱动。
export class HarmonySpeechDriver implements SpeechDriver {
  private context: common.Context;
  private asr: speechRecognizer.SpeechRecognitionEngine | null = null;
  private tts: textToSpeech.TextToSpeechEngine | null = null;
  private generation: number = 0;
  private activeId: string = '';

  constructor(context: common.Context) { this.context = context; }

  supportsRecognition(): boolean { return canIUse('SystemCapability.AI.SpeechRecognizer'); }
  supportsSynthesis(): boolean { return canIUse('SystemCapability.AI.TextToSpeech'); }

  async requestMicrophonePermission(): Promise<boolean> {
    const manager: abilityAccessCtrl.AtManager = abilityAccessCtrl.createAtManager();
    const result = await manager.requestPermissionsFromUser(this.context, ['ohos.permission.MICROPHONE']);
    return result.authResults.length === 1 && result.authResults[0] === 0;
  }

  async startRecognition(id: string, callbacks: RecognitionCallbacks): Promise<void> {
    const generation: number = this.generation;
    const engine: speechRecognizer.SpeechRecognitionEngine = await speechRecognizer.createEngine({
      language: 'zh-CN', online: 1,
      extraParams: { 'locate': 'CN', 'recognizerMode': 'short' }
    });
    if (generation !== this.generation) { engine.shutdown(); return; }
    this.asr = engine;
    this.activeId = id;
    const listener: speechRecognizer.RecognitionListener = {
      onStart: (_sessionId: string, _message: string) => {},
      onEvent: (_sessionId: string, _event: number, _message: string) => {},
      onResult: (sessionId: string, result: speechRecognizer.SpeechRecognitionResult) => {
        if (sessionId === id) { callbacks.result(result.result, result.isFinal, result.isLast); }
      },
      onComplete: (sessionId: string, _message: string) => {
        if (sessionId === id) { callbacks.complete(); }
      },
      onError: (sessionId: string, code: number, _message: string) => {
        if (sessionId === id) {
          callbacks.error(new Error('SPEECH_ASR_FAILED: 语音识别失败，系统错误码 ' + code.toString() + '。'));
        }
      }
    };
    engine.setListener(listener);
    engine.startListening({
      sessionId: id,
      audioInfo: { audioType: 'pcm', sampleRate: 16000, soundChannel: 1, sampleBit: 16 },
      extraParams: { 'recognitionMode': 0, 'maxAudioDuration': 15000 }
    });
  }

  async startSpeaking(id: string, text: string, callbacks: SynthesisCallbacks): Promise<void> {
    const generation: number = this.generation;
    const engine: textToSpeech.TextToSpeechEngine = await textToSpeech.createEngine({
      language: 'zh-CN', person: 0, online: 1,
      extraParams: { 'style': 'interaction-broadcast', 'locate': 'CN' }
    });
    if (generation !== this.generation) { engine.shutdown(); return; }
    this.tts = engine;
    this.activeId = id;
    const listener: textToSpeech.SpeakListener = {
      onStart: (_requestId: string, _response: textToSpeech.StartResponse) => {},
      onComplete: (requestId: string, response: textToSpeech.CompleteResponse) => {
        // type=0 仅合成完成，type=1 才是扬声器播报完成。
        if (requestId === id && response.type === 1) { callbacks.complete(); }
      },
      onStop: (requestId: string, _response: textToSpeech.StopResponse) => {
        if (requestId === id) { callbacks.error(new Error('SPEECH_CANCELLED: 已停止播报。')); }
      },
      onError: (requestId: string, code: number, _message: string) => {
        if (requestId === id) {
          callbacks.error(new Error('SPEECH_TTS_FAILED: 语音播报失败，系统错误码 ' + code.toString() + '。'));
        }
      }
    };
    engine.setListener(listener);
    engine.speak(text, { requestId: id, extraParams: { 'speed': 1.0, 'volume': 1.0 } });
  }

  stop(): void {
    this.generation += 1;
    const asr: speechRecognizer.SpeechRecognitionEngine | null = this.asr;
    const tts: textToSpeech.TextToSpeechEngine | null = this.tts;
    const id: string = this.activeId;
    this.asr = null;
    this.tts = null;
    this.activeId = '';
    if (asr !== null) {
      try { asr.cancel(id); } catch { /* 会话可能已自然结束。 */ }
      try { asr.shutdown(); } catch { /* 继续释放其他资源。 */ }
    }
    if (tts !== null) {
      try { tts.stop(); } catch { /* 播报可能已自然结束。 */ }
      try { tts.shutdown(); } catch { /* 本地引用已释放。 */ }
    }
  }
}
