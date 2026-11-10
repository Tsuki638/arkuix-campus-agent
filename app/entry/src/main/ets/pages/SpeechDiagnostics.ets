import common from '@ohos.app.ability.common';
import { SpeechService } from '../contracts/Ports';
import { createPlatformSpeech } from '../platform/speech/PlatformSpeechFactory';

// 独立语音验收入口，不依赖模型密钥、聊天存储或其他成员的模块。
@Entry
@Component
struct SpeechDiagnostics {
  @State private asrAvailable: boolean = false;
  @State private ttsAvailable: boolean = false;
  @State private state: string = '正在检查设备能力';
  @State private text: string = '你好，我是学习规划助手。语音播报测试开始。';
  @State private recognized: string = '';
  @State private error: string = '';
  @State private busy: boolean = true;
  private speech: SpeechService | null = null;
  private visible: boolean = false;
  private request: number = 0;

  aboutToAppear(): void { this.visible = true; this.initialize(); }
  onPageHide(): void { this.stopSpeech(); }
  aboutToDisappear(): void { this.visible = false; this.stopSpeech(); }

  private async initialize(): Promise<void> {
    try {
      const speech: SpeechService = await createPlatformSpeech(getContext(this) as common.Context);
      if (!this.visible) { await speech.stop(); return; }
      this.speech = speech;
      this.asrAvailable = canIUse('SystemCapability.AI.SpeechRecognizer');
      this.ttsAvailable = canIUse('SystemCapability.AI.TextToSpeech');
      this.state = '就绪';
    } catch (error) {
      this.error = (error as Error).message;
      this.state = '语音初始化失败';
    } finally { if (this.visible) { this.busy = false; } }
  }

  private async recognize(): Promise<void> {
    if (this.speech === null || this.busy) { return; }
    const request: number = ++this.request;
    this.busy = true;
    this.error = '';
    this.recognized = '';
    this.state = '正在请求权限或识别，请说一句中文（最长约 15 秒）';
    try {
      const text: string = await this.speech.recognizeOnce();
      if (!this.visible || request !== this.request) { return; }
      this.recognized = text;
      this.state = '识别完成；可将识别结果用于播报测试';
    } catch (error) {
      if (this.visible && request === this.request) {
        this.error = (error as Error).message;
        this.state = '本次识别未完成';
      }
    } finally { if (this.visible && request === this.request) { this.busy = false; } }
  }

  private async speak(): Promise<void> {
    if (this.speech === null || this.busy || this.text.trim().length === 0) { return; }
    const request: number = ++this.request;
    this.busy = true;
    this.error = '';
    this.state = '正在播报';
    try {
      await this.speech.speak(this.text);
      if (this.visible && request === this.request) { this.state = '播报完成'; }
    } catch (error) {
      if (this.visible && request === this.request) {
        this.error = (error as Error).message;
        this.state = '本次播报未完成';
      }
    } finally { if (this.visible && request === this.request) { this.busy = false; } }
  }

  private async stopSpeech(): Promise<void> {
    this.request += 1;
    if (this.speech !== null) { await this.speech.stop(); }
    if (this.visible) { this.busy = false; this.state = '已停止，可重新测试'; }
  }

  build() {
    Scroll() {
      Column({ space: 18 }) {
        Text('鸿蒙语音自测').fontSize(28).fontWeight(FontWeight.Bold).fontColor('#172A23')
        Text('先分别验证识别与播报，再接入聊天页面。').fontSize(15).fontColor('#63736C')
        Text('ASR 系统能力：' + (this.asrAvailable ? '已声明' : '未声明'))
        Text('TTS 系统能力：' + (this.ttsAvailable ? '已声明' : '未声明'))
        Text('能力声明不代表引擎及语音资源可用；请以实际测试结果为准。')
          .fontSize(13).fontColor('#63736C')
        Text(this.state).fontSize(16).fontColor('#28664B')
        Button('1. 开始中文识别').enabled(!this.busy && this.asrAvailable && this.speech !== null)
          .onClick(() => { this.recognize(); })
        Text(this.recognized.length > 0 ? this.recognized : '识别结果显示在这里')
          .width('100%').padding(16).backgroundColor('#FFFFFF').fontSize(18)
        Button('将识别结果用于播报').enabled(!this.busy && this.recognized.length > 0)
          .onClick(() => { this.text = this.recognized; })
        TextArea({ text: this.text, placeholder: '输入播报测试文字' })
          .height(120).enabled(!this.busy).onChange((value: string) => { this.text = value; })
        Button('2. 播报上方文字').enabled(!this.busy && this.ttsAvailable && this.speech !== null)
          .onClick(() => { this.speak(); })
        Button('停止语音').enabled(this.busy && this.speech !== null)
          .onClick(() => { this.stopSpeech(); })
        if (this.error.length > 0) { Text(this.error).fontSize(14).fontColor('#A23A30') }
        Text('模拟器若未提供语音服务，请记录能力和错误码，之后在鸿蒙真机补测。')
          .fontSize(14).fontColor('#63736C')
        Button('3. 打开聊天联调（默认模拟模型）').onClick(() => {
          this.getUIContext().getRouter().pushUrl({ url: 'pages/Index' });
        })
      }.width('100%').alignItems(HorizontalAlign.Start).padding(24)
    }.width('100%').height('100%').backgroundColor('#F3F6F1')
  }
}
