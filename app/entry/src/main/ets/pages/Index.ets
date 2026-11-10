import { ChatWorkspace } from '../ui/ChatWorkspace';

@Entry
@Component
struct Index {
  @State private foreground: boolean = true;

  onPageShow(): void { this.foreground = true; }
  onPageHide(): void { this.foreground = false; }

  build() {
    Column() {
      ChatWorkspace({ foreground: this.foreground })
    }.width('100%').height('100%')
  }
}
