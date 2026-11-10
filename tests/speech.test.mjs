import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { compileCore } from '../scripts/compile-core.mjs';

const core = await compileCore();
const { ManagedSpeechService, SpeechTimeouts } = await core.load('platform/speech/ManagedSpeechService.ts');

class FakeDriver {
  recognition = true;
  synthesis = true;
  permission = async () => true;
  recognitions = [];
  utterances = [];
  stops = 0;
  supportsRecognition() { return this.recognition; }
  supportsSynthesis() { return this.synthesis; }
  requestMicrophonePermission() { return this.permission(); }
  async startRecognition(id, callbacks) { this.recognitions.push({ id, callbacks }); }
  async startSpeaking(id, text, callbacks) { this.utterances.push({ id, text, callbacks }); }
  stop() { this.stops++; }
}

test('recognition commits final sentences and ignores interim hypotheses', async () => {
  const driver = new FakeDriver();
  const speech = new ManagedSpeechService(driver);
  const result = speech.recognizeOnce();
  await setImmediate();
  const callbacks = driver.recognitions[0].callbacks;
  callbacks.result('不完整', false, false);
  callbacks.result('每天学习一小时。', true, false);
  callbacks.result('准备考研。', true, true);
  callbacks.complete();
  assert.equal(await result, '每天学习一小时。准备考研。');
  assert.equal(driver.stops, 1);
});

test('permission denial ends operation without starting the microphone', async () => {
  const driver = new FakeDriver();
  driver.permission = async () => false;
  const speech = new ManagedSpeechService(driver);
  await assert.rejects(speech.recognizeOnce(), /SPEECH_PERMISSION_DENIED/);
  assert.equal(driver.recognitions.length, 0);
});

test('stop during permission prompt prevents late permission from starting ASR', async () => {
  const driver = new FakeDriver();
  let grant;
  driver.permission = () => new Promise(resolve => { grant = resolve; });
  const speech = new ManagedSpeechService(driver);
  const rejected = assert.rejects(speech.recognizeOnce(), /SPEECH_CANCELLED/);
  await speech.stop();
  grant(true);
  await rejected;
  await setImmediate();
  assert.equal(driver.recognitions.length, 0);
});

test('late callbacks after stop cannot finish a subsequent recognition', async () => {
  const driver = new FakeDriver();
  const speech = new ManagedSpeechService(driver);
  const cancelled = assert.rejects(speech.recognizeOnce(), /SPEECH_CANCELLED/);
  await setImmediate();
  const old = driver.recognitions[0].callbacks;
  await speech.stop();
  await cancelled;
  const current = speech.recognizeOnce();
  await setImmediate();
  old.result('旧会话', true, true);
  old.error(new Error('stale error'));
  driver.recognitions[1].callbacks.result('新会话', true, true);
  assert.equal(await current, '新会话');
});

test('concurrent requests reject without disrupting the active request', async () => {
  const driver = new FakeDriver();
  const speech = new ManagedSpeechService(driver);
  const current = speech.recognizeOnce();
  await assert.rejects(speech.speak('你好'), /SPEECH_BUSY/);
  await setImmediate();
  driver.recognitions[0].callbacks.result('有效结果', true, true);
  assert.equal(await current, '有效结果');
});

test('recognition timeout includes permission and engine initialization', async () => {
  const driver = new FakeDriver();
  driver.permission = () => new Promise(() => {});
  const timeouts = new SpeechTimeouts();
  timeouts.recognitionMs = 15;
  const speech = new ManagedSpeechService(driver, timeouts);
  await assert.rejects(speech.recognizeOnce(), /SPEECH_TIMEOUT/);
  assert.equal(driver.stops, 1);
});

test('empty completion does not submit an interim transcript', async () => {
  const driver = new FakeDriver();
  const speech = new ManagedSpeechService(driver);
  const rejected = assert.rejects(speech.recognizeOnce(), /SPEECH_NO_RESULT/);
  await setImmediate();
  driver.recognitions[0].callbacks.result('还没确认', false, false);
  driver.recognitions[0].callbacks.complete();
  await rejected;
});

test('ASR failure releases resources and allows another attempt', async () => {
  const driver = new FakeDriver();
  const speech = new ManagedSpeechService(driver);
  const rejected = assert.rejects(speech.recognizeOnce(), /system failure/);
  await setImmediate();
  driver.recognitions[0].callbacks.error(new Error('system failure'));
  await rejected;
  const retry = speech.recognizeOnce();
  await setImmediate();
  driver.recognitions[1].callbacks.result('重试成功', true, true);
  assert.equal(await retry, '重试成功');
});

test('speak waits for playback completion and stop cancels pending playback', async () => {
  const driver = new FakeDriver();
  const speech = new ManagedSpeechService(driver);
  const current = speech.speak('你好');
  driver.utterances[0].callbacks.complete();
  await current;
  const cancelled = assert.rejects(speech.speak('第二段'), /SPEECH_CANCELLED/);
  await speech.stop();
  await cancelled;
  assert.equal(driver.stops, 2);
});

test('TTS failure and timeout end promises', async () => {
  const driver = new FakeDriver();
  const timeouts = new SpeechTimeouts();
  timeouts.synthesisMs = 15;
  const speech = new ManagedSpeechService(driver, timeouts);
  const failed = assert.rejects(speech.speak('你好'), /synthesis failed/);
  driver.utterances[0].callbacks.error(new Error('synthesis failed'));
  await failed;
  await assert.rejects(speech.speak('没有回调'), /SPEECH_TIMEOUT/);
});

test('capability checks keep TTS independently usable without ASR', async () => {
  const driver = new FakeDriver();
  driver.recognition = false;
  const speech = new ManagedSpeechService(driver);
  assert.equal(speech.isAvailable(), false);
  await assert.rejects(speech.recognizeOnce(), /SPEECH_UNAVAILABLE/);
  const playback = speech.speak('仍可单独测试播报');
  driver.utterances[0].callbacks.complete();
  await playback;
});

test('engine initialization errors do not leave speech busy', async () => {
  const driver = new FakeDriver();
  driver.startRecognition = async () => { throw new Error('engine unavailable'); };
  const speech = new ManagedSpeechService(driver);
  await assert.rejects(speech.recognizeOnce(), /engine unavailable/);
  await assert.rejects(speech.recognizeOnce(), /engine unavailable/);
  assert.equal(driver.stops, 2);
});
