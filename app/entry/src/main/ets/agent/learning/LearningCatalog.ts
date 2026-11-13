import type { LearnerProfile, LearningPath, LearningTask, LearningTaskDraft } from '../../contracts/LearningModels';
import { validateTimestamp } from './LearningScheduler';

interface WeekContent {
  learn: string;
  learnCriteria: string;
  practice: string;
  practiceCriteria: string;
}

export function missingProfileFields(profile: LearnerProfile): string[] {
  const missing: string[] = [];
  if (profile.track !== 'employment' && profile.track !== 'postgraduate') { missing.push('track'); }
  if (profile.major.trim().length === 0) { missing.push('major'); }
  if (profile.grade.trim().length === 0) { missing.push('grade'); }
  if (profile.background.trim().length === 0) { missing.push('background'); }
  if (profile.interests.trim().length === 0) { missing.push('interests'); }
  if (profile.goal.trim().length === 0) { missing.push('goal'); }
  if (profile.weeks === 0) { missing.push('weeks'); }
  if (profile.minutesPerWeek === 0) { missing.push('minutesPerWeek'); }
  return missing;
}

export function recommendPaths(profile: LearnerProfile): LearningPath[] {
  if (missingProfileFields(profile).length > 0) { return []; }
  const context: string = '你是' + profile.major.trim() + '专业、' + profile.grade.trim() +
    '；已有基础：' + profile.background.trim() + '；兴趣：' + profile.interests.trim() +
    '；目标：' + profile.goal.trim() + '。可用' + profile.weeks + '周，每周' +
    profile.minutesPerWeek + '分钟。';
  const estimate: string = '任务耗时仅为模板提案估计，需根据实际进度调整。';
  if (profile.track === 'postgraduate') {
    const caveat: string = estimate + '自述信息不能确定适配程度；具体招生要求、科目与适用年份需核实目标院校官方信息。';
    return [
      { id: 'postgraduate-foundation', title: '考研通用学习基础',
        reason: context + '先体验资料阅读、主动回忆和错题复盘，观察能否持续投入基础学习。',
        trial: '选择一段已有学习材料，阅读后合上材料写出要点，再核对遗漏。', caveat: caveat },
      { id: 'postgraduate-explore', title: '考研目标核实与探索',
        reason: context + '先整理目标与官方信息来源，比较投入成本和未核实条件，再决定准备方向。',
        trial: '列出两个待了解的目标，找到各自官方招生入口，记录来源和待核实问题。', caveat: caveat }
    ];
  }
  const caveat: string = estimate + '方向适配程度仍需实践验证，不代表已具备岗位资格；具体岗位要求需另行核实。';
  if (/计算机|软件工程|网络工程|信息安全|物联网|人工智能|数据科学|computer science|software engineering|computing/i.test(profile.major)) {
    return [
      { id: 'go-backend', title: 'Go 后端开发体验',
        reason: context + '后端路径侧重数据处理、接口与测试，可用小型服务检验对逻辑和服务端问题的兴趣。',
        trial: '运行一个 Go 小程序并修改输入输出，再尝试一个本地 HTTP 接口。', caveat: caveat },
      { id: 'frontend', title: '前端开发体验',
        reason: context + '前端路径侧重页面、交互与信息表达，可通过可见界面比较自己对用户体验问题的兴趣。',
        trial: '制作一个简单页面，加入按钮交互，观察是否喜欢界面反馈与调试过程。', caveat: caveat }
    ];
  }
  return [
    { id: 'general-skills', title: '通用问题解决与表达',
      reason: context + '从资料检索、信息整理和成果表达开始，体验与现有专业可结合的通用能力。',
      trial: '围绕一个本专业小问题查找资料，用一页文档说明问题、依据和结论。', caveat: caveat },
    { id: 'career-explore', title: '职业方向体验与核实',
      reason: context + '比较真实任务与自身兴趣，通过小型模拟任务收集选择依据，逐步核实方向要求。',
      trial: '选两个感兴趣方向，各找一份公开岗位说明，记录要求并尝试其中一个入门任务。', caveat: caveat }
  ];
}

