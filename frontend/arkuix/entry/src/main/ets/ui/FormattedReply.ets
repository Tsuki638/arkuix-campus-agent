import { parseReplyBlocks, ReplyBlock, ReplyRun, ReplyTable, ReplyTableAlignment, ReplyTableColumn } from './ReplyFormatting';
import { openWebLink } from './OpenWebLink';
import { WorkspaceTheme as T } from './WorkspaceTheme';

@Component
export struct FormattedReply {
  @Prop @Watch('contentChanged') content: string = '';
  @State private blocks: ReplyBlock[] = [];
  @State private contentWidth: number = 0;

  aboutToAppear(): void { this.contentChanged(); }

  private contentChanged(): void { this.blocks = parseReplyBlocks(this.content); }

  private headingSize(level: number): number { return level === 1 ? 22 : level === 2 ? 20 : 18; }

  private spacing(index: number): number {
    if (index === 0) { return 0; }
    const current: ReplyBlock = this.blocks[index];
    const previous: ReplyBlock = this.blocks[index - 1];
    if (current.kind === 'heading') { return 20; }
    if (previous.kind === 'heading') { return 8; }
    if (current.kind === 'table' || previous.kind === 'table') { return 16; }
    if (current.kind === 'list' && previous.kind === 'list') { return 6; }
    return 12;
  }

  @Builder
  private richText(runs: ReplyRun[], bold: boolean, color: string, size: number, lineHeight: number,
    alignment: TextAlign = TextAlign.Start) {
    Text() {
      ForEach(runs, (run: ReplyRun, index: number) => {
        if (run.url !== undefined) {
          Span(run.text)
            .fontWeight(run.bold || bold ? FontWeight.Bold : FontWeight.Normal)
            .fontStyle(run.italic ? FontStyle.Italic : FontStyle.Normal)
            .fontColor(T.accent).decoration({ type: TextDecorationType.Underline })
            .onClick(() => { void openWebLink(this.getUIContext(), run.url ?? ''); })
        } else {
          Span(run.text)
            .fontWeight(run.bold || bold ? FontWeight.Bold : FontWeight.Normal)
            .fontStyle(run.italic ? FontStyle.Italic : FontStyle.Normal)
            .fontFamily(run.code ? 'monospace' : 'HarmonyOS Sans')
            .fontColor(run.code ? T.accent : color)
        }
      }, (run: ReplyRun, index: number) => index.toString() + ':' + run.text + ':' +
        run.bold.toString() + run.italic.toString() + run.code.toString() + ':' + (run.url ?? ''))
    }.fontSize(size).lineHeight(lineHeight).textAlign(alignment).width('100%').copyOption(CopyOptions.InApp)
  }

  @Builder
  private paragraph(block: ReplyBlock) {
    this.richText(block.runs, block.kind === 'heading', block.kind === 'quote' ? T.secondary : T.ink,
      block.kind === 'heading' ? this.headingSize(block.level) : 15,
      block.kind === 'heading' ? this.headingSize(block.level) + 10 : 26)
  }

  private textAlign(alignment: ReplyTableAlignment): TextAlign {
    if (alignment === 'center') { return TextAlign.Center; }
    return alignment === 'end' ? TextAlign.End : TextAlign.Start;
  }

  @Builder
  private tableRow(table: ReplyTable, row: ReplyRun[][], header: boolean) {
    Row() {
      ForEach(table.columns, (column: ReplyTableColumn, index: number) => {
        Column() {
          this.richText(header ? column.heading : row[index], header, header ? T.secondary : T.ink, 14, 22,
            this.textAlign(column.alignment))
        }.layoutWeight(column.weight).padding({ left: 11, right: 11, top: 9, bottom: 9 })
      }, (_column: ReplyTableColumn, index: number) => index.toString())
    }.width('100%').alignItems(VerticalAlign.Top).backgroundColor(header ? T.sidebar : T.surface)
  }

  @Builder
  private tableCard(table: ReplyTable, row: ReplyRun[][]) {
    Column({ space: 8 }) {
      ForEach(table.columns, (column: ReplyTableColumn, index: number) => {
        if (row[index].length > 0) {
          Column({ space: 2 }) {
            if (column.heading.length > 0) {
              this.richText(column.heading, true, T.secondary, 12, 18)
            }
            this.richText(row[index], index === 0, T.ink, index === 0 ? 15 : 14, 22)
          }.width('100%').alignItems(HorizontalAlign.Start)
        }
      }, (_column: ReplyTableColumn, index: number) => index.toString())
    }.width('100%').alignItems(HorizontalAlign.Start).padding(13).backgroundColor(T.surface)
      .borderWidth(1).borderRadius(9).borderColor(T.border)
  }

  @Builder
  private replyTable(table: ReplyTable) {
    if (this.contentWidth < table.columns.length * 114 + 52 && table.rows.length > 0) {
      Column({ space: 9 }) {
        ForEach(table.rows, (row: ReplyRun[][]) => {
          this.tableCard(table, row)
        }, (_row: ReplyRun[][], index: number) => index.toString())
      }.width('100%')
    } else {
      Column() {
        this.tableRow(table, [], true)
        ForEach(table.rows, (row: ReplyRun[][]) => {
          Column() {
            Divider().strokeWidth(1).color(T.border)
            this.tableRow(table, row, false)
          }.width('100%')
        }, (_row: ReplyRun[][], index: number) => index.toString())
      }.width('100%').borderWidth(1).borderRadius(9).borderColor(T.border).clip(true)
    }
  }

  @Builder
  private replyBlock(block: ReplyBlock) {
    if (block.kind === 'list') {
      Row({ space: 4 }) {
        Text(block.marker).fontSize(15).lineHeight(26).fontColor(T.secondary)
          .width(block.marker === '•' ? 18 : Math.min(64, Math.max(28, block.marker.length * 8)))
          .textAlign(TextAlign.Start)
        Column() { this.paragraph(block) }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      }.width('100%').alignItems(VerticalAlign.Top).padding({ left: block.indent * 16 })
    } else if (block.kind === 'quote') {
      Column() { this.paragraph(block) }.width('100%').alignItems(HorizontalAlign.Start)
        .padding({ left: 12, top: 3, bottom: 3 }).borderWidth({ left: 3 }).borderColor(T.border)
    } else if (block.kind === 'code') {
      Text(block.text).fontSize(14).fontFamily('monospace').fontColor(T.ink).lineHeight(23)
        .textAlign(TextAlign.Start).wordBreak(WordBreak.BREAK_ALL).width('100%')
        .padding(12).backgroundColor(T.sidebar).borderRadius(8).copyOption(CopyOptions.InApp)
    } else if (block.kind === 'divider') {
      Divider().color(T.border).strokeWidth(1).margin({ top: 4, bottom: 4 })
    } else if (block.table !== undefined) {
      this.replyTable(block.table)
    } else {
      this.paragraph(block)
    }
  }

  build() {
    Column() {
      ForEach(this.blocks, (block: ReplyBlock, index: number) => {
        Column() { this.replyBlock(block) }.width('100%').alignItems(HorizontalAlign.Start)
          .padding({ top: this.spacing(index) })
      }, (block: ReplyBlock, index: number) => index.toString() + ':' + block.kind + ':' + block.text)
    }.width('100%').alignItems(HorizontalAlign.Start)
      .onAreaChange((_oldArea: Area, area: Area) => {
        const width: number = Number(area.width);
        if (width !== this.contentWidth) { this.contentWidth = width; }
      })
  }
}
