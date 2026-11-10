import common from '@ohos.app.ability.common';
import { AgentResult, AgentState, ChatMessage, Conversation, ModelSettings, makeMessage } from '../contracts/Models';
import { AppRuntime } from '../bootstrap/Runtime';
import { configureDeviceModel, createDeviceRuntime } from '../bootstrap/DeviceRuntime';
import { PlanTask, PlanVersion } from '../services/storage/StudyDataRepository';
import { createPlatformSpeech } from '../platform/speech/PlatformSpeechFactory';
import { MessageBubble } from './MessageBubble';

@Component
export struct ChatWorkspace {
  @Prop @Watch('foregroundChanged') foreground: boolean = true;
  @State private conversations: Conversation[] = [];
  @State private messages: ChatMessage[] = [];
  @State private currentId: string = '';
  @State private input: string = '';
  @State private busy: boolean = true;
  @State private status: AgentState = 'idle';
  @State private error: string = '';
  @State private modeLabel: string = '正在初始化';
  @State private speechReady: boolean = false;
  @State private speechState: string = '';
  @State private view: string = 'chat';
  @State private showModelSettings: boolean = false;
  @State private modelEndpoint: string = '';
  @State private modelName: string = '';
  @State private modelKey: string = '';
  @State private modelError: string = '';
  @State private plans: PlanVersion[] = [];
  @State private planError: string = '';
  private runtime: AppRuntime | null = null;
  private scroller: Scroller = new Scroller();
  private visible: boolean = false;
  private speechRequest: number = 0;

  aboutToAppear(): void { this.visible = true; this.initialize(); }

  private foregroundChanged(): void {
    if (!this.foreground) { this.stopSpeech(); }
  }

  aboutToDisappear(): void {
    this.visible = false;
    this.speechRequest += 1;
    if (this.runtime !== null) { this.runtime.speech.stop().catch(() => {}); }
  }

  private async initialize(): Promise<void> {
    try {
      const context: common.Context = getContext(this) as common.Context;
      const speech = await createPlatformSpeech(context);
      if (!this.visible) { await speech.stop(); return; }
      // 先用离线模型启动；设置入口可在运行时接通 C 的真实模型适配器。
      this.runtime = createDeviceRuntime(context, undefined, speech);
      this.modeLabel = this.runtime.modeLabel;
      this.speechReady = this.runtime.speech.isAvailable();
      this.conversations = await this.runtime.sessions.list();
      await this.refreshPlans();
      const current: Conversation = this.conversations.length > 0 ? this.conversations[0] :
        await this.runtime.agent.createConversation();
      this.showConversation(current);
      this.conversations = await this.runtime.sessions.list();
    } catch (error) {
      this.error = (error as Error).message || '初始化失败，请重新打开应用。';
      this.runtime = null;
    } finally { this.busy = false; }
  }

  private applyModelSettings(offline: boolean): void {
    if (this.runtime === null || this.busy) { return; }
    try {
      if (offline) {
        configureDeviceModel(this.runtime);
      } else {
        const settings: ModelSettings = {
          endpoint: this.modelEndpoint.trim(), model: this.modelName.trim(), apiKey: this.modelKey.trim()
        };
        configureDeviceModel(this.runtime, settings);
      }
      this.modeLabel = this.runtime.modeLabel;
      this.modelError = '';
      this.modelKey = '';
      this.showModelSettings = false;
    } catch (error) {
      this.modelError = (error as Error).message || '模型配置无效，请检查后重试。';
    }
  }

  private async refreshPlans(): Promise<void> {
    if (this.runtime === null) { return; }
    try {
      this.plans = await this.runtime.study.listPlans();
      this.planError = '';
    } catch (error) { this.planError = (error as Error).message || '学习计划读取失败。'; }
  }

  private async toggleTask(planId: string, task: PlanTask): Promise<void> {
    if (this.runtime === null || this.busy) { return; }
    this.busy = true;
    try {
      await this.runtime.study.setTaskCompletion(planId, task.id, task.status !== 'done');
      await this.refreshPlans();
    } catch (error) { this.planError = (error as Error).message || '任务更新失败，请重试。'; }
    finally { this.busy = false; }
  }

  private completedTasks(plan: PlanVersion): number {
    return plan.tasks.filter((task: PlanTask) => task.status === 'done').length;
  }

