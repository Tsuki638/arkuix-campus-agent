export type ReplyBlockKind = 'heading' | 'paragraph' | 'list' | 'quote' | 'code' | 'divider' | 'table';
export type ReplyTableAlignment = 'start' | 'center' | 'end';

export interface ReplyRun {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
  url?: string;
}

export interface ReplyBlock {
  kind: ReplyBlockKind;
  text: string;
  runs: ReplyRun[];
  level: number;
  marker: string;
  indent: number;
  table?: ReplyTable;
}

export interface ReplyTableColumn {
  heading: ReplyRun[];
  alignment: ReplyTableAlignment;
  weight: number;
}

export interface ReplyTable {
  columns: ReplyTableColumn[];
  rows: ReplyRun[][][];
}

interface ReplyTableHeader {
  labels: string[];
  delimiters: string[];
}

function appendRun(runs: ReplyRun[], text: string, bold: boolean, italic: boolean, code: boolean, url?: string): void {
  if (text.length === 0) { return; }
  const last: ReplyRun | undefined = runs[runs.length - 1];
  if (url === undefined && last !== undefined && last.url === undefined &&
    last.bold === bold && last.italic === italic && last.code === code) {
    last.text += text;
  } else if (url !== undefined) {
    runs.push({ text: text, bold: bold, italic: italic, code: code, url: url });
  } else {
    runs.push({ text: text, bold: bold, italic: italic, code: code });
  }
}

interface InlineLink {
  label: string;
  url: string;
  end: number;
}

