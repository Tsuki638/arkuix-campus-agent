import type { KeyValueStore } from '../../contracts/Ports';
import type { LearningRepository } from '../../contracts/LearningPorts';
import type { CalendarItemResult, CalendarOperation, LearningState, ScheduledBlock } from '../../contracts/LearningModels';
import { validateTimestamp } from '../../agent/learning/LearningScheduler';

interface LearningDocument { version: number; states: LearningState[]; }

// 独立键避免 Agent 保存聊天快照时覆盖刚写入的计划/日历结果。C 可替换此端口实现。
export class JsonLearningRepository implements LearningRepository {
  private store: KeyValueStore;
  private pending: Promise<void> = Promise.resolve();
  private key: string = 'learning_v1';

  constructor(store: KeyValueStore) { this.store = store; }

  async load(conversationId: string): Promise<LearningState | null> {
    await this.pending;
    return (await this.read()).states.find((state: LearningState) => state.conversationId === conversationId) || null;
  }

  save(state: LearningState): Promise<void> {
    const snapshot: LearningState = JSON.parse(JSON.stringify(state)) as LearningState;
    const operation = this.pending.then(async () => {
      const document = await this.read();
      if (!this.validState(snapshot)) { throw new Error('LEARNING_STORAGE_CORRUPT: 无效的规划状态，拒绝覆盖。'); }
      document.states = document.states.filter((item: LearningState) => item.conversationId !== snapshot.conversationId);
      document.states.push(snapshot);
      await this.store.set(this.key, JSON.stringify(document));
    });
    this.pending = operation.then(() => {}, () => {});
    return operation;
  }

  delete(conversationId: string): Promise<void> {
    const operation = this.pending.then(async () => {
      const document = await this.read();
      document.states = document.states.filter((item: LearningState) => item.conversationId !== conversationId);
      await this.store.set(this.key, JSON.stringify(document));
    });
    this.pending = operation.then(() => {}, () => {});
    return operation;
  }

  private async read(): Promise<LearningDocument> {
    const raw = await this.store.get(this.key);
    if (raw === '') { return { version: 1, states: [] }; }
    try {
      const document = JSON.parse(raw) as LearningDocument;
      if (document === null || document.version !== 1 || !Array.isArray(document.states)) { throw new Error(); }
      const ids: Set<string> = new Set<string>();
      for (const state of document.states) {
        if (!this.validState(state) || ids.has(state.conversationId)) { throw new Error(); }
        ids.add(state.conversationId);
      }
      return document;
    } catch { throw new Error('LEARNING_STORAGE_CORRUPT: 规划数据损坏或版本不兼容，请先备份，未覆盖原数据。'); }
  }

  private validBlock(block: ScheduledBlock): boolean {
    return block !== null && block !== undefined && typeof block.id === 'string' && block.id.length > 0 &&
      typeof block.taskId === 'string' && block.taskId.length > 0 &&
      typeof block.title === 'string' && typeof block.startAt === 'string' && typeof block.endAt === 'string' &&
      this.validTime(block.startAt) && this.validTime(block.endAt) && Date.parse(block.endAt) > Date.parse(block.startAt) &&
      Number.isInteger(block.reminderMinutes) && block.reminderMinutes >= 0 && block.reminderMinutes <= 10080;
  }

  private validTime(value: string): boolean {
    try { validateTimestamp(value); return true; } catch { return false; }
  }

  private sameBlock(left: ScheduledBlock, right: ScheduledBlock): boolean {
    return left.id === right.id && left.taskId === right.taskId && left.title === right.title &&
      left.startAt === right.startAt && left.endAt === right.endAt && left.reminderMinutes === right.reminderMinutes;
  }

  private scopedKey(state: LearningState, block: ScheduledBlock, key: string, currentPlan: boolean): boolean {
    const prefix = state.conversationId + ':';
    if (!key.startsWith(prefix)) { return false; }
    const rest = key.slice(prefix.length);
    const separator = rest.indexOf(':');
    if (separator <= 0 || (currentPlan && rest.slice(0, separator) !== state.plan?.id)) { return false; }
    const tail = rest.slice(separator + 1);
    if (tail === block.id) { return true; }
    if (!tail.startsWith(block.id + ':v')) { return false; }
    const version = tail.slice(block.id.length + 2);
    return /^[1-9]\d*$/.test(version) && Number.isSafeInteger(Number(version)) &&
      (!currentPlan || Number(version) <= (state.plan?.version || 0));
  }

