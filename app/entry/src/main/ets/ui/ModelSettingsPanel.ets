import { WorkspaceIcon } from './WorkspaceIcon';
import { WorkspaceTheme as T } from './WorkspaceTheme';
import { DeepSeekConfig } from '../services/model/DeepSeekConfig';

@Component
export struct ModelSettingsPanel {
  @Link endpoint: string;
  @Link model: string;
  @Link apiKey: string;
  @Prop error: string = '';
  @Prop busy: boolean = false;
  @Prop ready: boolean = false;
  @Prop offline: boolean = true;
  onApply: (offline: boolean) => void = () => {};

  build() {
    Scroll() {
      Column({ space: 24 }) {
        Column({ space: 9 }) {
          Text('选择你的思考伙伴。').fontSize(26).fontWeight(FontWeight.Medium).fontColor(T.ink)
          Text('连接云端模型，或使用离线示例体验学习计划。').fontSize(13).fontColor(T.secondary).lineHeight(22)
        }.width('100%').alignItems(HorizontalAlign.Start)

        Row({ space: 12 }) {
          Stack() {
            WorkspaceIcon({ name: 'terminal', iconSize: 20, color: T.accent })
          }.width(40).height(40).backgroundColor(T.accentSoft).borderRadius(11)
          Column({ space: 6 }) {
            Text(this.offline ? '当前使用离线示例' : '当前使用云端模型')
              .fontSize(14).fontWeight(FontWeight.Medium).fontColor(T.ink)
            Text(this.offline ? '无需密钥，即可体验基础计划工具' : '配置已应用，实际连通性以对话结果为准')
              .fontSize(11).fontColor(T.secondary).lineHeight(18)
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        }.width('100%').padding(18).border({ width: 1, color: T.border })
          .backgroundColor(T.surface).borderRadius(13)

        Column({ space: 19 }) {
          Row({ space: 8 }) {
            WorkspaceIcon({ name: 'settings', iconSize: 18, color: T.ink })
            Text('云端连接').fontSize(15).fontWeight(FontWeight.Medium).fontColor(T.ink)
          }.width('100%')
          Button({ type: ButtonType.Normal }) {
            Row({ space: 8 }) {
              WorkspaceIcon({ name: 'spark', iconSize: 17, color: T.accent })
              Text('填入 DeepSeek 官方配置').fontSize(12).fontColor(T.accent).layoutWeight(1)
                .textAlign(TextAlign.Start)
              WorkspaceIcon({ name: 'right', iconSize: 15, color: T.accent })
            }.width('100%')
          }.width('100%').height(42).padding({ left: 12, right: 12 }).borderRadius(9)
            .backgroundColor(T.accentSoft).enabled(!this.busy).onClick(() => {
              this.endpoint = DeepSeekConfig.endpoint;
              this.model = DeepSeekConfig.model;
              this.apiKey = '';
            })
          Text('DeepSeek 当前使用非思考模式，支持多轮对话和工具调用；填入配置后再输入密钥。')
            .fontSize(10).fontColor(T.muted).lineHeight(18)
          Column({ space: 8 }) {
            Text('接口地址').fontSize(12).fontColor(T.secondary)
            TextInput({ placeholder: 'https://…/v1/chat/completions', text: this.endpoint })
              .fontSize(13).fontColor(T.ink).placeholderColor(T.muted).height(47)
              .backgroundColor(T.canvas).border({ width: 1, color: T.border, radius: 9 })
              .enabled(!this.busy).onChange((value: string) => { this.endpoint = value; })
            Text('填写兼容 Chat Completions 的完整 HTTPS 地址。').fontSize(10).fontColor(T.muted).lineHeight(17)
          }.width('100%').alignItems(HorizontalAlign.Start)
          Column({ space: 8 }) {
            Text('模型名称').fontSize(12).fontColor(T.secondary)
            TextInput({ placeholder: '服务商提供的模型 ID', text: this.model })
              .fontSize(13).fontColor(T.ink).placeholderColor(T.muted).height(47)
              .backgroundColor(T.canvas).border({ width: 1, color: T.border, radius: 9 })
              .enabled(!this.busy).onChange((value: string) => { this.model = value; })
          }.width('100%').alignItems(HorizontalAlign.Start)
          Column({ space: 8 }) {
            Text('API Key').fontSize(12).fontColor(T.secondary)
            TextInput({ placeholder: '输入本次运行使用的密钥', text: this.apiKey }).type(InputType.Password)
              .fontSize(13).fontColor(T.ink).placeholderColor(T.muted).height(47)
              .backgroundColor(T.canvas).border({ width: 1, color: T.border, radius: 9 })
              .enabled(!this.busy).onChange((value: string) => { this.apiKey = value; })
            Text('密钥仅在本次运行中使用，不写入会话；重启应用后需重新配置。')
              .fontSize(10).fontColor(T.muted).lineHeight(18)
          }.width('100%').alignItems(HorizontalAlign.Start)
          if (this.error.length > 0) {
            Text(this.error).fontSize(12).fontColor(T.danger).lineHeight(20).width('100%')
              .padding(12).backgroundColor(T.dangerSoft).borderRadius(9)
          }
          Button('应用云端配置', { type: ButtonType.Normal }).width('100%').height(44)
            .fontSize(13).fontColor('#FFFFFF').backgroundColor(T.ink).borderRadius(9)
            .enabled(!this.busy && this.ready).onClick(() => { this.onApply(false); })
        }.width('100%').padding(22).backgroundColor(T.surface)
          .border({ width: 1, color: T.border, radius: 14 }).alignItems(HorizontalAlign.Start)

        Button('使用离线示例', { type: ButtonType.Normal }).width('100%').height(43)
          .fontSize(13).fontColor(T.secondary).backgroundColor(T.sidebar).borderRadius(9)
          .enabled(!this.busy && this.ready).onClick(() => { this.onApply(true); })
      }.width('100%').constraintSize({ maxWidth: 620 }).padding({ top: 30, bottom: 28 })
    }.width('100%').height('100%').scrollBar(BarState.Auto).align(Alignment.Top)
  }
}
