import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCore } from '../../scripts/compile-core.mjs';

const core = await compileCore();
const { parseReplyInline, parseReplyBlocks } = await core.load('ui/ReplyFormatting.ts');
const visible = (runs) => runs.map((run) => run.text).join('');

test('回复中的 Markdown 链接和裸网址保留原始查询参数及锚点', () => {
  const url = 'https://jobs.example.com/posting?id=3&role=java#req';
  const runs = parseReplyInline(`**[岗位原文](${url})**。来源:https://example.com/docs，另见 <https://example.org/a>`);
  const links = runs.filter((run) => run.url);
  assert.deepEqual(links.map((run) => [run.text, run.url]), [
    ['岗位原文', url], ['https://example.com/docs', 'https://example.com/docs'],
    ['https://example.org/a', 'https://example.org/a']
  ]);
  assert.equal(links[0].bold, true);
  assert.equal(visible(runs), '岗位原文。来源:https://example.com/docs，另见 https://example.org/a');
});

test('开括号链接、非网页协议和代码链接按各自语义处理', () => {
  const url = 'https://example.org/Java_(语言)';
  const text = `[参考](${url})（也见 https://example.com/a.） [本地](file:///tmp/a) ` +
    '[脚本](javascript:alert(1)) https://account@example.org/path `https://example.com/code`';
  assert.deepEqual(parseReplyInline(text).filter((run) => run.url).map((run) => run.url),
    [url, 'https://example.com/a']);
});

test('岗位对照表与来源链接分别排版，表格中的来源可点击', () => {
  const url = 'https://jobs.example.com/campus/detail?id=A54227&from=chat#requirements';
  const blocks = parseReplyBlocks([
    '**本轮检索到的岗位线索**',
    '| 岗位 | 公司/来源 | 城市 | 摘要中看到的关键点 |',
    '|---|---|:---:|---|',
    `| [Agent 全栈开发实习生](${url}) | 校园招聘 | 北京、上海 | 熟悉 **Java** 或 Python 中至少一门 |`,
    '| AI 应用开发实习生 | 企业官网 | 杭州 | 能连续实习三个月以上 |',
    '原始链接',
    `- ${url}`
  ].join('\n'));
  assert.deepEqual(blocks.map((item) => item.kind), ['heading', 'table', 'paragraph', 'list']);
  const { columns, rows } = blocks[1].table;
  assert.deepEqual(columns.map(({ heading }) => visible(heading)), ['岗位', '公司/来源', '城市', '摘要中看到的关键点']);
  assert.equal(columns[2].alignment, 'center');
  assert.equal(rows.length, 2);
  assert.equal(rows[0][0][0].url, url);
  assert.equal(rows[0][0][0].text, 'Agent 全栈开发实习生');
  assert.ok(rows[0][3].some((run) => run.text === 'Java' && run.bold));
  assert.equal(blocks[3].runs[0].url, url);
});

test('表格保留行内竖线与多余字段，遇到新段落立即结束', () => {
  const blocks = parseReplyBlocks([
    '按公司和岗位总结。',
    '岗位 | 技能 | 来源',
    ':--- | :---: | ---:',
    '| A \\| B | `x|y` | 详情 | 补充 |',
    '| 少一列 | Java |',
    '下一段直接开始，保留原文。',
    '',
    '| 普通文本 | 没有分隔行 |'
  ].join('\n'));
  assert.deepEqual(blocks.map((item) => item.kind), ['paragraph', 'table', 'paragraph', 'paragraph']);
  const { columns, rows } = blocks[1].table;
  assert.deepEqual(columns.map((column) => column.alignment), ['start', 'center', 'end']);
  assert.deepEqual(rows.map((row) => row.map(visible)), [['A | B', 'x|y', '详情 | 补充'], ['少一列', 'Java', '']]);
  assert.equal(blocks[3].text, '| 普通文本 | 没有分隔行 |');
});

test('历史回复的独立加粗标题与连续编号分别呈现，不必重新请求模型', () => {
  const blocks = parseReplyBlocks('**四、资源与约束**\n11. 是否已经报班？\n12. 每天能投入 **3 小时** 吗？\n\n**五、如果时间很紧**\n先确认考试时间。');
  assert.deepEqual(blocks.map((item) => item.kind), ['heading', 'list', 'list', 'heading', 'paragraph']);
  assert.equal(blocks[0].text, '四、资源与约束');
  assert.equal(blocks[0].level, 3);
  assert.deepEqual(blocks.filter((item) => item.kind === 'list').map((item) => item.marker), ['11.', '12.']);
  assert.ok(blocks[2].runs.some((run) => run.text === '3 小时' && run.bold));
  // 同一段里有多个加粗片段时仍是正文，避免误当成标题。
  assert.equal(parseReplyBlocks('**时间**与**目标**都要确认。')[0].kind, 'paragraph');
});

