import { WorkspaceIcon } from './WorkspaceIcon';
import { WorkspaceTheme as T } from './WorkspaceTheme';
import { WorkspaceBrand } from './WorkspaceBrand';

@Component
export struct WelcomePanel {
  @Prop wide: boolean = false;
  @Prop offline: boolean = true;
  @Prop available: boolean = true;
  onPrompt: (text: string) => void = () => {};

  @Builder
  private promptCard(icon: string, title: string, description: string, prompt: string) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 12 }) {
        Row({ space: 9 }) {
          Stack() {
            WorkspaceIcon({ name: icon, iconSize: 18, color: T.accent })
          }.width(30).height(30).backgroundColor(T.accentSoft).borderRadius(9)
          Text(title).fontSize(13).fontWeight(FontWeight.Medium).fontColor(T.ink)
            .layoutWeight(1).textAlign(TextAlign.Start)
          WorkspaceIcon({ name: 'right', iconSize: 14, color: T.muted })
        }.width('100%')
        Text(description).fontSize(11).fontColor(T.secondary).maxLines(2).lineHeight(19)
          .textAlign(TextAlign.Start)
      }.alignItems(HorizontalAlign.Start).width('100%')
    }.layoutWeight(1).height(this.wide ? 112 : 110).padding(14)
      .backgroundColor(T.surface).border({ width: 1, color: T.border, radius: 15 })
      .enabled(this.available)
      .onClick(() => { this.onPrompt(prompt); })
  }

  build() {
    Column({ space: 0 }) {
      WorkspaceBrand({ diameter: this.wide ? 76 : 66 }).margin({ bottom: 14 })
      Text('CAMPUS  /  学习工作台').fontSize(9).letterSpacing(1.4).fontColor(T.accent)
        .margin({ bottom: 15 })
      Text('让每一步，都有方向。').fontSize(this.wide ? 32 : 24).fontWeight(FontWeight.Medium)
        .fontColor(T.ink).textAlign(TextAlign.Center).margin({ bottom: 12 })
      Text('聊聊你的目标，把想法变成下一步行动。').fontSize(13).fontColor(T.secondary)
        .lineHeight(22).textAlign(TextAlign.Center).margin({ bottom: this.wide ? 30 : 24 })
      Row({ space: 10 }) {
        this.promptCard('book', '考研准备', '理清备考目标与复习节奏',
          this.offline ? '复习考研数学|7' : '我想准备考研，请先帮我梳理需要明确的目标和条件。')
        this.promptCard('compass', '就业探索', '找到适合自己的学习路径',
          this.offline ? '学习求职基础技能|7' : '我想为就业做准备，请结合我的专业、兴趣和基础，一起探索学习方向。')
      }.width('100%').margin({ bottom: 10 })
      Row({ space: 10 }) {
        this.promptCard('plan', '制定计划', '把一个目标拆成每日任务',
          this.offline ? '复习高数|3' : '请帮我制定一份学习计划，先问问我的目标、可用时间和当前基础。')
        this.promptCard('spark', '从小处开始', '给自己一个短期学习挑战',
          this.offline ? '每天阅读专业书籍|3' : '我还没确定学习方向，想先尝试一个短期学习任务，你有什么建议？')
      }.width('100%')
      Text(this.offline ? '离线示例可体验基础计划，连接云端模型后可自由交流。' : '选择一个起点，或在下方直接说说你的想法。')
        .fontSize(10).fontColor(T.muted).lineHeight(18).textAlign(TextAlign.Center).margin({ top: 18 })
    }.width('100%').constraintSize({ maxWidth: 600 }).padding({ top: 24, bottom: 24 })
  }
}
