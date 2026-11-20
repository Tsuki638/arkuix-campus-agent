import { WorkspaceTheme as T } from './WorkspaceTheme';
import { ModelOption, ModelPresets, ModelProvider } from '../services/model/ModelPresets';

@Component
export struct ModelSettingsPanel {
  @Link endpoint: string;
  @Link model: string;
  @Link apiKey: string;
  @Link useDefault: boolean;
  @Prop error: string = '';
  @Prop busy: boolean = false;
  @Prop ready: boolean = false;
  @Prop activeModel: string = '';
  @Prop defaultKeyAvailable: boolean = false;
  @Prop showAccountModels: boolean = false;
  @Prop defaultModelName: string = '';
  @Prop serverDefaultConfigured: boolean = false;
  @Prop activeSource: string = '';
  @Prop savedKeyAvailable: boolean = false;
  @State private providerIndex: number = 0;
  onApply: () => void = () => {};

  aboutToAppear(): void { this.providerIndex = ModelPresets.providerIndex(this.endpoint, this.model); }

  private provider(): ModelProvider { return ModelPresets.providers[this.providerIndex]; }
  private providerOptions(): SelectOption[] {
    return ModelPresets.providers.map((provider: ModelProvider): SelectOption => ({ value: provider.label }));
  }
  private modelOptions(): SelectOption[] {
    return this.provider().models.map((model: ModelOption): SelectOption => ({ value: model.label }));
  }
  private modelIndex(): number {
    return Math.max(0, this.provider().models.findIndex((model: ModelOption) => model.id === this.model));
  }
  private selectProvider(index: number): void {
    if (index === this.providerIndex) { return; }
    this.providerIndex = index;
    this.apiKey = '';
    this.endpoint = this.provider().endpoint;
    this.model = this.provider().models.length > 0 ? this.provider().models[0].id : '';
  }

  private selectMode(useDefault: boolean): void {
    if (this.useDefault !== useDefault) {
      this.apiKey = '';
      this.useDefault = useDefault;
    }
  }

  private keyPlaceholder(): string {
    if (this.savedKeyAvailable) { return '已保存密钥，留空沿用'; }
    return this.defaultKeyAvailable ? '已配置默认密钥，留空沿用' : '输入该服务商的 API Key';
  }

  private canApply(): boolean {
    if (this.busy || !this.ready) { return false; }
    if (this.showAccountModels && this.useDefault) { return this.serverDefaultConfigured; }
    return this.endpoint.trim().length > 0 && this.model.trim().length > 0 &&
      (this.savedKeyAvailable || this.defaultKeyAvailable || this.apiKey.trim().length > 0);
  }

  @Builder
  private modeButton(label: string, useDefault: boolean) {
    Button(label, { type: ButtonType.Normal }).height(44).layoutWeight(1).fontSize(13).borderRadius(9)
      .backgroundColor(this.useDefault === useDefault ? T.ink : T.canvas)
      .fontColor(this.useDefault === useDefault ? Color.White : T.ink)
      .enabled(!this.busy).onClick(() => { this.selectMode(useDefault); })
  }

