export const STATES = {
  idle: { label: '随时待命', detail: '开始一个任务，让想法继续。' },
  thinking: { label: '正在思考', detail: '梳理思路，寻找更好的答案。' },
  streaming: { label: '正在回答', detail: '答案正在一点点展开。' },
  tools: { label: '正在执行', detail: '正在调用工具完成任务。' },
  waiting: { label: '等待你确认', detail: '回到 Harness 查看并处理。' },
  completed: { label: '已完成', detail: '这一步已经完成，可以查看结果。' },
  paused: { label: '已暂停', detail: '任务已停止，随时可以继续。' },
  error: { label: '需要留意', detail: '任务遇到问题，请回到 Harness 查看。' },
  reconnecting: { label: '正在重试', detail: 'Harness 正在重新尝试连接。' },
  compacting: { label: '整理上下文', detail: '收拢已有信息，为后续工作留出空间。' },
  offline: { label: '连接已断开', detail: '等待 Harness 恢复连接。' }
};
const priority = { waiting: 100, error: 90, tools: 60, streaming: 55, thinking: 50, compacting: 50, reconnecting: 45, completed: 20, paused: 10, idle: 0 };
const FINISHED = ['completed', 'paused', 'error'];
const clip = (value, max = 100) => typeof value === 'string' ? value.replace(/[\x00-\x1f]/g, ' ').trim().slice(0, max) : '';
const count = value => Number.isFinite(value) && value > 0 ? value : 0;

