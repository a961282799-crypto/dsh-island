import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { ActivityStore } from './state.js';
import { resolveRuntime, runtimeHelp } from './runtime.js';
import { promptRuntimeHelp, runtimeHelpText } from './notify.js';
import { Config, readPrefs } from './settings.js';
import { QuestionDesk } from './questions.js';
import { ApprovalDesk } from './approvals.js';
import { UsageLedger } from './usage.js';
import { ChatDesk } from './chat.js';

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
  // 继续对话的目标：当前显示的任务，或最近一个顶层任务（不会是子智能体）。
  const chat = extra.chat?.target(store, known, data.sessionId);
  data.chat = chat ? (extra.prefs?.details === false ? { ...chat, title: '', reply: '' } : chat) : null;
  return data;
}

const wallets = list => (Array.isArray(list) ? list : []).filter(w => w && ['CNY','USD'].includes(w.currency) && typeof w.balance === 'string' && /^-?\d+(\.\d+)?$/.test(w.balance)).map(w => ({ currency: w.currency, balance: w.balance }));
let harnessVersion;
const clientInfo = () => {
  if (harnessVersion === undefined) { try { harnessVersion = createRequire(import.meta.url)('@deepseek-ai/dsh-deepseek-account/package.json').version; } catch { harnessVersion = '0.2.2-rc.1'; } }
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
    const chat = new ChatDesk(ctx);
    chat.enabled = prefs.chat;
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
      const data=islandSnapshot(ctx,store,known,desk,{approvals,chat,prefs,usage:usageNow()}), encoded=JSON.stringify(data);
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
      prefs = next; desk.enabled = prefs.questions; approvals.enabled = prefs.approvals; chat.enabled = prefs.chat; message({ type: 'prefs', data: prefs }); publish();
      if (balanceChanged) refreshBalance(true);
      // 设置页改动也是“再试一次”的入口：用户刚装好运行环境时不必重启 Harness。
      if (!child) launch();
    });

    // 桌面窗口跑在独立的 Electron 里。运行环境缺失、Electron 起不来或中途崩溃都不能静默失败：
    // 写状态文件、记 error 日志，并在 Windows 上弹一次原生提示（否则用户只会看到“插件已启用但没效果”）。
    const statusFile = join(dataDir, 'runtime-status.json');
    const helpFile = join(dataDir, 'runtime-help.txt');
    const stderrTail = [];
    let status = { state: 'starting', at: Date.now() }, retries = 0, retryTimer;

    const writeJson = (file, value) => {
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
        renameSync(`${file}.tmp`, file);
      } catch {}
    };
    const noteStatus = patch => { status = { ...status, ...patch, at: Date.now() }; writeJson(statusFile, status); };
    const captureStderr = chunk => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) stderrTail.push(line.trim().slice(0, 300));
      if (stderrTail.length > 20) stderrTail.splice(0, stderrTail.length - 20);
    };
    // 失败后按 15s / 1min / 5min 再试：dsh-orb 的下载往往要几分钟，装完不必重启 Harness。
    // 之后只要还是“缺运行环境”就每 10 分钟再看一眼；崩溃类失败不再无限重试。
    const retryLater = () => {
      if (stopped || child) return;
      const delays = [15000, 60000, 300000];
      if (retries >= delays.length && status.state !== 'missing') return;
      const delay = retries < delays.length ? delays[retries] : 600000;
      retries++;
      retryTimer = setTimeout(() => { retryTimer = undefined; launch(); }, delay);
      retryTimer.unref?.();
    };
    const report = text => { try { ctx.logger?.error?.(text); } catch {} };
    const fail = reason => {
      const missing = /运行环境/.test(reason);
      noteStatus({ state: missing ? 'missing' : 'failed', reason, tried: missing ? status.tried ?? [] : undefined, stderr: stderrTail.slice() });
      report(`[dsh-island] 灵动岛没有显示：${reason}\n${missing ? runtimeHelp(status.tried ?? []) : '详情见 ' + statusFile}`);
      if (!status.announced && prefs.enabled) {
        try { writeFileSync(helpFile, '\uFEFF' + runtimeHelpText({ reason, tried: status.tried ?? [], stderr: stderrTail }), 'utf8'); } catch {}
        noteStatus({ announced: true });
        const shown = promptRuntimeHelp({ dataDir, file: helpFile, lines: ['灵动岛没有显示。', reason, '', '点“是”查看两条解决办法。'] });
        report(`[dsh-island] 修复说明已写入 ${helpFile}${shown ? '（已弹出提示）' : ''}`);
      }
      retryLater();
    };
    const launch = () => {
      if (stopped || child) return;
      const found = resolveRuntime(env);
      noteStatus({ state: 'starting', tried: found.tried, runtime: found.path, source: found.source, verified: found.verified, stderr: [] });
      if (!found.path) { fail(found.error.split('\n')[0]); return; }
      try {
        child = spawn(found.path, [fileURLToPath(new URL('../desktop/main.cjs', import.meta.url)), `--island-data=${dataDir}`], {
          env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc']
        });
      } catch (error) { child = null; fail(`无法启动 Electron：${error.message}`); return; }
      const proc = child;
      stderrTail.length = 0;
      proc.stderr.on('data', captureStderr);
      proc.on('error', error => { if (proc !== child) return; child = null; fail(`无法启动 Electron：${error.message}`); });
      proc.on('message', msg => {
        if (msg?.type === 'ready') {
          retries = 0; last = '';
          noteStatus({ state: 'running', announced: false, stderr: [] });
          try { rmSync(helpFile, { force: true }); } catch {}
          message({ type: 'prefs', data: prefs }); send(); setTimeout(() => refreshBalance(true), 3000).unref?.();
        }
        if(msg?.type==='panel-open') refreshBalance();
        if(msg?.type==='answer' && typeof msg.callId==='string'){ const result = desk.answer(msg.callId, msg.answers, rootsOf(ctx)); message({ type: 'answer-result', callId: msg.callId, ...result }); publish(); }
        if(msg?.type==='stop' && stopSession(ctx, msg.sessionId)) publish();
        if(msg?.type==='approve' && typeof msg.id==='string'){ const result = approvals.decide(msg.id, msg.outcome); message({ type: 'approval-result', id: msg.id, ...result }); publish(); }
        if(msg?.type==='chat' && typeof msg.id==='string'){ chat.send(msg.sessionId, msg.text, msg.mode).then(result => { message({ type: 'chat-result', id: msg.id, ...result }); publish(); }); }
        if(msg?.type==='stats'){ message({ type: 'stats', data: ledger.stats(['today','7d','30d'].includes(msg.range) ? msg.range : '7d') }); if (!ledger.sessions.size) backfill(); }
      });
      proc.on('exit', (code, signal) => {
        if (proc !== child) return;
        const tail = stderrTail.length ? `：${stderrTail.at(-1)}` : '';
        child = null;
        if (stopped) return;
        if (!code && !signal) { noteStatus({ state: 'closed' }); return; }
        fail(`灵动岛窗口已退出（${code ?? signal ?? '未知'}）${tail}`);
      });
    };
    launch();
    const timer=setInterval(publish,1000); timer.unref();
    const balanceTimer=setInterval(() => refreshBalance(true), 10 * 60000); balanceTimer.unref();
    return () => { stopped=true; clearTimeout(retryTimer); detach(); offDesk?.(); offApprovals?.(); offLedger?.(); backfillAbort.abort(); clearTimeout(backfillFirst); clearInterval(backfillTimer); ledger.save(); offSettings?.(); clearInterval(timer); clearInterval(balanceTimer); clearTimeout(pending); if(child?.connected)child.send({type:'shutdown'}); setTimeout(()=>{if(child?.exitCode===null)child.kill();},1500).unref(); };
  });
}
