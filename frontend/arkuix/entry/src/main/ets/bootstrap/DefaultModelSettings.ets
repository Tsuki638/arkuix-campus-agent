import common from '@ohos.app.ability.common';
import util from '@ohos.util';
import { ModelSettings } from '../contracts/Models';
import { DeepSeekConfig } from '../services/model/DeepSeekConfig';

// 本机配置由 prepare-model-config.mjs 生成，不进入源码仓库或聊天历史。
export function readDefaultModelSettings(context: common.Context): ModelSettings {
  try {
    const bytes: Uint8Array = context.resourceManager.getRawFileContentSync('local.model.json');
    const value: ModelSettings = JSON.parse(util.TextDecoder.create('utf-8').decodeToString(bytes)) as ModelSettings;
    if (value.endpoint === DeepSeekConfig.endpoint && typeof value.model === 'string' && value.model.trim().length > 0 &&
      typeof value.apiKey === 'string') { return value; }
  } catch { /* 未提供本机密钥时仍可查看历史和进入模型设置。 */ }
  return { endpoint: DeepSeekConfig.endpoint, model: DeepSeekConfig.model, apiKey: '' };
}
