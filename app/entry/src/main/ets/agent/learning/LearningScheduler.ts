import type { LearningPlan, LearningTask, ScheduleResult, TimeWindow } from '../../contracts/LearningModels';

const MINUTE = 60 * 1000;
const WEEK = 7 * 24 * 60 * MINUTE;

interface Interval { start: number; end: number; }

export function validateTimestamp(value: string): number {
  const match = typeof value === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value)
    : null;
  if (match === null) throw new Error('INVALID_TIMESTAMP');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const zone = match[8];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1] ||
    Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] || 0) > 59 ||
    (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))) {
    throw new Error('INVALID_TIMESTAMP');
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) throw new Error('INVALID_TIMESTAMP');
  return instant;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  intervals.sort((left, right) => left.start - right.start);
  const result: Interval[] = [];
  for (const interval of intervals) {
    const previous = result[result.length - 1];
    if (previous !== undefined && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      result.push({ start: interval.start, end: interval.end });
    }
  }
  return result;
}

function readWindows(windows: TimeWindow[], minutePrecision: boolean): Interval[] {
  const intervals: Interval[] = [];
  for (const window of windows) {
    const start = validateTimestamp(window.startAt);
    const end = validateTimestamp(window.endAt);
    if (end <= start || (minutePrecision && (start % MINUTE !== 0 || end % MINUTE !== 0))) {
      throw new Error('INVALID_TIME_WINDOW');
    }
    intervals.push({ start: Math.floor(start / MINUTE) * MINUTE, end: Math.ceil(end / MINUTE) * MINUTE });
  }
  return mergeIntervals(intervals);
}

function taskOrder(tasks: LearningTask[]): LearningTask[] {
  const byId = new Map<string, LearningTask>();
  for (const task of tasks) {
    if (!task.id || byId.has(task.id) || !Array.isArray(task.dependsOn)) {
      throw new Error('INVALID_DEPENDENCY');
    }
    byId.set(task.id, task);
  }
  const active = new Set<string>();
  const visited = new Set<string>();
  const ordered: LearningTask[] = [];
  function visit(task: LearningTask): void {
    if (active.has(task.id)) throw new Error('INVALID_DEPENDENCY');
    if (visited.has(task.id)) return;
    active.add(task.id);
    for (const id of task.dependsOn) {
      const dependency = byId.get(id);
      if (dependency === undefined) throw new Error('INVALID_DEPENDENCY');
      visit(dependency);
    }
    active.delete(task.id);
    visited.add(task.id);
    ordered.push(task);
  }
  for (const task of tasks) visit(task);
  return ordered;
}

export function scheduleLearningTasks(
  plan: LearningPlan, available: TimeWindow[], busy: TimeWindow[], from: string
): ScheduleResult {
  const fromInstant = validateTimestamp(from);
  const horizon = fromInstant + WEEK;
  const start = Math.ceil(fromInstant / MINUTE) * MINUTE;
  const end = Math.floor(horizon / MINUTE) * MINUTE;
  const planStart = validateTimestamp(plan.startAt);
  const ordered = taskOrder(plan.tasks);
  const deadlines = new Map<string, number>();
  for (const task of ordered) {
    deadlines.set(task.id, task.dueAt === '' ? horizon : validateTimestamp(task.dueAt));
    if (!Number.isSafeInteger(task.week) || task.week <= 0 ||
      (task.status !== 'done' && (!Number.isSafeInteger(task.remainingMinutes) || task.remainingMinutes <= 0))) {
      throw new Error('INVALID_TASK');
    }
  }
  const userWindows = readWindows(available, true);
  const conflicts = readWindows(busy, false);
  let free: Interval[] = [];
  for (const window of userWindows) {
    let cursor = Math.max(start, window.start);
    const limit = Math.min(end, window.end);
    for (const conflict of conflicts) {
      if (conflict.end <= cursor) continue;
      if (conflict.start >= limit) break;
      if (conflict.start > cursor) free.push({ start: cursor, end: conflict.start });
      cursor = Math.max(cursor, conflict.end);
      if (cursor >= limit) break;
    }
    if (cursor < limit) free.push({ start: cursor, end: limit });
  }

  const result: ScheduleResult = { blocks: [], unscheduledTaskIds: [], deferredTaskIds: [] };
  const completed = new Map<string, number>();
  const deferred = new Set<string>();
  for (const task of ordered) {
    if (task.status === 'done') {
      completed.set(task.id, start);
      continue;
    }
    const release = planStart + (task.week - 1) * WEEK;
    if (release >= horizon || task.dependsOn.some((id: string) => deferred.has(id))) {
      deferred.add(task.id);
      result.deferredTaskIds.push(task.id);
      continue;
    }
    if (task.dependsOn.some((id: string) => !completed.has(id))) {
      result.unscheduledTaskIds.push(task.id);
      continue;
    }
    let earliest = Math.max(start, Math.ceil(release / MINUTE) * MINUTE);
    for (const id of task.dependsOn) earliest = Math.max(earliest, completed.get(id)!);
    const latest = Math.min(end, deadlines.get(task.id)!);
    let remaining = task.remainingMinutes;
    let part = 1;
    let completedAt = earliest;
    const nextFree: Interval[] = [];
    for (const slot of free) {
      const blockStart = Math.max(slot.start, earliest);
      const minutes = Math.min(remaining, Math.floor((Math.min(slot.end, latest) - blockStart) / MINUTE));
      if (minutes <= 0) {
        nextFree.push(slot);
        continue;
      }
      const blockEnd = blockStart + minutes * MINUTE;
      result.blocks.push({
        id: task.id + '-part-' + part, taskId: task.id, title: task.title,
        startAt: new Date(blockStart).toISOString(), endAt: new Date(blockEnd).toISOString(), reminderMinutes: 0
      });
      part++;
      remaining -= minutes;
      completedAt = blockEnd;
      if (slot.start < blockStart) nextFree.push({ start: slot.start, end: blockStart });
      if (blockEnd < slot.end) nextFree.push({ start: blockEnd, end: slot.end });
    }
    free = nextFree;
    if (remaining === 0) completed.set(task.id, completedAt);
    else result.unscheduledTaskIds.push(task.id);
  }
  return result;
}
