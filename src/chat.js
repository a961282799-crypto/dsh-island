// 在灵动岛里继续对话：通过 Harness 自己的会话控制器（sessionController.prompt，与 Harness 输入框是同一个入口）
// 把消息发给当前显示的、或最近一个顶层任务。空闲时开始新一轮；任务进行中可以排队（本轮结束后发送）或插话（插入本轮）。
import { randomUUID } from 'node:crypto';

export const MAX_MESSAGE = 8000;
const MODES = new Set(['queue', 'steer']);
const clean = text => typeof text === 'string' ? text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim() : '';
const timeZone = () => { try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; return /^(UTC|[A-Za-z_]+(\/[A-Za-z0-9_+\-]+)+)$/.test(z ?? '') ? z : undefined; } catch { return undefined; } };

const REASONS = {
  'session/not-found': '找不到这个对话，可能已被删除或归档',
  'session/model-unavailable': '请先在 Harness 中选择一个可用的模型',
  'session/agent-busy': 'Agent 暂时无法接收消息',
  'session/steer-unavailable': '这一轮已经结束，无法插话',
  'session/attachment-invalid': '消息内容无效',
  'gateway/bad-request': '消息内容无效',
  'gateway/cancelled': '发送超时，请重试'
};
export function reasonOf(error) {
  const code = error?.code ?? error?.name;
  return REASONS[code] ?? 'Harness 没有接收这条消息';
}

export class ChatDesk {
  constructor(ctx) { this.ctx = ctx; this.enabled = true; this.last = null; }
  running(id) { try { return this.ctx.agents?.get?.(id)?.status === 'running'; } catch { return false; } }
  /**
   * The conversation the island continues: the task on show, else the most recently active top-level one.
   * @param known - session ids seen as top-level tasks; sub-agents never become a target.
   */
  target(store, known, shownId) {
    if (!this.enabled) return null;
    const ok = id => typeof id === 'string' && known.has(id);
    let entry = ok(shownId) ? store.sessions.get(shownId) : undefined;
    if (!entry) for (const e of store.sessions.values()) if (ok(e.id) && (e.started || e.title || e.reply) && (!entry || e.updated > entry.updated)) entry = e;
    if (entry) {
      const same = this.last?.sessionId === entry.id;
      this.last = { sessionId: entry.id, title: entry.title || (same ? this.last.title : ''), reply: entry.reply || '', state: entry.state };
    }
    if (!this.last) return null;
    return { ...this.last, running: this.running(this.last.sessionId) };
  }
  /**
   * Send one text message to the target conversation, exactly as Harness's own composer would.
   * @param mode - 'queue' starts a turn when idle or waits for the running one; 'steer' joins the running turn.
   */
  async send(sessionId, text, mode = 'queue', { timeout = 30000 } = {}) {
    if (!this.enabled) return { ok: false, reason: '已在设置中关闭' };
    if (!this.last || this.last.sessionId !== sessionId) return { ok: false, reason: '这个对话已经切换，请重新发送' };
    const body = clean(text);
    if (!body) return { ok: false, reason: '消息是空的' };
    if (body.length > MAX_MESSAGE) return { ok: false, reason: `消息太长（最多 ${MAX_MESSAGE} 字）` };
    if (!MODES.has(mode)) mode = 'queue';
    if (mode === 'steer' && !this.running(sessionId)) mode = 'queue';
    const service = this.ctx.get?.('sessionController');
    if (typeof service?.prompt !== 'function') return { ok: false, reason: '当前 Harness 版本不支持从灵动岛发送' };
    const tz = timeZone();
    const request = { requestId: randomUUID(), sessionId, mode, content: [{ type: 'text', text: body }], ...(tz ? { clientTimeZone: tz } : {}) };
    try {
      await service.prompt(request, AbortSignal.timeout(timeout));
      return { ok: true, mode };
    } catch (error) {
      return { ok: false, reason: reasonOf(error) };
    }
  }
}
