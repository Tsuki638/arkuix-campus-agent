import { CalendarDraft, CalendarEntry, CalendarEventInput } from '../contracts/Calendar';
import { calendarTimeText, calendarInputTime } from '../services/calendar/CalendarTime';
import { WorkspaceIcon } from './WorkspaceIcon';
import { WorkspaceTheme as T } from './WorkspaceTheme';

@Component
export struct CalendarDraftCard {
  @Prop draft: CalendarDraft;
  @Prop busy: boolean = false;
  @Prop available: boolean = false;
  onConfirm: (draft: CalendarDraft) => void = () => {};
  onCancel: (draft: CalendarDraft) => void = () => {};
  onEdit: (draft: CalendarDraft, eventId: string, input: CalendarEventInput) => Promise<boolean> = async () => false;
  @State private editingId: string = '';
  @State private editTitle: string = '';
  @State private editStart: string = '';
  @State private editEnd: string = '';
  @State private editReminder: string = '';
  @State private editError: string = '';

  private created(): number { return this.draft.events.filter((event: CalendarEntry) => event.state === 'created').length; }
  private editable(): boolean {
    return this.draft.status === 'pending' && this.draft.events.every((event: CalendarEntry) => event.state === 'pending');
  }
  private beginEdit(event: CalendarEntry): void {
    this.editingId = event.id; this.editTitle = event.title;
    this.editStart = calendarTimeText(event.startTime); this.editEnd = calendarTimeText(event.endTime);
    this.editReminder = event.reminderMinutes.join(','); this.editError = '';
  }
  private async saveEdit(event: CalendarEntry): Promise<void> {
    try {
      const input: CalendarEventInput = { title: this.editTitle,
        startTime: calendarInputTime(this.editStart), endTime: calendarInputTime(this.editEnd),
        reminderMinutes: this.editReminder.trim() ? this.editReminder.split(',').map((value: string) => Number(value.trim())) : [],
        taskId: event.taskId, description: event.description };
      if (await this.onEdit(this.draft, event.id, input)) { this.editingId = ''; }
    } catch (error) { this.editError = (error as Error).message || '时间格式无效。'; }
  }
  private statusText(): string {
    if (this.draft.status === 'completed') { return '已添加到系统日历'; }
    if (this.draft.status === 'cancelled') { return '草案已取消'; }
    return this.editable() ? '待你确认' : '有日程尚未完成';
  }
  private eventStatus(event: CalendarEntry): string {
    if (event.state === 'created') { return '已创建到系统日历'; }
    if (this.draft.status === 'cancelled') { return '已取消后续执行'; }
    if (event.state === 'writing' || event.state === 'uncertain') { return '结果待核对，可查询重试'; }
    return event.state === 'failed' ? '未完成' : '尚未写入';
  }

  @Builder
  private editForm(event: CalendarEntry) {
    Column({ space: 10 }) {
      TextInput({ text: this.editTitle, placeholder: '日程标题' }).fontSize(13).backgroundColor(T.canvas)
        .border({ width: 1, color: T.border, radius: 8 }).enabled(!this.busy)
        .onChange((text: string) => { this.editTitle = text; })
      Text('北京时间 · YYYY-MM-DD HH:mm').fontSize(10).fontColor(T.muted).width('100%')
      TextInput({ text: this.editStart, placeholder: '开始：2026-11-12 19:00' }).fontSize(12)
        .backgroundColor(T.canvas).border({ width: 1, color: T.border, radius: 8 }).enabled(!this.busy)
        .onChange((text: string) => { this.editStart = text; })
      TextInput({ text: this.editEnd, placeholder: '结束：2026-11-12 20:00' }).fontSize(12)
        .backgroundColor(T.canvas).border({ width: 1, color: T.border, radius: 8 }).enabled(!this.busy)
        .onChange((text: string) => { this.editEnd = text; })
      TextInput({ text: this.editReminder, placeholder: '提前提醒分钟数，例如 10；留空不提醒' }).fontSize(12)
        .backgroundColor(T.canvas).border({ width: 1, color: T.border, radius: 8 }).enabled(!this.busy)
        .onChange((text: string) => { this.editReminder = text; })
      if (this.editError.length > 0) { Text(this.editError).fontSize(11).fontColor(T.danger).width('100%') }
      Row({ space: 10 }) {
        Button('放弃修改', { type: ButtonType.Normal }).height(35).fontSize(12).fontColor(T.secondary)
          .backgroundColor(T.sidebar).borderRadius(8).enabled(!this.busy).onClick(() => { this.editingId = ''; })
        Button('保存修改', { type: ButtonType.Normal }).height(35).fontSize(12).fontColor('#FFFFFF')
          .backgroundColor(T.accent).borderRadius(8).enabled(!this.busy).onClick(() => { this.saveEdit(event); })
      }.width('100%').justifyContent(FlexAlign.End)
    }.width('100%').padding(12).backgroundColor(T.sidebar).borderRadius(10)
  }

