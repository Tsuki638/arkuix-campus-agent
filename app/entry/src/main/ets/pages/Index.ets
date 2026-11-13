import { ChatWorkspace } from '../ui/ChatWorkspace';
import { WorkspaceNavigation } from '../ui/WorkspaceNavigation';

@Entry
@Component
struct Index {
  @State private foreground: boolean = true;
  private navigation: WorkspaceNavigation = new WorkspaceNavigation();

  onPageShow(): void { this.foreground = true; }
  onPageHide(): void { this.foreground = false; }
  onBackPress(): boolean { return this.navigation.handleBack(); }

  build() {
    Column() {
      ChatWorkspace({ foreground: this.foreground, navigation: this.navigation })
    }.width('100%').height('100%')
  }
}
