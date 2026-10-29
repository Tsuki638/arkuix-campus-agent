import type { KeyValueStore } from '../../contracts/Ports';

export interface UserConditions {
  goal: string;
  dailyMinutes: number;
  startDate: string; // YYYY-MM-DD
}

export interface PlanTask {
  id: string;
  title: string;
  day: number;
  status: 'pending' | 'done';
}

export interface PlanVersion {
  id: string;
  conditions: UserConditions;
  tasks: PlanTask[];
  createdAt: number;
}

export interface StudyRecord {
  planId: string;
  taskId: string;
  completedAt: number;
}

interface StudyDocument {
  version: number;
  plans: PlanVersion[];
  records: StudyRecord[];
}

// 学习计划与打卡记录的本地持久化。与会话仓库分开存储（不同 key），
// 互不覆盖；写入串行化，损坏时抛错而不是清空历史。
export class StudyDataRepository {
  private store: KeyValueStore;
  private pending: Promise<void> = Promise.resolve();
  private key: string = 'study_data_v1';

  constructor(store: KeyValueStore) { this.store = store; }

  async listPlans(): Promise<PlanVersion[]> {
    await this.pending;
    const document: StudyDocument = await this.read();
    return document.plans.slice().sort((a: PlanVersion, b: PlanVersion) => b.createdAt - a.createdAt);
  }

  async getPlan(planId: string): Promise<PlanVersion | null> {
    const plans: PlanVersion[] = await this.listPlans();
    return plans.find((plan: PlanVersion) => plan.id === planId) || null;
  }

  addPlan(plan: PlanVersion): Promise<void> {
    const snapshot: PlanVersion = JSON.parse(JSON.stringify(plan)) as PlanVersion;
    return this.enqueue(async (document: StudyDocument) => {
      document.plans = document.plans.filter((item: PlanVersion) => item.id !== snapshot.id);
      document.plans.push(snapshot);
    });
  }

  // 只切换单个任务的完成状态，保留同一计划的其它任务与历史版本。
  updateTask(planId: string, taskId: string, status: 'pending' | 'done'): Promise<void> {
    return this.enqueue(async (document: StudyDocument) => {
      const plan: PlanVersion | undefined = document.plans.find((item: PlanVersion) => item.id === planId);
      if (plan === undefined) { throw new Error('STUDY_NOT_FOUND: 学习计划不存在，请重新生成。'); }
      const task: PlanTask | undefined = plan.tasks.find((item: PlanTask) => item.id === taskId);
      if (task === undefined) { throw new Error('STUDY_NOT_FOUND: 学习任务不存在，请刷新计划。'); }
      task.status = status;
    });
  }

  addRecord(record: StudyRecord): Promise<void> {
    const snapshot: StudyRecord = JSON.parse(JSON.stringify(record)) as StudyRecord;
    return this.enqueue(async (document: StudyDocument) => {
      document.records.push(snapshot);
    });
  }

  async listRecords(planId: string): Promise<StudyRecord[]> {
    await this.pending;
    const document: StudyDocument = await this.read();
    return document.records.filter((record: StudyRecord) => record.planId === planId);
  }

  private enqueue(mutate: (document: StudyDocument) => Promise<void>): Promise<void> {
    const operation: Promise<void> = this.pending.then(async () => {
      const document: StudyDocument = await this.read();
      await mutate(document);
      await this.store.set(this.key, JSON.stringify(document));
    });
    this.pending = operation.then(() => {}, () => {});
    return operation;
  }

  private async read(): Promise<StudyDocument> {
    const raw: string = await this.store.get(this.key);
    if (raw === '') { return { version: 1, plans: [], records: [] }; }
    try {
      const document: StudyDocument = JSON.parse(raw) as StudyDocument;
      if (document === null || document.version !== 1 || !Array.isArray(document.plans) ||
        !Array.isArray(document.records)) {
        throw new Error('Invalid document');
      }
      const ids: Set<string> = new Set<string>();
      for (const plan of document.plans) {
        if (plan === null || typeof plan.id !== 'string' || ids.has(plan.id) ||
          typeof plan.createdAt !== 'number' || plan.conditions === null ||
          typeof plan.conditions.goal !== 'string' || typeof plan.conditions.dailyMinutes !== 'number' ||
          typeof plan.conditions.startDate !== 'string' || !Array.isArray(plan.tasks) ||
          !plan.tasks.every((task: PlanTask) => this.validTask(task))) {
          throw new Error('Invalid plan');
        }
        ids.add(plan.id);
      }
      for (const record of document.records) {
        if (record === null || typeof record.planId !== 'string' || typeof record.taskId !== 'string' ||
          typeof record.completedAt !== 'number') {
          throw new Error('Invalid record');
        }
      }
      return document;
    } catch {
      throw new Error('STORAGE_CORRUPT: 学习数据文件损坏或版本不兼容。请先备份，避免覆盖历史。');
    }
  }

  private validTask(task: PlanTask): boolean {
    return task !== null && typeof task.id === 'string' && typeof task.title === 'string' &&
      typeof task.day === 'number' && (task.status === 'pending' || task.status === 'done');
  }
}
