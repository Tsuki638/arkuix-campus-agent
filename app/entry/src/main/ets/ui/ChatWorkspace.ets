import common from '@ohos.app.ability.common';
import { AgentResult, AgentState, ChatMessage, Conversation, makeMessage } from '../contracts/Models';
import { AppRuntime } from '../bootstrap/Runtime';
import { createDeviceRuntime } from '../bootstrap/DeviceRuntime';
import { MessageBubble } from './MessageBubble';

@Component
export struct ChatWorkspace {
  @State private conversations: Conversation[] = [];
  @State private messages: ChatMessage[] = [];
  @State private currentId: string = '';
  @State private input: string = '';
  @State private busy: boolean = true;
  @State private status: AgentState = 'idle';
  @State private error: string = '';
  @State private modeLabel: string = '正在初始化';
  @State private speechReady: boolean = false;
  private runtime: AppRuntime | null = null;
  private scroller: Scroller = new Scroller();

  aboutToAppear(): void { this.initialize(); }

  aboutToDisappear(): void {
    if (this.runtime !== null) { this.runtime.speech.stop().catch(() => {}); }
  }

  private async initialize(): Promise<void> {
    try {
      // 成员 C 接入运行时模型配置；成员 D 在装配点注入鸿蒙语音服务。
      this.runtime = createDeviceRuntime(getContext(this) as common.Context);
      this.modeLabel = this.runtime.modeLabel;
      this.speechReady = this.runtime.speech.isAvailable();
      this.conversations = await this.runtime.sessions.list();
      const current: Conversation = this.conversations.length > 0 ? this.conversations[0] :
        await this.runtime.agent.createConversation();
      this.showConversation(current);
      this.conversations = await this.runtime.sessions.list();
    } catch (error) {
      this.error = (error as Error).message || '初始化失败，请重新打开应用。';
      this.runtime = null;
    } finally { this.busy = false; }
  }

  private showConversation(conversation: Conversation): void {
    this.currentId = conversation.id;
    this.messages = conversation.messages.slice();
    this.status = 'idle';
    this.error = '';
  }

  private async newConversation(): Promise<void> {
    if (this.runtime === null || this.busy) { return; }
    this.busy = true;
    try {
      this.showConversation(await this.runtime.agent.createConversation());
      this.input = '';
      this.conversations = await this.runtime.sessions.list();
    } catch (error) { this.error = (error as Error).message; }
    finally { this.busy = false; }
  }

  private async selectConversation(id: string): Promise<void> {
    if (this.runtime === null || this.busy) { return; }
    this.busy = true;
    try {
      const conversation: Conversation | null = await this.runtime.sessions.get(id);
      if (conversation !== null) { this.showConversation(conversation); this.input = ''; }
    } catch (error) { this.error = (error as Error).message; }
    finally { this.busy = false; }
  }

  private async deleteCurrent(): Promise<void> {
    if (this.runtime === null || this.busy || this.currentId.length === 0) { return; }
    this.busy = true;
    try {
      await this.runtime.sessions.delete(this.currentId);
      this.conversations = await this.runtime.sessions.list();
      this.showConversation(this.conversations.length > 0 ? this.conversations[0] :
        await this.runtime.agent.createConversation());
      this.input = '';
      this.conversations = await this.runtime.sessions.list();
    } catch (error) { this.error = (error as Error).message; }
    finally { this.busy = false; }
  }

  private async submit(readAloud: boolean = false): Promise<void> {
    if (this.runtime === null || this.busy || this.input.trim().length === 0) { return; }
    const text: string = this.input;
    this.busy = true;
    this.error = '';
    this.status = 'thinking';
    this.messages = this.messages.concat([makeMessage('user', text.trim())]);
    try {
      const result: AgentResult = await this.runtime.agent.send(this.currentId, text,
        (state: AgentState) => { this.status = state; });
      this.messages = result.conversation.messages.slice();
      this.input = '';
      this.error = result.error;
      this.conversations = await this.runtime.sessions.list();
      if (readAloud && result.state === 'completed') {
        try { await this.runtime.speech.speak(result.reply); }
        catch { this.error = '回复已生成，语音播报失败。可以继续使用文本。'; }
      }
      this.scroller.scrollEdge(Edge.Bottom);
    } catch (error) {
      this.error = (error as Error).message || '发送失败，请重试。';
      this.status = 'failed';
      // 若首次落盘失败则保留输入，恢复已保存的历史，避免只显示临时气泡。
      try {
        const saved: Conversation | null = await this.runtime.sessions.get(this.currentId);
        if (saved !== null) { this.messages = saved.messages.slice(); }
      } catch { /* 历史读取失败时保留当前界面并展示错误。 */ }
    } finally { this.busy = false; }
  }