export function buildLearningTasks(profile: LearnerProfile, pathId: string): LearningTask[] {
  if (!recommendPaths(profile).some((path: LearningPath) => path.id === pathId)) {
    throw new Error('INVALID_PATH: 请选择本次推荐中的路径。');
  }
  const contents: WeekContent[] = weekContents(pathId);
  const phases: string[] = ['入门体验', '基础实践', '改进检验', '成果复盘'];
  const tasks: LearningTask[] = [];
  const learnMinutes: number = Math.floor(profile.minutesPerWeek / 2);
  const practiceMinutes: number = profile.minutesPerWeek - learnMinutes;
  for (let week: number = 1; week <= profile.weeks; week += 1) {
    const content: WeekContent = contents[week - 1];
    const learnId: string = pathId + '-w' + week + '-learn';
    const practiceId: string = pathId + '-w' + week + '-practice';
    tasks.push({ id: learnId, title: content.learn, phase: phases[week - 1], week: week,
      estimatedMinutes: learnMinutes, remainingMinutes: learnMinutes,
      completionCriteria: content.learnCriteria,
      dependsOn: week === 1 ? [] : [pathId + '-w' + (week - 1) + '-practice'],
      dueAt: '', status: 'pending' });
    tasks.push({ id: practiceId, title: content.practice, phase: phases[week - 1], week: week,
      estimatedMinutes: practiceMinutes, remainingMinutes: practiceMinutes,
      completionCriteria: content.practiceCriteria, dependsOn: [learnId], dueAt: '', status: 'pending' });
  }
  return tasks;
}

export function validateTaskDraft(profile: LearnerProfile, pathId: string, startAt: string,
  drafts: LearningTaskDraft[]): LearningTask[] {
  const invalid = 'INVALID_TASK_DRAFT: 请提供每周的具体任务、预计分钟、完成标准和有效的前置任务；任务合计不能超过该周预算。';
  if (!Array.isArray(drafts) || drafts.length < profile.weeks || drafts.length > 16) { throw new Error(invalid); }
  const startsAt = validateTimestamp(startAt);
  const byId: Map<string, LearningTaskDraft> = new Map<string, LearningTaskDraft>();
  const totals: number[] = new Array<number>(profile.weeks).fill(0);
  const allowed = ['id', 'title', 'phase', 'week', 'estimatedMinutes', 'completionCriteria', 'dependsOn', 'dueAt'];
  for (const task of drafts) {
    if (task === null || typeof task !== 'object' || Array.isArray(task) ||
      Object.keys(task).some((key) => !allowed.includes(key)) ||
      typeof task.id !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(task.id) || byId.has(task.id) ||
      !validDraftText(task.title, 120) || !validDraftText(task.phase, 60) || !validDraftText(task.completionCriteria, 300) ||
      !Number.isInteger(task.week) || task.week < 1 || task.week > profile.weeks ||
      !Number.isInteger(task.estimatedMinutes) || task.estimatedMinutes < 1 ||
      !Array.isArray(task.dependsOn) || task.dependsOn.length >= drafts.length ||
      new Set<string>(task.dependsOn).size !== task.dependsOn.length) { throw new Error(invalid); }
    if (task.dueAt !== undefined) {
      let due: number;
      try { due = validateTimestamp(task.dueAt); } catch { throw new Error(invalid); }
      if (due < startsAt + (task.week - 1) * 604800000 + task.estimatedMinutes * 60000) { throw new Error(invalid); }
    }
    byId.set(task.id, task);
    totals[task.week - 1] += task.estimatedMinutes;
  }
  if (totals.some((total) => total < 1 || total > profile.minutesPerWeek)) { throw new Error(invalid); }
  const accepted: Set<string> = new Set<string>();
  const tasks: LearningTask[] = [];
  for (const task of drafts) {
    for (const id of task.dependsOn) {
      const dependency = byId.get(id);
      if (!accepted.has(id) || dependency === undefined || dependency.week > task.week) { throw new Error(invalid); }
    }
    accepted.add(task.id);
    tasks.push({ id: pathId + '-draft-' + task.id, title: task.title.trim(), phase: task.phase.trim(), week: task.week,
      estimatedMinutes: task.estimatedMinutes, remainingMinutes: task.estimatedMinutes,
      completionCriteria: task.completionCriteria.trim(), dependsOn: task.dependsOn.map((id) => pathId + '-draft-' + id),
      dueAt: task.dueAt ?? '', status: 'pending' });
  }
  return tasks;
}

