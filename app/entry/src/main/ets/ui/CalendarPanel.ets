import { CalendarDraft, CalendarEventInput } from '../contracts/Calendar';
import { CalendarDraftCard } from './CalendarDraftCard';
import { WorkspaceIcon } from './WorkspaceIcon';
import { WorkspaceTheme as T } from './WorkspaceTheme';

@Component
export struct CalendarPanel {
  @Prop drafts: CalendarDraft[] = [];
  @Prop busy: boolean = false;
  @Prop available: boolean = false;
  @Prop unavailableMessage: string = '';
  @Prop @Watch('feedbackChanged') error: string = '';
  @Prop @Watch('feedbackChanged') notice: string = '';
  private scroller: Scroller = new Scroller();
  onConfirm: (draft: CalendarDraft) => void = () => {};
  onCancel: (draft: CalendarDraft) => void = () => {};
  onEdit: (draft: CalendarDraft, eventId: string, input: CalendarEventInput) => Promise<boolean> = async () => false;
  onRefresh: () => void = () => {};
  onCreate: () => void = () => {};

  private feedbackChanged(): void {
    if (this.error.length > 0 || this.notice.length > 0) { this.scroller.scrollEdge(Edge.Top); }
  }

  build() {
    Scroll(this.scroller) {
      Column({ space: 20 }) {
        Column({ space: 9 }) {
          Text('为想做的事，留出时间。').fontSize(25).fontWeight(FontWeight.Medium).fontColor(T.ink)
          Text('预览每个时段，确认后添加到系统日历。').fontSize(13).fontColor(T.secondary).lineHeight(22)
        }.width('100%').alignItems(HorizontalAlign.Start)
        if (!this.available) {
          Text(this.unavailableMessage).fontSize(12).fontColor(T.secondary).lineHeight(21).width('100%')
            .padding(16).backgroundColor(T.sidebar).borderRadius(11)
        }
        if (this.notice.length > 0) {
          Text(this.notice).fontSize(12).fontColor(T.accent).lineHeight(21).width('100%')
            .padding(16).backgroundColor(T.accentSoft).borderRadius(11)
        }
        if (this.error.length > 0) {
          Text(this.error).fontSize(12).fontColor(T.danger).lineHeight(21).width('100%')
            .padding(16).backgroundColor(T.dangerSoft).borderRadius(11)
        }
        if (this.drafts.length === 0 && this.error.length === 0) {
          Column({ space: 15 }) {
            WorkspaceIcon({ name: 'calendar', iconSize: 38, color: T.muted })
            Text('下一步，从一个时段开始。').fontSize(17).fontColor(T.ink)
            Text('告诉助手具体安排，或从学习计划准备日程草案。')
              .fontSize(12).fontColor(T.secondary).lineHeight(21).textAlign(TextAlign.Center)
            Button('在对话中安排日程', { type: ButtonType.Normal }).height(41).fontSize(12).fontColor('#FFFFFF')
              .backgroundColor(T.ink).borderRadius(9).enabled(!this.busy).onClick(() => { this.onCreate(); })
          }.width('100%').padding({ top: 45, bottom: 45, left: 18, right: 18 })
            .border({ width: 1, color: T.border, radius: 14 })
        }
        ForEach(this.drafts, (draft: CalendarDraft) => {
          CalendarDraftCard({ draft: draft, busy: this.busy, available: this.available,
            onConfirm: this.onConfirm, onCancel: this.onCancel, onEdit: this.onEdit })
        }, (draft: CalendarDraft) => draft.id + ':' + draft.revision + ':' + draft.status)
        Button('刷新日程记录', { type: ButtonType.Normal }).height(38).fontSize(12).fontColor(T.secondary)
          .backgroundColor(T.sidebar).borderRadius(9).enabled(!this.busy).onClick(() => { this.onRefresh(); })
        Text('日历同步记录独立保存。取消草案不会删除已写入的日程。')
          .fontSize(10).fontColor(T.muted).lineHeight(18).textAlign(TextAlign.Center)
      }.width('100%').constraintSize({ maxWidth: 760 }).padding({ top: 30, bottom: 28 })
    }.width('100%').height('100%').scrollBar(BarState.Auto).align(Alignment.Top)
  }
}
