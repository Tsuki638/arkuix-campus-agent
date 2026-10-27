import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sourceRoot = path.join(workspace, 'app', 'entry', 'src', 'main', 'ets');
const outputRoot = path.join(workspace, '.generated', 'core');

async function sourceFiles(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) result.push(...await sourceFiles(full));
    else if (item.name.endsWith('.ts')) result.push(full);
  }
  return result;
}

export async function compileCore() {
  const files = await sourceFiles(sourceRoot);
  const outputs = [];
  for (const file of files) {
    // 转换的是应用实际使用的同一份纯 TS 源码；不创建第二套 Agent 实现。
    // 此步骤只剥除类型，不代替 DevEco/ArkTS 静态检查和设备构建。
    const source = await readFile(file, 'utf8');
    const javascript = stripTypeScriptTypes(source, { mode: 'strip' }).replace(
      /(from\s+)(['"])(\.[^'"]+)\2/g,
      (_match, prefix, quote, specifier) => `${prefix}${quote}${specifier.replace(/\.ts$/, '')}.mjs${quote}`
    );
    const output = path.join(outputRoot, path.relative(sourceRoot, file).replace(/\.ts$/, '.mjs'));
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, javascript, 'utf8');
    outputs.push(output);
  }
  return {
    files: outputs,
    load: (relative) => import(pathToFileURL(path.join(outputRoot, relative.replace(/\.ts$/, '.mjs'))).href)
  };
}
