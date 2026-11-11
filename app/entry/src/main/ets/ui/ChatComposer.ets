import { WorkspaceIcon } from './WorkspaceIcon';
import { WorkspaceTheme as T } from './WorkspaceTheme';

@Component
export struct ChatComposer {
  @Link input: string;
  @Prop busy: boolean = false;
  @Prop ready: boolean = false;
  @Prop offline: boolean = true;
  @Prop speechReady: boolean = false;
  @Prop speechActive: boolean = false;
  onSubmit: () => void = () => {};
  onListen: () => void = () => {};
  onStopSpeech: () => void = () => {};
  onSettings: () => void = () => {};

  private canSend(): boolean { return !this.busy && this.ready && this.input.trim().length > 0; }

  build() {
    Column({ space: 0 }) {
      Column({ space: 3 }) {
        TextArea({ text: this.input, placeholder: '说说你的目标，或问一个问题…' })
          .id('workspace-composer').height(72).fontSize(15).fontColor(T.ink).placeholderColor(T.muted)
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
        Row({ space: 8 }) {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 6 }) {
              WorkspaceIcon({ name: 'terminal', iconSize: 15 })
              Text(this.offline ? '离线示例' : '云端模型').fontSize(11).fontColor(T.secondary)
              WorkspaceIcon({ name: 'chevron', iconSize: 12 })
            }
          }.height(36).padding({ left: 7, right: 8 }).borderRadius(7).backgroundColor(Color.Transparent)
            .enabled(!this.busy).onClick(() => { this.onSettings(); })
          Blank().layoutWeight(1)
          if (this.speechActive) {
            Button({ type: ButtonType.Normal }) {
              WorkspaceIcon({ name: 'stop', iconSize: 18, color: T.danger })
            }.width(40).height(40).padding(0).borderRadius(20).backgroundColor(T.dangerSoft)
              .accessibilityText('停止语音').onClick(() => { this.onStopSpeech(); })
          } else {
            Button({ type: ButtonType.Normal }) {
              WorkspaceIcon({ name: 'mic', iconSize: 19, color: this.speechReady ? T.secondary : T.muted })
            }.width(40).height(40).padding(0).borderRadius(20).backgroundColor(Color.Transparent)
              .accessibilityText(this.speechReady ? '语音输入' : '当前设备语音不可用')
              .enabled(this.speechReady && !this.busy && this.ready).onClick(() => { this.onListen(); })
          }
          Button({ type: ButtonType.Normal }) {
            if (this.busy) {
              LoadingProgress().width(19).height(19).color('#FFFFFF')
            } else {
              WorkspaceIcon({ name: 'arrow', iconSize: 21, color: '#FFFFFF' })
            }
          }.width(38).height(38).padding(0).borderRadius(19).backgroundColor(T.ink)
            .opacity(this.canSend() || this.busy ? 1 : 0.3).enabled(this.canSend())
            .accessibilityText(this.busy ? '正在处理' : '发送消息').onClick(() => { this.onSubmit(); })
        }.width('100%')
      }.padding({ left: 14, right: 12, top: 6, bottom: 10 }).width('100%')
        .backgroundColor(T.surface).border({ width: 1, color: '#DADBD3', radius: 20 })
        .shadow({ radius: 16, color: '#08000000', offsetY: 3 })
      Text('AI 也会有疏漏，重要信息请核对。').fontSize(10).fontColor(T.muted)
        .textAlign(TextAlign.Center).margin({ top: 11, bottom: 3 })
    }.width('100%')
  }
}
