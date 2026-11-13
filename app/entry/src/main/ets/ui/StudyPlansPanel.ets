import { PlanTask, PlanVersion } from '../services/storage/StudyDataRepository';
import { WorkspaceIcon } from './WorkspaceIcon';
import { WorkspaceTheme as T } from './WorkspaceTheme';
import { LearningPlan, LearningTask, ScheduledBlock } from '../contracts/LearningModels';
import { calendarTimeText } from '../services/calendar/CalendarTime';

@Component
export struct StudyPlansPanel {
  @Prop plans: PlanVersion[] = [];
  @Prop learningPlan: LearningPlan | null = null;
  @Prop error: string = '';
  @Prop busy: boolean = false;
  @Prop ready: boolean = false;
  onToggle: (planId: string, task: PlanTask) => void = () => {};
  onCreate: () => void = () => {};
  onRefresh: () => void = () => {};
  onSchedule: (plan: PlanVersion) => void = () => {};
  onToggleLearning: (task: LearningTask) => void = () => {};
  onOpenSchedule: () => void = () => {};

  private completed(plan: PlanVersion): number {
    return plan.tasks.filter((task: PlanTask) => task.status === 'done').length;
  }

  private totalCompleted(): number {
    return this.plans.reduce((count: number, plan: PlanVersion) => count + this.completed(plan), 0);
  }

  private totalTasks(): number {
    return this.plans.reduce((count: number, plan: PlanVersion) => count + plan.tasks.length, 0);
  }

  private renderId(plan: PlanVersion): string {
    return plan.id + ':' + plan.tasks.map((task: PlanTask) => task.status).join(',');
  }

  @Builder
  private statistic(value: string, label: string) {
    Column({ space: 7 }) {
      Text(value).fontSize(26).fontWeight(FontWeight.Medium).fontColor(T.ink)
      Text(label).fontSize(11).fontColor(T.secondary)
    }.layoutWeight(1).alignItems(HorizontalAlign.Start).padding(18)
      .borderRadius(12).backgroundColor(T.sidebar)
  }