  private validOperation(state: LearningState, op: CalendarOperation, result: CalendarItemResult): boolean {
    const plan = state.plan;
    if (plan === null || !this.scopedKey(state, op, op.appEventKey, op.kind === 'create') ||
      op.operationKey !== op.appEventKey + ':' + plan.version + ':' + op.kind) { return false; }
    const link = state.calendarLinks.find((item) => item.appEventKey === op.appEventKey);
    if (op.kind === 'delete') {
      if (op.eventId.length === 0 || state.plan?.tasks.some((task) => task.id === op.taskId && task.status === 'done')) {
        return false;
      }
      // 成功删除已移除关联；其余结果必须仍精确对应保存的旧日程。
      return result.status === 'succeeded'
        ? link === undefined && (result.eventId === '' || result.eventId === op.eventId)
        : link !== undefined && !link.taskCompleted && link.eventId === op.eventId && this.sameBlock(op, link);
    }
    if (!plan.schedule.some((block) => this.sameBlock(op, block)) ||
      !plan.tasks.some((task) => task.id === op.taskId && task.status === 'pending')) { return false; }
    if (op.kind === 'create' && op.eventId !== '') { return false; }
    if (op.kind === 'update' && (op.eventId === '' || link === undefined || link.taskCompleted ||
      link.eventId !== op.eventId || link.id !== op.id || link.taskId !== op.taskId)) { return false; }
    if (result.status === 'succeeded') {
      return result.eventId.length > 0 && link !== undefined && link.eventId === result.eventId && this.sameBlock(op, link);
    }
    // 新建完成前不应已有相同键，防止损坏数据把已创建日程当成新操作。
    return op.kind !== 'create' || link === undefined;
  }

  private validState(state: LearningState): boolean {
    if (state === null || state === undefined || state.schemaVersion !== 1 || typeof state.conversationId !== 'string' ||
      !Number.isInteger(state.revision) || state.revision < 0 || typeof state.selectedPathId !== 'string' ||
      state.profile === null || typeof state.profile !== 'object' || !Array.isArray(state.candidates) ||
      !state.candidates.every((path) => path !== null && typeof path.id === 'string' && typeof path.title === 'string' &&
        typeof path.reason === 'string' && typeof path.trial === 'string' && typeof path.caveat === 'string') ||
      !Array.isArray(state.calendarLinks) || !state.calendarLinks.every((link) => this.validBlock(link) &&
        typeof link.eventId === 'string' && link.eventId.length > 0 && typeof link.appEventKey === 'string' &&
        (link.taskCompleted === undefined || typeof link.taskCompleted === 'boolean') &&
        this.scopedKey(state, link, link.appEventKey, false)) ||
      new Set(state.calendarLinks.map((link) => link.appEventKey)).size !== state.calendarLinks.length ||
      new Set(state.calendarLinks.map((link) => link.eventId)).size !== state.calendarLinks.length) { return false; }
    const profile = state.profile;
    if (![profile.track, profile.major, profile.grade, profile.background, profile.interests, profile.goal]
      .every((value) => typeof value === 'string') || !Number.isInteger(profile.weeks) ||
      !Number.isInteger(profile.minutesPerWeek)) { return false; }
    if (state.plan !== null) {
      const plan = state.plan;
      if (plan === undefined || typeof plan.id !== 'string' || !Number.isInteger(plan.version) ||
        (plan.personalized !== undefined && typeof plan.personalized !== 'boolean') ||
        (plan.needsScheduling !== undefined && typeof plan.needsScheduling !== 'boolean') ||
        typeof plan.pathId !== 'string' || !Number.isInteger(plan.weeks) || typeof plan.startAt !== 'string' ||
        !this.validTime(plan.startAt) ||
        !Array.isArray(plan.tasks) || !Array.isArray(plan.schedule) || !Array.isArray(plan.unscheduledTaskIds) ||
        !plan.schedule.every((block) => this.validBlock(block)) || !plan.tasks.every((task) => task !== null &&
          typeof task.id === 'string' && typeof task.title === 'string' && typeof task.phase === 'string' &&
          Number.isInteger(task.week) && Number.isInteger(task.estimatedMinutes) && Number.isInteger(task.remainingMinutes) &&
          typeof task.completionCriteria === 'string' && typeof task.dueAt === 'string' &&
          (task.dueAt === '' || this.validTime(task.dueAt)) &&
          ['pending', 'done'].includes(task.status) && Array.isArray(task.dependsOn) &&
          task.dependsOn.every((id) => typeof id === 'string'))) { return false; }
    }
    if (state.preview !== null) {
      const preview = state.preview;
      if (preview === undefined || state.plan === null || typeof preview.id !== 'string' || !Number.isInteger(preview.revision) ||
        (preview.cancelRequested !== undefined && typeof preview.cancelRequested !== 'boolean') ||
        !Number.isInteger(preview.planVersion) || typeof preview.timeZone !== 'string' ||
        preview.revision !== state.revision || preview.planVersion !== state.plan.version ||
        !Array.isArray(preview.operations) || !Array.isArray(preview.results) ||
        preview.operations.length !== preview.results.length || !preview.operations.every((op) => this.validBlock(op) &&
          typeof op.operationKey === 'string' && typeof op.appEventKey === 'string' && typeof op.eventId === 'string' &&
          ['create', 'update', 'delete'].includes(op.kind)) || !preview.results.every((item, index) => item !== null &&
          item.operationKey === preview.operations[index].operationKey &&
          ['pending', 'succeeded', 'failed', 'unknown'].includes(item.status) &&
          typeof item.eventId === 'string' && typeof item.error === 'string') ||
        new Set(preview.operations.map((op) => op.operationKey)).size !== preview.operations.length ||
        new Set(preview.operations.map((op) => op.appEventKey)).size !== preview.operations.length ||
        !preview.operations.every((op, index) => this.validOperation(state, op, preview.results[index]))) { return false; }
    }
    return true;
  }
}