  private planRenderId(plan: PlanVersion): string {
    return plan.id + ':' + plan.tasks.map((task: PlanTask) => task.status).join(',');
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
    const speechRequest: number = this.speechRequest;
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
      await this.refreshPlans();
      if (readAloud && result.state === 'completed' && this.visible && speechRequest === this.speechRequest) {
        this.speechState = '正在播报回复';
        try { await this.runtime.speech.speak(result.reply); }
        catch (error) {
          if (speechRequest === this.speechRequest) {
            this.error = '回复已生成。' + (error as Error).message;
          }
        } finally { if (speechRequest === this.speechRequest) { this.speechState = ''; } }
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
    const request: number = ++this.speechRequest;
    this.speechState = '正在请求权限或识别，请说话…';
    try {
      const text: string = await this.runtime.speech.recognizeOnce();
      if (!this.visible || request !== this.speechRequest) { return; }
      this.input = text;
    } catch (error) {
      if (this.visible && request === this.speechRequest) { this.error = (error as Error).message; }
    } finally {
      if (request === this.speechRequest) { this.busy = false; this.speechState = ''; }
    }
    if (this.visible && request === this.speechRequest && this.error.length === 0 &&
      this.input.trim().length > 0) { await this.submit(true); }
  }

  private async stopSpeech(): Promise<void> {
    const wasRecognizing: boolean = this.speechState.indexOf('识别') >= 0;
    this.speechRequest += 1;
    this.speechState = '';
    if (this.runtime !== null) { await this.runtime.speech.stop(); }
    if (wasRecognizing) { this.busy = false; }
  }

  private statusLabel(): string {
    if (this.speechState.length > 0) { return this.speechState; }
    if (this.status === 'using_tool') { return '正在执行工具…'; }
    if (this.busy) { return '正在处理…'; }
    if (this.status === 'failed') { return '本轮未完成，可继续补充信息'; }
    return '就绪';
  }

  @Builder
  private modelSettingsPanel() {
    Column({ space: 8 }) {
      Text('模型设置').fontSize(17).fontWeight(FontWeight.Medium)
      TextInput({ placeholder: '完整 HTTPS 接口地址（以 /chat/completions 结尾）', text: this.modelEndpoint })
        .onChange((value: string) => { this.modelEndpoint = value; }).enabled(!this.busy)
      TextInput({ placeholder: '模型名称', text: this.modelName })
        .onChange((value: string) => { this.modelName = value; }).enabled(!this.busy)
      TextInput({ placeholder: 'API Key', text: this.modelKey }).type(InputType.Password)
        .onChange((value: string) => { this.modelKey = value; }).enabled(!this.busy)
      Text('密钥仅在本次运行中使用，重启后需重新配置。').fontSize(12).fontColor('#63736C')
      if (this.modelError.length > 0) {
        Text(this.modelError).fontSize(12).fontColor('#A23A30')
      }
      Row({ space: 8 }) {
        Button('使用云端模型').onClick(() => { this.applyModelSettings(false); })
          .enabled(!this.busy && this.runtime !== null)
        Button('切回离线示例').onClick(() => { this.applyModelSettings(true); })
          .enabled(!this.busy && this.runtime !== null)
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor('#E7EDE8')
  }

  @Builder
  private studyPlansPanel() {
    Column({ space: 10 }) {
      Text('全部学习计划').fontSize(20).fontWeight(FontWeight.Medium).width('100%')
      Text('生成的基础安排会保存在这里，可逐项标记完成。').fontSize(13).fontColor('#63736C').width('100%')
      if (this.planError.length > 0) {
        Text(this.planError).fontColor('#A23A30').fontSize(13)
        Button('重新读取').onClick(() => { this.refreshPlans(); }).enabled(!this.busy)
      }
      if (this.plans.length === 0) {
        Column({ space: 12 }) {
          Text('还没有学习计划').fontSize(18)
          Button('生成一份示例计划').enabled(!this.busy).onClick(() => {
            this.view = 'chat'; this.input = '复习高数|3';
          })
        }.layoutWeight(1).justifyContent(FlexAlign.Center)
      } else {
        List({ space: 12 }) {
          ForEach(this.plans, (plan: PlanVersion) => {
            ListItem() {
              Column({ space: 10 }) {
                Text(plan.conditions.goal).fontSize(18).fontWeight(FontWeight.Medium).width('100%')
                Text('已完成 ' + this.completedTasks(plan) + ' / ' + plan.tasks.length)
                  .fontSize(13).fontColor('#63736C').width('100%')
                ForEach(plan.tasks, (task: PlanTask) => {
                  Row({ space: 8 }) {
                    Text('第 ' + task.day + ' 天：' + task.title).fontSize(14).layoutWeight(1)
                      .fontColor(task.status === 'done' ? '#63736C' : '#172A23')
                    Button(task.status === 'done' ? '撤销完成' : '标记完成').fontSize(12)
                      .enabled(!this.busy).onClick(() => { this.toggleTask(plan.id, task); })
                  }.width('100%')
                }, (task: PlanTask) => task.id)
              }.padding(14).width('100%').backgroundColor('#FFFFFF').borderRadius(12)
            }
          }, (plan: PlanVersion) => this.planRenderId(plan))
        }.layoutWeight(1).width('100%')
      }
    }.layoutWeight(1).width('100%')
  }

  build() {
    Column({ space: 12 }) {
      Row() {
        Column({ space: 4 }) {
          Text('学习任务助手').fontSize(25).fontWeight(FontWeight.Bold).fontColor('#172A23')
          Text(this.modeLabel).fontSize(12).fontColor('#63736C')
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        Button(this.showModelSettings ? '收起设置' : '模型设置').fontSize(12).enabled(!this.busy)
          .onClick(() => { this.showModelSettings = !this.showModelSettings; this.modelKey = ''; })
      }.width('100%')
      if (this.showModelSettings) {
        Scroll() { this.modelSettingsPanel() }.layoutWeight(1).width('100%')
      } else {
      Row({ space: 10 }) {
        Button('对话').onClick(() => { this.view = 'chat'; }).enabled(!this.busy)
        Button('学习计划（' + this.plans.length + '）').enabled(!this.busy)
          .onClick(() => { this.view = 'plans'; this.refreshPlans(); })
      }.width('100%')
      if (this.view === 'plans') {
        this.studyPlansPanel()
      } else {
      Row() {
        Text('会话历史').fontSize(14).fontColor('#63736C').layoutWeight(1)
        Button('新会话').fontSize(12).onClick(() => { this.newConversation(); })
          .enabled(!this.busy && this.runtime !== null)
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
        Button(this.speechReady ? '语音输入' : '当前设备语音不可用')
          .enabled(this.speechReady && !this.busy).onClick(() => { this.listen(); })
        if (this.speechState.length > 0) {
          Button('停止语音').onClick(() => { this.stopSpeech(); })
        }
        Button('发送').layoutWeight(1).backgroundColor('#28664B')
          .enabled(!this.busy && this.runtime !== null && this.input.trim().length > 0)
          .onClick(() => { this.submit(); })
      }.width('100%')
      }
      }
    }.padding(20).width('100%').height('100%').backgroundColor('#F3F6F1')
  }
}
