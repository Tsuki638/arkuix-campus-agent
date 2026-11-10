import type { CalendarPort, CalendarReadResult, CalendarReceipt, LearningRepository } from '../../contracts/LearningPorts';
import type { CalendarItemResult, CalendarLink, CalendarOperation, CalendarPreview, LearnerProfile, LearningPlan, LearningState,
  ScheduledBlock, TimeWindow } from '../../contracts/LearningModels';
import { newId } from '../../contracts/Models';
import { buildLearningTasks, missingProfileFields, recommendPaths } from './LearningCatalog';
import { scheduleLearningTasks, validateTimestamp } from './LearningScheduler';

const WEEK: number = 7 * 24 * 60 * 60 * 1000;

export class LearningPlanner {
  private repository: LearningRepository;
  private calendar: CalendarPort;
  private now: () => number;
  private exists?: (id: string) => Promise<boolean>;
  private busy: Set<string> = new Set<string>();

  constructor(repository: LearningRepository, calendar: CalendarPort, now: () => number = Date.now,
    exists?: (id: string) => Promise<boolean>) {
    this.repository = repository;
    this.calendar = calendar;
    this.now = now;
    this.exists = exists;
  }

  async getState(conversationId: string): Promise<LearningState> {
    return await this.repository.load(conversationId) || {
      schemaVersion: 1, conversationId: conversationId, revision: 0,
      profile: { track: '', major: '', grade: '', background: '', interests: '', goal: '', weeks: 0, minutesPerWeek: 0 },
      candidates: [], selectedPathId: '', plan: null, preview: null, calendarLinks: []
    };
  }

