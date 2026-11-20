import fs from '@ohos.file.fs';
import { KeyValueStore } from '../../contracts/Ports';

// ArkUI-X 的文件 API 适配：数据只存应用沙箱，供鸿蒙和 Android 复用。
// 需成员 D 在选定 SDK 上验证 API/插件配置。轻量 JSON 方案后续可替换为数据库。
export class FileKeyValueStore implements KeyValueStore {
  private directory: string;

  constructor(filesDir: string) { this.directory = filesDir; }

  async get(key: string): Promise<string> {
    const path: string = this.path(key);
    if (!fs.accessSync(path)) { return ''; }
    return fs.readTextSync(path);
  }

  async set(key: string, value: string): Promise<void> {
    const path: string = this.path(key);
    const temporary: string = path + '.tmp';
    const file: fs.File = fs.openSync(temporary, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
    try {
      fs.writeSync(file.fd, value);
      fs.fsyncSync(file.fd);
    } finally {
      fs.closeSync(file);
    }
    fs.renameSync(temporary, path);
  }

  private path(key: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) { throw new Error('STORAGE_KEY: 非法存储键。'); }
    return this.directory + '/campus_agent_' + key + '.json';
  }
}
