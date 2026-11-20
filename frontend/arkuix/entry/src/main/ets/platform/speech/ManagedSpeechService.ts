import type { SpeechService } from '../../contracts/Ports';

export interface RecognitionCallbacks {
  result(text: string, isFinal: boolean, isLast: boolean): void;
  complete(): void;
  error(error: Error): void;
}

export interface SynthesisCallbacks {
  complete(): void;
  error(error: Error): void;
}

// 平台驱动只处理系统 API；会话、超时及取消由同一份可检查逻辑管理。
export interface SpeechDriver {
  supportsRecognition(): boolean;
  supportsSynthesis(): boolean;
  requestMicrophonePermission(): Promise<boolean>;
  startRecognition(id: string, callbacks: RecognitionCallbacks): Promise<void>;
  startSpeaking(id: string, text: string, callbacks: SynthesisCallbacks): Promise<void>;
  stop(): void;
}

export class SpeechTimeouts {
  recognitionMs: number = 30000;
  synthesisMs: number = 120000;
}

class SpeechOperation {
  id: string;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timer: number = -1;
  sentences: string[] = [];

  constructor(id: string, resolve: (text: string) => void, reject: (error: Error) => void) {
    this.id = id;
    this.resolve = resolve;
    this.reject = reject;
  }
}

export class ManagedSpeechService implements SpeechService {
  private driver: SpeechDriver;
  private timeouts: SpeechTimeouts;
  private active: SpeechOperation | null = null;
  private sequence: number = 0;

  constructor(driver: SpeechDriver, timeouts: SpeechTimeouts = new SpeechTimeouts()) {
    this.driver = driver;
    this.timeouts = timeouts;
  }

  isAvailable(): boolean {
    return this.driver.supportsRecognition() && this.driver.supportsSynthesis();
  }

  recognizeOnce(): Promise<string> {
    if (!this.driver.supportsRecognition()) {
      return Promise.reject(new Error('SPEECH_UNAVAILABLE: 当前设备未提供语音识别服务，请使用文本或换鸿蒙设备测试。'));
    }
    return this.begin(true, '');
  }

  async speak(text: string): Promise<void> {
    if (!this.driver.supportsSynthesis()) {
      throw new Error('SPEECH_UNAVAILABLE: 当前设备未提供语音播报服务，文字回复仍可阅读。');
    }
    if (text.trim().length === 0) { return; }
    if (text.length > 10000) {
      throw new Error('SPEECH_TEXT_TOO_LONG: 本次回复超过单次播报长度，请阅读文字。');
    }
    await this.begin(false, text);
  }

  async stop(): Promise<void> {
    const operation: SpeechOperation | null = this.active;
    if (operation !== null) {
      this.finish(operation, '', new Error('SPEECH_CANCELLED: 已停止语音。'));
    } else {
      this.driver.stop();
    }
  }

  private begin(recognition: boolean, text: string): Promise<string> {
    if (this.active !== null) {
      return Promise.reject(new Error('SPEECH_BUSY: 语音正在使用中，请先停止当前操作。'));
    }
    this.sequence += 1;
    const id: string = 'speech-' + Date.now().toString() + '-' + this.sequence.toString();
    return new Promise<string>((resolve, reject) => {
      const operation: SpeechOperation = new SpeechOperation(id, resolve, reject);
      this.active = operation;
      operation.timer = setTimeout(() => {
        this.finish(operation, '', new Error('SPEECH_TIMEOUT: 语音操作超时，请重试或使用文本。'));
      }, recognition ? this.timeouts.recognitionMs : this.timeouts.synthesisMs);
      if (recognition) {
        this.recognize(operation).catch((error: Error) => { this.finish(operation, '', error); });
      } else {
        const callbacks: SynthesisCallbacks = {
          complete: () => { this.finish(operation, '', null); },
          error: (error: Error) => { this.finish(operation, '', error); }
        };
        this.driver.startSpeaking(id, text, callbacks)
          .catch((error: Error) => { this.finish(operation, '', error); });
      }
    });
  }

  private async recognize(operation: SpeechOperation): Promise<void> {
    const granted: boolean = await this.driver.requestMicrophonePermission();
    if (this.active !== operation) { return; }
    if (!granted) {
      throw new Error('SPEECH_PERMISSION_DENIED: 未获得麦克风权限。可在系统设置中授权，或继续文本输入。');
    }
    const callbacks: RecognitionCallbacks = {
      result: (text: string, isFinal: boolean, isLast: boolean) => {
        if (this.active !== operation || !isFinal) { return; }
        operation.sentences.push(text);
        if (isLast) { this.completeRecognition(operation); }
      },
      complete: () => { this.completeRecognition(operation); },
      error: (error: Error) => { this.finish(operation, '', error); }
    };
    await this.driver.startRecognition(operation.id, callbacks);
  }

  private completeRecognition(operation: SpeechOperation): void {
    if (this.active !== operation) { return; }
    const text: string = operation.sentences.join('').trim();
    this.finish(operation, text, text.length > 0 ? null :
      new Error('SPEECH_NO_RESULT: 没有识别到清晰语音，请重试或输入文字。'));
  }

  private finish(operation: SpeechOperation, text: string, error: Error | null): void {
    if (this.active !== operation) { return; }
    this.active = null;
    clearTimeout(operation.timer);
    // 先使旧操作失效，防止 cancel/shutdown 触发的回调再次结束操作。
    try { this.driver.stop(); }
    catch { /* 继续结束 Promise，避免平台释放异常使页面永久等待。 */ }
    if (error !== null) { operation.reject(error); }
    else { operation.resolve(text); }
  }
}
