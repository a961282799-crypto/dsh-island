import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// 灵动岛在 Harness「设置 › 灵动岛」中的选项。字段都是 volatile：修改后即时生效，不重启插件。
export const POSITIONS = ['top-center', 'top-left', 'top-right', 'left-center', 'right-center', 'bottom-center'];
export const SIZES = { small: 0.85, medium: 1, large: 1.15 };
export const DEFAULT_PREFS = { enabled: true, position: 'top-center', size: 'medium', reduceMotion: false, popups: true, details: true, balance: true, questions: true };

async function loadSchemastery() {
  try { const m = await import('@deepseek-ai/schemastery'); return m.default ?? m; } catch {}
  // 从源码目录运行（测试、预览）时借用 Harness 安装里的同一份库。
  const roots = [process.env.DSH_HOST_PACKAGE, process.argv[1], join(dirname(process.execPath), 'resources/app.asar/dsh/package.json'), 'D:/deepseek harness/resources/app.asar/dsh/package.json'];
  for (const root of roots) {
    if (!root) continue;
    try { const m = createRequire(root)('@deepseek-ai/schemastery'); return m.default ?? m; } catch {}
  }
  return null;
}

const z = await loadSchemastery();
const choice = (values, fallback) => z.union(values.map(value => z.const(value))).default(fallback);

export const Config = z ? z.object({
  enabled: z.boolean().default(true).description('显示灵动岛').volatile(),
  position: choice(POSITIONS, 'top-center').description('停靠位置').volatile(),
  size: choice(Object.keys(SIZES), 'medium').description('大小').volatile(),
  reduceMotion: z.boolean().default(false).description('减少动态效果').volatile(),
  popups: z.boolean().default(true).description('开始、完成、需要确认时弹出提醒').volatile(),
  details: z.boolean().default(true).description('在灵动岛中显示任务标题、计划与工具').volatile(),
  balance: z.boolean().default(true).description('空闲时显示 DeepSeek 账户余额').volatile(),
  questions: z.boolean().default(true).description('在灵动岛中回答 Agent 的提问').volatile(),
  allowStandalone: z.boolean().default(false).hidden(),
  dataDir: z.string().hidden()
}) : undefined;

const read = value => typeof value?.get === 'function' ? value.get() : value;

/** Current preferences from a parsed Config (volatile references) or a plain object. */
export function readPrefs(config = {}) {
  const prefs = {};
  for (const key of Object.keys(DEFAULT_PREFS)) {
    const value = read(config[key]);
    prefs[key] = value === undefined ? DEFAULT_PREFS[key] : value;
  }
  if (!POSITIONS.includes(prefs.position)) prefs.position = DEFAULT_PREFS.position;
  if (!Object.hasOwn(SIZES, prefs.size)) prefs.size = DEFAULT_PREFS.size;
  for (const key of ['enabled', 'reduceMotion', 'popups', 'details', 'balance', 'questions']) prefs[key] = prefs[key] !== false && prefs[key] !== 'false' ? Boolean(prefs[key]) : false;
  return prefs;
}