function validDraftText(value: string, maximum: number): boolean {
  return typeof value === 'string' && value.trim().length > 0 && Array.from(value.trim()).length <= maximum;
}

// 以下均为可调整的体验任务提案，不包含岗位资格或院校考试要求的事实判断。
function weekContents(pathId: string): WeekContent[] {
  switch (pathId) {
    case 'go-backend': return [
      { learn: '学习 Go 基础与程序入口', learnCriteria: '用自己的话记录变量、函数与程序入口各自的作用。',
        practice: '运行并修改一个 Go 小程序', practiceCriteria: '保留可运行代码和一组输入输出，说明修改前后的变化。' },
      { learn: '学习 HTTP 请求与响应', learnCriteria: '画出本地请求到处理函数再到响应的调用顺序。',
        practice: '完成一个本地 Go 接口', practiceCriteria: '运行本地接口，保留一次成功请求与返回结果。' },
      { learn: '学习输入校验与接口测试', learnCriteria: '列出接口的正常输入、边界输入和非法输入及预期结果。',
        practice: '补充校验并验证异常输入', practiceCriteria: '记录正常与非法请求结果，并解释与预期是否一致。' },
      { learn: '整理接口设计与运行说明', learnCriteria: '写明接口用途、输入、输出、启动步骤和已知限制。',
        practice: '演示成果并复盘方向兴趣', practiceCriteria: '按说明重新运行成果，记录遇到的问题、兴趣变化和下一步选择。' }
    ];
    case 'frontend': return [
      { learn: '学习页面结构与样式', learnCriteria: '画出页面信息层次，说明结构与样式分别负责什么。',
        practice: '制作一个信息展示页面', practiceCriteria: '保存可打开的页面与截图，检查主要内容是否能完整阅读。' },
      { learn: '学习事件与界面状态', learnCriteria: '记录一个按钮事件如何改变数据与页面显示的调用顺序。',
        practice: '完成一个可交互的小页面', practiceCriteria: '演示一次操作前后的状态变化，并记录操作与预期结果。' },
      { learn: '学习数据展示与错误状态', learnCriteria: '列出页面加载、空数据和错误时需要向用户展示的内容。',
        practice: '检验页面边界状态', practiceCriteria: '用本地样例分别展示正常、空数据和错误状态并保留截图。' },
      { learn: '整理交互说明与使用步骤', learnCriteria: '写明页面用途、操作步骤、运行方式和已知限制。',
        practice: '演示页面并复盘方向兴趣', practiceCriteria: '按说明重新演示交互，记录问题、兴趣变化和下一步选择。' }
    ];
    case 'general-skills': return [
      { learn: '学习将专业问题拆成小问题', learnCriteria: '写出一个专业相关问题、预期产物与需要确认的条件。',
        practice: '形成一页问题说明', practiceCriteria: '保存一页说明，区分已知事实、个人假设和待查证事项。' },
      { learn: '学习资料检索与来源核对', learnCriteria: '列出检索关键词与来源判断标准，记录引用位置。',
        practice: '完成有来源的简短分析', practiceCriteria: '产出带来源的结论，标出证据不足与仍需核实的部分。' },
      { learn: '学习整理比较信息', learnCriteria: '定义比较维度与判断依据，解释为何适用于当前问题。',
        practice: '制作比较表并检验结论', practiceCriteria: '保存比较表，检查各项结论是否有对应来源支持。' },
      { learn: '学习清楚表达结果与限制', learnCriteria: '写出结论、主要依据、局限和建议的表达提纲。',
        practice: '提交成果并复盘可迁移能力', practiceCriteria: '完成一份简报，记录实际耗时、困难与下一步想验证的能力。' }
    ];
    case 'career-explore': return [
      { learn: '了解感兴趣方向的任务与要求', learnCriteria: '选择两个方向，记录公开岗位说明来源和仍不明确的要求。',
        practice: '比较两个方向的入门任务', practiceCriteria: '完成一张任务比较表，区分兴趣判断和来源可支持的要求。' },
      { learn: '拆解一个可完成的模拟任务', learnCriteria: '选一个无需预设职业资格的模拟任务，写出步骤和产物标准。',
        practice: '尝试模拟任务并记录体验', practiceCriteria: '保存模拟产物，记录实际困难、耗时和感兴趣的环节。' },
      { learn: '核对能力差距与学习成本', learnCriteria: '结合来源列出已具备能力、待验证能力和未知要求。',
        practice: '验证一个主要能力差距', practiceCriteria: '选择一项差距做小练习，记录证据和仍无法判断的部分。' },
      { learn: '整理方向比较与选择依据', learnCriteria: '列出各方向的任务偏好、投入成本与未解决问题。',
        practice: '复盘并提出下一步方向', practiceCriteria: '提交比较结论，注明不确定性和下一次体验要验证的问题。' }
    ];
    case 'postgraduate-foundation': return [
      { learn: '梳理现有学习基础与材料', learnCriteria: '选择已有学习材料，列出熟悉主题、薄弱点和可核对的来源。',
        practice: '完成一次阅读与主动回忆', practiceCriteria: '合上材料写出要点，再对照来源标注遗漏和误解。' },
      { learn: '学习拆解难点与订正方法', learnCriteria: '将一个不熟悉的主题拆成小问题，写出各自验证方式。',
        practice: '完成一次难点练习与订正', practiceCriteria: '保留练习过程、核对依据和订正说明，标记仍未理解的点。' },
      { learn: '整理重复出现的学习困难', learnCriteria: '按理解、记忆或应用分类记录困难及其具体证据。',
        practice: '验证一种改进学习方法', practiceCriteria: '对同一薄弱点再次练习，比较前后结果并记录方法是否有效。' },
      { learn: '整理通用学习复盘方法', learnCriteria: '写出材料来源、复习步骤、检查方式和未解决问题。',
        practice: '复盘投入与后续准备条件', practiceCriteria: '记录实际进度与耗时，提出后续准备建议和需核实的官方要求。' }
    ];
    case 'postgraduate-explore': return [
      { learn: '梳理深造动机与目标问题', learnCriteria: '写出深造动机、待了解的目标及个人限制，区分偏好与事实。',
        practice: '建立目标与官方来源清单', practiceCriteria: '记录两个候选目标的官方信息入口与尚未核实的问题。' },
      { learn: '学习核实招生信息的范围', learnCriteria: '列出需核对的要求、适用年份与来源，缺失信息标记为待核实。',
        practice: '整理带来源的目标比较表', practiceCriteria: '记录官方页面链接、查看日期和适用范围，不确定项保留待核实标记。' },
      { learn: '梳理准备投入与个人条件', learnCriteria: '列出时间、费用及能力方面的限制，标明哪些仍是个人估计。',
        practice: '检验目标与当前条件的差距', practiceCriteria: '用已核实信息逐项比较差距，记录缺少证据或需要进一步咨询的问题。' },
      { learn: '整理目标选择依据与不确定性', learnCriteria: '写出候选目标的依据、投入和未确认要求，不将猜测当作招生事实。',
        practice: '形成下一步核实与准备清单', practiceCriteria: '保存带来源的比较结论，列明下一步行动和仍需官方核实的条件。' }
    ];
    default: throw new Error('INVALID_PATH: 未找到路径任务模板。');
  }
}
