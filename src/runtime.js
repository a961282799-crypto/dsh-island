import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export function runtimePath(env = process.env) {
  const root = env.DSH_HOME || join(homedir(), '.dsh');
  const binary = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
  const paths = [env.DSH_ISLAND_ELECTRON, join(root,'dsh-orb','electron-runtime',binary)];
  for (const p of paths) if (p && existsSync(p)) return p;
  throw new Error('找不到桌面运行环境。请设置 DSH_ISLAND_ELECTRON 为 Electron 程序路径，或先启用已安装的悬浮球下载运行环境。');
}