  @Builder
  private directionPlan(plan: LearningPlan) {
    Column({ space: 12 }) {
      Text('当前对话的阶段计划 · ' + plan.weeks + ' 周').fontSize(17).fontWeight(FontWeight.Medium).fontColor(T.ink)
      ForEach(plan.tasks, (task: LearningTask) => {
        Column({ space: 5 }) {
          Text('第 ' + task.week + ' 周 · ' + task.phase).fontSize(11).fontColor(T.secondary)
          Text(task.title).fontSize(14).fontColor(T.ink)
          Text(task.completionCriteria).fontSize(12).lineHeight(19).fontColor(T.secondary)
          Text('预计 ' + task.estimatedMinutes + ' 分钟 · 剩余 ' + task.remainingMinutes + ' 分钟')
            .fontSize(11).fontColor(T.secondary)
          Button(task.status === 'done' ? '撤销完成' : '标记完成', { type: ButtonType.Normal })
            .height(34).fontSize(12).fontColor(T.accent).backgroundColor(T.accentSoft)
            .enabled(!this.busy).onClick(() => { this.onToggleLearning(task); })
        }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 7, bottom: 7 })
      }, (task: LearningTask) => task.id + ':' + plan.version)
      if (plan.needsScheduling) {
        Text('请回到对话提供空闲时段，更新周排期后再预览日历。').fontSize(12).fontColor(T.secondary)
      } else if (plan.schedule.length > 0) {
        Text('已排时段（北京时间）').fontSize(14).fontColor(T.ink)
        ForEach(plan.schedule, (block: ScheduledBlock) => {
          Text(block.title + '\n' + calendarTimeText(Date.parse(block.startAt)) + ' 至 ' +
            calendarTimeText(Date.parse(block.endAt))).fontSize(12).lineHeight(19).fontColor(T.secondary)
        }, (block: ScheduledBlock) => block.id + ':' + plan.version)
      }
      if (plan.unscheduledTaskIds.length > 0) {
        Text('本周有 ' + plan.unscheduledTaskIds.length + ' 项任务未排完，可回到对话调整可用时段。')
          .fontSize(12).lineHeight(19).fontColor(T.secondary)
      }
      if (plan.needsScheduling === false || (!plan.needsScheduling && plan.schedule.length > 0)) {
        Button('打开日程预览', { type: ButtonType.Normal }).height(34).fontSize(12)
          .fontColor(T.accent).backgroundColor(T.accentSoft).enabled(!this.busy).onClick(() => { this.onOpenSchedule(); })
      }
    }.width('100%').padding(20).alignItems(HorizontalAlign.Start)
      .border({ width: 1, color: T.border }).borderRadius(15)
  }

  @Builder
  private planCard(plan: PlanVersion) {
    Column({ space: 15 }) {
      Row({ space: 12 }) {
        Stack() {
          WorkspaceIcon({ name: 'plan', iconSize: 20, color: T.accent })
        }.width(38).height(38).backgroundColor(T.accentSoft).borderRadius(10)
        Column({ space: 5 }) {
          Text(plan.conditions.goal).fontSize(17).fontWeight(FontWeight.Medium).fontColor(T.ink)
            .width('100%')
          Text(plan.tasks.length + ' 项任务 · 已完成 ' + this.completed(plan) + ' 项')
            .fontSize(11).fontColor(T.secondary)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      }.width('100%')
      Progress({ value: this.completed(plan), total: Math.max(1, plan.tasks.length), type: ProgressType.Linear })
        .color(T.accent).backgroundColor(T.border).width('100%').style({ strokeWidth: 4 })
      Column({ space: 4 }) {
        ForEach(plan.tasks, (task: PlanTask) => {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 12 }) {
              Stack() {
                if (task.status === 'done') {
                  WorkspaceIcon({ name: 'check', iconSize: 13, color: '#FFFFFF' })
                }
              }.width(19).height(19).borderRadius(6)
                .backgroundColor(task.status === 'done' ? T.accent : T.surface)
                .border({ width: 1, color: task.status === 'done' ? T.accent : '#CFCFC7' })
              Column({ space: 4 }) {
                Text('DAY ' + task.day).fontSize(9).fontColor(T.muted).letterSpacing(1)
                Text(task.title).fontSize(13).fontColor(task.status === 'done' ? T.secondary : T.ink)
                  .decoration({ type: task.status === 'done' ? TextDecorationType.LineThrough : TextDecorationType.None })
                  .textAlign(TextAlign.Start).lineHeight(21)
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              Text(task.status === 'done' ? '已完成' : '待完成').fontSize(10).fontColor(T.muted)
            }.width('100%')
          }.width('100%').padding({ left: 2, right: 2, top: 13, bottom: 13 }).borderRadius(8)
            .backgroundColor(Color.Transparent).enabled(!this.busy)
            .accessibilityText((task.status === 'done' ? '撤销完成：' : '标记完成：') + task.title)
            .onClick(() => { this.onToggle(plan.id, task); })
        }, (task: PlanTask) => task.id)
      }.width('100%')
      Button('准备日历日程', { type: ButtonType.Normal }).height(39).width('100%')
        .fontSize(12).fontColor(T.accent).backgroundColor(T.accentSoft).borderRadius(9)
        .enabled(!this.busy && this.ready && this.completed(plan) < plan.tasks.length)
        .onClick(() => { this.onSchedule(plan); })
    }.padding(20).width('100%').backgroundColor(T.surface).borderRadius(15)
      .border({ width: 1, color: T.border }).alignItems(HorizontalAlign.Start)
  }

  build() {
    Scroll() {
      Column({ space: 22 }) {
        Column({ space: 9 }) {
          Text('每一点进步，都算数。').fontSize(26).fontWeight(FontWeight.Medium).fontColor(T.ink)
          Text('你的学习安排与完成记录，都在这里。').fontSize(13).fontColor(T.secondary).lineHeight(22)
        }.width('100%').alignItems(HorizontalAlign.Start)
        if (this.learningPlan !== null) { this.directionPlan(this.learningPlan) }
        Row({ space: 10 }) {
          this.statistic(this.plans.length.toString(), '学习计划')
          this.statistic(this.totalTasks().toString(), '全部任务')
          this.statistic(this.totalCompleted().toString(), '已完成')
        }.width('100%')
        if (this.error.length > 0) {
          Column({ space: 10 }) {
            Text(this.error).fontSize(13).fontColor(T.danger).width('100%')
            Button('重新读取', { type: ButtonType.Normal }).fontSize(12).fontColor(T.danger)
              .height(36).borderRadius(8).backgroundColor(T.dangerSoft).enabled(!this.busy)
              .onClick(() => { this.onRefresh(); })
          }.width('100%').alignItems(HorizontalAlign.Start)
        }
        if (this.plans.length === 0 && this.learningPlan === null && this.error.length === 0) {
          Column({ space: 14 }) {
            WorkspaceIcon({ name: 'plan', iconSize: 35, color: T.muted })
            Text('给第一个目标，留个位置。').fontSize(17).fontColor(T.ink)
            Text('在对话中生成计划后，就能在这里查看并逐项打卡。')
              .fontSize(12).fontColor(T.secondary).lineHeight(21).textAlign(TextAlign.Center)
            Button('开始制定计划', { type: ButtonType.Normal }).height(40).fontSize(13).fontColor('#FFFFFF')
              .backgroundColor(T.ink).borderRadius(9).margin({ top: 8 }).enabled(!this.busy && this.ready)
              .onClick(() => { this.onCreate(); })
          }.width('100%').padding({ top: 48, bottom: 48, left: 18, right: 18 })
            .border({ width: 1, color: T.border }).borderRadius(15)
        } else {
          ForEach(this.plans, (plan: PlanVersion) => {
            this.planCard(plan)
          }, (plan: PlanVersion) => this.renderId(plan))
          Button('+  制定新计划', { type: ButtonType.Normal }).height(42).width('100%')
            .fontSize(13).fontColor(T.secondary).backgroundColor(T.sidebar).borderRadius(9)
            .enabled(!this.busy && this.ready).onClick(() => { this.onCreate(); })
        }
        Text('基础计划独立保存，阶段计划随当前对话保存。')
          .fontSize(10).fontColor(T.muted).textAlign(TextAlign.Center).lineHeight(18)
      }.width('100%').constraintSize({ maxWidth: 760 }).padding({ top: 30, bottom: 28 })
    }.width('100%').height('100%').scrollBar(BarState.Auto).align(Alignment.Top)
  }
}
