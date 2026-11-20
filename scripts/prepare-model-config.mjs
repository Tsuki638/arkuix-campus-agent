import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let local = {};
try { local = parseEnv(await readFile(path.join(root, '.env.local'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const baseUrl = (process.env.ARKUI_BACKEND_URL ?? local.ARKUI_BACKEND_URL ?? '').trim().replace(/\/+$/, '');
if (baseUrl && !/^https?:\/\/[^/?#\s@]+(?:\/[^?#\s]*)?$/.test(baseUrl)) {
  throw new Error('ARKUI_BACKEND_URL 必须为有效的 HTTP 或 HTTPS 后端根地址。');
}
if (baseUrl && !/^https:\/\//.test(baseUrl) && !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(baseUrl)) {
  throw new Error('账号模式需要 HTTPS 后端根地址，本机回环 HTTP 地址可用于调试。');
}
const settings = {
  endpoint: 'https://api.deepseek.com/chat/completions',
  model: (process.env.DEEPSEEK_MODEL || local.DEEPSEEK_MODEL || 'deepseek-flash').trim(),
  apiKey: baseUrl ? '' : (process.env.DEEPSEEK_API_KEY || local.DEEPSEEK_API_KEY || '').trim()
};
const directory = path.join(root, 'frontend/arkuix/entry/src/main/resources/rawfile');
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, 'local.model.json'), JSON.stringify(settings), 'utf8');
await writeFile(path.join(directory, 'local.backend.json'), JSON.stringify({ baseUrl }), 'utf8');
console.log(baseUrl ? '已准备 Java 后端模式，模型凭据由服务端配置。' :
  settings.apiKey ? '已准备端内模式的默认 DeepSeek 配置（文件由 Git 忽略）。' :
  '未配置默认密钥，应用将引导用户连接模型。');
