// DeepSeek 官方 API 价格（人民币 / 百万 tokens），用于估算费用。
// 来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing （2026-10-27 查询）。价格可能调整，估算仅供参考。
// 高峰时段：北京时间周一至周五 9:00–12:00、14:00–18:00；其余为空闲时段（法定节假日无法自动识别，按工作日计）。
export const PRICES_AS_OF = '2026-10-27';
export const PRICE_SOURCE = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing';

const TABLE = {
  'deepseek-flash': { offPeak: { hit: 0.02, miss: 1, out: 4 }, peak: { hit: 0.04, miss: 2, out: 8 } },
  'deepseek-v4-pro': { offPeak: { hit: 0.15, miss: 4.5, out: 13.5 }, peak: { hit: 0.30, miss: 9, out: 27 } }
};
// 已下线、但仍按 Flash 计费的旧模型名。
const ALIASES = { 'deepseek-v4-flash': 'deepseek-flash', 'deepseek-v4-flash-vision-exp': 'deepseek-flash' };

/** The priced model id for a model name, or null when no official price is known. */
export function pricedModel(model) {
  if (typeof model !== 'string') return null;
  const id = model.trim().toLowerCase();
  if (TABLE[id]) return id;
  if (ALIASES[id]) return ALIASES[id];
  return null;
}

/** Whether a moment falls in DeepSeek's peak period (Beijing time, weekdays 9–12 and 14–18). */
export function isPeak(time) {
  const beijing = new Date(time + 8 * 3600e3);
  const day = beijing.getUTCDay(), minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
  if (day === 0 || day === 6) return false;
  return (minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080);
}

/**
 * Estimated cost in CNY of one model call.
 * Harness usage: inputTokens are uncached prompt tokens, cacheReadTokens hit the cache,
 * cacheWriteTokens are billed as cache misses, outputTokens include reasoning.
 * @returns the cost, or null when the model has no official price.
 */
export function estimateCost({ model, time, inputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0, outputTokens = 0 }) {
  const id = pricedModel(model);
  if (!id) return null;
  const p = TABLE[id][isPeak(time) ? 'peak' : 'offPeak'];
  return ((inputTokens + cacheWriteTokens) * p.miss + cacheReadTokens * p.hit + outputTokens * p.out) / 1e6;
}
