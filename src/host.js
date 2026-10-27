import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ActivityStore } from './state.js';
import { runtimePath } from './runtime.js';
import { Config, readPrefs } from './settings.js';
import { QuestionDesk } from './questions.js';
import { ApprovalDesk } from './approvals.js';
import { UsageLedger } from './usage.js';

export { Config };
export const name = 'dsh-island';
export const inject = ['agents'];

const rootsOf = ctx => { try { return typeof ctx.agents.roots === 'function' ? ctx.agents.roots() : ctx.agents.list(); } catch { return []; } };

export function attachActivity(ctx, store, publish) {
  const listeners = [];
  const on = (name, cb) => listeners.push(ctx.on(name, cb, { global: true }));
  on('session/event', (session, event) => { store.event(session.id,event); publish(); });
  on('agent/assistant-stream', ({ agent, frame }) => { store.stream(agent.session.id,frame); publish(); });
  on('agent/status', ({ agent, status }) => {
    if (status === 'running' && ['idle','completed','paused'].includes(store.entry(agent.session.id)?.state)) store.set(agent.session.id,'thinking',{started:Date.now(),ended:0});
    publish();
  });
  on('agent/error', ({ agent }) => { store.set(agent.session.id,'error',{ended:Date.now()}); publish(); });
  on('agent/disposed', ({ agent }) => {
    const e=store.sessions.get(agent.session.id);
    if(e && !['idle','completed','paused','error'].includes(e.state)) store.set(e.id,'paused',{ended:Date.now()});
    publish();
  });
  for(const agent of ctx.agents.list()) if(agent.status === 'running') store.set(agent.session.id,'thinking',{started:Date.now()});
  return () => listeners.forEach(dispose=>dispose());
}

/** Stop the running turn of one top-level task, exactly like Harness's own Stop button. */
export function stopSession(ctx, sessionId) {
  const agent = typeof sessionId === 'string' ? ctx.agents.get?.(sessionId) : undefined;
  if (!agent || !rootsOf(ctx).includes(agent) || typeof agent.cancel !== 'function') return false;
  agent.cancel({ kind: 'user' }, { keepInbox: true });
  return true;
}

/** Context pressure from Harness's own token-meter projection, when the session is live. */
function contextFromProjection(ctx, sessionId) {
  try {
    const session = ctx.agents.get?.(sessionId)?.session;
    const view = session && ctx.get?.('sessionProjections')?.stateOf?.(session, 'contextPressure');
    return view && typeof view === 'object' ? view : null;
  } catch { return null; }
}

/** Snapshot sent to the island: top-level tasks only, plus sub-agents that need the user. */
export function islandSnapshot(ctx, store, known, desk, extra = {}) {
  const roots = rootsOf(ctx);
  for (const agent of roots) if (agent?.session?.id) known.add(agent.session.id);
  const data = store.snapshot(id => known.size === 0 || known.has(id));
  const title = id => store.sessions.get(id)?.title ?? '';
  data.questions = desk ? desk.list(roots).map(q => ({ ...q, title: title(q.sessionId) })) : [];
  data.approvals = extra.approvals ? extra.approvals.list().map(a => ({ ...a, title: title(a.sessionId) })) : [];
  data.stoppable = Boolean(data.sessionId && !['completed','paused','error','idle'].includes(data.state) && roots.some(a => a?.session?.id === data.sessionId));
  if (data.detail) {
    const view = contextFromProjection(ctx, data.sessionId);
    if (view?.contextWindow) data.detail.contextWindow = view.contextWindow;
    if (Number.isFinite(view?.projectedTokens) || Number.isFinite(view?.pressureTokens)) data.detail.contextTokens = view.projectedTokens ?? view.pressureTokens;
    if (extra.prefs && extra.prefs.details === false) data.detail.reply = '';
  }
  if (extra.usage) data.usage = extra.usage;
  return data;
}

const wallets = list => (Array.isArray(list) ? list : []).filter(w => w && ['CNY','USD'].includes(w.currency) && typeof w.balance === 'string' && /^-?\d+(\.\d+)?$/.test(w.balance)).map(w => ({ currency: w.currency, balance: w.balance }));
let harnessVersion;
const clientInfo = () => {
  if (harnessVersion === undefined) { try { harnessVersion = createRequire(import.meta.url)('@deepseek-ai/dsh-deepseek-account/package.json').version; } catch { harnessVersion = '0.2.1-rc.3'; } }
  return { version: harnessVersion, locale: Intl.DateTimeFormat().resolvedOptions().locale || 'zh-CN', timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 };
};
/**
 * Account balance through Harness's own account service (the same call as 设置 › 账户).
 * Only for a signed-in DeepSeek account; the island never sees a token or API key.
 */
export async function readBalance(account, client = clientInfo()) {
  if (!account || typeof account.getBalance !== 'function') return null;
  const result = await account.getBalance(client);
  if (!result || result.status !== 'ready') return null;
  const main = wallets(result.value), bonus = wallets(result.bonusWallets);
  return main.length || bonus.length ? { wallets: main, bonus, at: Date.now() } : null;
}

