import { Conversation } from '../contracts/Models';
import { WorkspaceIcon } from './WorkspaceIcon';
import { WorkspaceTheme as T } from './WorkspaceTheme';
import { WorkspaceBrand } from './WorkspaceBrand';

@Component
export struct WorkspaceSidebar {
  @Prop conversations: Conversation[] = [];
  @Prop currentId: string = '';
  @Prop activeView: string = 'chat';
  @Prop busy: boolean = false;
  @Prop ready: boolean = false;
  @Prop planCount: number = 0;
  @Prop activeModel: string = '';
  @Prop accountName: string = '';
  @Prop compactHeight: boolean = false;
  @State private search: string = '';
  onNew: () => void = () => {};
  onSelect: (id: string) => void = () => {};
  onNavigate: (view: string) => void = () => {};
  onClose: () => void = () => {};

  private filteredConversations(): Conversation[] {
    const query: string = this.historyCount() > 5 ? this.search.trim().toLowerCase() : '';
    return this.conversations.filter((item: Conversation) =>
      item.messages.length > 0 && item.title.toLowerCase().includes(query));
  }

  private historyCount(): number {
    return this.conversations.filter((item: Conversation) => item.messages.length > 0).length;
  }

  private dateLabel(timestamp: number): string {
    const date: Date = new Date(timestamp);
    const today: Date = new Date();
    if (date.toDateString() === today.toDateString()) { return '今天'; }
    return (date.getMonth() + 1) + '/' + date.getDate();
  }

  @Builder
  private navigationItem(icon: string, label: string, destination: string) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 11 }) {
        WorkspaceIcon({ name: icon, iconSize: 19, color: this.activeView === destination ? T.ink : T.secondary })
        Text(label).fontSize(14).fontColor(T.ink).layoutWeight(1).textAlign(TextAlign.Start).maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (destination === 'plans' && this.planCount > 0) {
          Text(this.planCount.toString()).fontSize(11).fontColor(T.secondary)
            .padding({ left: 7, right: 7, top: 3, bottom: 3 }).backgroundColor(T.border).borderRadius(5)
        }
      }.width('100%')
    }.width('100%').height(44).padding({ left: 12, right: 12 }).borderRadius(9)
      .backgroundColor(this.activeView === destination ? T.hover : Color.Transparent)
      .enabled(!this.busy)
      .onClick(() => { this.onNavigate(destination); })
  }

  build() {
    Column() {
      Row({ space: 9 }) {
        WorkspaceBrand({ diameter: 34 })
        Text('Campus').fontSize(20).fontWeight(FontWeight.Medium).fontColor(T.ink).layoutWeight(1)
        Button({ type: ButtonType.Normal }) {
          WorkspaceIcon({ name: 'sidebar', iconSize: 19 })
        }.width(44).height(44).padding(0).backgroundColor(Color.Transparent).borderRadius(8)
          .accessibilityText('收起侧边栏').onClick(() => { this.onClose(); })
      }.height(this.compactHeight ? 56 : 64).width('100%').padding({ left: 12, right: 4 })

      Button({ type: ButtonType.Normal }) {
        Row({ space: 10 }) {
          WorkspaceIcon({ name: 'plus', iconSize: 18, color: '#FFFFFF' })
          Text('新建对话').fontSize(14).fontColor('#FFFFFF').layoutWeight(1).textAlign(TextAlign.Start)
        }.width('100%')
      }.width('100%').height(44).backgroundColor(T.ink)
        .borderRadius(10).padding({ left: 12, right: 12 })
        .margin({ top: 4, bottom: this.compactHeight ? 12 : 20 })
        .enabled(!this.busy && this.ready).onClick(() => { this.onNew(); })

      this.navigationItem('plan', '学习计划', 'plans')
      this.navigationItem('calendar', '日程预览', 'calendar')

      Row() {
        Text('最近对话').fontSize(11).fontColor(T.secondary).layoutWeight(1)
      }.width('100%').padding({ left: 12, right: 12, top: this.compactHeight ? 16 : 27, bottom: 11 })
      if (this.historyCount() > 5) {
        TextInput({ placeholder: '搜索对话', text: this.search })
          .height(40).fontSize(13).fontColor(T.ink).placeholderColor(T.muted)
          .backgroundColor(T.surface).borderRadius(8).padding({ left: 12, right: 12 })
          .onChange((value: string) => { this.search = value; }).margin({ bottom: 10 })
      }

      List({ space: 3 }) {
        ForEach(this.filteredConversations(), (conversation: Conversation) => {
          ListItem() {
            Button({ type: ButtonType.Normal }) {
              Row({ space: 9 }) {
                Text(conversation.title).fontSize(13).fontColor(T.ink).maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1).textAlign(TextAlign.Start)
                Text(this.dateLabel(conversation.updatedAt)).fontSize(10).fontColor(T.muted)
              }.width('100%')
            }.width('100%').height(44).padding({ left: 12, right: 10 }).borderRadius(8)
              .backgroundColor(conversation.id === this.currentId && this.activeView === 'chat' ? T.hover : Color.Transparent)
              .enabled(!this.busy && this.ready).onClick(() => { this.onSelect(conversation.id); })
          }
        }, (conversation: Conversation) => conversation.id + ':' + conversation.title + ':' + conversation.updatedAt)
        if (this.filteredConversations().length === 0) {
          ListItem() {
            Text(this.historyCount() > 5 && this.search.trim().length > 0 ? '没有找到相关对话' : '对话会自动保存在这里')
              .fontSize(12).fontColor(T.muted).lineHeight(20).padding(12)
          }
        }
      }.width('100%').layoutWeight(1).scrollBar(BarState.Auto)

      Divider().color(T.border).margin({ top: this.compactHeight ? 8 : 12, bottom: this.compactHeight ? 8 : 10 })
      if (this.accountName.length > 0) { this.navigationItem('account', '@' + this.accountName, 'account') }
      Button({ type: ButtonType.Normal }) {
        Row({ space: 11 }) {
          WorkspaceIcon({ name: 'settings', iconSize: 19 })
          Column({ space: 4 }) {
            Text('模型设置').fontSize(14).fontColor(T.ink)
            Text(this.activeModel).fontSize(12).fontColor(T.secondary).maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        }.width('100%')
      }.width('100%').height(this.compactHeight ? 56 : 64).padding({ left: 12, right: 12 }).borderRadius(9)
        .backgroundColor(this.activeView === 'settings' ? T.hover : Color.Transparent)
        .enabled(!this.busy).onClick(() => { this.onNavigate('settings'); })
        .margin({ bottom: this.compactHeight ? 8 : 14 })
    }.width('100%').height('100%').padding({ left: 12, right: 12 })
      .backgroundColor(T.sidebar).border({ width: { right: 1 }, color: T.border })
  }
}