// Crosses the process boundary: state, titles, the agent's own plan items, tool names,
// model id and token counts. Never prompts, replies, reasoning or tool arguments.
export class ActivityStore {
  constructor(now = Date.now) { this.now = now; this.sessions = new Map(); this.finished = []; }
  entry(id) {
    if (!id) return null;
    if (!this.sessions.has(id)) this.sessions.set(id, {
      id, state: 'idle', title: '', updated: this.now(), started: 0, ended: 0,
      tools: new Map(), approvals: new Set(), questions: new Set(),
      todos: [], trail: [], toolCount: 0, model: '', contextTokens: 0, contextWindow: 0, inputTokens: 0, cacheTokens: 0, outputTokens: 0, lastText: '', reply: ''
    });
    return this.sessions.get(id);
  }
  set(id, state, extra = {}) {
    const entry = this.entry(id);
    if (!entry) return;
    Object.assign(entry, extra);
    if (entry.state !== state) { entry.state = state; entry.updated = this.now(); }
  }
  event(id, event) {
    const e = this.entry(id), d = event.data ?? {};
    if (!e) return;
    switch (event.type) {
      case 'session/title': e.title = clip(d.title); break;
      case 'turn/start':
        e.tools.clear(); e.approvals.clear(); e.questions.clear();
        e.trail = []; e.toolCount = 0; e.inputTokens = 0; e.cacheTokens = 0; e.outputTokens = 0; e.lastText = ''; e.reply = '';
        this.set(id, 'thinking', { started: this.now(), ended: 0, updated: this.now() }); break;
      case 'step/start': if (!e.approvals.size && !e.questions.size) this.set(id, 'thinking'); break;
      case 'tool/call': {
        const name = clip(d.name, 60);
        e.tools.set(d.callId, name);
        e.toolCount += 1;
        if (name && e.trail.at(-1) !== name) e.trail = [...e.trail, name].slice(-6);
        if (d.name === 'ask_user_question') e.questions.add(d.callId);
        this.set(id, e.approvals.size || e.questions.size ? 'waiting' : 'tools'); break;
      }
      case 'tool/result': {
        let pending=false;
        if(e.questions.has(d.message?.toolCallId)) {
          try { pending=JSON.parse(d.message.content?.find(b=>b.type==='text')?.text??'{}').pending===true; } catch {}
          if(!pending)e.questions.delete(d.message?.toolCallId);
        }
        e.tools.delete(d.message?.toolCallId);
        this.set(id, e.approvals.size || e.questions.size ? 'waiting' : e.tools.size ? 'tools' : 'thinking'); break;
      }
      case 'user/message':
        if(d.source?.kind==='user-question-reply') {
          e.questions.delete(d.source.callId);
          this.set(id,e.approvals.size||e.questions.size?'waiting':e.tools.size?'tools':'thinking');
        }
        break;
      case 'todo/write':
        if (Array.isArray(d.todos)) e.todos = d.todos.slice(0, 40).map(t => ({ content: clip(t?.content, 80), status: ['pending','in_progress','completed'].includes(t?.status) ? t.status : 'pending' })).filter(t => t.content);
        break;
      case 'model/selection': { const m = typeof d.model === 'string' ? d.model : d.model?.id ?? d.selection?.model; if (typeof m === 'string') e.model = clip(m, 40); break; }
      case 'assistant/attempt': if (typeof d.source?.model === 'string') e.model = clip(d.source.model, 40); break;
      case 'request/context': if (Number.isFinite(d.contextWindow) && d.contextWindow > 0) e.contextWindow = d.contextWindow; break;
      case 'assistant/message': {
        const text = Array.isArray(d.message?.content) ? d.message.content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join(' ') : '';
        if (text.trim()) e.lastText = clip(text.replace(/[#*`>_~|]+/g, ' ').replace(/\s+/g, ' '), 160);
        const u = d.usage;
        if (u && typeof u === 'object') {
          e.contextTokens = count(u.inputTokens) + count(u.cacheReadTokens) + count(u.cacheWriteTokens);
          e.inputTokens += count(u.inputTokens) + count(u.cacheWriteTokens);
          e.cacheTokens += count(u.cacheReadTokens);
          e.outputTokens += count(u.outputTokens);
        }
        break;
      }
      case 'approval/asked': e.approvals.add(d.id); this.set(id, 'waiting'); break;
      case 'approval/decided':
        e.approvals.delete(d.id);
        if (!e.approvals.size && !e.questions.size) this.set(id, e.tools.size ? 'tools' : 'thinking'); break;
      case 'compaction/start': this.set(id, 'compacting'); break;
      case 'compaction/end': this.set(id, d.error ? 'error' : 'thinking'); break;
      case 'llm/retry': this.set(id, 'reconnecting'); break;
      case 'llm/retry-started': this.set(id, 'thinking'); break;
      case 'turn/end': {
        const reason = d.reason?.kind;
        const state = reason === 'completed' ? 'completed' : reason === 'aborted' ? 'paused' : 'error';
        e.tools.clear(); e.approvals.clear();
        if(state!=='completed')e.questions.clear();
        if (state === 'completed') e.reply = e.lastText;
        this.set(id, e.questions.size?'waiting':state, { ended: this.now() });
        if (e.started) this.finished = [...this.finished, { id, title: e.title, state, started: e.started, ended: e.ended, toolCount: e.toolCount, inputTokens: e.inputTokens, cacheTokens: e.cacheTokens, outputTokens: e.outputTokens }].slice(-12);
        break;
      }
    }
  }
  stream(id, frame) {
    const e = this.entry(id);
    if (!e || e.approvals.size || e.questions.size || e.tools.size) return;
    if (frame.type === 'start') this.set(id, 'thinking');
    if (frame.type !== 'chunk') return;
    const c = frame.chunk ?? {};
    if (c.type === 'reasoning-delta' || c.type === 'block-start' && c.blockType === 'reasoning') this.set(id, 'thinking');
    if (c.type === 'text-delta' || c.type === 'block-start' && c.blockType === 'text') this.set(id, 'streaming');
    if (c.type === 'tool-call-delta') this.set(id, 'tools');
  }
  /** @param include - which sessions count as user tasks; others show only while they need the user. */
  snapshot(include = () => true) {
    const now = this.now();
    for (const [id,e] of this.sessions) {
      if (['completed','paused'].includes(e.state) && now - e.updated > 6500) e.state = 'idle';
      if (e.state === 'error' && now - e.updated > 15000) e.state = 'idle';
      if (e.state === 'idle' && now - e.updated > 600000) this.sessions.delete(id);
    }
    const shown = e => include(e.id) || ['waiting','error'].includes(e.state);
    const rows = [...this.sessions.values()].filter(e => e.state !== 'idle' && shown(e)).sort((a,b) => (priority[b.state] ?? 0) - (priority[a.state] ?? 0) || b.updated - a.updated);
    const e = rows[0];
    const todos = e?.todos ?? [];
    return {
      state: e?.state ?? 'idle', title: e?.title ?? '', sessionId: e?.id ?? null,
      started: e?.started ?? 0, ended: e?.ended ?? 0,
      activeCount: rows.filter(e => !FINISHED.includes(e.state)).length,
      tool: e ? [...e.tools.values()].at(-1) ?? '' : '',
      detail: e ? {
        plan: todos.length ? { total: todos.length, done: todos.filter(t => t.status === 'completed').length, current: todos.find(t => t.status === 'in_progress')?.content ?? '' } : null,
        trail: e.trail.slice(-4), toolCount: e.toolCount, model: e.model, contextTokens: e.contextTokens, contextWindow: e.contextWindow, outputTokens: e.outputTokens,
        reply: e.state === 'completed' ? e.reply : '',
        cacheRate: e.inputTokens + e.cacheTokens > 0 ? Math.round(e.cacheTokens / (e.inputTokens + e.cacheTokens) * 100) : null
      } : null,
      sessions: rows.slice(0, 5).map(r => ({ id: r.id, title: r.title, state: r.state, started: r.started, ended: r.ended })),
      finished: this.finished.filter(f => include(f.id)).slice(-6)
    };
  }
}
