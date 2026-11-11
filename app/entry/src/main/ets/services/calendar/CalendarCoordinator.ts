import type { KeyValueStore } from '../../contracts/Ports';
import type { CalendarDraft, CalendarEntry, CalendarEventInput, CalendarEventReference,
  CalendarService } from '../../contracts/Calendar';
import { newId } from '../../contracts/Models';
import { calendarTimeText, parseCalendarTime } from './CalendarTime';

interface CalendarDocument { version: number; drafts: CalendarDraft[]; }

function copyDraft(draft: CalendarDraft): CalendarDraft { return JSON.parse(JSON.stringify(draft)) as CalendarDraft; }

function validateInput(input: CalendarEventInput, now: number): CalendarEntry {
  if (input === null || typeof input !== 'object' || typeof input.title !== 'string' ||
    input.title.trim().length < 1 || input.title.length > 200 || !Array.isArray(input.reminderMinutes) ||
    input.reminderMinutes.length > 3 || input.reminderMinutes.some((minute: number) =>
      !Number.isInteger(minute) || minute < 0 || minute > 10080) ||
    (input.taskId !== undefined && (typeof input.taskId !== 'string' || input.taskId.length > 150)) ||
    (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 2000))) {
    throw new Error('CALENDAR_INPUT: 请填写日程标题和有效提醒时间（0–10080 分钟，最多 3 个）。');
  }
  const start: number = parseCalendarTime(input.startTime);
  const end: number = parseCalendarTime(input.endTime);
  if (start <= now || end <= start || end - start > 24 * 60 * 60 * 1000) {
    throw new Error('CALENDAR_INPUT: 开始时间须晚于当前时间，结束时间须更晚，单项最长 24 小时。');
  }
  return { id: newId('campus-event'), taskId: input.taskId || '', title: input.title.trim(),
    startTime: start, endTime: end, timeZone: 'Asia/Shanghai', reminderMinutes: Array.from(new Set<number>(input.reminderMinutes)),
    description: input.description || '', state: 'pending', calendarId: 0, eventId: 0, error: '' };
}

function sameEvents(left: CalendarEntry[], right: CalendarEntry[]): boolean {
  return left.length === right.length && left.every((event: CalendarEntry, index: number) => {
    const other: CalendarEntry = right[index];
    return event.taskId === other.taskId && event.title === other.title && event.startTime === other.startTime &&
      event.endTime === other.endTime && event.description === other.description &&
      JSON.stringify(event.reminderMinutes) === JSON.stringify(other.reminderMinutes);
  });
}

// 模型只持有 prepare/list 工具；confirm 仅由真实 UI 操作调用。所有变更串行化。
export class CalendarCoordinator {
  private store: KeyValueStore;
  private service: CalendarService;
  private pending: Promise<void> = Promise.resolve();
  private key: string = 'calendar_data_v1';

  constructor(store: KeyValueStore, service: CalendarService) { this.store = store; this.service = service; }
  isAvailable(): boolean { return this.service.isAvailable(); }
  unavailableReason(): string { return this.service.unavailableReason(); }

  async list(conversationId?: string): Promise<CalendarDraft[]> {
    await this.pending;
    const document: CalendarDocument = await this.read();
    return document.drafts.filter((draft: CalendarDraft) =>
      conversationId === undefined || draft.conversationId === conversationId)
      .sort((a: CalendarDraft, b: CalendarDraft) => b.createdAt - a.createdAt);
  }