  build() {
    Column({ space: 17 }) {
      Row({ space: 12 }) {
        Stack() { WorkspaceIcon({ name: 'calendar', iconSize: 20, color: T.accent }) }
          .width(40).height(40).backgroundColor(T.accentSoft).borderRadius(11)
        Column({ space: 5 }) {
          Text(this.statusText()).fontSize(16).fontWeight(FontWeight.Medium).fontColor(T.ink)
          Text(this.draft.events.length + ' 条日程 · 已创建 ' + this.created() + ' 条 · 北京时间')
            .fontSize(10).fontColor(T.secondary)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      }.width('100%')
      ForEach(this.draft.events, (event: CalendarEntry) => {
        Column({ space: 8 }) {
          Row({ space: 8 }) {
            Text(event.title).fontSize(14).fontWeight(FontWeight.Medium).fontColor(T.ink)
              .layoutWeight(1).lineHeight(22)
            if (this.editable()) {
              Button('修改', { type: ButtonType.Normal }).height(29).fontSize(11).fontColor(T.accent)
                .backgroundColor(T.accentSoft).borderRadius(7).enabled(!this.busy)
                .onClick(() => { this.beginEdit(event); })
            }
          }.width('100%')
          Text(calendarTimeText(event.startTime) + ' → ' + calendarTimeText(event.endTime))
            .fontSize(11).fontColor(T.secondary).width('100%').lineHeight(20)
          Text(event.reminderMinutes.length > 0 ? '提前 ' + event.reminderMinutes.join('、') + ' 分钟提醒' : '不设置提醒')
            .fontSize(10).fontColor(T.muted).width('100%')
          Text(this.eventStatus(event)).fontSize(10).fontColor(event.state === 'created' ? T.accent : T.secondary)
            .width('100%')
          if (event.error.length > 0 && this.draft.status !== 'cancelled') {
            Text(event.error).fontSize(11).fontColor(T.danger).width('100%').lineHeight(19)
          }
          if (this.editingId === event.id) { this.editForm(event) }
        }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 12, bottom: 12 })
          .border({ width: { top: 1 }, color: T.border })
      }, (event: CalendarEntry) => event.id)
      if (this.draft.status === 'pending') {
        Text(this.created() > 0 ? '已创建的日程会保留，重试只处理尚未确认成功的条目。' :
          '确认后会创建真实系统日程，提醒由系统日历按其设置触发。')
          .fontSize(10).fontColor(T.muted).lineHeight(18).width('100%')
        Button(this.editable() ? '确认添加 ' + this.draft.events.length + ' 条日程' : '查询并重试未完成项',
          { type: ButtonType.Normal }).height(43).width('100%').fontSize(13).fontColor('#FFFFFF')
          .backgroundColor(T.ink).borderRadius(9).enabled(!this.busy && this.available && this.editingId.length === 0)
          .onClick(() => { this.onConfirm(this.draft); })
        Button(this.created() > 0 ? '取消剩余日程' : '取消草案', { type: ButtonType.Normal })
          .height(35).width('100%').fontSize(12).fontColor(T.secondary).backgroundColor(T.sidebar).borderRadius(8)
          .enabled(!this.busy).onClick(() => { this.onCancel(this.draft); })
      }
    }.padding(20).width('100%').backgroundColor(T.surface).border({ width: 1, color: T.border, radius: 15 })
      .alignItems(HorizontalAlign.Start)
  }
}
