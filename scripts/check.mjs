import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compileCore, workspace } from './compile-core.mjs';

const core = await compileCore();
for (const file of core.files) await import(pathToFileURL(file).href);
console.log(`共享逻辑 ${core.files.length} 个模块的转换与导入检查通过。`);
const result = spawnSync(process.execPath,
  ['--disable-warning=ExperimentalWarning', '--test', 'tests/framework.test.mjs'],
  { cwd: workspace, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
