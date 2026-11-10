// 产品业务数据：A 定义与使用，B 展示，C 持久化，D 通过日历端口执行。
export interface LearnerProfile {
  track: string;
  major: string;
  grade: string;
  background: string;
  interests: string;
  goal: string;
  weeks: number;
  minutesPerWeek: number;
}

export interface LearningPath {
  id: string;
  title: string;
  reason: string;
  trial: string;
  caveat: string;
}

export interface LearningTask {
  id: string;
  title: string;
  phase: string;
  week: number;
  estimatedMinutes: number;
  remainingMinutes: number;
  completionCriteria: string;
  dependsOn: string[];
  dueAt: string;
  status: 'pending' | 'done';
}

export interface TimeWindow { startAt: string; endAt: string; }

export interface ScheduledBlock extends TimeWindow {
  id: string;
  taskId: string;
  title: string;
  reminderMinutes: number;
}

export interface LearningPlan {
  id: string;
  version: number;
  pathId: string;
  weeks: number;
  startAt: string;
  tasks: LearningTask[];
  schedule: ScheduledBlock[];
  unscheduledTaskIds: string[];
}

export interface ScheduleResult {
  blocks: ScheduledBlock[];
  unscheduledTaskIds: string[];
  deferredTaskIds: string[];
}

export interface CalendarLink extends ScheduledBlock {
  appEventKey: string;
  eventId: string;
  taskCompleted?: boolean;
}

export interface CalendarOperation extends ScheduledBlock {
  operationKey: string;
  appEventKey: string;
  kind: 'create' | 'update' | 'delete';
  eventId: string;
}

export interface CalendarItemResult {
  operationKey: string;
  status: 'pending' | 'succeeded' | 'failed' | 'unknown';
  eventId: string;
  error: string;
}

export interface CalendarPreview {
  id: string;
  revision: number;
  planVersion: number;
  timeZone: string;
  cancelRequested?: boolean;
  operations: CalendarOperation[];
  results: CalendarItemResult[];
}

export interface LearningState {
  schemaVersion: number;
  conversationId: string;
  revision: number;
  profile: LearnerProfile;
  candidates: LearningPath[];
  selectedPathId: string;
  plan: LearningPlan | null;
  preview: CalendarPreview | null;
  calendarLinks: CalendarLink[];
}

export interface ToolContext { conversationId: string; }
