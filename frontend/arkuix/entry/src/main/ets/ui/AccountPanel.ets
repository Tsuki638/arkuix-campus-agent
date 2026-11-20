import { WorkspaceBrand } from './WorkspaceBrand';
import { WorkspaceTheme as T } from './WorkspaceTheme';

@Component
export struct AccountPanel {
  @Prop username: string = '';
  @Prop busy: boolean = false;
  @Prop legacyAvailable: boolean = false;
  @Prop error: string = '';
  @Prop notice: string = '';
  onSync: () => void = () => {};
  onImport: () => void = () => {};
  onSignOut: () => void = () => {};

  build() {
    Scroll() {
      Column({ space: 18 }) {
        Row({ space: 14 }) {
          WorkspaceBrand({ diameter: 50 })
          Column({ space: 5 }) {
            Text('@' + this.username).fontSize(22).fontWeight(FontWeight.Medium).fontColor(T.ink)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text('对话、计划和日历草案随账号同步').fontSize(13).fontColor(T.secondary).lineHeight(20)
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        }.width('100%').padding(16).backgroundColor(T.accentSoft).borderRadius(10)
        if (this.notice.length > 0 || this.error.length > 0) {
          Text(this.error.length > 0 ? this.error : this.notice).fontSize(13).lineHeight(21)
            .fontColor(this.error.length > 0 ? T.danger : T.accent).width('100%')
        }
        Button('同步记录').width('100%').height(44).borderRadius(9).fontSize(14)
          .backgroundColor(T.ink).fontColor(Color.White).enabled(!this.busy).onClick(() => { this.onSync(); })
        if (this.legacyAvailable) {
          Button('导入这台设备的旧记录').width('100%').height(44).borderRadius(9).fontSize(14)
            .backgroundColor(T.sidebar).fontColor(T.ink).enabled(!this.busy).onClick(() => { this.onImport(); })
        }
        Divider().color(T.border)
        Button('退出登录').width('100%').height(44).borderRadius(9).fontSize(14)
          .backgroundColor(T.dangerSoft).fontColor(T.danger).enabled(!this.busy).onClick(() => { this.onSignOut(); })
      }.width('100%').constraintSize({ maxWidth: 540 }).padding({ top: 26, bottom: 26 })
    }.width('100%').height('100%').scrollBar(BarState.Auto)
  }
}
