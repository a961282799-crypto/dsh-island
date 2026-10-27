// 用量统计窗口：今天按小时、7/30 天按天；按模型、按会话（可展开到每一轮）。数据来自 Harness 会话记录。
const api = window.usageStats;
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const SERIES = [['cacheRead', '缓存命中', 'var(--s-cache)'], ['input', '未命中输入', 'var(--s-input)'], ['output', '输出', 'var(--s-output)']];
let range = 'today', data = null;

const tokens = n => !n ? '0' : n < 1000 ? String(Math.round(n)) : n < 1e6 ? `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}K` : n < 1e9 ? `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M` : `${(n / 1e9).toFixed(2)}B`;
const money = n => n == null ? '—' : n === 0 ? '¥0' : n < 0.01 ? '<¥0.01' : `¥${n.toFixed(n < 100 ? 2 : 0)}`;
const duration = ms => { const m = Math.round(ms / 60000); return m < 1 ? '不到 1 分钟' : m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`; };
const clock = t => { const d = new Date(t), hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; return d.toDateString() === new Date().toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`; };
const shortModel = m => m ? m.replace(/^deepseek-/i, '') : '—';
const el = (tag, attrs = {}, ...children) => {
  const node = tag.startsWith('svg:') ? document.createElementNS(NS, tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) k === 'text' ? node.textContent = v : node.setAttribute(k, v);
  node.append(...children.filter(c => c != null));
  return node;
};

function load(next) {
  range = next;
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.range === range));
  $('main').setAttribute('aria-busy', 'true');
  api.request(range);
}
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => load(b.dataset.range));
document.querySelector('.tabs').addEventListener('keydown', e => {
  const order = ['today', '7d', '30d'], i = order.indexOf(range);
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = order[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3]; load(n); document.querySelector(`[data-range="${n}"]`).focus(); }
});