  prepare(conversationId: string, planId: string, inputs: CalendarEventInput[]): Promise<CalendarDraft> {
    return this.enqueue(async (): Promise<CalendarDraft> => {
      if (!conversationId || !Array.isArray(inputs) || inputs.length < 1 || inputs.length > 30) {
        throw new Error('CALENDAR_INPUT: 每批需要 1–30 条日程。');
      }
      const events: CalendarEntry[] = inputs.map((input: CalendarEventInput) => validateInput(input, Date.now()));
      const taskIds: string[] = events.filter((event: CalendarEntry) => event.taskId.length > 0)
        .map((event: CalendarEntry) => event.taskId);
      if (new Set<string>(taskIds).size !== taskIds.length) {
        throw new Error('CALENDAR_INPUT: 同一任务在一批草案中只能安排一次。');
      }
      const fingerprints: string[] = events.map((event: CalendarEntry) =>
        JSON.stringify([event.title, event.startTime, event.endTime]));
      if (new Set<string>(fingerprints).size !== fingerprints.length) {
        throw new Error('CALENDAR_INPUT: 同一批次包含重复的标题和时段，请合并后确认。');
      }
      const document: CalendarDocument = await this.read();
      const existing: CalendarDraft | undefined = document.drafts.find((draft: CalendarDraft) =>
        draft.status !== 'cancelled' && draft.conversationId === conversationId && draft.planId === planId &&
        sameEvents(draft.events, events));
      if (existing !== undefined) { return copyDraft(existing); }
      if (planId && document.drafts.some((draft: CalendarDraft) => draft.planId === planId &&
        draft.events.some((event: CalendarEntry) => taskIds.includes(event.taskId) &&
          (draft.status !== 'cancelled' || ['created', 'writing', 'uncertain'].includes(event.state))))) {
        throw new Error('CALENDAR_DUPLICATE: 该计划的任务已有日程草案，请查看已有草案。');
      }
      const draft: CalendarDraft = { id: newId('calendar-draft'), conversationId: conversationId,
        planId: planId, revision: 1, createdAt: Date.now(), status: 'pending', events: events };
      document.drafts.push(draft);
      await this.write(document);
      return copyDraft(draft);
    });
  }

  edit(id: string, revision: number, eventId: string, input: CalendarEventInput): Promise<CalendarDraft> {
    return this.enqueue(async (): Promise<CalendarDraft> => {
      const document: CalendarDocument = await this.read();
      const draft: CalendarDraft = this.requireDraft(document, id, revision);
      if (draft.status !== 'pending' || draft.events.some((event: CalendarEntry) => event.state !== 'pending')) {
        throw new Error('CALENDAR_LOCKED: 已尝试写入的草案不能修改，可重试或取消剩余日程。');
      }
      const index: number = draft.events.findIndex((event: CalendarEntry) => event.id === eventId);
      if (index < 0) { throw new Error('CALENDAR_NOT_FOUND: 日程不存在。'); }
      const replacement: CalendarEntry = validateInput(input, Date.now());
      replacement.id = eventId;
      replacement.taskId = draft.events[index].taskId;
      draft.events[index] = replacement;
      draft.revision += 1;
      await this.write(document);
      return copyDraft(draft);
    });
  }

  cancel(id: string, revision: number): Promise<CalendarDraft> {
    return this.enqueue(async (): Promise<CalendarDraft> => {
      const document: CalendarDocument = await this.read();
      const draft: CalendarDraft = this.requireDraft(document, id, revision);
      if (draft.status === 'completed') { throw new Error('CALENDAR_LOCKED: 已创建的日程不会通过取消草案删除。'); }
      draft.status = 'cancelled';
      draft.revision += 1;
      await this.write(document);
      return copyDraft(draft);
    });
  }

  // revision 绑定界面所预览的整批内容；无模型可调用的提交工具。
  confirm(id: string, revision: number): Promise<CalendarDraft> {
    return this.enqueue(async (): Promise<CalendarDraft> => {
      const document: CalendarDocument = await this.read();
      const draft: CalendarDraft = this.requireDraft(document, id, revision);
      if (draft.status === 'completed') { return copyDraft(draft); }
      if (draft.status === 'cancelled') { throw new Error('CALENDAR_CANCELLED: 草案已取消。'); }
      if (!this.service.isAvailable()) { throw new Error('CALENDAR_UNAVAILABLE: ' + this.service.unavailableReason()); }
      let permission: boolean = false;
      try { permission = await this.service.requestPermission(); }
      catch { throw new Error('CALENDAR_PERMISSION: 无法获取日历权限，请检查系统设置后重试，草案已保留。'); }
      if (!permission) {
        throw new Error('CALENDAR_PERMISSION: 未获得日历读写权限，草案已保留。');
      }
      for (const event of draft.events) {
        if (event.state === 'created') { continue; }
        // 查询与写入失败可能具有不确定结果；下次必须先按稳定 identifier 恢复。
        event.state = 'writing';
        event.error = '';
        draft.revision += 1;
        await this.write(document); // 写前落盘失败则绝不调用系统写入。
        let reference: CalendarEventReference | null = null;
        try {
          reference = await this.service.findEvent(event);
          if (reference === null) {
            if (event.startTime <= Date.now()) {
              event.state = 'failed'; event.error = '开始时间已过，请取消此草案并重新安排。';
              await this.write(document);
              continue;
            }
            reference = await this.service.createEvent(event);
          }
          if (!Number.isInteger(reference.eventId) || reference.eventId <= 0 ||
            !Number.isInteger(reference.calendarId) || reference.calendarId < 0) {
            throw new Error('Invalid calendar reference');
          }
        } catch {
          event.state = 'uncertain';
          event.error = '系统结果未确认；重试时会先查询已有日程，避免重复创建。';
          await this.write(document);
          continue;
        }
        event.state = 'created';
        event.eventId = reference.eventId;
        event.calendarId = reference.calendarId;
        // 系统已成功但此处存储失败时保留写前记录，下次查询 identifier 找回 ID。
        await this.write(document);
      }
      draft.status = draft.events.every((event: CalendarEntry) => event.state === 'created') ? 'completed' : 'pending';
      await this.write(document);
      return copyDraft(draft);
    });
  }

