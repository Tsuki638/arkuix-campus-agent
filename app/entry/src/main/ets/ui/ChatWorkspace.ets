import common from '@ohos.app.ability.common';
import { AgentResult, AgentState, ChatMessage, Conversation, ModelSettings, makeMessage } from '../contracts/Models';
import { AppRuntime } from '../bootstrap/Runtime';
import { configureDeviceModel, createDeviceRuntime } from '../bootstrap/DeviceRuntime';
import { PlanTask, PlanVersion } from '../services/storage/StudyDataRepository';
import { createPlatformSpeech } from '../platform/speech/PlatformSpeechFactory';
import { MessageBubble } from './MessageBubble';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { WorkspaceIcon } from './WorkspaceIcon';
import { WelcomePanel } from './WelcomePanel';
import { ChatComposer } from './ChatComposer';
import { StudyPlansPanel } from './StudyPlansPanel';
import { ModelSettingsPanel } from './ModelSettingsPanel';
import { WorkspaceTheme as T } from './WorkspaceTheme';
import { WorkspaceNavigation } from './WorkspaceNavigation';
import { CalendarDraft, CalendarEventInput, CalendarService } from '../contracts/Calendar';
import { createPlatformCalendar } from '../platform/calendar/PlatformCalendarFactory';
import { calendarTimeText, planCalendarInputs } from '../services/calendar/CalendarTime';
import { CalendarPanel } from './CalendarPanel';
import { CalendarPreview, LearningPlan, LearningTask } from '../contracts/LearningModels';

@Component
export struct ChatWorkspace {
  @Prop @Watch('foregroundChanged') foreground: boolean = true;
  navigation: WorkspaceNavigation = new WorkspaceNavigation();
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
  @State private wide: boolean = false;
  @State private sidebarVisible: boolean = true;
  @State private drawerOpen: boolean = false;
  @State private modelEndpoint: string = '';
  @State private modelName: string = '';
  @State private modelKey: string = '';
  @State private modelError: string = '';
  @State private plans: PlanVersion[] = [];
  @State private learningPlan: LearningPlan | null = null;
  @State private learningPreview: CalendarPreview | null = null;
  @State private planError: string = '';
  @State private calendarDrafts: CalendarDraft[] = [];
  @State private calendarReady: boolean = false;
  @State private calendarUnavailable: string = '';
  @State private calendarError: string = '';
  @State private calendarNotice: string = '';
  private runtime: AppRuntime | null = null;
  private scroller: Scroller = new Scroller();
  private visible: boolean = false;
  private speechRequest: number = 0;
  private scrollTimer: number = -1;

  aboutToAppear(): void {
    this.visible = true;
    this.navigation.handleBack = () => { return this.handleBack(); };
    this.initialize();
  }

  private foregroundChanged(): void {
    if (!this.foreground) { this.stopSpeech(); }
  }

  aboutToDisappear(): void {
    this.visible = false;
    this.navigation.handleBack = () => false;
    this.speechRequest += 1;
    if (this.scrollTimer >= 0) { clearTimeout(this.scrollTimer); }
    if (this.runtime !== null) { this.runtime.speech.stop().catch(() => {}); }
  }

  private async initialize(): Promise<void> {
    try {
      const context: common.Context = this.getUIContext().getHostContext() as common.Context;
      const speech = await createPlatformSpeech(context);
      const calendar: CalendarService = await createPlatformCalendar(context);
      if (!this.visible) { await speech.stop(); return; }
      // 先用离线模型启动；设置入口可在运行时接通 C 的真实模型适配器。
      this.runtime = createDeviceRuntime(context, undefined, speech, calendar);
      this.calendarReady = this.runtime.calendar.isAvailable();
      this.calendarUnavailable = this.runtime.calendar.unavailableReason();
      this.modeLabel = this.runtime.modeLabel;
      this.speechReady = this.runtime.speech.isAvailable();
      this.conversations = await this.runtime.sessions.list();
      const current: Conversation = this.conversations.length > 0 ? this.conversations[0] :
        await this.runtime.agent.createConversation();
      this.showConversation(current);
      await this.refreshPlans();
      await this.refreshCalendar();
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
      this.view = 'chat';
      this.scrollToLatest();
    } catch (error) {
      this.modelError = (error as Error).message || '模型配置无效，请检查后重试。';
    }
  }

