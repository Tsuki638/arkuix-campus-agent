import common from '@ohos.app.ability.common';
import { AgentResult, AgentState, ChatMessage, Conversation, ModelSettings, makeMessage } from '../contracts/Models';
import { AccountModelSettings, ModelPreference, ModelStatus, WorkspaceRuntime } from '../bootstrap/WorkspaceRuntime';
import { createDeviceAccount, createLocalDeviceRuntime } from '../bootstrap/DeviceRuntime';
import { AccountConnection, AccountUser } from '../services/backend/AccountConnection';
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
import { WorkspaceLayout } from './WorkspaceLayout';
import { WorkspaceNavigation } from './WorkspaceNavigation';
import { DeepSeekConfig } from '../services/model/DeepSeekConfig';
import { resolveModelSettings } from '../services/model/ModelPresets';
import { CalendarDraft, CalendarEventInput, CalendarService } from '../contracts/Calendar';
import { createPlatformCalendar } from '../platform/calendar/PlatformCalendarFactory';
import { calendarTimeText, planCalendarInputs } from '../services/calendar/CalendarTime';
import { CalendarPanel } from './CalendarPanel';
import { AccountGate } from './AccountGate';
import { AccountPanel } from './AccountPanel';

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
  @State private compact: boolean = true;
  @State private compactHeight: boolean = false;
  @State private sidebarVisible: boolean = true;
  @State private drawerOpen: boolean = false;
  @State private modelEndpoint: string = DeepSeekConfig.endpoint;
  @State private modelName: string = DeepSeekConfig.model;
  @State private modelKey: string = '';
  @State private useDefaultModel: boolean = true;
  @State private modelError: string = '';
  @State private plans: PlanVersion[] = [];
  @State private planError: string = '';
  @State private calendarDrafts: CalendarDraft[] = [];
  @State private calendarReady: boolean = false;
  @State private calendarUnavailable: string = '';
  @State private calendarError: string = '';
  @State private calendarNotice: string = '';
  @State private accountMode: boolean = false;
  @State private accountOpen: boolean = false;
  @State private accountName: string = '';
  @State private accountError: string = '';
  @State private accountNotice: string = '';
  @State private legacyAvailable: boolean = false;
  private runtime: WorkspaceRuntime | null = null;
  private account: AccountConnection | null = null;
  private defaultModelSettings: ModelSettings = { endpoint: DeepSeekConfig.endpoint, model: DeepSeekConfig.model, apiKey: '' };
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
    else if (this.accountOpen) { this.syncAccount(false); }
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
      const account: AccountConnection | null = await createDeviceAccount(context, speech, calendar, () => {
        this.closeAccount('登录已失效，请重新登录。');
      });
      if (!this.visible) { await speech.stop(); return; }
      this.account = account;
      this.accountMode = account !== null;
      if (account === null) {
        await this.activateWorkspace(createLocalDeviceRuntime(context, speech, calendar));
      } else {
        const user: AccountUser | null = await account.restore();
        if (user !== null) { await this.openAccount(user.username); }
      }
    } catch (error) {
      const message: string = (error as Error).message || '初始化失败，请重新打开应用。';
      if (this.accountMode) { this.accountError = message; }
      else { this.error = message; }
      this.runtime = null;
    } finally { this.busy = false; }
  }

  private async activateWorkspace(runtime: WorkspaceRuntime): Promise<void> {
    const saved: Conversation[] = await runtime.sessions.list();
    const current: Conversation = saved.length > 0 ? saved[0] : await runtime.agent.createConversation();
    if (!this.visible) { return; }
    this.runtime = runtime;
    this.defaultModelSettings = runtime.defaultModelSettings;
    const preference: ModelPreference | undefined = runtime.accountModel?.preference;
    const custom: ModelStatus | null | undefined = preference?.customModel;
    this.useDefaultModel = preference?.mode !== 'custom';
    this.modelEndpoint = custom?.endpoint ?? this.defaultModelSettings.endpoint;
    this.modelName = custom?.model ?? this.defaultModelSettings.model;
    this.calendarReady = runtime.calendar.isAvailable();
    this.calendarUnavailable = runtime.calendar.unavailableReason();
    this.modeLabel = runtime.modeLabel;
    this.speechReady = runtime.speech.isAvailable();
    this.conversations = saved.length > 0 ? saved : [current];
    this.showConversation(current);
    if (!runtime.modelConfigured) { this.view = 'settings'; }
    await this.refreshPlans();
    await this.refreshCalendar();
  }

  private async openAccount(username: string): Promise<void> {
    const account: AccountConnection | null = this.account;
    if (account === null || !this.visible) { return; }
    this.accountName = username;
    await this.activateWorkspace(await account.openWorkspace());
    if (this.runtime === null || !account.isSignedIn() || !this.visible) { return; }
    this.accountOpen = true;
    try { this.legacyAvailable = await account.hasLegacyHistory(); }
    catch (error) {
      if (account.isSignedIn()) { this.accountError = (error as Error).message; }
    }
  }

  private async submitAccount(username: string, password: string, register: boolean): Promise<void> {
    const account: AccountConnection | null = this.account;
    if (account === null || this.busy) { return; }
    this.busy = true;
    this.accountError = '';
    try {
      const user: AccountUser = await account.signIn(username, password, register);
      await this.openAccount(user.username);
    } catch (error) { this.accountError = (error as Error).message || '账号请求失败，请稍后重试。'; }
    finally { this.busy = false; }
  }

  private async retryAccount(): Promise<void> {
    if (this.busy || this.accountName.length === 0) { return; }
    this.busy = true;
    this.accountError = '';
    try { await this.openAccount(this.accountName); }
    catch (error) { this.accountError = (error as Error).message || '学习空间加载失败。'; }
    finally { this.busy = false; }
  }

  private closeAccount(message: string): void {
    if (this.runtime !== null) { this.runtime.speech.stop().catch(() => {}); }
    this.speechRequest += 1;
    this.runtime = null;
    this.accountOpen = false;
    this.accountName = '';
    this.accountError = message;
    this.accountNotice = '';
    this.legacyAvailable = false;
    this.conversations = [];
    this.currentId = '';
    this.messages = [];
    this.input = '';
    this.status = 'idle';
    this.error = '';
    this.plans = [];
    this.planError = '';
    this.calendarDrafts = [];
    this.calendarError = '';
    this.calendarNotice = '';
    this.modelKey = '';
    this.modelError = '';
    this.speechState = '';
    this.view = 'chat';
    this.drawerOpen = false;
  }

  private async signOut(): Promise<void> {
    const account: AccountConnection | null = this.account;
    if (account === null || this.busy) { return; }
    this.accountError = '';
    this.busy = true;
    try {
      await account.signOut();
      this.closeAccount('');
    } catch (error) {
      if (!account.isSignedIn()) { this.closeAccount('已退出此设备。服务器连接失败，远程会话未确认撤销。'); }
      else { this.accountError = (error as Error).message || '退出失败，请重试。'; }
    } finally { this.busy = false; }
  }

  private async updateAccountRecords(): Promise<void> {
    const runtime: WorkspaceRuntime | null = this.runtime;
    if (runtime === null) { return; }
    const saved: Conversation[] = await runtime.sessions.list();
    let current: Conversation | undefined = saved.find((item: Conversation) => item.id === this.currentId);
    if (current === undefined) {
      current = saved.length > 0 ? saved[0] : await runtime.agent.createConversation();
    }
    if (this.runtime !== runtime) { return; }
    this.currentId = current.id;
    this.messages = current.messages.slice();
    this.conversations = saved.length > 0 ? saved : [current];
    await this.refreshPlans();
    await this.refreshCalendar(true);
  }

  private async syncAccount(manual: boolean): Promise<void> {
    if (!this.accountOpen || this.busy) { return; }
    this.busy = true;
    if (manual) { this.accountError = ''; this.accountNotice = ''; }
    try {
      await this.updateAccountRecords();
      if (manual && this.accountOpen) {
        this.accountNotice = this.planError.length === 0 && this.calendarError.length === 0 ?
          '学习记录已同步。' : '对话已同步，部分学习计划或日历记录读取失败。';
      }
    } catch (error) {
      if (this.accountOpen) { this.accountError = (error as Error).message || '同步失败，请稍后重试。'; }
    } finally { this.busy = false; }
  }

  private requestLegacyImport(): void {
    if (!this.legacyAvailable || !this.accountOpen || this.busy) { return; }
    this.getUIContext().showAlertDialog({
      title: '把旧记录导入当前账号？',
      message: '这台设备和原工作区的旧记录将关联到 @' + this.accountName + '，并在登录此账号的设备上可见。',
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: { value: '确认导入', action: () => { this.importLegacyHistory(); } }
    });
  }

  private async importLegacyHistory(): Promise<void> {
    const account: AccountConnection | null = this.account;
    if (account === null || !this.accountOpen || this.busy) { return; }
    this.busy = true;
    this.accountError = '';
    this.accountNotice = '';
    try {
      await account.importLegacyHistory();
      this.legacyAvailable = false;
      await this.updateAccountRecords();
      if (this.accountOpen) { this.accountNotice = '旧记录已导入当前账号。'; }
    } catch (error) {
      if (this.accountOpen) { this.accountError = (error as Error).message || '旧记录导入失败，请重试。'; }
    } finally { this.busy = false; }
  }

  private async applyModelSettings(): Promise<void> {
    const runtime: WorkspaceRuntime | null = this.runtime;
    if (runtime === null || this.busy) { return; }
    this.busy = true;
    try {
      const input: ModelSettings = {
        endpoint: this.modelEndpoint.trim(), model: this.modelName.trim(), apiKey: this.modelKey.trim()
      };
      const accountModel: AccountModelSettings | null = runtime.accountModel;
      if (accountModel === null) {
        runtime.modeLabel = await runtime.configureModel(resolveModelSettings(input, this.defaultModelSettings));
      } else {
        const saved: ModelPreference = await accountModel.save(this.useDefaultModel ? 'default' : 'custom', input);
        accountModel.preference = saved;
        const status: ModelStatus = saved.mode === 'custom' && saved.customModel !== null ?
          saved.customModel : saved.defaultModel;
        runtime.modelConfigured = status.configured;
        runtime.modeLabel = status.configured ? status.model : '未配置密钥';
        if (this.runtime === runtime && saved.customModel !== null) {
          this.modelEndpoint = saved.customModel.endpoint;
          this.modelName = saved.customModel.model;
        }
      }
      if (this.runtime !== runtime) { return; }
      this.modeLabel = runtime.modeLabel;
      this.modelError = '';
      this.modelKey = '';
      this.view = 'chat';
      this.scrollToLatest();
    } catch (error) {
      if (this.runtime === runtime) { this.modelError = (error as Error).message || '模型配置无效，请检查后重试。'; }
    } finally { this.busy = false; }
  }

  private async refreshPlans(): Promise<void> {
    const runtime: WorkspaceRuntime | null = this.runtime;
    if (runtime === null) { return; }
    try {
      const plans: PlanVersion[] = await runtime.study.listPlans();
      if (this.runtime !== runtime) { return; }
      this.plans = plans;
      this.planError = '';
    } catch (error) {
      if (this.runtime === runtime) { this.planError = (error as Error).message || '学习计划读取失败。'; }
    }
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

  private async refreshCalendar(clearError: boolean = false): Promise<void> {
    const runtime: WorkspaceRuntime | null = this.runtime;
    if (runtime === null) { return; }
    try {
      const drafts: CalendarDraft[] = await runtime.calendar.list();
      if (this.runtime === runtime) {
        this.calendarDrafts = drafts;
        if (clearError) { this.calendarError = ''; }
      }
    } catch (error) {
      if (this.runtime === runtime) { this.calendarError = (error as Error).message || '日程记录读取失败。'; }
    }
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
    const conversation: Conversation | null = await this.runtime.recordCalendarResult(draft);
    if (conversation === null) { return; }
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
    this.status = 'idle';
    this.error = '';
    this.view = 'chat';
    this.drawerOpen = false;
    this.scrollToLatest();
  }

  private async newConversation(): Promise<void> {
    if (this.runtime === null || this.busy) { return; }
    if (this.currentId.length > 0 && this.messages.length === 0) { this.navigate('chat'); return; }
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
      message: '此操作会删除当前对话记录，已保存的学习计划会继续保留。',
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: { value: '删除对话', fontColor: T.danger, action: () => { this.deleteCurrent(); } }
    });
  }

  private title(): string {
    if (this.view === 'account') { return '账号与同步'; }
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
      busy: this.busy, ready: this.runtime !== null, planCount: this.plans.length, activeModel: this.modeLabel,
      accountName: this.accountName,
      compactHeight: this.compactHeight,
      onNew: () => { this.newConversation(); },
      onSelect: (id: string) => { this.selectConversation(id); },
      onNavigate: (destination: string) => { this.navigate(destination); },
      onClose: () => {
        if (this.wide) { this.sidebarVisible = false; } else { this.drawerOpen = false; }
      }
    })
  }

  @Builder
  private conversationMenu() {
    Menu() {
      if (!this.wide || !this.sidebarVisible) {
        MenuItem({ content: '新建对话' }).onClick(() => { this.newConversation(); })
      }
      MenuItem({ content: '删除当前对话' }).contentFontColor(T.danger).onClick(() => { this.requestDelete(); })
    }
  }

  @Builder
  private workspaceHeader() {
    Row({ space: 10 }) {
      if (this.view !== 'chat') {
        Button({ type: ButtonType.Normal }) {
          WorkspaceIcon({ name: 'back', iconSize: 21, color: T.ink })
        }.width(44).height(44).padding(0).borderRadius(9).backgroundColor(Color.Transparent)
          .accessibilityText('返回对话').onClick(() => { this.navigate('chat'); })
      } else if (!this.wide || !this.sidebarVisible) {
        Button({ type: ButtonType.Normal }) {
          WorkspaceIcon({ name: 'sidebar', iconSize: 21, color: T.ink })
        }.width(44).height(44).padding(0).borderRadius(9).backgroundColor(Color.Transparent)
          .accessibilityText('打开导航与会话历史').onClick(() => {
            if (this.wide) { this.sidebarVisible = true; } else { this.drawerOpen = true; }
          })
      }
      Text(this.title()).fontSize(15).fontWeight(FontWeight.Medium).fontColor(T.ink)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
      if (this.view === 'chat') {
        Text(this.modeLabel).fontSize(12).fontColor(T.secondary).constraintSize({ maxWidth: '40%' })
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        if (this.messages.length > 0) {
          Button({ type: ButtonType.Normal }) {
            WorkspaceIcon({ name: 'more', iconSize: 21 })
          }.width(44).height(44).padding(0).backgroundColor(Color.Transparent).borderRadius(9)
            .accessibilityText('对话菜单').enabled(!this.busy && this.runtime !== null)
            .bindMenu(this.conversationMenu)
        }
      }
    }.height(this.compactHeight ? 56 : (this.compact ? 58 : 64)).width('100%')
      .padding({ left: this.wide ? 28 : 10, right: this.wide ? 24 : 12 })
      .border({ width: { bottom: 1 }, color: T.border })
  }

  @Builder
  private chatPanel() {
    Column({ space: 0 }) {
      if (this.messages.length === 0) {
        Scroll() {
          Column() {
            WelcomePanel({
              wide: !this.compact, compactHeight: this.compactHeight,
              available: !this.busy && this.runtime !== null,
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
            }.padding({ left: WorkspaceLayout.scrollbarGutter, right: WorkspaceLayout.scrollbarGutter })
          }, (message: ChatMessage) => message.id)
        }.layoutWeight(1).width(`calc(100% + ${WorkspaceLayout.scrollbarGutter * 2}vp)`)
          .padding({ top: 22, bottom: 20 }).scrollBar(BarState.Auto).id('workspace-message-list')
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
        input: $input, busy: this.busy, ready: this.runtime !== null,
        compactHeight: this.compactHeight,
        speechReady: this.speechReady, speechActive: this.speechState.length > 0,
        onSubmit: () => { this.submit(); }, onListen: () => { this.listen(); },
        onStopSpeech: () => { this.stopSpeech(); }
      })
    }.width('100%').height('100%').constraintSize({ maxWidth: WorkspaceLayout.chatWidth }).padding({ bottom: 12 })
  }

  build() {
    Stack({ alignContent: Alignment.Start }) {
      if (this.accountMode && !this.accountOpen) {
        AccountGate({
          busy: this.busy, error: this.accountError, signedInUser: this.accountName,
          onSubmit: (username: string, password: string, register: boolean) => {
            this.submitAccount(username, password, register);
          },
          onRetry: () => { this.retryAccount(); }, onSignOut: () => { this.signOut(); },
          onSwitch: () => { this.accountError = ''; }
        })
      } else {
        Row({ space: 0 }) {
          if (this.wide && this.sidebarVisible) {
            Column() { this.sidebar() }.width(WorkspaceLayout.sidebarWidth).height('100%')
          }
          Column({ space: 0 }) {
            this.workspaceHeader()
            Column() {
              if (this.view === 'account') {
                AccountPanel({ username: this.accountName, busy: this.busy, legacyAvailable: this.legacyAvailable,
                  error: this.accountError, notice: this.accountNotice,
                  onSync: () => { this.syncAccount(true); }, onImport: () => { this.requestLegacyImport(); },
                  onSignOut: () => { this.signOut(); } })
              } else if (this.view === 'settings') {
                ModelSettingsPanel({
                  endpoint: $modelEndpoint, model: $modelName, apiKey: $modelKey, useDefault: $useDefaultModel,
                  error: this.modelError, busy: this.busy, ready: this.runtime !== null, activeModel: this.modeLabel,
                  showAccountModels: this.runtime?.accountModel !== null && this.runtime !== null,
                  defaultModelName: this.runtime?.accountModel?.preference.defaultModel.model ?? '',
                  serverDefaultConfigured: this.runtime?.accountModel?.preference.defaultModel.configured ?? false,
                  activeSource: this.runtime?.accountModel?.preference.mode ?? '',
                  savedKeyAvailable: (this.runtime?.accountModel?.preference.customModel?.configured ?? false) &&
                    this.modelEndpoint.trim() === this.runtime?.accountModel?.preference.customModel?.endpoint,
                  defaultKeyAvailable: this.runtime?.accountModel === null && this.runtime.modelConfigured &&
                    this.modelEndpoint === this.defaultModelSettings.endpoint,
                  onApply: () => { this.applyModelSettings(); }
                })
              } else if (this.view === 'calendar') {
                CalendarPanel({ drafts: this.calendarDrafts, busy: this.busy, available: this.calendarReady,
                  unavailableMessage: this.calendarUnavailable, error: this.calendarError, notice: this.calendarNotice,
                  onConfirm: (draft: CalendarDraft) => { this.confirmCalendar(draft); },
                  onCancel: (draft: CalendarDraft) => { this.cancelCalendar(draft); },
                  onEdit: (draft: CalendarDraft, eventId: string, input: CalendarEventInput) => {
                    return this.editCalendar(draft, eventId, input);
                  },
                  onRefresh: () => { this.calendarError = ''; this.refreshCalendar(); },
                  onCreate: () => { this.usePrompt(this.calendarPrompt()); } })
              } else if (this.view === 'plans') {
                StudyPlansPanel({
                  plans: this.plans, error: this.planError, busy: this.busy, ready: this.runtime !== null,
                  onToggle: (planId: string, task: PlanTask) => { this.toggleTask(planId, task); },
                  onRefresh: () => { this.refreshPlans(); },
                  onSchedule: (plan: PlanVersion) => { this.schedulePlan(plan); },
                  onCreate: () => { this.usePrompt('请帮我制定学习计划，先了解我的目标和可用时间。'); }
                })
              } else {
                this.chatPanel()
              }
            }.layoutWeight(1).width('100%').padding({
              left: this.wide ? 32 : (this.compact ? 16 : 24),
              right: this.wide ? 32 : (this.compact ? 16 : 24)
            })
          }.layoutWeight(1).height('100%')
        }.width('100%').height('100%')
        if (!this.wide && this.drawerOpen) {
          Row({ space: 0 }) {
            Column() { this.sidebar() }.width('84%').constraintSize({ maxWidth: 312 }).height('100%')
            Blank().layoutWeight(1).height('100%').accessibilityText('关闭导航')
              .onClick(() => { this.drawerOpen = false; })
          }.width('100%').height('100%').backgroundColor('#66000000')
        }
      }
    }.width('100%').height('100%').backgroundColor(T.canvas)
      .onAreaChange((oldArea: Area, newArea: Area) => {
        const wide: boolean = Number(newArea.width) >= WorkspaceLayout.expandedWidth;
        const compact: boolean = Number(newArea.width) < WorkspaceLayout.mediumWidth;
        const compactHeight: boolean = Number(newArea.height) < WorkspaceLayout.compactHeight;
        if (compact !== this.compact) { this.compact = compact; }
        if (compactHeight !== this.compactHeight) { this.compactHeight = compactHeight; }
        if (wide !== this.wide) { this.wide = wide; this.drawerOpen = false; }
      })
      .onKeyEvent((event: KeyEvent) => {
        if (event.type === KeyType.Down && event.keyCode === 2070) { return this.handleBack(); }
        return false;
      })
  }
}
