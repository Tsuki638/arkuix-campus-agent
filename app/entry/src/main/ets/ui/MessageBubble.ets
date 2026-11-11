import { ChatMessage, ToolCall, ToolResult, makeMessage } from '../contracts/Models';
import { WorkspaceIcon } from './WorkspaceIcon';
import { WorkspaceTheme as T } from './WorkspaceTheme';
import { WorkspaceBrand } from './WorkspaceBrand';
import { CalendarDraft, CalendarEntry } from '../contracts/Calendar';
import { calendarTimeText } from '../services/calendar/CalendarTime';

interface CalendarToolContent { draft: CalendarDraft; }

@Component
export struct MessageBubble {
  @Prop message: ChatMessage = makeMessage('assistant', '');
  @State private expanded: boolean = false;
  onOpenPlans: () => void = () => {};
  onOpenCalendar: () => void = () => {};

  private toolResult(): ToolResult | null {
    if (this.message.role !== 'tool') { return null; }
    try {
      const result: ToolResult = JSON.parse(this.message.content) as ToolResult;
      if (result !== null && typeof result.content === 'string' && typeof result.success === 'boolean') { return result; }
    } catch { /* 旧会话或非结构化结果继续显示原文。 */ }
    return null;
  }

  private toolLabel(): string {
    const result: ToolResult | null = this.toolResult();
    if (result === null) { return '查看工具结果'; }
    const name: string = result.name === 'create_study_plan' ? '学习计划' :
      result.name === 'prepare_calendar_events' ? '日程草案' : result.name === 'list_calendar_drafts' ? '日程查询' : '工具执行';
    return name + (result.success ? ' · 已完成' : ' · 未完成');
  }

  private toolText(): string {
    const result: ToolResult | null = this.toolResult();
    if (result?.name === 'prepare_calendar_events' && result.success) {
      try {
        const value: CalendarToolContent = JSON.parse(result.content) as CalendarToolContent;
        return '已准备 ' + value.draft.events.length + ' 条日程。请在日程预览中核对并确认。\n' +
          value.draft.events.map((event: CalendarEntry) => event.title + ' · ' + calendarTimeText(event.startTime) + '（北京时间）').join('\n');
      } catch { return '日程草案已准备，请打开日程预览查看。'; }
    }
    return result?.content ?? this.message.content;
  }

  build() {
    if (this.message.role === 'user') {
      Row() {
        Blank().layoutWeight(1)
        Text(this.message.content).fontSize(15).lineHeight(24).fontColor(T.ink)
          .copyOption(CopyOptions.InApp).constraintSize({ maxWidth: '86%' })
          .padding({ left: 17, right: 17, top: 12, bottom: 12 }).backgroundColor('#ECEDE7').borderRadius(17)
      }.width('100%').padding({ top: 10, bottom: 8 })
    } else if (this.message.role === 'tool') {
      Column({ space: 10 }) {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 9 }) {
            WorkspaceIcon({ name: 'tool', iconSize: 16, color: T.secondary })
            Text(this.toolLabel()).fontSize(12).fontColor(T.secondary).layoutWeight(1).textAlign(TextAlign.Start)
            Text(this.expanded ? '收起' : '展开').fontSize(11).fontColor(T.muted)
          }.width('100%')
        }.width('100%').height(43).padding({ left: 13, right: 13 }).backgroundColor(T.sidebar).borderRadius(9)
          .onClick(() => { this.expanded = !this.expanded; })
        if (this.expanded) {
          Text(this.toolText()).fontSize(13).lineHeight(22)
            .fontColor(T.secondary).width('100%').copyOption(CopyOptions.InApp).padding({ left: 12, right: 12 })
          if (this.toolResult()?.success && this.toolResult()?.name === 'create_study_plan') {
            Button('查看学习计划', { type: ButtonType.Normal }).fontSize(12).fontColor(T.accent)
              .height(34).backgroundColor(T.accentSoft).borderRadius(8)
              .onClick(() => { this.onOpenPlans(); })
          }
        }
        if (this.toolResult()?.success && this.toolResult()?.name === 'prepare_calendar_events') {
          Button('预览日程并确认', { type: ButtonType.Normal }).height(36).fontSize(12).fontColor(T.accent)
            .backgroundColor(T.accentSoft).borderRadius(8).onClick(() => { this.onOpenCalendar(); })
        }
      }.width('100%').alignItems(HorizontalAlign.Start)
    } else {
      Column({ space: 13 }) {
        Row({ space: 8 }) {
          WorkspaceBrand({ diameter: 28 })
          Text('Campus').fontSize(13).fontWeight(FontWeight.Medium).fontColor(T.ink)
        }
        if (this.message.content.length > 0) {
          Text(this.message.content).fontSize(15).fontColor(T.ink).lineHeight(26)
            .width('100%').copyOption(CopyOptions.InApp)
        }
        if (this.message.toolCalls.length > 0) {
          Row({ space: 7 }) {
            WorkspaceIcon({ name: 'tool', iconSize: 14 })
            Text('调用 ' + this.message.toolCalls.map((call: ToolCall) =>
              call.name === 'create_study_plan' ? '学习计划工具' : call.name).join('、'))
              .fontSize(11).fontColor(T.secondary)
          }
        }
      }.alignItems(HorizontalAlign.Start).width('100%').padding({ top: 10, bottom: 12 })
    }
  }
}