  async interview(id: string, patch: Partial<LearnerProfile>): Promise<{ state: LearningState; missing: string[] }> {
    return this.change(id, async (state) => {
      const allowed = ['track', 'major', 'grade', 'background', 'interests', 'goal', 'weeks', 'minutesPerWeek'];
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch) ||
        Object.keys(patch).some((key) => !allowed.includes(key))) { throw new Error('INVALID_PROFILE: 存在未知的访谈字段。'); }
      const profile: LearnerProfile = { ...state.profile, ...patch };
      if (![profile.track, profile.major, profile.grade, profile.background, profile.interests, profile.goal]
        .every((value) => typeof value === 'string' && Array.from(value).length <= 500) ||
        !['', 'employment', 'postgraduate'].includes(profile.track) ||
        !Number.isInteger(profile.weeks) || (profile.weeks !== 0 && (profile.weeks < 2 || profile.weeks > 4)) ||
        !Number.isInteger(profile.minutesPerWeek) || (profile.minutesPerWeek !== 0 &&
          (profile.minutesPerWeek < 30 || profile.minutesPerWeek > 10080))) {
        throw new Error('INVALID_PROFILE: 请选择考研或就业；计划 2–4 周，每周可用时间为 30–10080 整数分钟。');
      }
      state.profile = profile;
      state.candidates = recommendPaths(profile);
      if (!state.candidates.some((path) => path.id === state.selectedPathId)) {
        state.selectedPathId = '';
        state.plan = null;
      }
      this.touch(state);
      await this.repository.save(state);
      return { state: state, missing: missingProfileFields(profile) };
    });
  }

  async selectPath(id: string, pathId: string): Promise<LearningState> {
    return this.change(id, async (state) => {
      if (!state.candidates.some((path) => path.id === pathId)) { throw new Error('INVALID_PATH: 请先完成访谈并选择已展示的候选路径。'); }
      if (pathId !== state.selectedPathId) { state.plan = null; }
      state.selectedPathId = pathId;
      this.touch(state);
      await this.repository.save(state);
      return state;
    });
  }

  async createPlan(id: string, startAt: string): Promise<LearningState> {
    return this.change(id, async (state) => {
      if (state.selectedPathId === '') { throw new Error('PATH_NOT_SELECTED: 请先由用户选择学习路径。'); }
      validateTimestamp(startAt);
      const tasks = buildLearningTasks(state.profile, state.selectedPathId);
      // 稳定任务身份保留实际进度与原估时，不因模板重建覆盖用户反馈。
      const previous = state.plan;
      if (previous !== null && previous.pathId === state.selectedPathId) {
        for (const task of tasks) {
          const old = previous.tasks.find((item) => item.id === task.id);
          if (old !== undefined) {
            task.status = old.status;
            task.remainingMinutes = old.remainingMinutes;
            task.estimatedMinutes = old.estimatedMinutes;
            task.dueAt = old.dueAt;
            task.dependsOn = old.dependsOn.slice();
          }
        }
        for (const old of previous.tasks) {
          if (old.status === 'done' && !tasks.some((task) => task.id === old.id)) { tasks.push(old); }
        }
      }
      state.plan = { id: previous?.id || newId('plan'), version: (previous?.version || 0) + 1,
        pathId: state.selectedPathId, weeks: state.profile.weeks, startAt: startAt, tasks: tasks,
        schedule: previous === null ? [] : previous.schedule.filter((block) =>
          tasks.some((task) => task.id === block.taskId && task.status === 'done')), unscheduledTaskIds: [] };
      this.touch(state);
      await this.repository.save(state);
      return state;
    });
  }

  async schedule(id: string, from: string, available: TimeWindow[], reminderMinutes: number = 0) {
    return this.change(id, async (state) => {
      const plan = this.requirePlan(state);
      if (!Number.isInteger(reminderMinutes) || reminderMinutes < 0 || reminderMinutes > 10080) {
        throw new Error('INVALID_REMINDER: 提醒分钟数应为 0–10080 整数，0 为不提醒。');
      }
      const start = Math.max(validateTimestamp(from), this.now());
      let read: CalendarReadResult;
      try { read = await this.calendar.readBusy(new Date(start).toISOString(), new Date(start + WEEK).toISOString()); }
      catch { read = { readable: false, busy: [], reason: 'CALENDAR_READ_FAILED: 未能读取日历，仅使用用户提供的时段。' }; }
      const conflicts = read.readable ? read.busy.filter((window) => !state.calendarLinks.some((link) =>
        !link.taskCompleted && Date.parse(link.startAt) >= this.now() &&
        plan.tasks.some((task) => task.id === link.taskId && task.status === 'pending') &&
        (window.eventId !== undefined || window.appEventKey !== undefined) &&
        (window.eventId === undefined || window.eventId === link.eventId) &&
        (window.appEventKey === undefined || window.appEventKey === link.appEventKey))) : [];
      const result = scheduleLearningTasks(plan, available, conflicts, new Date(start).toISOString());
      const done = plan.schedule.filter((block) => plan.tasks.some((task) => task.id === block.taskId && task.status === 'done'));
      result.blocks.forEach((block) => { block.reminderMinutes = reminderMinutes; });
      plan.schedule = done.concat(result.blocks);
      plan.unscheduledTaskIds = result.unscheduledTaskIds;
      plan.version += 1;
      this.touch(state);
      await this.repository.save(state);
      return { state: state, result: result, calendarRead: read };
    });
  }

  async recordProgress(id: string, taskId: string, status: 'pending' | 'done', remainingMinutes?: number): Promise<LearningState> {
    return this.change(id, async (state) => {
      const plan = this.requirePlan(state);
      const task = plan.tasks.find((item) => item.id === taskId);
      if (task === undefined || !['pending', 'done'].includes(status) ||
        (remainingMinutes !== undefined && (!Number.isInteger(remainingMinutes) || remainingMinutes < 1 || remainingMinutes > 43200))) {
        throw new Error('INVALID_PROGRESS: 请提供本计划任务 ID、done/pending 及有效的剩余分钟数。');
      }
      task.status = status;
      task.remainingMinutes = status === 'done' ? 0 : remainingMinutes ?? (task.remainingMinutes || task.estimatedMinutes);
      state.calendarLinks.forEach((link) => {
        if (link.taskId === taskId) { link.taskCompleted = status === 'done'; }
      });
      plan.version += 1;
      // 其余待办需要显式重新排期；已完成任务保留原日程与 ID。
      plan.schedule = plan.schedule.filter((block) => plan.tasks.some((item) => item.id === block.taskId && item.status === 'done'));
      plan.unscheduledTaskIds = [];
      this.touch(state);
      await this.repository.save(state);
      return state;
    });
  }

  async updateTaskConstraints(id: string, taskId: string,
    patch: { dueAt?: string; dependsOn?: string[] }): Promise<LearningState> {
    return this.change(id, async (state) => {
      const plan = this.requirePlan(state);
      const task = plan.tasks.find((item) => item.id === taskId);
      if (task === undefined || task.status === 'done' || patch === null || typeof patch !== 'object' ||
        Array.isArray(patch) || Object.keys(patch).length === 0 ||
        Object.keys(patch).some((key) => !['dueAt', 'dependsOn'].includes(key))) {
        throw new Error('INVALID_TASK_CONSTRAINT: 只能调整本计划未完成任务的截止时间或依赖。');
      }
      if (patch.dueAt !== undefined) {
        if (patch.dueAt !== '') { validateTimestamp(patch.dueAt); }
        task.dueAt = patch.dueAt;
      }
      if (patch.dependsOn !== undefined) {
        if (!Array.isArray(patch.dependsOn) || patch.dependsOn.some((value) => typeof value !== 'string')) {
          throw new Error('INVALID_DEPENDENCY: 依赖必须为本计划任务 ID 数组。');
        }
        task.dependsOn = patch.dependsOn.slice();
      }
      // 复用纯排期校验拓扑与时间；空时段不产生任何执行或写入。
      scheduleLearningTasks(plan, [], [], new Date(this.now()).toISOString());
      plan.version += 1;
      plan.schedule = plan.schedule.filter((block) => plan.tasks.some((item) => item.id === block.taskId && item.status === 'done'));
      plan.unscheduledTaskIds = [];
      this.touch(state);
      await this.repository.save(state);
      return state;
    });
  }

  async previewCalendar(id: string): Promise<CalendarPreview> {
    return this.change(id, async (state) => {
      const plan = this.requirePlan(state);
      if (plan.schedule.length === 0 && !state.calendarLinks.some((link) => !link.taskCompleted &&
        Date.parse(link.startAt) >= this.now() &&
        !plan.tasks.some((task) => task.id === link.taskId && task.status === 'done'))) {
        throw new Error('SCHEDULE_REQUIRED: 请先提供可用时段并生成近期日程。');
      }
      const operations: CalendarOperation[] = [];
      const keptKeys: Set<string> = new Set<string>();
      for (const block of plan.schedule) {
        const task = plan.tasks.find((item) => item.id === block.taskId);
        if (task?.status === 'done' || Date.parse(block.startAt) < this.now()) { continue; }
        const link = state.calendarLinks.find((item) => item.id === block.id && item.taskId === block.taskId &&
          !item.taskCompleted && Date.parse(item.startAt) >= this.now());
        const baseKey = state.conversationId + ':' + plan.id + ':' + block.id;
        const key = link?.appEventKey || (state.calendarLinks.some((item) => item.appEventKey === baseKey)
          ? baseKey + ':v' + plan.version : baseKey);
        keptKeys.add(key);
        if (link !== undefined && link.startAt === block.startAt && link.endAt === block.endAt &&
          link.title === block.title && link.reminderMinutes === block.reminderMinutes) { continue; }
        operations.push(this.operation(plan, block, key, link === undefined ? 'create' : 'update', link?.eventId || ''));
      }
      for (const link of state.calendarLinks) {
        const task = plan.tasks.find((item) => item.id === link.taskId);
        if (link.taskCompleted || task?.status === 'done' || Date.parse(link.startAt) < this.now()) { continue; }
        if (!keptKeys.has(link.appEventKey)) {
          operations.push(this.operation(plan, link, link.appEventKey, 'delete', link.eventId));
        }
      }
      state.preview = { id: newId('preview'), revision: state.revision, planVersion: plan.version,
        timeZone: 'UTC（时间戳含明确时区，可按设备时区显示）', operations: operations,
        results: operations.map((op) => ({ operationKey: op.operationKey, status: 'pending', eventId: '', error: '' })) };
      await this.repository.save(state);
      return state.preview;
    });
  }

  // 仅供 B 在用户点击确认后调用；此方法不注册为模型工具，不接受模型声明的 confirmed=true。
  async confirmCalendar(id: string, previewId: string): Promise<CalendarPreview> {
    return this.change(id, async (state) => {
      const preview = state.preview;
      if (preview?.cancelRequested) { throw new Error('CALENDAR_CANCELLED: 已请求取消，仅可核对结果，不再补写。'); }
      if (preview === null || preview.id !== previewId || preview.revision !== state.revision ||
        preview.planVersion !== state.plan?.version) { throw new Error('STALE_PREVIEW: 预览已取消或计划已变更，请重新预览确认。'); }
      if (!preview.results.some((item) => item.status === 'unknown') && preview.operations.some((op, index) =>
        preview.results[index].status !== 'succeeded' && this.isPastOperation(state, op))) {
        throw new Error('STALE_PREVIEW: 预览中的日程已过时，请重新排期并预览确认。');
      }
      for (let index = 0; index < preview.operations.length; index++) {
        const op = preview.operations[index];
        const item = preview.results[index];
        if (item.status === 'succeeded') { continue; }
        if (op.kind !== 'create' && !state.calendarLinks.some((link) =>
          link.appEventKey === op.appEventKey && link.eventId === op.eventId)) {
          item.status = 'failed'; item.error = 'CALENDAR_OWNERSHIP: 未找到本应用保存的日程关联，拒绝操作。';
          await this.repository.save(state); continue;
        }
        let receipt: CalendarReceipt;
        try { receipt = this.safeReceipt(await this.calendar.reconcile(op)); }
        catch { receipt = { status: 'unknown', eventId: '', error: 'CALENDAR_UNKNOWN: 无法核对之前的执行结果。' }; }
        if (receipt.status === 'failed') {
          if (this.isPastOperation(state, op)) {
            item.status = 'failed'; item.eventId = '';
            item.error = 'STALE_PREVIEW: 日程已过时且确认未执行，请重新排期。';
            await this.repository.save(state); continue;
          }
          // 先保存执行意图；写成功但保存结果失败时，重启后通过 reconcile 查证，不盲目创建。
          item.status = 'unknown'; item.error = 'CALENDAR_UNKNOWN: 操作执行中，恢复后需核对。';
          await this.repository.save(state);
          try { receipt = this.safeReceipt(await this.calendar.apply(op)); }
          catch { receipt = { status: 'unknown', eventId: '', error: 'CALENDAR_UNKNOWN: 日历调用中断，需要核对结果。' }; }
        }
        this.recordReceipt(state, op, item, receipt);
        await this.repository.save(state);
      }
      return preview;
    }, true);
  }

  async cancelCalendar(id: string, previewId: string): Promise<void> {
    await this.change(id, async (state) => {
      if (state.preview?.id !== previewId) { throw new Error('STALE_PREVIEW: 预览不存在或已过期。'); }
      const preview = state.preview;
      if (preview.results.some((item) => item.status === 'unknown')) {
        preview.cancelRequested = true;
        await this.repository.save(state);
        for (let index = 0; index < preview.operations.length; index++) {
          const item = preview.results[index];
          if (item.status !== 'unknown') { continue; }
          let receipt: CalendarReceipt;
          try { receipt = this.safeReceipt(await this.calendar.reconcile(preview.operations[index])); }
          catch { receipt = { status: 'unknown', eventId: '', error: 'CALENDAR_UNKNOWN: 取消后仍需核对执行结果。' }; }
          this.recordReceipt(state, preview.operations[index], item, receipt);
          await this.repository.save(state);
        }
        if (preview.results.some((item) => item.status === 'unknown')) {
          throw new Error('CALENDAR_UNRESOLVED: 已停止补写，待日历恢复后再次核对取消结果。');
        }
      }
      state.preview = null;
      await this.repository.save(state);
    }, true);
  }

  private safeReceipt(receipt: CalendarReceipt): CalendarReceipt {
    if (receipt === null || typeof receipt !== 'object' ||
      !['succeeded', 'failed', 'unknown'].includes(receipt.status) ||
      typeof receipt.eventId !== 'string' || typeof receipt.error !== 'string') {
      return { status: 'unknown', eventId: '', error: 'CALENDAR_RECEIPT: 回执格式无效，需要核对。' };
    }
    return receipt;
  }

  private recordReceipt(state: LearningState, op: CalendarOperation, item: CalendarItemResult, receipt: CalendarReceipt): void {
    if (receipt.status === 'succeeded' && op.kind !== 'delete' &&
      (receipt.eventId.length === 0 || (op.kind === 'update' && receipt.eventId !== op.eventId) ||
        state.calendarLinks.some((link) => link.eventId === receipt.eventId && link.appEventKey !== op.appEventKey))) {
      receipt = { status: 'unknown', eventId: '', error: 'CALENDAR_RECEIPT: 日历返回的关联无效，需要核对。' };
    }
    item.status = receipt.status; item.eventId = receipt.eventId; item.error = receipt.error;
    if (receipt.status === 'succeeded') {
      state.calendarLinks = state.calendarLinks.filter((link) => link.appEventKey !== op.appEventKey);
      if (op.kind !== 'delete') {
        const link: CalendarLink = { id: op.id, taskId: op.taskId, title: op.title,
          startAt: op.startAt, endAt: op.endAt, reminderMinutes: op.reminderMinutes,
          appEventKey: op.appEventKey, eventId: receipt.eventId };
        state.calendarLinks.push(link);
      }
    }
  }

  async deleteLocalState(id: string, removeSession: () => Promise<void>, restoreSession: () => Promise<void>): Promise<void> {
    await this.change(id, async () => {
      await removeSession();
      try { await this.repository.delete(id); }
      catch (error) {
        try { await restoreSession(); }
        catch { throw new Error('DELETE_RECOVERY_REQUIRED: 会话恢复失败，规划数据已保留，请先恢复会话后重试删除。'); }
        throw error;
      }
    });
  }

  private operation(plan: LearningPlan, block: ScheduledBlock, key: string,
    kind: 'create' | 'update' | 'delete', eventId: string): CalendarOperation {
    return { ...block, appEventKey: key, kind: kind, eventId: eventId,
      operationKey: key + ':' + plan.version + ':' + kind };
  }

  private isPastOperation(state: LearningState, op: CalendarOperation): boolean {
    const link = state.calendarLinks.find((item) => item.appEventKey === op.appEventKey && item.eventId === op.eventId);
    return validateTimestamp(op.startAt) < this.now() || (op.kind !== 'create' &&
      link !== undefined && validateTimestamp(link.startAt) < this.now());
  }

  private touch(state: LearningState): void { state.revision += 1; state.preview = null; }

  private requirePlan(state: LearningState): LearningPlan {
    if (state.plan === null) { throw new Error('PLAN_REQUIRED: 请先选择路径并生成阶段计划。'); }
    return state.plan;
  }

  private async change<T>(id: string, action: (state: LearningState) => Promise<T>, allowUnknown: boolean = false): Promise<T> {
    if (this.busy.has(id)) { throw new Error('LEARNING_BUSY: 当前规划正在处理，请稍候。'); }
    this.busy.add(id);
    try {
      if (this.exists !== undefined && !await this.exists(id)) {
        throw new Error('SESSION_NOT_FOUND: 会话已删除，请重新打开或新建会话。');
      }
      const state = await this.getState(id);
      if (!allowUnknown && state.preview?.results.some((item) => item.status === 'unknown')) {
        throw new Error('CALENDAR_UNRESOLVED: 请先核对上一批日历操作结果，再修改计划或取消预览。');
      }
      return await action(state);
    } finally { this.busy.delete(id); }
  }
}
