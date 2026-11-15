import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// 灵动岛在独立的 Electron 窗口里渲染。Harness 自带的 Electron 不能复用（打包应用有自己的 app.asar
// 和单实例锁），所以这里按顺序找一台可用的运行环境，并在找不到时说清楚要做什么。

export function runtimeBinary(platform = process.platform) {
  return platform === 'win32' ? 'electron.exe' : platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
}

export function dshHome(env = process.env) {
  return env.DSH_HOME || join(homedir(), '.dsh');
}

function isFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

/**
 * dsh-orb 下载完成时会在运行环境目录写一个 `.complete-<version>` 标记。
 * 只有看到它才认为这个目录是完整的；没有标记但已经有可执行的 electron 时仍然使用，
 * 只把 `verified` 记为 false（旧版本 dsh-orb、或用户自己放进来的运行时）。
 */
export function orbRuntimeReady(dir) {
  try {
    return readdirSync(dir).some(name => name.startsWith('.complete-'));
  } catch { return false; }
}

/** 依次尝试的运行环境；顺序就是优先级。 */
export function runtimeCandidates(env = process.env, platform = process.platform) {
  const orbDir = join(dshHome(env), 'dsh-orb', 'electron-runtime');
  const list = [];
  if (env.DSH_ISLAND_ELECTRON) {
    list.push({ path: env.DSH_ISLAND_ELECTRON, source: 'DSH_ISLAND_ELECTRON', label: '环境变量 DSH_ISLAND_ELECTRON' });
  }
  list.push({ path: join(orbDir, runtimeBinary(platform)), source: 'dsh-orb', label: '悬浮球插件 dsh-orb 的运行环境', runtimeDir: orbDir });
  return list;
}

/** 给人看的修复说明：两条能照着做的路，加上已经找过哪里。 */
export function runtimeHelp(tried = []) {
  const lines = [
    '灵动岛需要一个 Electron 运行环境，但本机没有找到。',
    '解决办法（任选其一，然后重新打开 Harness）：',
    '  1. 安装悬浮球插件 dsh-orb：它会自动下载 Electron，灵动岛会复用它；',
    '  2. 下载任意 Electron，把用户环境变量 DSH_ISLAND_ELECTRON 设为 electron.exe 的完整路径。',
  ];
  if (tried.length) lines.push(`已经找过：${tried.join('、')}`);
  return lines.join('\n');
}

/**
 * 找到可用的运行环境。
 * @returns {{path: string, source: string, label: string, verified: boolean, tried: string[]} | {error: string, tried: string[]}}
 */
export function resolveRuntime(env = process.env, platform = process.platform) {
  const tried = [];
  for (const candidate of runtimeCandidates(env, platform)) {
    tried.push(candidate.path);
    if (!candidate.path || !isFile(candidate.path)) continue;
    const verified = candidate.source !== 'dsh-orb' || orbRuntimeReady(candidate.runtimeDir);
    return { path: candidate.path, source: candidate.source, label: candidate.label, verified, tried };
  }
  return { tried, error: runtimeHelp(tried) };
}

/** 兼容旧调用方：找不到时抛出带修复说明的错误。 */
export function runtimePath(env = process.env, platform = process.platform) {
  const found = resolveRuntime(env, platform);
  if (!found.path) throw new Error(found.error);
  return found.path;
}
