// 在灵动岛里批准或拒绝权限请求（ctx.approval → `approval/request` waterfall）。
//
// 灵动岛在 waterfall 最前面挂一个监听，与 Harness 窗口里的审批卡“赛跑”，先答者生效。
// 往下游传的 signal 换成“原信号 或 灵动岛已作答”的组合：灵动岛先答时中止它，Harness 的审批卡随之撤下，
// 不会一直占着输入框。只给顶层任务用；只提供“允许一次”和“拒绝”，持久授权仍在 Harness 中设置。
import { randomUUID } from 'node:crypto';

const clip = (value, max) => typeof value === 'string' ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ').trim().slice(0, max) : '';
const OUTCOMES = new Set(['allowed-once', 'rejected']);

/** What a tool call wants to do, for display: a command, a file, a URL or a short argument digest. */
export function summarizeCall(name, argumentsText) {
  let args;
  try { args = typeof argumentsText === 'string' ? JSON.parse(argumentsText) : argumentsText; } catch { return argumentsText ? { label: '参数', text: clip(String(argumentsText), 600) } : null; }
  if (!args || typeof args !== 'object') return null;
  const pick = (...keys) => { for (const k of keys) if (typeof args[k] === 'string' && args[k].trim()) return args[k]; return ''; };
  const command = pick('command', 'cmd', 'script', 'code');
  const path = pick('path', 'file_path', 'filePath', 'file', 'target');
  const url = pick('url', 'uri');
  if (/^(bash|pwsh|powershell|terminal_send|terminal_open|shell)$/i.test(name) && command) return { label: '命令', text: clip(command, 600), mono: true };
  if (path) return { label: /write|edit|replace|create|delete|remove/i.test(name + ' ' + (args.command ?? '')) ? '修改文件' : '文件', text: clip(path, 300), mono: true, extra: command && command !== path ? clip(command, 40) : '' };
  if (url) return { label: '网址', text: clip(url, 300), mono: true };
  if (command) return { label: '命令', text: clip(command, 600), mono: true };
  const first = Object.entries(args).find(([, v]) => typeof v === 'string' && v.trim());
  return first ? { label: first[0], text: clip(first[1], 400), mono: false } : null;
}

/** Find the tool call an approval is about, scanning back from the end of the session log. */
export function callDetail(session, callId) {
  if (!callId || typeof session?.eventAt !== 'function' || !Number.isInteger(session.seq)) return null;
  for (let seq = session.seq - 1, n = 0; seq >= 0 && n < 500; seq -= 1, n += 1) {
    let event; try { event = session.eventAt(seq); } catch { return null; }
    if (event?.type === 'tool/call' && event.data?.callId === callId) return summarizeCall(event.data.name, event.data.arguments);
  }
  return null;
}

export class ApprovalDesk {
  constructor(ctx, onChange = () => {}) { this.ctx = ctx; this.onChange = onChange; this.pending = new Map(); this.enabled = true; }
  attach() {
    const desk = this;
    return this.ctx.on('approval/request', function (request, next) { return desk.intercept(request, next); }, { global: true, prepend: true });
  }
  isRoot(agent) {
    try { const agents = this.ctx.get?.('agents'); return !!agents && (agents.roots?.() ?? []).includes(agent); } catch { return false; }
  }
  intercept(request, next) {
    if (!this.enabled || !request?.agent?.session || request.signal?.aborted || !this.isRoot(request.agent)) return next();
    const original = request.signal, retire = new AbortController();
    const combined = original ? AbortSignal.any([original, retire.signal]) : retire.signal;
    try { request.signal = combined; } catch { return next(); }
    if (request.signal !== combined) return next();
    const id = randomUUID();
    return new Promise(resolve => {
      let done = false;
      const finish = (outcome, fromIsland) => {
        if (done) return;
        done = true; this.pending.delete(id); original?.removeEventListener?.('abort', onAbort); this.onChange(); resolve(outcome);
        // The island answered: retire Harness's own card so it does not hold the composer.
        if (fromIsland) retire.abort(new Error('answered in the island'));
      };
      const onAbort = () => finish('cancelled', false);
      original?.addEventListener?.('abort', onAbort, { once: true });
      this.pending.set(id, {
        id, agent: request.agent, sessionId: request.agent.session.id, at: Date.now(),
        toolName: clip(request.toolName, 60), reason: clip(request.displayReason || request.reason, 300),
        detail: callDetail(request.agent.session, request.callId),
        decide: outcome => finish(outcome, true)
      });
      this.onChange();
      let downstream;
      try { downstream = Promise.resolve(next()); } catch { downstream = Promise.resolve('unavailable'); }
      // Harness's own card answered first. `unavailable` means no window is open: the island keeps asking.
      downstream.then(outcome => { if (outcome !== 'unavailable') finish(outcome, false); }, () => {});
    });
  }
  list() {
    if (!this.enabled) return [];
    return [...this.pending.values()].map(({ id, sessionId, at, toolName, reason, detail }) => ({ id, sessionId, at, toolName, reason, detail })).slice(0, 4);
  }
  /** @returns `{ ok }` or `{ ok: false, reason }`. */
  decide(id, outcome) {
    const entry = this.pending.get(id);
    if (!entry) return { ok: false, reason: '这个请求已经处理过或已取消' };
    if (!OUTCOMES.has(outcome)) return { ok: false, reason: '无效的决定' };
    entry.decide(outcome);
    return { ok: true };
  }
}
