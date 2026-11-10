import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCore } from '../scripts/compile-core.mjs';

const core = await compileCore();
const { scheduleLearningTasks, validateTimestamp } = await core.load('agent/learning/LearningScheduler.ts');
const from = '2026-10-28T00:00:00Z';

function task(id, overrides = {}) {
  return {
    id, title: `学习 ${id}`, phase: '入门', week: 1,
    estimatedMinutes: 60, remainingMinutes: 60,
    completionCriteria: '完成练习', dependsOn: [], dueAt: '', status: 'pending',
    ...overrides
  };
}

function plan(tasks, overrides = {}) {
  return {
    id: 'plan-1', version: 1, pathId: 'path-1', weeks: 3, startAt: from,
    tasks, schedule: [], unscheduledTaskIds: [], ...overrides
  };
}

function window(startAt, endAt) { return { startAt, endAt }; }
function block(id, taskId, startAt, endAt) {
  return { id, taskId, title: `学习 ${taskId}`, startAt, endAt, reminderMinutes: 0 };
}

test('timestamp validation requires an explicit zone and a real calendar date', () => {
  assert.equal(validateTimestamp('2026-10-28T08:00:00+08:00'), 1793145600000);
  assert.equal(validateTimestamp('2026-10-27T17:00:00-07:00'), 1793145600000);
  assert.equal(validateTimestamp('2024-02-29T23:59:59.125Z'), 1709251199125);
  assert.equal(validateTimestamp('2000-02-29T00:00:00Z'), 951782400000);
  for (const invalid of [
    '2026-10-28T08:00:00', '2026-10-28', '2026-02-30T00:00:00Z',
    '2025-02-29T00:00:00+08:00', '1900-02-29T00:00:00Z', '2026-04-31T00:00:00Z',
    '2026-13-01T00:00:00Z', '2026-10-28T24:00:00Z',
    '2026-10-28T00:60:00Z', '2026-10-28T00:00:60Z',
    '2026-10-28T00:00:00+24:00', '2026-10-28T00:00:00+08:60',
    ' 2026-10-28T00:00:00Z', '2026-10-28T00:00:00Z trailing'
  ]) assert.throws(() => validateTimestamp(invalid), /INVALID_TIMESTAMP/, invalid);
});

test('clips availability to the future seven-day interval including its first minute', () => {
  const result = scheduleLearningTasks(plan([task('a', { remainingMinutes: 180 })]), [
    window('2026-10-27T23:00:00Z', '2026-10-28T01:00:00Z'),
    window('2026-11-03T23:00:00Z', '2026-11-04T01:00:00Z'),
    window('2026-11-04T01:00:00Z', '2026-11-04T03:00:00Z')
  ], [], from);
  assert.deepEqual(result, {
    blocks: [
      block('a-part-1', 'a', '2026-10-28T00:00:00.000Z', '2026-10-28T01:00:00.000Z'),
      block('a-part-2', 'a', '2026-11-03T23:00:00.000Z', '2026-11-04T00:00:00.000Z')
    ], unscheduledTaskIds: ['a'], deferredTaskIds: []
  });
});

test('compares offset timestamps as instants across local dates', () => {
  const result = scheduleLearningTasks(plan([task('a')]), [
    window('2026-10-27T17:00:00-07:00', '2026-10-27T18:00:00-07:00')
  ], [], '2026-10-28T08:00:00+08:00');
  assert.deepEqual(result.blocks, [block('a-part-1', 'a',
    '2026-10-28T00:00:00.000Z', '2026-10-28T01:00:00.000Z')]);
});

test('subtracts every overlapping busy interval without crossing a conflict', () => {
  const result = scheduleLearningTasks(plan([task('a', { remainingMinutes: 120 })]), [
    window('2026-10-28T09:00:00Z', '2026-10-28T13:00:00Z')
  ], [
    window('2026-10-28T10:30:00Z', '2026-10-28T12:00:00Z'),
    window('2026-10-28T10:00:00Z', '2026-10-28T11:00:00Z'),
    window('2026-10-28T10:15:00Z', '2026-10-28T10:45:00Z')
  ], from);
  assert.deepEqual(result, {
    blocks: [
      block('a-part-1', 'a', '2026-10-28T09:00:00.000Z', '2026-10-28T10:00:00.000Z'),
      block('a-part-2', 'a', '2026-10-28T12:00:00.000Z', '2026-10-28T13:00:00.000Z')
    ], unscheduledTaskIds: [], deferredTaskIds: []
  });
});

