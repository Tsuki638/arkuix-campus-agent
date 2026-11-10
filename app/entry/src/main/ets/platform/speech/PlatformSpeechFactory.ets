import common from '@ohos.app.ability.common';
import deviceInfo from '@ohos.deviceInfo';
import { SpeechService } from '../../contracts/Ports';
import { ManagedSpeechService } from './ManagedSpeechService';
import { UnavailableSpeechService } from './UnavailableSpeechService';

export async function createPlatformSpeech(context: common.Context): Promise<SpeechService> {
  const os: string = deviceInfo.osFullName;
  if (os.startsWith('Android') || os.startsWith('iOS') || os.startsWith('iPadOS') ||
    os.startsWith('macOS')) { return new UnavailableSpeechService(); }
  if (!canIUse('SystemCapability.AI.SpeechRecognizer') && !canIUse('SystemCapability.AI.TextToSpeech')) {
    return new UnavailableSpeechService();
  }
  // 鸿蒙专有 Kit 在平台检查之后才加载。工程需按官方指引设置 ignoreCrossPlatform。
  try {
    const module = await import('./HarmonySpeechDriver');
    return new ManagedSpeechService(new module.HarmonySpeechDriver(context));
  } catch {
    return new UnavailableSpeechService('系统语音模块加载失败，请使用文本或在支持语音的鸿蒙设备上测试。');
  }
}
