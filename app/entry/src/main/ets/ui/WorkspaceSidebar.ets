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
  @Prop offline: boolean = true;
  @State private search: string = '';
  onNew: () => void = () => {};
  onSelect: (id: string) => void = () => {};
  onNavigate: (view: string) => void = () => {};
  onClose: () => void = () => {};

  private filteredConversations(): Conversation[] {
    const query: string = this.search.trim().toLowerCase();
    return this.conversations.filter((item: Conversation) => item.title.toLowerCase().includes(query));
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
        Text(label).fontSize(14).fontColor(T.ink).layoutWeight(1).textAlign(TextAlign.Start)
        if (destination === 'plans') {
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
        }.width(36).height(40).padding(0).backgroundColor(Color.Transparent).borderRadius(8)
          .accessibilityText('收起侧边栏').onClick(() => { this.onClose(); })
      }.height(68).width('100%').padding({ left: 12, right: 4 })

      Button({ type: ButtonType.Normal }) {
        Row({ space: 10 }) {
          WorkspaceIcon({ name: 'plus', iconSize: 18, color: T.ink })
          Text('新建对话').fontSize(14).fontColor(T.ink).layoutWeight(1).textAlign(TextAlign.Start)
        }.width('100%')
      }.width('100%').height(43).backgroundColor(T.surface).border({ width: 1, color: T.border })
        .borderRadius(9).padding({ left: 12, right: 12 }).margin({ top: 5, bottom: 18 })
        .enabled(!this.busy && this.ready).onClick(() => { this.onNew(); })

      this.navigationItem('chat', '对话工作台', 'chat')
      this.navigationItem('plan', '学习计划', 'plans')
      this.navigationItem('calendar', '日程预览', 'calendar')

      Row() {
        Text('最近对话').fontSize(11).fontColor(T.secondary).layoutWeight(1)
        Text(this.conversations.length.toString()).fontSize(11).fontColor(T.muted)
      }.width('100%').padding({ left: 12, right: 12, top: 27, bottom: 11 })
      TextInput({ placeholder: '搜索对话', text: this.search })
        .height(36).fontSize(12).fontColor(T.ink).placeholderColor(T.muted)
        .backgroundColor('#E9E8E3').borderRadius(8).padding({ left: 12, right: 12 })
        .onChange((value: string) => { this.search = value; }).margin({ bottom: 10 })

      List({ space: 3 }) {
        ForEach(this.filteredConversations(), (conversation: Conversation) => {
          ListItem() {
            Button({ type: ButtonType.Normal }) {
              Row({ space: 9 }) {
                WorkspaceIcon({ name: 'chat', iconSize: 15,
                  color: conversation.id === this.currentId ? T.ink : T.muted })
                Text(conversation.title).fontSize(13).fontColor(T.ink).maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1).textAlign(TextAlign.Start)
                Text(this.dateLabel(conversation.updatedAt)).fontSize(10).fontColor(T.muted)
              }.width('100%')
            }.width('100%').height(42).padding({ left: 12, right: 10 }).borderRadius(8)
              .backgroundColor(conversation.id === this.currentId && this.activeView === 'chat' ? T.hover : Color.Transparent)
              .enabled(!this.busy && this.ready).onClick(() => { this.onSelect(conversation.id); })
          }
        }, (conversation: Conversation) => conversation.id + ':' + conversation.title + ':' + conversation.updatedAt)
        if (this.filteredConversations().length === 0) {
          ListItem() {
            Text(this.search.length > 0 ? '没有找到相关对话' : '从新建一个对话开始')
              .fontSize(12).fontColor(T.muted).padding(12)
          }
        }
      }.width('100%').layoutWeight(1).scrollBar(BarState.Auto)

      Divider().color(T.border).margin({ top: 12, bottom: 10 })
      this.navigationItem('settings', '模型设置', 'settings')
      Row({ space: 10 }) {
        Text('学').fontSize(13).fontWeight(FontWeight.Medium).fontColor(T.secondary)
          .width(32).height(32).textAlign(TextAlign.Center).backgroundColor(T.border).borderRadius(16)
        Column({ space: 3 }) {
          Text('我的学习空间').fontSize(12).fontColor(T.ink)
          Text(this.offline ? '离线示例 · 本地保存' : '云端模型 · 本地保存').fontSize(10).fontColor(T.secondary)
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        Circle().width(6).height(6).fill(this.ready ? T.accent : T.muted)
      }.width('100%').padding({ left: 10, right: 12, top: 13, bottom: 20 })
    }.width('100%').height('100%').padding({ left: 12, right: 12 })
      .backgroundColor(T.sidebar).border({ width: { right: 1 }, color: T.border })
  }
}