test('标准标题保留层级，正文中的井号及带井号的课程名不被吞掉', () => {
  const blocks = parseReplyBlocks('# 总目标\n## 本周安排 ##\n### C#\n正文 # 不是标题\n#没有空格');
  assert.deepEqual(blocks.slice(0, 3).map((item) => [item.level, item.text]), [[1, '总目标'], [2, '本周安排'], [3, 'C#']]);
  assert.equal(blocks[3].text, '正文 # 不是标题\n#没有空格');
});

test('加粗、斜体和行内代码可以混排，代码中的强调符号保持原文', () => {
  const runs = parseReplyInline('先做 **核心任务**，再看 *补充*，输入 `a_**b**`。');
  assert.equal(visible(runs), '先做 核心任务，再看 补充，输入 a_**b**。');
  assert.ok(runs.some((run) => run.text === '核心任务' && run.bold));
  assert.ok(runs.some((run) => run.text === '补充' && run.italic));
  assert.ok(runs.some((run) => run.text === 'a_**b**' && run.code && !run.bold));
  const nested = parseReplyInline('*先做 **高数** 再练习*，**保留 `**原文**`**。');
  assert.equal(visible(nested), '先做 高数 再练习，保留 **原文**。');
  assert.ok(nested.some((run) => run.text === '高数' && run.bold && run.italic));
  assert.ok(nested.some((run) => run.text === '**原文**' && run.code && run.bold));
  assert.equal(visible(parseReplyInline('***双重强调*** / **重点 *附注***')), '双重强调 / 重点 附注');
});

test('转义、未闭合标记和普通变量名不丢失内容', () => {
  const escaped = String.raw`\*\*原文\*\*，api_key，**尚未完成，` + '\\';
  assert.equal(visible(parseReplyInline(escaped)), '**原文**，api_key，**尚未完成，\\');
  for (const text of ['**等待', '`未闭合代码', '``未闭合', '*', '普通文字', '__等待']) {
    assert.equal(visible(parseReplyInline(text)), text);
  }
});

test('列表换行、嵌套缩进、原有起始编号与段落边界保持可读', () => {
  const blocks = parseReplyBlocks('9. 第一项\r\n   补充说明\r\n10. 第二项\r\n  - **子任务**\r\n\r\n下一段\r\n继续说明。');
  assert.equal(blocks[0].text, '第一项\n补充说明');
  assert.equal(blocks[1].marker, '10.');
  assert.equal(blocks[2].marker, '•');
  assert.equal(blocks[2].indent, 1);
  assert.equal(blocks[3].kind, 'paragraph');
  assert.equal(blocks[3].text, '下一段\n继续说明。');
});

test('代码围栏中的标题、列表与星号不会再次解析，未闭合围栏保留代码', () => {
  const blocks = parseReplyBlocks('````ts\n## 原文\n- **原文**\n```\n````\n\n结束');
  assert.equal(blocks[0].kind, 'code');
  assert.equal(blocks[0].text, '## 原文\n- **原文**\n```');
  assert.equal(blocks[1].text, '结束');
  assert.equal(parseReplyBlocks('~~~\nconst a = 1;')[0].text, 'const a = 1;');
});

test('引用与分隔线独立显示，引用内仍能突出重点', () => {
  const blocks = parseReplyBlocks('> 提醒：**先确认日期**\n> 再生成日程\n\n---\n\n普通正文');
  assert.deepEqual(blocks.map((item) => item.kind), ['quote', 'divider', 'paragraph']);
  assert.equal(visible(blocks[0].runs), '提醒：先确认日期\n再生成日程');
  assert.ok(blocks[0].runs.some((run) => run.text === '先确认日期' && run.bold));
});

test('空回复安全，长文本和 HTML 作为原文保留', () => {
  assert.deepEqual(parseReplyBlocks(' \n\r\n'), []);
  const text = '<script>alert(1)</script>\n' + '复习安排。'.repeat(3000);
  const blocks = parseReplyBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(visible(blocks[0].runs), text);
});