export function apply(ctx, config = {}) {
  // This process is owned by the Desktop profile and never starts a background service.
  const read = key => typeof config[key]?.get === 'function' ? config[key].get() : config[key];
  if (!process.env.DSH_DESKTOP_NODE_EXECUTABLE && !process.execPath.includes('DeepSeek Harness') && !read('allowStandalone')) return;
  // This plugin draws its own settings page (设置 › 灵动岛), so Harness should not generate one.
  ctx.inject?.(['settings'], child => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)); });
  // Optional: present when the user can sign in with a DeepSeek account.
  let account;
  ctx.inject?.(['deepseekAccount'], child => { child.effect(() => { account = child.deepseekAccount; return () => { if (account === child.deepseekAccount) account = undefined; }; }); });
  ctx.effect(() => {
    let child, last = '', stopped = false, pending, prefs = readPrefs(config);
    const store = new ActivityStore(), known = new Set();
    const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE;
    const dataDir = read('dataDir') || join(env.DSH_HOME || join(homedir(),'.dsh'),'dsh-island');
    const desk = new QuestionDesk(ctx, () => publish());
    desk.enabled = prefs.questions;
    const offDesk = desk.attach();
    const approvals = new ApprovalDesk(ctx, () => publish());
    approvals.enabled = prefs.approvals;
    const offApprovals = approvals.attach();
    // 用量账本：实时事件 + 历史会话补算（通过 Harness 的 sessionQuery，读一次即缓存）。
    const ledger = new UsageLedger({ file: join(dataDir, 'usage.json') }).load();
    const offLedger = ctx.on('session/event', (session, event) => ledger.ingest(session?.id, event), { global: true });
    let usage, usageAt = 0, usageVersion = -1;
    const usageNow = () => {
      if (ledger.version !== usageVersion || Date.now() - usageAt > 60000) { usage = ledger.panel(); usageAt = Date.now(); usageVersion = ledger.version; }
      return usage;
    };
    const backfillAbort = new AbortController();
    const backfill = () => { const query = ctx.get?.('sessionQuery'); ledger.backfill(query, { signal: backfillAbort.signal }).then(n => { if (n) publish(); }, () => {}); };
    const backfillFirst = setTimeout(backfill, 8000); backfillFirst.unref?.();
    const backfillTimer = setInterval(backfill, 30 * 60000); backfillTimer.unref?.();
    const message = value => { if (!stopped && child?.connected) child.send(value, () => {}); };
    const send = () => {
      pending = undefined;
      if (stopped || !child?.connected) return;
      const data=islandSnapshot(ctx,store,known,desk,{approvals,prefs,usage:usageNow()}), encoded=JSON.stringify(data);
      if(encoded===last)return;
      last=encoded;
      child.send({type:'activity',data}, error=>{ if(error) last=''; });
    };
    const publish = () => { if(!pending) pending=setTimeout(send,80); };
    const detach=attachActivity(ctx,store,publish);
    // Settings edited in Harness arrive as volatile updates; forward them without restarting the window.
    let balanceAt = 0, balanceBusy = false;
    const refreshBalance = async (force = false) => {
      if (!prefs.balance) { message({ type: 'balance', data: null }); return; }
      if (balanceBusy || (!force && Date.now() - balanceAt < 60000)) return;
      balanceBusy = true;
      try { const data = await readBalance(account); balanceAt = Date.now(); message({ type: 'balance', data }); }
      catch { balanceAt = Date.now(); }
      finally { balanceBusy = false; }
    };
    const offSettings = ctx.on?.('loader/volatile-update', () => {
      const next = readPrefs(config);
      if (next.enabled && !prefs.enabled) message({ type: 'show' });
      const balanceChanged = next.balance !== prefs.balance;
      prefs = next; desk.enabled = prefs.questions; approvals.enabled = prefs.approvals; message({ type: 'prefs', data: prefs }); publish();
      if (balanceChanged) refreshBalance(true);
    });
    try {
      child=spawn(runtimePath(env),[fileURLToPath(new URL('../desktop/main.cjs',import.meta.url)),`--island-data=${dataDir}`],{
        env, windowsHide:true, stdio:['ignore','ignore','pipe','ipc']
      });
      child.stderr.on('data',()=>{});
      child.on('error',error=>ctx.logger.warn(`灵动岛启动失败：${error.message}`));
      child.on('message',msg=>{
        if(msg?.type==='ready'){ last=''; message({ type: 'prefs', data: prefs }); send(); setTimeout(() => refreshBalance(true), 3000).unref?.(); }
        if(msg?.type==='panel-open') refreshBalance();
        if(msg?.type==='answer' && typeof msg.callId==='string'){ const result = desk.answer(msg.callId, msg.answers, rootsOf(ctx)); message({ type: 'answer-result', callId: msg.callId, ...result }); publish(); }
        if(msg?.type==='stop' && stopSession(ctx, msg.sessionId)) publish();
        if(msg?.type==='approve' && typeof msg.id==='string'){ const result = approvals.decide(msg.id, msg.outcome); message({ type: 'approval-result', id: msg.id, ...result }); publish(); }
        if(msg?.type==='stats'){ message({ type: 'stats', data: ledger.stats(['today','7d','30d'].includes(msg.range) ? msg.range : '7d') }); if (!ledger.sessions.size) backfill(); }
      });
      child.on('exit',code=>{ if(!stopped && code)ctx.logger.warn(`灵动岛窗口已退出 (${code})，重新启用插件可恢复。`); });
    } catch(error) { ctx.logger.warn(error.message); }
    const timer=setInterval(publish,1000); timer.unref();
    const balanceTimer=setInterval(() => refreshBalance(true), 10 * 60000); balanceTimer.unref();
    return () => { stopped=true; detach(); offDesk?.(); offApprovals?.(); offLedger?.(); backfillAbort.abort(); clearTimeout(backfillFirst); clearInterval(backfillTimer); ledger.save(); offSettings?.(); clearInterval(timer); clearInterval(balanceTimer); clearTimeout(pending); if(child?.connected)child.send({type:'shutdown'}); setTimeout(()=>{if(child?.exitCode===null)child.kill();},1500).unref(); };
  });
}
