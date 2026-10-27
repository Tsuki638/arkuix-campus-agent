import { ChatMessage, ToolCall, makeMessage } from '../contracts/Models';

@Component
export struct MessageBubble {
  @Prop message: ChatMessage = makeMessage('assistant', '');

  private label(): string {
    if (this.message.role === 'user') { return '我'; }
    if (this.message.role === 'tool') { return '工具结果'; }
    return '学习助手';
  }

  build() {
    Column({ space: 6 }) {
      Text(this.label()).fontSize(12).fontColor('#63736C')
      if (this.message.content.length > 0) {
        Text(this.message.content).fontSize(16).fontColor('#172A23').lineHeight(24)
          .width('100%').copyOption(CopyOptions.InApp)
      }
      if (this.message.toolCalls.length > 0) {
        Text('调用工具：' + this.message.toolCalls.map((call: ToolCall) => call.name).join('、'))
          .fontSize(12).fontColor('#28664B')
      }
    }
    .alignItems(HorizontalAlign.Start).padding(14).width('100%').borderRadius(12)
    .backgroundColor(this.message.role === 'user' ? '#DDEFE3' : '#FFFFFF')
  }
}