  private async listen(): Promise<void> {
    if (this.runtime === null || this.busy || !this.speechReady) { return; }
    this.busy = true;
    this.error = '';
    try { this.input = await this.runtime.speech.recognizeOnce(); }
    catch { this.error = '语音识别失败，请检查麦克风权限，或使用文本输入。'; }
    finally { this.busy = false; }
    if (this.error.length === 0 && this.input.trim().length > 0) { await this.submit(true); }
  }

  private statusLabel(): string {
    if (this.status === 'using_tool') { return '正在执行工具…'; }
    if (this.busy) { return '正在处理…'; }
    if (this.status === 'failed') { return '本轮未完成，可继续补充信息'; }
    return '就绪';
  }

  build() {
    Column({ space: 12 }) {
      Row() {
        Column({ space: 4 }) {
          Text('学习任务助手').fontSize(25).fontWeight(FontWeight.Bold).fontColor('#172A23')
          Text(this.modeLabel).fontSize(12).fontColor('#63736C')
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        Button('新会话').onClick(() => { this.newConversation(); }).enabled(!this.busy && this.runtime !== null)
      }.width('100%')
      Row() {
        Text('会话历史').fontSize(14).fontColor('#63736C').layoutWeight(1)
        Button('删除当前', { type: ButtonType.Normal }).fontSize(12).backgroundColor('#E7EDE8')
          .fontColor('#475A50').onClick(() => { this.deleteCurrent(); }).enabled(!this.busy && this.runtime !== null)
      }.width('100%')
      List({ space: 4 }) {
        ForEach(this.conversations, (conversation: Conversation) => {
          ListItem() {
            Text((conversation.id === this.currentId ? '● ' : '○ ') + conversation.title)
              .fontSize(14).fontColor('#28664B').maxLines(1).width('100%').padding(6)
              .onClick(() => { this.selectConversation(conversation.id); })
          }
        }, (conversation: Conversation) => conversation.id)
      }.height(76).width('100%')
      if (this.messages.length === 0) {
        Column({ space: 12 }) {
          Text('把一个学习目标，变成可执行的安排。').fontSize(20).fontColor('#172A23')
          Text('先说说你想完成什么，再一起补充时间和步骤。').fontSize(14).fontColor('#63736C')
          Button('试试：复习高数|3').onClick(() => { this.input = '复习高数|3'; }).enabled(!this.busy)
        }.layoutWeight(1).justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Start)
      } else {
        List({ space: 12, scroller: this.scroller }) {
          ForEach(this.messages, (message: ChatMessage) => {
            ListItem() { MessageBubble({ message: message }) }
          }, (message: ChatMessage) => message.id)
        }.layoutWeight(1).width('100%')
      }
      Text(this.statusLabel()).fontSize(12).fontColor('#63736C').width('100%')
      if (this.error.length > 0) {
        Text(this.error).fontSize(13).fontColor('#A23A30').width('100%')
      }
      TextInput({ placeholder: '输入目标，离线示例：复习高数|3', text: this.input })
        .onChange((value: string) => { this.input = value; }).enabled(!this.busy).height(48)
      Row({ space: 12 }) {
        Button(this.speechReady ? '语音输入' : '语音待接入')
          .enabled(this.speechReady && !this.busy).onClick(() => { this.listen(); })
        Button('发送').layoutWeight(1).backgroundColor('#28664B')
          .enabled(!this.busy && this.runtime !== null && this.input.trim().length > 0)
          .onClick(() => { this.submit(); })
      }.width('100%')
    }.padding(20).width('100%').height('100%').backgroundColor('#F3F6F1')
  }
}
