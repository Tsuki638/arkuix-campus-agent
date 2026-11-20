import { WorkspaceIcon } from './WorkspaceIcon';
import { WorkspaceTheme as T } from './WorkspaceTheme';

@Component
export struct ChatComposer {
  @Link input: string;
  @Prop busy: boolean = false;
  @Prop ready: boolean = false;
  @Prop speechReady: boolean = false;
  @Prop speechActive: boolean = false;
  @Prop compactHeight: boolean = false;
  onSubmit: () => void = () => {};
  onListen: () => void = () => {};
  onStopSpeech: () => void = () => {};

  private canSend(): boolean { return !this.busy && this.ready && this.input.trim().length > 0; }

  build() {
    Column({ space: 0 }) {
      TextArea({ text: this.input, placeholder: '说说你的目标…' })
        .id('workspace-composer').height(this.compactHeight ? 52 : 64)
        .fontSize(15).fontColor(T.ink).placeholderColor(T.muted)
        .backgroundColor(Color.Transparent).padding({ left: 4, right: 4, top: 8, bottom: 8 })
        .borderRadius(0).enabled(!this.busy && this.ready).enterKeyType(EnterKeyType.NEW_LINE)
        .onChange((value: string) => { this.input = value; })
        .onKeyEvent((event: KeyEvent) => {
          // 桌面键盘 Enter 发送，Shift + Enter 保留多行输入。
          if (event.type === KeyType.Down && event.keyCode === 2054 &&
            !(event.getModifierKeyState !== undefined && event.getModifierKeyState(['Shift']))) {
            if (this.canSend()) { this.onSubmit(); }
            return true;
          }
          return false;
        })
      Row({ space: 6 }) {
        Blank().layoutWeight(1)
        if (this.speechActive) {
          Button({ type: ButtonType.Normal }) {
            WorkspaceIcon({ name: 'stop', iconSize: 18, color: T.danger })
          }.width(44).height(44).padding(0).borderRadius(12).backgroundColor(T.dangerSoft)
            .accessibilityText('停止语音').onClick(() => { this.onStopSpeech(); })
        } else if (this.speechReady) {
          Button({ type: ButtonType.Normal }) {
            WorkspaceIcon({ name: 'mic', iconSize: 20, color: T.secondary })
          }.width(44).height(44).padding(0).borderRadius(12).backgroundColor(Color.Transparent)
            .accessibilityText('语音输入')
            .enabled(!this.busy && this.ready).onClick(() => { this.onListen(); })
        }
        Button({ type: ButtonType.Normal }) {
          if (this.busy) {
            LoadingProgress().width(19).height(19).color('#FFFFFF')
          } else {
            WorkspaceIcon({ name: 'arrow', iconSize: 21, color: '#FFFFFF' })
          }
        }.width(44).height(44).padding(0).borderRadius(12).backgroundColor(T.ink)
          .opacity(this.canSend() || this.busy ? 1 : 0.3).enabled(this.canSend())
          .accessibilityText(this.busy ? '正在处理' : '发送消息').onClick(() => { this.onSubmit(); })
      }.width('100%')
    }.padding({ left: 14, right: 10, top: 4, bottom: 10 }).width('100%')
      .backgroundColor(T.surface).border({ width: 1, color: T.border, radius: 16 })
  }
}
