import { ChatWorkspace } from '../ui/ChatWorkspace';
import { WorkspaceNavigation } from '../ui/WorkspaceNavigation';
import { KeyboardAvoidMode } from '@ohos.arkui.UIContext';

@Entry
@Component
struct Index {
  @State private foreground: boolean = true;
  private navigation: WorkspaceNavigation = new WorkspaceNavigation();

  aboutToAppear(): void {
    // 平板软键盘弹出时压缩可用内容区，保留底部输入框与可滚动的消息区。
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
  }

  onPageShow(): void { this.foreground = true; }
  onPageHide(): void { this.foreground = false; }
  onBackPress(): boolean { return this.navigation.handleBack(); }

  build() {
    Column() {
      ChatWorkspace({ foreground: this.foreground, navigation: this.navigation })
    }.width('100%').height('100%')
  }
}
