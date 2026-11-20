import { WorkspaceIcon } from './WorkspaceIcon';
import { WorkspaceTheme as T } from './WorkspaceTheme';
import { WorkspaceBrand } from './WorkspaceBrand';

@Component
export struct WelcomePanel {
  @Prop wide: boolean = false;
  @Prop compactHeight: boolean = false;
  @Prop available: boolean = true;
  onPrompt: (text: string) => void = () => {};

  @Builder
  private promptCard(icon: string, title: string, description: string, prompt: string) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 14 }) {
        WorkspaceIcon({ name: icon, iconSize: 22, color: T.accent })
        Column({ space: 6 }) {
          Text(title).fontSize(15).fontWeight(FontWeight.Medium).fontColor(T.ink)
            .textAlign(TextAlign.Start)
          Text(description).fontSize(12).fontColor(T.secondary).lineHeight(20)
            .textAlign(TextAlign.Start).width('100%')
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        WorkspaceIcon({ name: 'right', iconSize: 16, color: T.muted })
      }.width('100%')
    }.width(this.wide ? '48.5%' : '100%')
      .constraintSize({ minHeight: this.compactHeight ? 76 : 88 }).flexShrink(0).padding(this.compactHeight ? 14 : 18)
      .backgroundColor(T.surface).border({ width: 1, color: T.border, radius: 12 })
      .enabled(this.available)
      .onClick(() => { this.onPrompt(prompt); })
  }

  build() {
    Column({ space: 0 }) {
      if (!this.compactHeight) {
        WorkspaceBrand({ diameter: this.wide ? 60 : 48 }).margin({ bottom: 24 })
      }
      Text('从你的目标开始').fontSize(this.compactHeight ? 24 : (this.wide ? 32 : 27)).fontWeight(FontWeight.Medium)
        .fontColor(T.ink).textAlign(TextAlign.Center).margin({ bottom: 12 })
      Text('聊聊想做的事，一起理清下一步。').fontSize(14).fontColor(T.secondary)
        .lineHeight(24).textAlign(TextAlign.Center).margin({ bottom: this.compactHeight ? 16 : 28 })
      Flex({ direction: this.wide ? FlexDirection.Row : FlexDirection.Column,
        justifyContent: FlexAlign.SpaceBetween }) {
        this.promptCard('book', '考研准备', '明确目标，安排复习',
          '我想准备考研，请先帮我梳理需要明确的目标和条件。')
        this.promptCard('compass', '就业探索', '找到适合的学习方向',
          '我想为就业做准备，请结合我的专业、兴趣和基础，一起探索学习方向。')
      }.width('100%').constraintSize({ minHeight: this.wide ?
        (this.compactHeight ? 76 : 88) : (this.compactHeight ? 164 : 188) })
      Text('也可以直接在下方输入你的想法。')
        .fontSize(12).fontColor(T.muted).lineHeight(20).textAlign(TextAlign.Center)
        .margin({ top: this.compactHeight ? 16 : 22 })
    }.width('100%').constraintSize({ maxWidth: 600 })
      .padding({ top: this.compactHeight ? 12 : 24, bottom: this.compactHeight ? 12 : 24 })
  }
}