  private async refreshPlans(): Promise<void> {
    if (this.runtime === null) { return; }
    try {
      this.plans = await this.runtime.study.listPlans();
      this.learningPlan = this.currentId.length === 0 ? null : (await this.runtime.learning.getState(this.currentId)).plan;
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

  private async toggleLearningTask(task: LearningTask): Promise<void> {
    if (this.runtime === null || this.busy) { return; }
    this.busy = true;
    try {
      await this.runtime.learning.recordProgress(this.currentId, task.id, task.status === 'done' ? 'pending' : 'done');
      await this.refreshPlans();
    } catch (error) { this.planError = (error as Error).message || '任务更新失败，请重试。'; }
    finally { this.busy = false; }
  }

  private async refreshCalendar(): Promise<void> {
    if (this.runtime === null) { return; }
    try {
      this.calendarDrafts = await this.runtime.calendar.list();
      this.learningPreview = this.currentId.length === 0 ? null : (await this.runtime.learning.getState(this.currentId)).preview;
    }
    catch (error) { this.calendarError = (error as Error).message || '日程记录读取失败。'; }
  }

  private async resolveLearningPreview(preview: CalendarPreview, cancel: boolean): Promise<void> {
    if (this.runtime === null || this.busy || !this.foreground) { return; }
    this.busy = true;
    this.calendarError = '';
    this.calendarNotice = '';
    try {
      if (cancel) {
        await this.runtime.learning.cancelCalendar(this.currentId, preview.id);
        this.calendarNotice = '已取消后续操作，之前已确认成功的日程继续保留。';
      } else {
        const result: CalendarPreview = await this.runtime.learning.confirmCalendar(this.currentId, preview.id);
        this.calendarNotice = result.results.length > 0 && result.results.every((item) => item.status === 'succeeded')
          ? '系统日历已确认全部操作。' : '部分操作待处理，请核对逐项结果。';
      }
    } catch (error) { this.calendarError = (error as Error).message || '日历操作未完成。'; }
    finally { await this.refreshCalendar(); this.busy = false; }
  }

  private async openLearningSchedule(): Promise<void> {
    if (this.runtime === null || this.busy) { return; }
    this.busy = true;
    this.view = 'calendar';
    this.calendarError = '';
    this.calendarNotice = '';
    try {
      const state = await this.runtime.learning.getState(this.currentId);
      if (state.preview === null) { await this.runtime.learning.previewCalendar(this.currentId); }
    } catch (error) { this.calendarError = (error as Error).message || '日程预览准备失败。'; }
    finally { await this.refreshCalendar(); this.busy = false; }
  }

  private async schedulePlan(plan: PlanVersion): Promise<void> {
    if (this.runtime === null || this.busy) { return; }
    this.busy = true; this.calendarError = ''; this.calendarNotice = '';
    this.view = 'calendar';
    try {
      const existing: CalendarDraft | undefined = (await this.runtime.calendar.list()).find((draft: CalendarDraft) =>
        draft.planId === plan.id && draft.status !== 'cancelled');
      if (existing !== undefined) { this.calendarNotice = '这份计划已有日程记录，请在下方查看。'; }
      else {
        await this.runtime.calendar.prepare(this.currentId, plan.id, planCalendarInputs(plan, Date.now()));
        this.calendarNotice = '已按明天起每日 19:00–20:00 准备草案，提前 10 分钟提醒。请逐项检查或修改后确认。';
      }
    } catch (error) { this.calendarError = (error as Error).message || '日程草案准备失败。'; }
    finally { await this.refreshCalendar(); this.busy = false; }
  }

  private async recordCalendarResult(draft: CalendarDraft): Promise<void> {
    if (this.runtime === null) { return; }
    const conversation: Conversation | null = await this.runtime.sessions.get(draft.conversationId);
    if (conversation === null) { return; }
    // 来自应用执行的确定结果进入历史，后续模型上下文可直接读取；不伪造模型工具调用。
    conversation.messages.push(makeMessage('assistant', '【应用执行结果】\n' + this.runtime.calendar.summary(draft)));
    conversation.updatedAt = Date.now();
    await this.runtime.sessions.save(conversation);
    if (this.currentId === conversation.id) { this.messages = conversation.messages.slice(); }
    this.conversations = await this.runtime.sessions.list();
  }

  private async confirmCalendar(draft: CalendarDraft): Promise<void> {
    if (this.runtime === null || this.busy || !this.foreground) { return; }
    this.busy = true; this.calendarError = ''; this.calendarNotice = '';
    try {
      const result: CalendarDraft = await this.runtime.calendar.confirm(draft.id, draft.revision);
      this.calendarNotice = result.status === 'completed' ? '日程已添加，请在系统日历的「学习计划」账户中查看。' :
        '部分日程未确认成功，请查看逐项结果后查询重试。';
      await this.recordCalendarResult(result);
    } catch (error) { this.calendarError = (error as Error).message || '日历操作未完成，记录已保留，请刷新后查看。'; }
    finally { await this.refreshCalendar(); this.busy = false; }
  }

  private async cancelCalendar(draft: CalendarDraft): Promise<void> {
    if (this.runtime === null || this.busy) { return; }
    this.busy = true; this.calendarError = ''; this.calendarNotice = '';
    try {
      const result: CalendarDraft = await this.runtime.calendar.cancel(draft.id, draft.revision);
      await this.recordCalendarResult(result);
      this.calendarNotice = '草案后续执行已取消，已创建的系统日程继续保留。';
    } catch (error) { this.calendarError = (error as Error).message || '取消未完成。'; }
    finally { await this.refreshCalendar(); this.busy = false; }
  }

  private async editCalendar(draft: CalendarDraft, eventId: string, input: CalendarEventInput): Promise<boolean> {
    if (this.runtime === null || this.busy) { return false; }
    this.busy = true; this.calendarError = ''; this.calendarNotice = '';
    try {
      await this.runtime.calendar.edit(draft.id, draft.revision, eventId, input);
      return true;
    } catch (error) { this.calendarError = (error as Error).message || '修改未保存。'; return false; }
    finally { await this.refreshCalendar(); this.busy = false; }
  }

  private calendarPrompt(): string {
    const date: string = calendarTimeText(Date.now() + 24 * 60 * 60 * 1000).slice(0, 10);
    return '请准备 ' + date + ' 北京时间 19:00 到 20:00 的高数复习日程，提前 10 分钟提醒，先给我预览。';
  }

  private showConversation(conversation: Conversation): void {
    this.currentId = conversation.id;
    this.messages = conversation.messages.slice();
    this.learningPlan = null;
    this.learningPreview = null;
    this.status = 'idle';
    this.error = '';
    this.view = 'chat';
    this.drawerOpen = false;
    this.scrollToLatest();
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
    this.scrollToLatest();
    try {
      const result: AgentResult = await this.runtime.agent.send(this.currentId, text,
        (state: AgentState) => { this.status = state; });
      this.messages = result.conversation.messages.slice();
      this.input = '';
      this.error = result.error;
      this.conversations = await this.runtime.sessions.list();
      await this.refreshPlans();
      await this.refreshCalendar();
      if (readAloud && result.state === 'completed' && this.visible && speechRequest === this.speechRequest) {
        this.speechState = '正在播报回复';
        try { await this.runtime.speech.speak(result.reply); }
        catch (error) {
          if (speechRequest === this.speechRequest) {
            this.error = '回复已生成。' + (error as Error).message;
          }
        } finally { if (speechRequest === this.speechRequest) { this.speechState = ''; } }
      }
      this.scrollToLatest();
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

  private offline(): boolean { return this.modeLabel.indexOf('云端') < 0; }

  private handleBack(): boolean {
    if (this.drawerOpen) { this.drawerOpen = false; return true; }
    if (this.view !== 'chat') { this.navigate('chat'); return true; }
    return false;
  }

  private scrollToLatest(): void {
    if (this.scrollTimer >= 0) { clearTimeout(this.scrollTimer); }
    // 等待声明式列表提交后滚动，包含新消息和切换历史两种情况。
    this.scrollTimer = setTimeout(() => {
      this.scrollTimer = -1;
      if (this.visible && this.view === 'chat' && this.messages.length > 0) {
        this.scroller.scrollEdge(Edge.Bottom);
      }
    }, 100);
  }

  private navigate(destination: string): void {
    this.modelKey = '';
    this.modelError = '';
    this.view = destination;
    this.drawerOpen = false;
    if (destination === 'plans') { this.refreshPlans(); }
    if (destination === 'calendar') { this.calendarError = ''; this.calendarNotice = ''; this.refreshCalendar(); }
    if (destination === 'chat') { this.scrollToLatest(); }
  }

  private usePrompt(text: string): void {
    if (this.busy || this.runtime === null) { return; }
    this.view = 'chat';
    this.drawerOpen = false;
    this.input = text;
  }

  private requestDelete(): void {
    if (this.runtime === null || this.busy || this.currentId.length === 0) { return; }
    this.getUIContext().showAlertDialog({
      title: '删除这段对话？',
      message: '当前对话及其阶段计划将删除。基础计划和已写入的系统日程会保留。',
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: { value: '删除对话', fontColor: T.danger, action: () => { this.deleteCurrent(); } }
    });
  }

  private title(): string {
    if (this.view === 'settings') { return '模型设置'; }
    if (this.view === 'plans') { return '学习计划'; }
    if (this.view === 'calendar') { return '日程预览'; }
    const current: Conversation | undefined = this.conversations.find((item: Conversation) => item.id === this.currentId);
    if (current === undefined || current.messages.length === 0) { return '新对话'; }
    return current.title;
  }

  private statusLabel(): string {
    if (this.speechState.length > 0) { return this.speechState; }
    if (this.runtime === null && this.busy) { return '正在准备你的学习空间…'; }
    if (this.status === 'using_tool') { return '正在执行工具…'; }
    if (this.busy) { return '正在整理思路…'; }
    if (this.status === 'failed') { return '本轮未完成，可以补充信息后继续'; }
    return '';
  }

  @Builder
  private sidebar() {
    WorkspaceSidebar({
      conversations: this.conversations, currentId: this.currentId, activeView: this.view,
      busy: this.busy, ready: this.runtime !== null, planCount: this.plans.length, offline: this.offline(),
      onNew: () => { this.newConversation(); },
      onSelect: (id: string) => { this.selectConversation(id); },
      onNavigate: (destination: string) => { this.navigate(destination); },
      onClose: () => {
        if (this.wide) { this.sidebarVisible = false; } else { this.drawerOpen = false; }
      }
    })
  }

  @Builder
  private workspaceHeader() {
    Row({ space: 10 }) {
      if (!this.wide || !this.sidebarVisible) {
        Button({ type: ButtonType.Normal }) {
          WorkspaceIcon({ name: 'sidebar', iconSize: 21, color: T.ink })
        }.width(40).height(40).padding(0).borderRadius(9).backgroundColor(Color.Transparent)
          .accessibilityText('打开导航与会话历史').onClick(() => {
            if (this.wide) { this.sidebarVisible = true; } else { this.drawerOpen = true; }
          })
      }
      Column({ space: 3 }) {
        if (this.wide) {
          Text('我的学习空间 /').fontSize(10).fontColor(T.muted)
        }
        Text(this.title()).fontSize(14).fontWeight(FontWeight.Medium).fontColor(T.ink)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      if (this.view === 'chat') {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 6 }) {
            Circle().width(5).height(5).fill(this.offline() ? T.muted : T.accent)
            Text(this.offline() ? '离线示例' : '云端模型').fontSize(10).fontColor(T.secondary)
            WorkspaceIcon({ name: 'chevron', iconSize: 12, color: T.muted })
          }
        }.height(31).padding({ left: 9, right: 9 }).backgroundColor(T.sidebar).borderRadius(7)
          .enabled(!this.busy).onClick(() => { this.navigate('settings'); })
        Button({ type: ButtonType.Normal }) {
          WorkspaceIcon({ name: 'plus', iconSize: 21 })
        }.width(36).height(40).padding(0).backgroundColor(Color.Transparent).borderRadius(8)
          .accessibilityText('新建对话').enabled(!this.busy && this.runtime !== null)
          .onClick(() => { this.newConversation(); })
        if (this.messages.length > 0) {
          Button({ type: ButtonType.Normal }) {
            WorkspaceIcon({ name: 'trash', iconSize: 18 })
          }.width(32).height(40).padding(0).backgroundColor(Color.Transparent).borderRadius(8)
            .accessibilityText('删除当前对话').enabled(!this.busy && this.runtime !== null)
            .onClick(() => { this.requestDelete(); })
        }
      } else {
        Button('返回对话', { type: ButtonType.Normal }).height(34).padding({ left: 11, right: 11 })
          .fontSize(11).fontColor(T.secondary).backgroundColor(T.sidebar).borderRadius(8)
          .onClick(() => { this.navigate('chat'); })
      }
    }.height(this.wide ? 68 : 58).width('100%').padding({ left: this.wide ? 28 : 10, right: this.wide ? 24 : 12 })
      .border({ width: { bottom: 1 }, color: T.border })
  }

  @Builder
  private chatPanel() {
    Column({ space: 0 }) {
      if (this.messages.length === 0) {
        Scroll() {
          Column() {
            WelcomePanel({
              wide: this.wide, offline: this.offline(), available: !this.busy && this.runtime !== null,
              onPrompt: (text: string) => { this.usePrompt(text); }
            })
          }.width('100%').constraintSize({ minHeight: '100%' }).justifyContent(FlexAlign.Center)
        }.layoutWeight(1).width('100%').scrollBar(BarState.Off).align(Alignment.Center)
      } else {
        List({ space: 14, scroller: this.scroller }) {
          ForEach(this.messages, (message: ChatMessage) => {
            ListItem() {
              MessageBubble({ message: message, onOpenPlans: () => { this.navigate('plans'); },
                onOpenCalendar: () => { this.navigate('calendar'); } })
            }
          }, (message: ChatMessage) => message.id)
        }.layoutWeight(1).width('100%').padding({ top: 22, bottom: 20 }).scrollBar(BarState.Auto)
      }
      if (this.statusLabel().length > 0) {
        Row({ space: 8 }) {
          if (this.busy) { LoadingProgress().width(16).height(16).color(T.secondary) }
          Text(this.statusLabel()).fontSize(11).fontColor(T.secondary).layoutWeight(1).lineHeight(19)
        }.width('100%').padding({ top: 7, bottom: 10 })
      }
      if (this.error.length > 0) {
        Column({ space: 8 }) {
          Text(this.error).fontSize(12).fontColor(T.danger).width('100%').lineHeight(20)
          if (this.runtime === null && !this.busy) {
            Button('重新加载', { type: ButtonType.Normal }).height(34).fontSize(12).fontColor(T.danger)
              .backgroundColor(T.dangerSoft).borderRadius(8).onClick(() => {
                this.busy = true; this.error = ''; this.initialize();
              })
          }
        }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor(T.dangerSoft)
          .borderRadius(10).margin({ bottom: 10 })
      }
      ChatComposer({
        input: $input, busy: this.busy, ready: this.runtime !== null, offline: this.offline(),
        speechReady: this.speechReady, speechActive: this.speechState.length > 0,
        onSubmit: () => { this.submit(); }, onListen: () => { this.listen(); },
        onStopSpeech: () => { this.stopSpeech(); }, onSettings: () => { this.navigate('settings'); }
      })
    }.width('100%').height('100%').constraintSize({ maxWidth: 800 }).padding({ bottom: 12 })
  }

  build() {
    Stack({ alignContent: Alignment.Start }) {
      Row({ space: 0 }) {
        if (this.wide && this.sidebarVisible) {
          Column() { this.sidebar() }.width(264).height('100%')
        }
        Column({ space: 0 }) {
          this.workspaceHeader()
          Column() {
            if (this.view === 'settings') {
              ModelSettingsPanel({
                endpoint: $modelEndpoint, model: $modelName, apiKey: $modelKey,
                error: this.modelError, busy: this.busy, ready: this.runtime !== null, offline: this.offline(),
                onApply: (offline: boolean) => { this.applyModelSettings(offline); }
              })
            } else if (this.view === 'calendar') {
              CalendarPanel({ drafts: this.calendarDrafts, learningPreview: this.learningPreview,
                busy: this.busy, available: this.calendarReady,
                unavailableMessage: this.calendarUnavailable, error: this.calendarError, notice: this.calendarNotice,
                onConfirm: (draft: CalendarDraft) => { this.confirmCalendar(draft); },
                onCancel: (draft: CalendarDraft) => { this.cancelCalendar(draft); },
                onResolveLearning: (preview: CalendarPreview, cancel: boolean) => { this.resolveLearningPreview(preview, cancel); },
                onEdit: (draft: CalendarDraft, eventId: string, input: CalendarEventInput) => {
                  return this.editCalendar(draft, eventId, input);
                },
                onRefresh: () => { this.calendarError = ''; this.refreshCalendar(); },
                onCreate: () => { this.usePrompt(this.calendarPrompt()); } })
            } else if (this.view === 'plans') {
              StudyPlansPanel({
                learningPlan: this.learningPlan,
                onToggleLearning: (task: LearningTask) => { this.toggleLearningTask(task); },
                onOpenSchedule: () => { this.openLearningSchedule(); },
                plans: this.plans, error: this.planError, busy: this.busy, ready: this.runtime !== null,
                onToggle: (planId: string, task: PlanTask) => { this.toggleTask(planId, task); },
                onRefresh: () => { this.refreshPlans(); },
                onSchedule: (plan: PlanVersion) => { this.schedulePlan(plan); },
                onCreate: () => { this.usePrompt(this.offline() ? '复习高数|3' : '请帮我制定学习计划，先了解我的目标和可用时间。'); }
              })
            } else {
              this.chatPanel()
            }
          }.layoutWeight(1).width('100%').padding({ left: this.wide ? 32 : 18, right: this.wide ? 32 : 18 })
        }.layoutWeight(1).height('100%')
      }.width('100%').height('100%')
      if (!this.wide && this.drawerOpen) {
        Row({ space: 0 }) {
          Column() { this.sidebar() }.width('84%').constraintSize({ maxWidth: 312 }).height('100%')
          Blank().layoutWeight(1).height('100%').accessibilityText('关闭导航')
            .onClick(() => { this.drawerOpen = false; })
        }.width('100%').height('100%').backgroundColor('#66000000')
      }
    }.width('100%').height('100%').backgroundColor(T.canvas)
      .onAreaChange((oldArea: Area, newArea: Area) => {
        const wide: boolean = Number(newArea.width) >= 900;
        if (wide !== this.wide) { this.wide = wide; this.drawerOpen = false; }
      })
      .onKeyEvent((event: KeyEvent) => {
        if (event.type === KeyType.Down && event.keyCode === 2070) { return this.handleBack(); }
        return false;
      })
  }
}
