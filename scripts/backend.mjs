import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const goals = { run: ['spring-boot:run'], test: ['verify'], package: ['package'] };
const action = process.argv[2];
if (!Object.hasOwn(goals, action)) {
  console.error('用法：node scripts/backend.mjs run|test|package');
  process.exit(2);
}

const env = { ...process.env };
if (env.JAVA_HOME && !existsSync(path.join(env.JAVA_HOME, 'bin',
  process.platform === 'win32' ? 'javac.exe' : 'javac'))) {
  console.error('JAVA_HOME 必须指向 JDK 21 或以上版本的根目录。');
  process.exit(2);
}

const backend = path.join(root, 'backend');
const args = ['-B', '-ntp', ...goals[action]];
// Windows .cmd 需要命令解释器；这里只执行仓库内固定的 Wrapper 和白名单目标。
const command = process.platform === 'win32' ? (env.ComSpec || 'cmd.exe') : 'sh';
const commandArgs = process.platform === 'win32' ?
  ['/d', '/s', '/c', `mvnw.cmd ${args.join(' ')}`] : ['./mvnw', ...args];
const child = spawn(command, commandArgs, { cwd: backend, env, stdio: 'inherit' });
child.on('error', () => {
  console.error('无法启动 Maven Wrapper，请检查 backend/mvnw 与 JDK 环境。');
  process.exitCode = 1;
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
