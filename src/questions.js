// 在灵动岛里回答 Agent 的提问（ask_user_question）。
//
// 开放中的问题：在 `user-questions/request` waterfall 最前面挂一个监听，和 Harness 网页端“赛跑”——
// 谁先回答用谁；灵动岛先答时，askTimed 随即关闭等待并中止共享 signal，网页端的卡片随之撤下。
// 网页端不在线（NO_PROVIDER）时，灵动岛就是唯一的回答方。
// 已超时转为“继续”的问题：通过 ctx.userQuestions.answer() 作为回复送回 Agent（与网页端相同）。
// 带计划审阅（intent）或附带长说明（detail）的问题留在 Harness 里看全文再答。

const clip = (value, max) => typeof value === 'string' ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ').trim().slice(0, max) : '';

/** Whether the island can show a question batch faithfully. */
export function answerable(questions) {
  return Array.isArray(questions) && questions.length > 0 && questions.length <= 4 &&
    questions.every(q => q && typeof q.id === 'string' && typeof q.question === 'string' && q.intent === undefined && q.detail === undefined && (q.options ?? []).length <= 8);
}

/** The island's copy of a question batch: text, header, options and whether several may be picked. */
export function normalizeQuestions(questions) {
  return questions.map(q => ({
    id: q.id,
    header: clip(q.header, 40),
    question: clip(q.question, 400),
    multiSelect: q.multiSelect === true,
    options: (q.options ?? []).map(o => ({ label: clip(o.label, 80), description: clip(o.description, 140) })).filter(o => o.label)
  }));
}

/**
 * Check an answer batch against its questions: every question exactly once, picks among its own
 * options, one pick for single-select, and typed text replacing the pick of a single-select.
 * @returns the clean batch, or null when it does not fit.
 */
export function validateAnswers(questions, answers) {
  if (!Array.isArray(answers) || answers.length !== questions.length) return null;
  const out = [];
  for (const q of questions) {
    const a = answers.filter(item => item && item.id === q.id);
    if (a.length !== 1) return null;
    const labels = new Set(q.options.map(o => o.label));
    const selected = Array.isArray(a[0].selected) ? [...new Set(a[0].selected)] : null;
    if (!selected || selected.some(label => typeof label !== 'string' || !labels.has(label))) return null;
    const custom = typeof a[0].custom === 'string' ? a[0].custom.trim().slice(0, 4000) : '';
    if (!q.multiSelect && selected.length > 1) return null;
    out.push({ id: q.id, selected: custom && !q.multiSelect ? [] : selected, ...(custom ? { custom } : {}) });
  }
  return out;
}

const noProvider = error => error?.code === 'NO_PROVIDER' || /no user-questions answerer/i.test(String(error?.message ?? ''));

export class QuestionDesk {
  /**
   * @param ctx - plugin context (events, `get('sessionProjections')`, `get('userQuestions')`).
   * @param onChange - called whenever the set of answerable questions changes.
   */
  constructor(ctx, onChange = () => {}) {
    this.ctx = ctx; this.onChange = onChange; this.open = new Map(); this.enabled = true; this.answered = new Map();
  }
  /** Join the answerer waterfall ahead of Harness's own UI. @returns the listener disposer. */
  attach() {
    const desk = this;
    return this.ctx.on('user-questions/request', function (request, next) { return desk.intercept(request, next); }, { global: true, prepend: true });
  }
  intercept(request, next) {
    const callId = request?.wait?.callId, signal = request?.signal;
    // Only timed waits: their closing signal retires the other answerer's card when the island wins.
    if (!this.enabled || request?.wait?.timed !== true || typeof callId !== 'string' || !request.agent?.session || !answerable(request.questions) || signal?.aborted) return next();
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (settle, value) => {
        if (done) return;
        done = true; this.open.delete(callId); signal?.removeEventListener?.('abort', onAbort); this.onChange(); settle(value);
      };
      const onAbort = () => finish(reject, signal.reason);
      signal?.addEventListener?.('abort', onAbort, { once: true });
      this.open.set(callId, { callId, agent: request.agent, questions: normalizeQuestions(request.questions), resolve: answers => finish(resolve, { answers }) });
      this.onChange();
      let downstream;
      try { downstream = Promise.resolve(next()); } catch (error) { downstream = Promise.reject(error); }
      // Harness's own UI answered first: use its answer. No UI connected: the island stays the answerer.
      downstream.then(value => finish(resolve, value), error => { if (!noProvider(error)) finish(reject, error); });
    });
  }
  /** Questions the island can answer now, newest sessions first. */
  list(roots = []) {
    if (!this.enabled) return [];
    const now = Date.now();
    for (const [id, at] of this.answered) if (now - at > 120000) this.answered.delete(id);
    const rows = [...this.open.values()].map(e => ({ callId: e.callId, sessionId: e.agent.session.id, state: 'open', questions: e.questions }));
    const projections = this.ctx.get?.('sessionProjections');
    for (const agent of roots) {
      let active = [];
      try { active = projections?.stateOf?.(agent.session, 'userQuestions')?.questions?.active ?? []; } catch {}
      for (const q of active) {
        if (q.state !== 'continued' || this.answered.has(q.callId) || rows.some(r => r.callId === q.callId) || !answerable(q.questions)) continue;
        rows.push({ callId: q.callId, sessionId: agent.session.id, state: 'continued', questions: normalizeQuestions(q.questions) });
      }
    }
    return rows.slice(0, 4);
  }
  /**
   * Answer one question batch from the island.
   * @returns `{ ok: true }`, or `{ ok: false, reason }` with a short user-facing reason.
   */
  answer(callId, answers, roots = []) {
    const open = this.open.get(callId);
    const row = open ? { state: 'open', questions: open.questions } : this.list(roots).find(r => r.callId === callId);
    if (!row) return { ok: false, reason: '这个问题已经回答过或已关闭' };
    const batch = validateAnswers(row.questions, answers);
    if (!batch) return { ok: false, reason: '每个问题都需要一个有效的回答' };
    if (open) { this.answered.set(callId, Date.now()); open.resolve(batch); return { ok: true }; }
    const agent = roots.find(a => a.session?.id === row.sessionId);
    const service = this.ctx.get?.('userQuestions');
    if (!agent || typeof service?.answer !== 'function') return { ok: false, reason: '这个任务当前不可回答，请在 Harness 中处理' };
    try {
      if (!service.answer(agent, callId, { answers: batch })) return { ok: false, reason: '这个问题已经回答过或已关闭' };
      this.answered.set(callId, Date.now());
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error?.code === 'REPLY_QUEUED' ? '已经有一条回答在等待 Agent 读取' : '回答没有被接受，请在 Harness 中处理' };
    } finally { this.onChange(); }
  }
}