  @Builder
  private customFields() {
    Column({ space: 19 }) {
      Column({ space: 8 }) {
        Text('服务商').fontSize(12).fontColor(T.secondary)
        Select(this.providerOptions()).selected(this.providerIndex).value(this.provider().label)
          .width('100%').height(48).font({ size: 14 }).fontColor(T.ink)
          .backgroundColor(T.canvas).borderRadius(9).enabled(!this.busy)
          .onSelect((index: number) => { this.selectProvider(index); })
      }.width('100%').alignItems(HorizontalAlign.Start)
      if (this.provider().id === 'custom') {
        Column({ space: 8 }) {
          Text('接口地址').fontSize(12).fontColor(T.secondary)
          TextInput({ placeholder: 'https://…/v1/chat/completions', text: this.endpoint })
            .fontSize(13).fontColor(T.ink).placeholderColor(T.muted).height(48)
            .backgroundColor(T.canvas).border({ width: 1, color: T.border, radius: 9 })
            .enabled(!this.busy).onChange((value: string) => { this.endpoint = value; })
          Text('填写完整的 HTTPS Chat Completions 地址。').fontSize(12).fontColor(T.muted).lineHeight(20)
        }.width('100%').alignItems(HorizontalAlign.Start)
        Column({ space: 8 }) {
          Text('模型名称').fontSize(12).fontColor(T.secondary)
          TextInput({ placeholder: '服务商提供的模型 ID', text: this.model })
            .fontSize(13).fontColor(T.ink).placeholderColor(T.muted).height(48)
            .backgroundColor(T.canvas).border({ width: 1, color: T.border, radius: 9 })
            .enabled(!this.busy).onChange((value: string) => { this.model = value; })
        }.width('100%').alignItems(HorizontalAlign.Start)
      } else {
        Column({ space: 8 }) {
          Text('模型').fontSize(12).fontColor(T.secondary)
          Select(this.modelOptions()).selected(this.modelIndex()).value(this.provider().models[this.modelIndex()].label)
            .width('100%').height(48).font({ size: 14 }).fontColor(T.ink)
            .backgroundColor(T.canvas).borderRadius(9).enabled(!this.busy)
            .onSelect((index: number) => { this.model = this.provider().models[index].id; })
          Text(this.endpoint).fontSize(12).fontColor(T.muted).lineHeight(20).width('100%')
        }.width('100%').alignItems(HorizontalAlign.Start)
      }
      Column({ space: 8 }) {
        Text('API Key').fontSize(12).fontColor(T.secondary)
        TextInput({ placeholder: this.keyPlaceholder(), text: this.apiKey }).type(InputType.Password)
          .fontSize(13).fontColor(T.ink).placeholderColor(T.muted).height(47)
          .backgroundColor(T.canvas).border({ width: 1, color: T.border, radius: 9 })
          .enabled(!this.busy).onChange((value: string) => { this.apiKey = value; })
        Text(this.showAccountModels ? '密钥加密保存在服务器上，随当前账号使用。' :
          (this.defaultKeyAvailable ? '留空将使用已配置的默认密钥。' : '密钥仅用于本次运行。'))
          .fontSize(12).fontColor(T.muted).lineHeight(20)
      }.width('100%').alignItems(HorizontalAlign.Start)
    }.width('100%')
  }

  build() {
    Scroll() {
      Column({ space: 24 }) {
        Text('选择模型').fontSize(24).fontWeight(FontWeight.Medium).fontColor(T.ink).width('100%')
        Text('当前：' + (this.activeSource === 'default' ? '服务器默认 · ' :
          (this.activeSource === 'custom' ? '自定义 · ' : '')) + this.activeModel)
          .fontSize(13).fontColor(T.secondary).width('100%')
        Column({ space: 19 }) {
          if (this.showAccountModels) {
            Row({ space: 8 }) {
              this.modeButton('服务器默认', true)
              this.modeButton('自定义', false)
            }.width('100%')
          }
          if (this.showAccountModels && this.useDefault) {
            Text(this.serverDefaultConfigured ? '使用服务器配置的 ' + this.defaultModelName + '。' :
              '服务器暂未配置默认模型，请选择自定义。').fontSize(13).fontColor(T.secondary).width('100%')
          } else {
            this.customFields()
          }
          if (this.error.length > 0) {
            Text(this.error).fontSize(12).fontColor(T.danger).lineHeight(20).width('100%')
              .padding(12).backgroundColor(T.dangerSoft).borderRadius(9)
          }
          Button(this.showAccountModels ? '保存并使用' : '使用此模型', { type: ButtonType.Normal })
            .width('100%').height(44)
            .fontSize(13).fontColor('#FFFFFF').backgroundColor(T.ink).borderRadius(9)
            .enabled(this.canApply())
            .onClick(() => { this.onApply(); })
        }.width('100%').padding(22).backgroundColor(T.surface)
          .border({ width: 1, color: T.border, radius: 14 }).alignItems(HorizontalAlign.Start)

      }.width('100%').constraintSize({ maxWidth: 620 }).padding({ top: 30, bottom: 28 })
    }.width('100%').height('100%').scrollBar(BarState.Auto).align(Alignment.Top)
  }
}
