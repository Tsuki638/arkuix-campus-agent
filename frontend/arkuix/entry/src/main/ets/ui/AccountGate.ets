import { WorkspaceBrand } from './WorkspaceBrand';
import { WorkspaceTheme as T } from './WorkspaceTheme';

@Component
export struct AccountGate {
  @Prop busy: boolean = false;
  @Prop error: string = '';
  @Prop signedInUser: string = '';
  @State private registering: boolean = false;
  @State private username: string = '';
  @State private password: string = '';
  @State private confirmation: string = '';
  @State private mismatch: boolean = false;
  onSubmit: (username: string, password: string, register: boolean) => void = () => {};
  onRetry: () => void = () => {};
  onSignOut: () => void = () => {};
  onSwitch: () => void = () => {};

  private submit(): void {
    if (this.busy || this.username.trim().length === 0 || this.password.length === 0) { return; }
    this.mismatch = this.registering && this.password !== this.confirmation;
    if (this.mismatch) { return; }
    const password: string = this.password;
    this.password = '';
    this.confirmation = '';
    this.onSubmit(this.username.trim(), password, this.registering);
  }

  @Builder
  private credentialFields() {
    Column({ space: 14 }) {
      Column({ space: 6 }) {
        Text('用户名').fontSize(13).fontColor(T.secondary)
        TextInput({ text: this.username, placeholder: '输入用户名' }).accessibilityText('用户名')
          .height(46).maxLength(32).fontSize(15).fontColor(T.ink).placeholderColor(T.muted)
          .backgroundColor(T.canvas).borderRadius(9).border({ width: 1, color: T.border })
          .enabled(!this.busy).onChange((value: string) => { this.username = value; })
      }.width('100%').alignItems(HorizontalAlign.Start)
      Column({ space: 6 }) {
        Text('密码').fontSize(13).fontColor(T.secondary)
        TextInput({ text: this.password, placeholder: this.registering ? '至少 8 个字符' : '输入密码' })
          .type(InputType.Password).accessibilityText('密码').height(46).maxLength(256)
          .fontSize(15).fontColor(T.ink).placeholderColor(T.muted).backgroundColor(T.canvas)
          .borderRadius(9).border({ width: 1, color: T.border }).enabled(!this.busy)
          .onChange((value: string) => { this.password = value; this.mismatch = false; })
          .onSubmit(() => { if (!this.registering) { this.submit(); } })
      }.width('100%').alignItems(HorizontalAlign.Start)
      if (this.registering) {
        Column({ space: 6 }) {
          Text('确认密码').fontSize(13).fontColor(T.secondary)
          TextInput({ text: this.confirmation, placeholder: '再次输入密码' })
            .type(InputType.Password).accessibilityText('确认密码').height(46).maxLength(256)
            .fontSize(15).fontColor(T.ink).placeholderColor(T.muted).backgroundColor(T.canvas)
            .borderRadius(9).border({ width: 1, color: T.border }).enabled(!this.busy)
            .onChange((value: string) => { this.confirmation = value; this.mismatch = false; })
            .onSubmit(() => { this.submit(); })
        }.width('100%').alignItems(HorizontalAlign.Start)
      }
    }.width('100%')
  }

  build() {
    Scroll() {
      Column({ space: 18 }) {
        Row({ space: 10 }) {
          WorkspaceBrand({ diameter: 42 })
          Text('Campus').fontSize(20).fontWeight(FontWeight.Medium).fontColor(T.accent)
        }.width('100%')
        Column({ space: 7 }) {
          Text(this.signedInUser.length > 0 ? '打开学习空间' : (this.registering ? '创建账号' : '登录学习空间'))
            .fontSize(28).fontWeight(FontWeight.Medium).fontColor(T.ink).width('100%')
          Text(this.signedInUser.length > 0 ? '已登录 @' + this.signedInUser : '在不同设备使用同一账号，继续你的对话和学习计划。')
            .fontSize(14).lineHeight(22).fontColor(T.secondary).width('100%')
        }.width('100%')
        if (this.signedInUser.length === 0) { this.credentialFields() }
        if (this.mismatch || this.error.length > 0) {
          Text(this.mismatch ? '两次输入的密码不一致。' : this.error).fontSize(13).lineHeight(20)
            .fontColor(T.danger).padding(11).backgroundColor(T.dangerSoft).borderRadius(8).width('100%')
        }
        if (this.signedInUser.length > 0) {
          Button(this.busy ? '正在加载…' : '重新加载').width('100%').height(46).borderRadius(9)
            .backgroundColor(T.ink).fontColor(Color.White).enabled(!this.busy).onClick(() => { this.onRetry(); })
          Button('退出登录').height(44).fontSize(14).fontColor(T.accent).backgroundColor(Color.Transparent)
            .enabled(!this.busy).onClick(() => { this.onSignOut(); })
        } else {
          Button(this.busy ? '正在连接…' : (this.registering ? '注册并登录' : '登录'))
            .width('100%').height(46).borderRadius(9).backgroundColor(T.ink).fontColor(Color.White)
            .enabled(!this.busy && this.username.trim().length > 0 && this.password.length > 0)
            .onClick(() => { this.submit(); })
          Button(this.registering ? '已有账号？返回登录' : '还没有账号？创建账号')
            .height(44).fontSize(14).fontColor(T.accent).backgroundColor(Color.Transparent)
            .enabled(!this.busy).onClick(() => {
              this.registering = !this.registering;
              this.password = '';
              this.confirmation = '';
              this.mismatch = false;
              this.onSwitch();
            })
        }
      }.width('100%').constraintSize({ maxWidth: 448 }).padding(23).backgroundColor(T.surface)
        .border({ width: 1, color: T.border }).borderRadius(13)
    }.width('100%').height('100%').padding({ left: 18, right: 18, top: 18, bottom: 18 })
      .align(Alignment.Center).scrollBar(BarState.Auto)
  }
}
