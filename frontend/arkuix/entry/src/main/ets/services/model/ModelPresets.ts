import type { ModelSettings } from '../../contracts/Models';
import { DeepSeekConfig } from './DeepSeekConfig';

export interface ModelOption { id: string; label: string; }
export interface ModelProvider { id: string; label: string; endpoint: string; models: ModelOption[]; }

// 2026-11-17 核对官方文档；只提供当前 Chat Completions 工具协议可用的型号。
export class ModelPresets {
  static readonly providers: ModelProvider[] = [
    { id: 'deepseek', label: 'DeepSeek（默认）', endpoint: DeepSeekConfig.endpoint,
      models: [{ id: DeepSeekConfig.model, label: 'DeepSeek Flash' }, { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }] },
    { id: 'qwen', label: '通义千问', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      models: [{ id: 'qwen3.8-flash', label: 'Qwen 3.8 Flash' }, { id: 'qwen3.8-max', label: 'Qwen 3.8 Max' }] },
    { id: 'kimi', label: 'Kimi', endpoint: 'https://api.moonshot.cn/v1/chat/completions',
      models: [{ id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro' },
        { id: 'kimi-k3.1-pro-highspeed', label: 'Kimi K3.1 Pro 高速版' }] },
    { id: 'glm', label: '智谱 GLM', endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      models: [{ id: 'glm-5.3', label: 'GLM 5.3' }] },
    { id: 'openai', label: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions',
      models: [{ id: 'gpt-6-luna', label: 'GPT 6 Luna' }] },
    { id: 'custom', label: '自定义接口', endpoint: '', models: [] }
  ];

  static providerIndex(endpoint: string, model: string): number {
    const index: number = ModelPresets.providers.findIndex((provider: ModelProvider) =>
      provider.endpoint === endpoint && provider.models.some((option: ModelOption) => option.id === model));
    return index < 0 ? ModelPresets.providers.length - 1 : index;
  }
}

export function officialProvider(endpoint: string): string {
  if (/^https:\/\/api\.deepseek\.com(?:\/|$)/i.test(endpoint)) { return 'deepseek'; }
  if (/^https:\/\/(?:dashscope(?:-intl)?\.aliyuncs\.com|[a-z0-9-]+\.[a-z0-9-]+\.maas\.aliyuncs\.com)(?:\/|$)/i.test(endpoint)) { return 'qwen'; }
  if (/^https:\/\/api\.moonshot\.cn(?:\/|$)/i.test(endpoint)) { return 'kimi'; }
  if (/^https:\/\/open\.bigmodel\.cn(?:\/|$)/i.test(endpoint)) { return 'glm'; }
  if (/^https:\/\/api\.openai\.com(?:\/|$)/i.test(endpoint)) { return 'openai'; }
  return 'custom';
}

// 默认密钥只能发往它原本绑定的接口；切换服务商时必须提供该服务商的密钥。
export function resolveModelSettings(input: ModelSettings, defaults: ModelSettings): ModelSettings {
  const endpoint: string = input.endpoint.trim();
  return { endpoint: endpoint, model: input.model.trim(),
    apiKey: input.apiKey.trim() || (endpoint === defaults.endpoint ? defaults.apiKey : '') };
}