test('rounds busy seconds outward so no scheduled minute crosses a busy boundary', () => {
  const result = scheduleLearningTasks(plan([task('a', { remainingMinutes: 120 })]), [
    window('2026-10-28T09:00:00Z', '2026-10-28T11:00:00Z')
  ], [window('2026-10-28T09:30:30Z', '2026-10-28T10:00:01Z')], from);
  assert.deepEqual(result.blocks, [
    block('a-part-1', 'a', '2026-10-28T09:00:00.000Z', '2026-10-28T09:30:00.000Z'),
    block('a-part-2', 'a', '2026-10-28T10:01:00.000Z', '2026-10-28T11:00:00.000Z')
  ]);
  assert.deepEqual(result.unscheduledTaskIds, ['a']);
});

test('subtracts disjoint conflicts and treats touching boundaries as non-overlapping', () => {
  const result = scheduleLearningTasks(plan([task('a', { remainingMinutes: 120 })]), [
    window('2026-10-28T09:00:00Z', '2026-10-28T12:00:00Z')
  ], [
    window('2026-10-28T08:00:00Z', '2026-10-28T09:00:00Z'),
    window('2026-10-28T09:30:00Z', '2026-10-28T10:00:00Z'),
    window('2026-10-28T11:00:00Z', '2026-10-28T11:30:00Z'),
    window('2026-10-28T12:00:00Z', '2026-10-28T13:00:00Z')
  ], from);
  assert.deepEqual(result, {
    blocks: [
      block('a-part-1', 'a', '2026-10-28T09:00:00.000Z', '2026-10-28T09:30:00.000Z'),
      block('a-part-2', 'a', '2026-10-28T10:00:00.000Z', '2026-10-28T11:00:00.000Z'),
      block('a-part-3', 'a', '2026-10-28T11:30:00.000Z', '2026-10-28T12:00:00.000Z')
    ], unscheduledTaskIds: [], deferredTaskIds: []
  });
});

test('rounds from upward and only emits complete future minutes', () => {
  const result = scheduleLearningTasks(plan([task('a', { remainingMinutes: 60 })]), [
    window('2026-10-28T00:00:00Z', '2026-10-28T01:00:00Z')
  ], [], '2026-10-28T00:00:01Z');
  assert.deepEqual(result.blocks, [block('a-part-1', 'a',
    '2026-10-28T00:01:00.000Z', '2026-10-28T01:00:00.000Z')]);
  assert.deepEqual(result.unscheduledTaskIds, ['a']);
});

test('topologically schedules a dependency before its earlier-listed successor', () => {
  const result = scheduleLearningTasks(plan([
    task('b', { dependsOn: ['a'] }), task('a')
  ]), [window('2026-10-28T09:00:00Z', '2026-10-28T12:00:00Z')], [], from);
  assert.deepEqual(result.blocks, [
    block('a-part-1', 'a', '2026-10-28T09:00:00.000Z', '2026-10-28T10:00:00.000Z'),
    block('b-part-1', 'b', '2026-10-28T10:00:00.000Z', '2026-10-28T11:00:00.000Z')
  ]);
});

test('does not schedule a successor before every dependency finishes across days', () => {
  const result = scheduleLearningTasks(plan([
    task('c', { remainingMinutes: 30, dependsOn: ['a', 'b'] }),
    task('a', { remainingMinutes: 90 }), task('b', { remainingMinutes: 30 })
  ]), [
    window('2026-10-28T09:00:00Z', '2026-10-28T10:00:00Z'),
    window('2026-10-29T09:00:00Z', '2026-10-29T11:00:00Z')
  ], [], from);
  assert.deepEqual(result.blocks, [
    block('a-part-1', 'a', '2026-10-28T09:00:00.000Z', '2026-10-28T10:00:00.000Z'),
    block('a-part-2', 'a', '2026-10-29T09:00:00.000Z', '2026-10-29T09:30:00.000Z'),
    block('b-part-1', 'b', '2026-10-29T09:30:00.000Z', '2026-10-29T10:00:00.000Z'),
    block('c-part-1', 'c', '2026-10-29T10:00:00.000Z', '2026-10-29T10:30:00.000Z')
  ]);
});