  summary(draft: CalendarDraft): string {
    const created: number = draft.events.filter((event: CalendarEntry) => event.state === 'created').length;
    return '系统日历执行结果：已创建 ' + created + '/' + draft.events.length + ' 条。' +
      (draft.status === 'cancelled' ? '剩余日程已取消；已创建的日程继续保留。' : '') + '\n' +
      draft.events.map((event: CalendarEntry) => event.title + ' · ' + calendarTimeText(event.startTime) +
        '（北京时间） · ' + (event.state === 'created' ? '已创建到系统日历' :
        event.error || '尚未写入')).join('\n');
  }

  private requireDraft(document: CalendarDocument, id: string, revision: number): CalendarDraft {
    const draft: CalendarDraft | undefined = document.drafts.find((item: CalendarDraft) => item.id === id);
    if (draft === undefined) { throw new Error('CALENDAR_NOT_FOUND: 日程草案不存在。'); }
    if (draft.revision !== revision) { throw new Error('CALENDAR_STALE: 草案已变化，请刷新预览后重新确认。'); }
    return draft;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result: Promise<T> = this.pending.then(operation);
    this.pending = result.then(() => {}, () => {});
    return result;
  }

  private async read(): Promise<CalendarDocument> {
    const raw: string = await this.store.get(this.key);
    if (!raw) { return { version: 1, drafts: [] }; }
    try {
      const document: CalendarDocument = JSON.parse(raw) as CalendarDocument;
      if (document === null || document.version !== 1 || !Array.isArray(document.drafts) ||
        !document.drafts.every((draft: CalendarDraft) => draft !== null && typeof draft.id === 'string' &&
          typeof draft.conversationId === 'string' && typeof draft.planId === 'string' &&
          Number.isInteger(draft.revision) && draft.revision > 0 && Number.isFinite(draft.createdAt) &&
          ['pending', 'completed', 'cancelled'].includes(draft.status) && Array.isArray(draft.events) &&
          draft.events.length > 0 && draft.events.length <= 30 && draft.events.every((event: CalendarEntry) => event !== null &&
            typeof event.id === 'string' && event.id.length > 0 && typeof event.taskId === 'string' &&
            typeof event.title === 'string' && event.title.length > 0 && event.title.length <= 200 &&
            Number.isFinite(event.startTime) && Number.isFinite(event.endTime) && event.endTime > event.startTime &&
            event.timeZone === 'Asia/Shanghai' && Array.isArray(event.reminderMinutes) && event.reminderMinutes.length <= 3 &&
            event.reminderMinutes.every((minute: number) => Number.isInteger(minute) && minute >= 0 && minute <= 10080) &&
            typeof event.description === 'string' && typeof event.error === 'string' &&
            ['pending', 'writing', 'created', 'failed', 'uncertain'].includes(event.state) &&
            Number.isInteger(event.eventId) && Number.isInteger(event.calendarId) &&
            (event.state !== 'created' || event.eventId > 0))) ||
        document.drafts.some((draft: CalendarDraft) => draft.status === 'completed' &&
          draft.events.some((event: CalendarEntry) => event.state !== 'created'))) {
        throw new Error('Invalid calendar document');
      }
      const draftIds: string[] = document.drafts.map((draft: CalendarDraft) => draft.id);
      const eventIds: string[] = [];
      document.drafts.forEach((draft: CalendarDraft) => draft.events.forEach((event: CalendarEntry) => eventIds.push(event.id)));
      if (new Set<string>(draftIds).size !== draftIds.length || new Set<string>(eventIds).size !== eventIds.length) {
        throw new Error('Duplicate calendar identifiers');
      }
      return document;
    } catch { throw new Error('CALENDAR_STORAGE: 日历记录损坏或版本不兼容，已保留原始数据。'); }
  }

  private async write(document: CalendarDocument): Promise<void> {
    await this.store.set(this.key, JSON.stringify(document));
  }
}