/** A bar segment with only its top corners rounded. */
function topRounded(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function niceMax(v) { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }

function renderChart(d) {
  const box = $('chart'), W = Math.max(320, box.clientWidth - 8), H = box.clientHeight - 6;
  const left = 46, bottom = 22, top = 8, plotW = W - left - 6, plotH = H - top - bottom;
  const totals = d.buckets.map(b => b.cacheRead + b.input + b.output), max = niceMax(Math.max(...totals, 1000));
  const svg = el('svg:svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${$('chart-title').textContent}的 tokens 用量` });
  for (let i = 0; i <= 4; i++) {
    const y = top + plotH - plotH * i / 4;
    svg.append(el('svg:line', { class: 'grid', x1: left, x2: W - 6, y1: y, y2: y }));
    svg.append(el('svg:text', { class: 'axis', x: left - 8, y: y + 3.5, 'text-anchor': 'end', text: tokens(max * i / 4) }));
  }
  const n = d.buckets.length, slot = plotW / n, bw = Math.max(3, Math.min(26, slot * 0.62));
  const every = d.byHour ? 3 : n > 10 ? 5 : 1;
  d.buckets.forEach((b, i) => {
    const x = left + slot * i + (slot - bw) / 2, g = el('svg:g', { class: 'col', 'data-i': i });
    let y = top + plotH;
    const parts = SERIES.map(([k, , c]) => [b[k], c]).filter(([v]) => v > 0);
    parts.forEach(([v, c], j) => {
      const h = Math.max(1.5, v / max * plotH), gap = j > 0 ? 2 : 0, last = j === parts.length - 1;
      y -= h;
      const segH = Math.max(0.5, h - gap);
      g.append(last ? el('svg:path', { class: 'seg', d: topRounded(x, y, bw, segH, 4), fill: c, style: `animation-delay:${i * 14}ms` })
        : el('svg:rect', { class: 'seg', x, y, width: bw, height: segH, fill: c, style: `animation-delay:${i * 14}ms` }));
    });
    g.append(el('svg:rect', { class: 'hit', x: left + slot * i, y: top, width: slot, height: plotH, tabindex: '0', 'aria-label': `${b.label}：${tokens(totals[i])} tokens` }));
    svg.append(g);
    if (i % every === 0 || (!d.byHour && i === n - 1)) svg.append(el('svg:text', { class: 'axis', x: left + slot * i + slot / 2, y: H - 6, 'text-anchor': 'middle', text: b.label }));
  });
  const show = (i, anchor) => {
    const b = d.buckets[i]; if (!b) return;
    for (const g of svg.querySelectorAll('.col')) g.classList.toggle('dim', g.dataset.i !== String(i));
    const tip = $('tip');
    tip.replaceChildren(el('b', { text: d.byHour ? `${b.label} – ${Number(b.label.split(':')[0]) + 1}:00` : b.label }),
      ...SERIES.map(([k, label, c]) => el('div', { class: 'r' }, el('span', {}, el('i', { style: `--c:${c}` }), label), el('span', { text: tokens(b[k]) }))),
      el('div', { class: 'r' }, el('span', { text: '≈ 费用' }), el('span', { text: money(b.cost) })),
      el('div', { class: 'r' }, el('span', { text: '轮次' }), el('span', { text: String(b.turns) })));
    tip.hidden = false;
    const card = box.parentElement.getBoundingClientRect(), r = anchor.getBoundingClientRect();
    let x = r.left - card.left + r.width / 2 + 12;
    if (x + tip.offsetWidth > card.width - 8) x = r.left - card.left + r.width / 2 - tip.offsetWidth - 12;
    tip.style.left = `${Math.max(8, x)}px`; tip.style.top = `${box.offsetTop + 10}px`;
  };
  const hide = () => { $('tip').hidden = true; for (const g of svg.querySelectorAll('.col')) g.classList.remove('dim'); };
  svg.addEventListener('pointerover', e => { const g = e.target.closest('.col'); if (g) show(Number(g.dataset.i), g.querySelector('.hit')); });
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('focusin', e => { const g = e.target.closest('.col'); if (g) show(Number(g.dataset.i), e.target); });
  svg.addEventListener('focusout', hide);
  box.replaceChildren(svg);
}

function renderModels(d) {
  const max = Math.max(...d.models.map(m => m.tokens), 1);
  $('models').replaceChildren(...d.models.map(m => el('tr', {},
    el('td', {}, el('div', { class: 'name' }, el('span', { text: m.model }), el('div', { class: 'share' }, el('i', { style: `width:${Math.max(2, m.tokens / max * 100)}%` })))),
    el('td', { class: 'r', text: tokens(m.tokens) }),
    el('td', { class: 'r' }, m.priced ? money(m.cost) : el('span', { class: 'unpriced', text: '无官方价格' })),
    el('td', { class: 'r', text: String(m.turns) }))));
}

const STATE = { completed: '完成', paused: '已停止', error: '出错' };
function renderSessions(d) {
  const open = new Set([...document.querySelectorAll('.sessions details[open]')].map(x => x.dataset.id));
  $('sessions').replaceChildren(...d.sessions.map(s => {
    const rows = s.items.map(t => el('tr', {},
      el('td', {}, el('span', { class: `state ${t.state}`, title: STATE[t.state] ?? t.state }), clock(t.end)),
      el('td', { text: shortModel(t.model), title: t.model || '' }),
      el('td', { class: 'r', text: `${t.calls} · ${t.tools}`, title: `模型调用 ${t.calls} 次，工具 ${t.tools} 次` }),
      el('td', { class: 'r', text: tokens(t.cacheRead) }),
      el('td', { class: 'r', text: tokens(t.input) }),
      el('td', { class: 'r', text: tokens(t.output) }),
      el('td', { class: 'r', text: t.priced ? money(t.cost) : '—' })));
    const table = el('table', { class: 'turns' },
      el('thead', {}, el('tr', {}, ...['结束', '模型', '调用·工具', '命中', '未命中', '输出', '≈ 费用'].map((h, i) => el('th', { class: i > 1 ? 'r' : null, text: h })))),
      el('tbody', {}, ...rows));
    const node = el('details', { 'data-id': s.id },
      el('summary', {}, el('span', { class: 't', text: s.title || '未命名会话', title: s.title || '' }), el('span', { class: 'm', text: `${s.turns} 轮 · ${tokens(s.tokens)}` }), el('span', { class: 'm', text: money(s.cost) })),
      table);
    if (open.has(s.id)) node.open = true;
    return node;
  }));
}

function render(d) {
  $('main').setAttribute('aria-busy', 'false');
  if (!d) { $('source').textContent = '暂时无法读取统计，请确认 Harness 正在运行。'; return; }
  if (d.range !== range) return;
  $('chart').classList.toggle('still', data?.range === d.range);
  data = d;
  const t = d.totals;
  $('source').replaceChildren(document.createTextNode(`来自 Harness 会话记录 · 已读取 ${d.scanned} 个会话`));
  if (d.preview) $('source').append(el('span', { class: 'tag', text: '预览 · 示例数据' }));
  $('chart-title').textContent = d.byHour ? '今天 · 按小时' : `最近 ${d.buckets.length} 天 · 按天`;
  $('k-tokens').textContent = tokens(t.tokens);
  $('k-tokens-sub').textContent = `输入 ${tokens(t.input + t.cacheRead)} · 输出 ${tokens(t.output)}`;
  $('k-cost').textContent = t.cost > 0 || !t.unpricedTokens ? `≈${money(t.cost)}` : '—';
  $('k-cost-sub').textContent = t.unpricedTokens ? `另有 ${tokens(t.unpricedTokens)} 无官方价格` : '按官方价格估算';
  $('k-cache').textContent = t.cacheRate == null ? '—' : `${t.cacheRate}%`;
  $('k-turns').textContent = String(t.turns);
  $('k-turns-sub').textContent = t.turns ? `完成 ${t.completed} · 其他 ${t.turns - t.completed}` : '';
  $('k-time').textContent = duration(t.ms);
  $('empty').hidden = t.turns > 0;
  renderChart(d); renderModels(d); renderSessions(d);
}

api.subscribe(render);
let resizeFrame;
addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { if (!data) return; $('chart').classList.add('still'); renderChart(data); }); });
load('today');
// 打开期间每分钟刷新一次。
setInterval(() => { if (document.visibilityState === 'visible') api.request(range); }, 60000);