test('caps blocks at task deadlines and retains partially allocated work', () => {
  const result = scheduleLearningTasks(plan([
    task('a', { remainingMinutes: 90, dueAt: '2026-10-28T10:00:30Z' }),
    task('b', { dependsOn: ['a'] }),
    task('c', { dueAt: '2026-10-27T12:00:00Z' })
  ]), [window('2026-10-28T09:00:00Z', '2026-10-28T13:00:00Z')], [], from);
  assert.deepEqual(result, {
    blocks: [block('a-part-1', 'a', '2026-10-28T09:00:00.000Z', '2026-10-28T10:00:00.000Z')],
    unscheduledTaskIds: ['a', 'b', 'c'], deferredTaskIds: []
  });
});

test('allows a block to end exactly at the deadline', () => {
  const result = scheduleLearningTasks(plan([
    task('a', { dueAt: '2026-10-28T10:00:00Z' })
  ]), [window('2026-10-28T09:00:00Z', '2026-10-28T11:00:00Z')], [], from);
  assert.equal(result.blocks[0].endAt, '2026-10-28T10:00:00.000Z');
  assert.deepEqual(result.unscheduledTaskIds, []);
});

test('excludes completed work while allowing tasks that depend on it', () => {
  const result = scheduleLearningTasks(plan([
    task('done', { status: 'done', remainingMinutes: 0 }),
    task('a', { dependsOn: ['done'] })
  ]), [window('2026-10-28T09:00:00Z', '2026-10-28T10:00:00Z')], [], from);
  assert.deepEqual(result, {
    blocks: [block('a-part-1', 'a', '2026-10-28T09:00:00.000Z', '2026-10-28T10:00:00.000Z')],
    unscheduledTaskIds: [], deferredTaskIds: []
  });
});

test('defers later phases instead of consuming time before their release week', () => {
  const result = scheduleLearningTasks(plan([
    task('week-2', { week: 2 }), task('week-3', { week: 3, dependsOn: ['week-2'] })
  ]), [window('2026-10-28T09:00:00Z', '2026-10-28T12:00:00Z')], [], from);
  assert.deepEqual(result, { blocks: [], unscheduledTaskIds: [], deferredTaskIds: ['week-2', 'week-3'] });
});

test('defers a current-phase task whose prerequisite starts outside the seven-day window', () => {
  const result = scheduleLearningTasks(plan([
    task('current', { dependsOn: ['future'] }), task('future', { week: 2 })
  ]), [window('2026-10-28T09:00:00Z', '2026-10-28T12:00:00Z')], [], from);
  assert.deepEqual(result, {
    blocks: [], unscheduledTaskIds: [], deferredTaskIds: ['future', 'current']
  });
});

test('never starts work before a plan start containing seconds', () => {
  const result = scheduleLearningTasks(plan([task('a')], {
    startAt: '2026-10-28T09:00:30Z'
  }), [window('2026-10-28T08:00:00Z', '2026-10-28T11:00:00Z')], [], from);
  assert.deepEqual(result.blocks, [block('a-part-1', 'a',
    '2026-10-28T09:01:00.000Z', '2026-10-28T10:01:00.000Z')]);
});

test('honors phase release relative to plan start inside a rolling seven-day interval', () => {
  const result = scheduleLearningTasks(plan([task('a', { week: 2 })]), [
    window('2026-11-03T09:00:00Z', '2026-11-03T11:00:00Z'),
    window('2026-11-04T09:00:00Z', '2026-11-04T11:00:00Z')
  ], [], '2026-11-03T00:00:00Z');
  assert.deepEqual(result.blocks, [block('a-part-1', 'a',
    '2026-11-04T09:00:00.000Z', '2026-11-04T10:00:00.000Z')]);
  assert.deepEqual(result.unscheduledTaskIds, []);
});

test('keeps earlier free time available to independent tasks with earlier releases', () => {
  const result = scheduleLearningTasks(plan([
    task('later', { week: 2 }), task('now')
  ]), [
    window('2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z'),
    window('2026-11-04T09:00:00Z', '2026-11-04T10:00:00Z')
  ], [], '2026-11-03T00:00:00Z');
  assert.deepEqual(result.blocks, [
    block('later-part-1', 'later', '2026-11-04T09:00:00.000Z', '2026-11-04T10:00:00.000Z'),
    block('now-part-1', 'now', '2026-11-03T09:00:00.000Z', '2026-11-03T10:00:00.000Z')
  ]);
});

