import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCore } from '../scripts/compile-core.mjs';

const core = await compileCore();
const { missingProfileFields, recommendPaths, buildLearningTasks } =
  await core.load('agent/learning/LearningCatalog.ts');

function profile(overrides = {}) {
  return {
    track: 'employment', major: '计算机科学与技术', grade: '大二',
    background: '学过 Go 基础', interests: '喜欢做能运行的小工具',
    goal: '通过实践比较发展方向', weeks: 2, minutesPerWeek: 120,
    ...overrides
  };
}

test('缺项访谈覆盖方向、个人条件和时间，空白文本及零时间不被猜测', () => {
  assert.deepEqual(missingProfileFields(profile({
    track: '', major: '', grade: '', background: '', interests: '', goal: '',
    weeks: 0, minutesPerWeek: 0
  })), ['track', 'major', 'grade', 'background', 'interests', 'goal', 'weeks', 'minutesPerWeek']);
  assert.deepEqual(missingProfileFields(profile()), []);
  assert.deepEqual(missingProfileFields(profile({ major: '  ', interests: '\n', minutesPerWeek: 0 })),
    ['major', 'interests', 'minutesPerWeek']);
  assert.deepEqual(missingProfileFields(profile({ track: 'undecided' })), ['track']);
});

test('任一必要条件缺失都不提前推荐路径', () => {
  for (const key of ['track', 'major', 'grade', 'background', 'interests', 'goal']) {
    assert.deepEqual(recommendPaths(profile({ [key]: '' })), [], key);
  }
  for (const key of ['weeks', 'minutesPerWeek']) {
    assert.deepEqual(recommendPaths(profile({ [key]: 0 })), [], key);
  }
  assert.deepEqual(recommendPaths(profile({ track: 'undecided' })), []);
});

test('计算机就业入口提供 Go 后端与前端两条可比较候选及个体条件依据', () => {
  const input = profile();
  const paths = recommendPaths(input);
  assert.deepEqual(paths.map((item) => item.id), ['go-backend', 'frontend']);
  assert.notEqual(paths[0].reason, paths[1].reason);
  assert.notEqual(paths[0].trial, paths[1].trial);
  for (const item of paths) {
    for (const field of ['title', 'reason', 'trial', 'caveat']) {
      assert.ok(item[field].trim().length > 0, `${item.id}.${field}`);
    }
    for (const field of ['major', 'grade', 'background', 'interests', 'goal']) {
      assert.ok(item.reason.includes(input[field]), `${item.id} 不应忽略 ${field}`);
    }
    assert.match(item.caveat, /估计|预计/);
    assert.match(item.caveat, /不确定|不能|不代表|需.*验证/);
  }
  for (const major of ['软件工程', 'Software Engineering']) {
    assert.deepEqual(recommendPaths(profile({ major })).map((item) => item.id),
      ['go-backend', 'frontend']);
  }
});

test('非计算机专业先比较通用能力与方向体验，不假定岗位资格', () => {
  const paths = recommendPaths(profile({ major: '汉语言文学', background: '没有编程经验' }));
  assert.equal(paths.length, 2);
  assert.equal(new Set(paths.map((item) => item.id)).size, 2);
  assert.ok(paths.every((item) => !['go-backend', 'frontend'].includes(item.id)));
  assert.match(paths.map((item) => item.title).join(' '), /通用/);
  assert.match(paths.map((item) => item.title).join(' '), /体验|探索/);
  for (const item of paths) {
    assert.match(item.reason, /汉语言文学/);
    assert.match(item.caveat, /资格|岗位要求/);
    assert.ok(item.trial.trim());
  }
});

test('考研入口提供通用基础和目标核实，不生成具体院校科目或年份事实', () => {
  const paths = recommendPaths(profile({ track: 'postgraduate', goal: '比较是否适合继续深造' }));
  assert.deepEqual(paths.map((item) => item.id), ['postgraduate-foundation', 'postgraduate-explore']);
  for (const item of paths) {
    assert.ok(item.reason.trim());
    assert.ok(item.trial.trim());
    assert.match(item.caveat, /官方|招生/);
    assert.doesNotMatch(JSON.stringify(item), /20\d{2}年|必考|保证录取/);
  }
});