export function isWebLink(url: string): boolean {
  return /^https?:\/\/(?:[\p{L}\d.-]+|\[[\da-f:.]+\])(?::\d{1,5})?(?:[/?#][^\s<>\\\u0000-\u001f\u007f-\u009f]*)?$/iu.test(url);
}

function linkAt(text: string, from: number): InlineLink | undefined {
  const char: string = text[from];
  if (char === '[' && text[from - 1] !== '!') {
    const label: RegExpMatchArray | null = text.slice(from).match(/^\[((?:\\.|[^\]\\\n])+)\]\(/);
    if (label === null) { return undefined; }
    const start: number = from + label[0].length;
    let nested: number = 0;
    for (let end = start; end < text.length && text[end] !== '\n'; end += 1) {
      if (text[end] === '(') { nested += 1; }
      if (text[end] !== ')') { continue; }
      if (nested > 0) { nested -= 1; continue; }
      const destination: RegExpMatchArray | null = text.slice(start, end).trim()
        .match(/^(?:<([^<>]+)>|([^\s<>]+))(?:\s+(?:"[^"]*"|'[^']*'))?$/);
      const url: string = destination?.[1] ?? destination?.[2] ?? '';
      return isWebLink(url) ? { label: label[1].replace(/\\([\\\[\]|])/g, '$1'), url: url, end: end + 1 } : undefined;
    }
    return undefined;
  }
  if (char === '<') {
    const match: RegExpMatchArray | null = text.slice(from).match(/^<(https?:\/\/[^<>\s]+)>/i);
    if (match !== null && isWebLink(match[1])) {
      return { label: match[1], url: match[1], end: from + match[0].length };
    }
    return undefined;
  }
  if (char.toLowerCase() !== 'h' || /[\w/=@'"\]]/.test(text[from - 1] ?? '') ||
    /(?:javascript|data|file|intent):$/i.test(text.slice(Math.max(0, from - 11), from))) { return undefined; }
  const bare: RegExpMatchArray | null = text.slice(from).match(/^https?:\/\/[^\s<>"'`*|，。；：！？、（）【】《》]+/i);
  if (bare === null) { return undefined; }
  let url: string = bare[0].replace(/[.,;:!?]+$/g, '');
  while ((url.endsWith(')') && url.split(')').length > url.split('(').length) ||
    (url.endsWith(']') && url.split(']').length > url.split('[').length)) {
    url = url.slice(0, -1).replace(/[.,;:!?]+$/g, '');
  }
  return isWebLink(url) ? { label: url, url: url, end: from + url.length } : undefined;
}

function codeEnd(text: string, marker: string, from: number): number {
  let index: number = text.indexOf(marker, from);
  while (index >= 0) {
    if (text[index - 1] !== '`' && text[index + marker.length] !== '`') { return index; }
    index = text.indexOf(marker, index + marker.length);
  }
  return -1;
}

function closingMarker(text: string, marker: string, from: number): number {
  let cursor: number = from;
  while (cursor < text.length) {
    if (text[cursor] === '\\') { cursor += 2; continue; }
    if (text[cursor] === '`') {
      let end: number = cursor + 1;
      while (text[end] === '`') { end += 1; }
      const close: number = codeEnd(text, text.slice(cursor, end), end);
      cursor = close >= 0 ? close + end - cursor : end;
      continue;
    }
    const link: InlineLink | undefined = linkAt(text, cursor);
    if (link !== undefined) { cursor = link.end; continue; }
    if (text[cursor] === marker[0]) {
      let end: number = cursor + 1;
      while (text[end] === marker[0]) { end += 1; }
      const length: number = end - cursor;
      if ((length === marker.length || length === 3) && !/\s/.test(text[cursor - 1])) {
        return end - marker.length;
      }
      cursor = end;
      continue;
    }
    cursor += 1;
  }
  return -1;
}

function inlineRuns(text: string, bold: boolean, italic: boolean, depth: number): ReplyRun[] {
  const runs: ReplyRun[] = [];
  let cursor: number = 0;
  let plain: string = '';
  while (cursor < text.length) {
    const char: string = text[cursor];
    if (char === '\\' && cursor + 1 < text.length && /[\\`*_{}\[\]()#+\-.!>|~]/.test(text[cursor + 1])) {
      plain += text[cursor + 1];
      cursor += 2;
      continue;
    }
    let marker: string = '';
    if (char === '`') {
      let end: number = cursor + 1;
      while (text[end] === '`') { end += 1; }
      marker = text.slice(cursor, end);
      // 行内代码只接受等长的反引号，内部的强调标记原样保留。
      const close: number = codeEnd(text, marker, end);
      if (close > end) {
        appendRun(runs, plain, bold, italic, false);
        plain = '';
        appendRun(runs, text.slice(end, close), bold, italic, true);
        cursor = close + marker.length;
        continue;
      }
      // 未闭合的输入保留原文，不隐藏内容。
      plain += marker;
      cursor = end;
      continue;
    }
    const link: InlineLink | undefined = linkAt(text, cursor);
    if (link !== undefined) {
      appendRun(runs, plain, bold, italic, false);
      plain = '';
      appendRun(runs, link.label, bold, italic, false, link.url);
      cursor = link.end;
      continue;
    }
    if ((char === '*' || char === '_') && depth < 8) {
      let length: number = 1;
      while (length < 3 && text[cursor + length] === char) { length += 1; }
      marker = text.slice(cursor, cursor + length);
      const insideWord: boolean = char === '_' && cursor > 0 && /[a-zA-Z0-9]/.test(text[cursor - 1]);
      const close: number = closingMarker(text, marker, cursor + length);
      if (!insideWord && close > cursor + length && !/\s/.test(text[cursor + length])) {
        appendRun(runs, plain, bold, italic, false);
        plain = '';
        const nested: ReplyRun[] = inlineRuns(text.slice(cursor + length, close),
          bold || length >= 2, italic || length === 1 || length === 3, depth + 1);
        nested.forEach((run: ReplyRun) => appendRun(runs, run.text, run.bold, run.italic, run.code, run.url));
        cursor = close + length;
        continue;
      }
      plain += marker;
      cursor += length;
      continue;
    }
    plain += char;
    cursor += 1;
  }
  appendRun(runs, plain, bold, italic, false);
  return runs;
}

export function parseReplyInline(text: string): ReplyRun[] {
  return inlineRuns(text, false, false, 0);
}

function block(kind: ReplyBlockKind, text: string, level: number = 0,
  marker: string = '', indent: number = 0): ReplyBlock {
  return { kind: kind, text: text, runs: kind === 'code' ? [] : parseReplyInline(text),
    level: level, marker: marker, indent: indent };
}

function isBoldHeading(line: string): boolean {
  const text: string = line.trim();
  if (text.length > 84 || !/^(\*\*|__)(.+)\1$/.test(text)) { return false; }
  const runs: ReplyRun[] = parseReplyInline(text);
  return runs.length === 1 && runs[0].bold && !runs[0].code;
}

function isBlockStart(line: string): boolean {
  return /^ {0,3}(#{1,6})[ \t]+\S/.test(line) || /^ {0,3}(`{3,}|~{3,})/.test(line) ||
    /^\s*([-+*]|\d{1,9}[.)])[ \t]+/.test(line) || /^ {0,3}>/.test(line) ||
    /^ {0,3}((\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/.test(line) || isBoldHeading(line);
}

function tableCells(line: string): string[] {
  const text: string = line.trim();
  const cells: string[] = [];
  let start: number = 0;
  let cursor: number = 0;
  while (cursor < text.length) {
    if (text[cursor] === '\\') { cursor += 2; continue; }
    if (text[cursor] === '`') {
      let markerEnd: number = cursor + 1;
      while (text[markerEnd] === '`') { markerEnd += 1; }
      const close: number = codeEnd(text, text.slice(cursor, markerEnd), markerEnd);
      cursor = close >= 0 ? close + markerEnd - cursor : markerEnd;
      continue;
    }
    if (text[cursor] === '[' || text[cursor] === '<') {
      const link: InlineLink | undefined = linkAt(text, cursor);
      if (link !== undefined) { cursor = link.end; continue; }
    }
    if (text[cursor] === '|') {
      cells.push(text.slice(start, cursor).trim());
      start = cursor + 1;
    }
    cursor += 1;
  }
  if (cells.length === 0) { return []; }
  if (start < text.length) { cells.push(text.slice(start).trim()); }
  return text.startsWith('|') ? cells.slice(1) : cells;
}

function tableHeader(lines: string[], cursor: number): ReplyTableHeader | undefined {
  const next: string = lines[cursor + 1] ?? '';
  if (!/^\s*\|?\s*:?-/.test(next) || !next.includes('|') || isBlockStart(lines[cursor])) { return undefined; }
  const labels: string[] = tableCells(lines[cursor]);
  const delimiters: string[] = tableCells(next);
  if (labels.length === 0 || labels.length !== delimiters.length ||
    !delimiters.every((cell: string) => /^:?-+:?$/.test(cell))) {
    return undefined;
  }
  return { labels: labels, delimiters: delimiters };
}

function readTable(header: ReplyTableHeader, rows: string[][]): ReplyTable {
  const width: number = header.labels.length;
  const values: ReplyRun[][][] = rows.map((row: string[]) => header.labels.map((_label: string, index: number) =>
    parseReplyInline(index === width - 1 && row.length > width ? row.slice(index).join(' | ') : row[index] ?? '')));
  const columns: ReplyTableColumn[] = header.labels.map((label: string, index: number): ReplyTableColumn => {
    const heading: ReplyRun[] = parseReplyInline(label);
    const delimiter: string = header.delimiters[index];
    const alignment: ReplyTableAlignment = delimiter.endsWith(':') ?
      (delimiter.startsWith(':') ? 'center' : 'end') : 'start';
    let length: number = heading.reduce((sum: number, run: ReplyRun) => sum + run.text.length, 0);
    for (const row of values) {
      length = Math.max(length, row[index].reduce((sum: number, run: ReplyRun) => sum + run.text.length, 0));
    }
    return { heading: heading, alignment: alignment, weight: Math.max(1, Math.min(3, 0.75 + length / 16)) };
  });
  return { columns: columns, rows: values };
}

// 只解析展示所需的 Markdown 子集；HTML 始终作为普通文字，不执行或加载外部内容。
export function parseReplyBlocks(content: string): ReplyBlock[] {
  const lines: string[] = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReplyBlock[] = [];
  let cursor: number = 0;
  while (cursor < lines.length) {
    const line: string = lines[cursor];
    if (line.trim().length === 0) { cursor += 1; continue; }
    const fence: RegExpMatchArray | null = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence !== null) {
      const code: string[] = [];
      const closing: RegExp = new RegExp('^ {0,3}' + fence[1][0] + '{' + fence[1].length + ',}[ \\t]*$');
      cursor += 1;
      while (cursor < lines.length && !closing.test(lines[cursor])) { code.push(lines[cursor]); cursor += 1; }
      if (cursor < lines.length) { cursor += 1; }
      blocks.push(block('code', code.join('\n')));
      continue;
    }
    const heading: RegExpMatchArray | null = line.match(/^ {0,3}(#{1,6})[ \t]+(.+)$/);
    if (heading !== null) {
      blocks.push(block('heading', heading[2].replace(/[ \t]+#+[ \t]*$/, '').trim(), heading[1].length));
      cursor += 1;
      continue;
    }
    if (isBoldHeading(line)) {
      blocks.push(block('heading', line.trim().slice(2, -2), 3));
      cursor += 1;
      continue;
    }
    if (/^ {0,3}((\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/.test(line)) {
      blocks.push(block('divider', ''));
      cursor += 1;
      continue;
    }
    if (/^ {0,3}>/.test(line)) {
      const quote: string[] = [];
      while (cursor < lines.length && /^ {0,3}>/.test(lines[cursor])) {
        quote.push(lines[cursor].replace(/^ {0,3}> ?/, ''));
        cursor += 1;
      }
      blocks.push(block('quote', quote.join('\n')));
      continue;
    }
    const header: ReplyTableHeader | undefined = tableHeader(lines, cursor);
    if (header !== undefined) {
      const start: number = cursor;
      const rows: string[][] = [];
      cursor += 2;
      while (cursor < lines.length && !isBlockStart(lines[cursor]) && tableHeader(lines, cursor) === undefined) {
        const cells: string[] = tableCells(lines[cursor]);
        if (cells.length === 0) { break; }
        rows.push(cells);
        cursor += 1;
      }
      blocks.push({ kind: 'table', text: lines.slice(start, cursor).join('\n'), runs: [], level: 0, marker: '', indent: 0,
        table: readTable(header, rows) });
      continue;
    }
    const item: RegExpMatchArray | null = line.match(/^(\s*)([-+*]|\d{1,9}[.)])[ \t]+(.*)$/);
    if (item !== null) {
      const text: string[] = [item[3]];
      cursor += 1;
      while (cursor < lines.length && lines[cursor].trim().length > 0 && !isBlockStart(lines[cursor]) &&
        tableHeader(lines, cursor) === undefined) {
        text.push(lines[cursor].trim());
        cursor += 1;
      }
      const indent: number = Math.min(3, Math.floor(item[1].replace(/\t/g, '    ').length / 2));
      blocks.push(block('list', text.join('\n'), 0, /\d/.test(item[2]) ? item[2] : '•', indent));
      continue;
    }
    const paragraph: string[] = [line.trim()];
    cursor += 1;
    while (cursor < lines.length && lines[cursor].trim().length > 0 && !isBlockStart(lines[cursor]) &&
      tableHeader(lines, cursor) === undefined) {
      paragraph.push(lines[cursor].trim());
      cursor += 1;
    }
    blocks.push(block('paragraph', paragraph.join('\n')));
  }
  return blocks;
}