test('merges overlapping availability so the same capacity cannot be consumed twice', () => {
  const result = scheduleLearningTasks(plan([
    task('a', { remainingMinutes: 150 }), task('b')
  ]), [
    window('2026-10-28T09:30:00Z', '2026-10-28T10:00:00Z'),
    window('2026-10-28T09:00:00Z', '2026-10-28T11:00:00Z'),
    window('2026-10-28T10:00:00Z', '2026-10-28T12:00:00Z')
  ], [], from);
  assert.deepEqual(result, {
    blocks: [
      block('a-part-1', 'a', '2026-10-28T09:00:00.000Z', '2026-10-28T11:30:00.000Z'),
      block('b-part-1', 'b', '2026-10-28T11:30:00.000Z', '2026-10-28T12:00:00.000Z')
    ], unscheduledTaskIds: ['b'], deferredTaskIds: []
  });
});

test('uses remaining minutes and produces stable IDs without mutating inputs', () => {
  const input = plan([task('a', { estimatedMinutes: 180, remainingMinutes: 90 })]);
  const available = [
    window('2026-10-29T09:00:00Z', '2026-10-29T10:00:00Z'),
    window('2026-10-28T09:00:00Z', '2026-10-28T10:00:00Z')
  ];
  const busy = [window('2026-10-28T09:30:00Z', '2026-10-28T10:00:00Z')];
  const before = structuredClone({ input, available, busy });
  const first = scheduleLearningTasks(input, available, busy, from);
  assert.deepEqual(first.blocks, [
    block('a-part-1', 'a', '2026-10-28T09:00:00.000Z', '2026-10-28T09:30:00.000Z'),
    block('a-part-2', 'a', '2026-10-29T09:00:00.000Z', '2026-10-29T10:00:00.000Z')
  ]);
  assert.deepEqual(scheduleLearningTasks(input, available, busy, from), first);
  assert.deepEqual({ input, available, busy }, before);
});

test('reports missing capacity without dropping independent task diagnostics', () => {
  const result = scheduleLearningTasks(plan([
    task('a'), task('b', { dependsOn: ['a'] }), task('later', { week: 2 })
  ]), [], [], from);
  assert.deepEqual(result, {
    blocks: [], unscheduledTaskIds: ['a', 'b'], deferredTaskIds: ['later']
  });
});

test('rejects duplicate IDs, unknown dependencies, self-dependencies and cycles', () => {
  for (const tasks of [
    [task('a'), task('a')],
    [task('a', { dependsOn: ['unknown'] })],
    [task('a', { dependsOn: ['a'] })],
    [task('a', { dependsOn: ['b'] }), task('b', { dependsOn: ['a'] })],
    [task('done', { status: 'done', remainingMinutes: 0, dependsOn: ['unknown'] })]
  ]) assert.throws(() => scheduleLearningTasks(plan(tasks), [], [], from), /INVALID_DEPENDENCY/);
});

test('validates every user window before clipping or scheduling', () => {
  for (const invalid of [
    window('2026-10-28T10:00:00Z', '2026-10-28T09:00:00Z'),
    window('2026-10-28T09:00:00Z', '2026-10-28T09:00:00Z'),
    window('2026-10-28T09:00:01Z', '2026-10-28T10:00:00Z'),
    window('2026-10-28T09:00:00Z', '2026-10-28T10:00:00.001Z')
  ]) assert.throws(() => scheduleLearningTasks(plan([]), [invalid], [], from), /INVALID_TIME_WINDOW/);
  assert.throws(() => scheduleLearningTasks(plan([]), [
    window('2026-02-30T09:00:00Z', '2026-03-01T10:00:00Z')
  ], [], from), /INVALID_TIMESTAMP/);
  assert.throws(() => scheduleLearningTasks(plan([]), [], [
    window('2026-10-28T09:00:00Z', '2026-10-28T08:00:00Z')
  ], from), /INVALID_TIME_WINDOW/);
});

test('validates plan start, from, deadlines, week and pending remaining duration', () => {
  assert.throws(() => scheduleLearningTasks(plan([]), [], [], '2026-10-28T00:00:00'), /INVALID_TIMESTAMP/);
  assert.throws(() => scheduleLearningTasks(plan([], { startAt: '2026-02-30T00:00:00Z' }), [], [], from), /INVALID_TIMESTAMP/);
  assert.throws(() => scheduleLearningTasks(plan([task('a', { dueAt: '2026-02-30T00:00:00Z' })]), [], [], from), /INVALID_TIMESTAMP/);
  for (const remainingMinutes of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => scheduleLearningTasks(plan([task('a', { remainingMinutes })]), [], [], from), /INVALID_TASK/);
  }
  for (const week of [0, -1, 1.5]) {
    assert.throws(() => scheduleLearningTasks(plan([task('a', { week })]), [], [], from), /INVALID_TASK/);
  }
});