test('所有推荐路径在 2 周和 4 周内均生成有标准、依赖与预算的阶段任务', () => {
  for (const input of [profile(), profile({ major: '机械工程' }), profile({ track: 'postgraduate' })]) {
    for (const weeks of [2, 4]) {
      for (const minutesPerWeek of [30, 31, 120]) {
        const current = { ...input, weeks, minutesPerWeek };
        const paths = recommendPaths(current);
        assert.equal(paths.length, 2);
        for (const path of paths) {
          const tasks = buildLearningTasks(current, path.id);
          assert.equal(tasks.length, 2 * weeks, path.id);
          assert.equal(new Set(tasks.map((task) => task.id)).size, tasks.length);
          const completed = new Set();
          for (let index = 0; index < tasks.length; index += 1) {
            const task = tasks[index];
            const week = Math.floor(index / 2) + 1;
            const kind = index % 2 === 0 ? 'learn' : 'practice';
            assert.equal(task.id, `${path.id}-w${week}-${kind}`);
            assert.equal(task.week, week);
            assert.ok(task.title.trim());
            assert.ok(task.phase.trim());
            assert.ok(task.completionCriteria.trim().length >= 10);
            assert.ok(Number.isInteger(task.estimatedMinutes) && task.estimatedMinutes > 0);
            assert.equal(task.remainingMinutes, task.estimatedMinutes);
            assert.equal(task.status, 'pending');
            assert.equal(task.dueAt, '');
            assert.deepEqual(task.dependsOn, index === 0 ? [] : [tasks[index - 1].id]);
            assert.ok(task.dependsOn.every((id) => completed.has(id)), '依赖只能指向已在前序出现的任务');
            completed.add(task.id);
          }
          for (let week = 1; week <= weeks; week += 1) {
            const weekly = tasks.filter((task) => task.week === week);
            assert.equal(weekly.length, 2);
            assert.ok(weekly.reduce((sum, task) => sum + task.estimatedMinutes, 0) <= minutesPerWeek);
          }
        }
      }
    }
  }
});

test('任务标识可复用，扩展到 4 周保留已有标识，输出之间不共享可变对象', () => {
  const input = profile();
  const original = structuredClone(input);
  const first = buildLearningTasks(input, 'go-backend');
  assert.deepEqual(first, buildLearningTasks(input, 'go-backend'));
  assert.deepEqual(first.map((task) => task.id), [
    'go-backend-w1-learn', 'go-backend-w1-practice', 'go-backend-w2-learn', 'go-backend-w2-practice'
  ]);
  assert.deepEqual(buildLearningTasks(profile({ weeks: 4 }), 'go-backend').slice(0, 4).map((task) => task.id),
    first.map((task) => task.id));
  first[0].status = 'done';
  first[1].dependsOn.push('foreign-task');
  assert.equal(buildLearningTasks(input, 'go-backend')[0].status, 'pending');
  assert.deepEqual(buildLearningTasks(input, 'go-backend')[1].dependsOn, ['go-backend-w1-learn']);
  assert.deepEqual(input, original);
});

test('任务只允许本次推荐中的路径，未知路径或其他入口的路径抛出 INVALID_PATH', () => {
  for (const id of ['', 'invented', 'postgraduate-foundation']) {
    assert.throws(() => buildLearningTasks(profile(), id), /INVALID_PATH/);
  }
  assert.throws(() => buildLearningTasks(profile({ track: 'postgraduate' }), 'go-backend'), /INVALID_PATH/);
  assert.throws(() => buildLearningTasks(profile({ major: '汉语言文学' }), 'go-backend'), /INVALID_PATH/);
  assert.throws(() => buildLearningTasks(profile({ goal: '' }), 'go-backend'), /INVALID_PATH/);
});
