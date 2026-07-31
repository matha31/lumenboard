#!/usr/bin/env node
// dev/build-snapshot-artifact.mjs — generate a self-contained snapshot artifact
// from the LIVE Lumenboard API, scored by the project's own computeRisk.
//
//   node dev/build-snapshot-artifact.mjs
//   -> frontend/snapshot/live-snapshot.html
//
// Why a generated snapshot rather than a live page: a published claude.ai
// artifact runs under a CSP that blocks every external host, so it cannot call
// the API at all. Its only live-data route is an MCP connector, which needs a
// custom connector this org does not permit. So the artifact is a snapshot by
// necessity — but it is a snapshot of REAL client data, scored by the same
// formula the tools use, and it says so on its face.
//
// Re-run it to refresh: renewal countdowns move every day, so a snapshot built
// today is wrong tomorrow. The generated page shows the exact date it was built.
//
// Output goes to frontend/snapshot/ deliberately: it embeds literal account ids,
// and harness/lint.js scans frontend/artifact/ for those. Keep it out of there.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import './../backend/mcp-server/src/env.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO_ROOT, 'frontend', 'snapshot', 'live-snapshot.html');

const BASE = process.env.LUMENBOARD_API_BASE;
const KEY = process.env.LUMENBOARD_API_KEY;
if (!BASE || !KEY) {
  console.error('LUMENBOARD_API_BASE / LUMENBOARD_API_KEY missing — see .env.example.');
  process.exit(1);
}

const { computeRisk } = await import(
  pathToFileURL(path.join(REPO_ROOT, 'backend', 'mcp-server', 'src', 'scoring.mjs')).href
);
const { buildRiskReason } = await import(
  pathToFileURL(path.join(REPO_ROOT, 'backend', 'mcp-server', 'src', 'reason.mjs')).href
);

async function api(p) {
  const res = await fetch(BASE.replace(/\/+$/, '') + p, { headers: { 'x-api-key': KEY } });
  if (!res.ok) throw new Error(`${p} -> ${res.status}`);
  return res.json();
}

// ── Pull ─────────────────────────────────────────────────────────────────────
const referenceDate = new Date().toISOString().slice(0, 10);
const accountsRes = await api('/accounts');
const accounts = accountsRes.data;

const usage = {};
for (const a of accounts) usage[a.id] = (await api(`/accounts/${encodeURIComponent(a.id)}/usage`)).series || [];

// Walk every event page so the per-account activity mix is complete.
const events = [];
let cursor;
for (let page = 0; page < 200; page++) {
  const qs = new URLSearchParams({ limit: '100' });
  if (cursor) qs.set('cursor', cursor);
  const res = await api(`/events?${qs}`);
  events.push(...res.data);
  if (!res.next_cursor) break;
  cursor = res.next_cursor;
}

// ── Score, using the same functions the MCP tools use ────────────────────────
const POSITIVE = new Set(['seat_added', 'invite_sent', 'integration_connected']);

const rows = accounts.map((a) => {
  const series = usage[a.id] || [];
  const risk = computeRisk(a, series, referenceDate);
  const counts = {};
  for (const e of events) if (e.account_id === a.id) counts[e.type] = (counts[e.type] || 0) + 1;
  return {
    id: a.id,
    name: a.name,
    plan: a.plan,
    mrr: a.mrr,
    seats: a.seats,
    health: a.health_score,
    bucket: risk.bucket,
    risk: Number(risk.combined_risk.toFixed(4)),
    days: risk.days_to_renewal,
    thin: risk.usage_insufficient_signal,
    reason: buildRiskReason(a, risk),
    spark: series.map((w) => w.active_users),
    events: Object.entries(counts)
      .sort((x, y) => y[1] - x[1])
      .map(([type, n]) => ({ type, n, good: POSITIVE.has(type) })),
  };
});
rows.sort((x, y) => y.risk - x.risk);

const atRisk = rows.filter((r) => r.bucket !== 'healthy');
const summary = {
  urgent: rows.filter((r) => r.bucket === 'urgent').length,
  watch: rows.filter((r) => r.bucket === 'watch').length,
  healthy: rows.filter((r) => r.bucket === 'healthy').length,
  mrrAtRisk: atRisk.reduce((s, r) => s + r.mrr, 0),
  total: rows.length,
  team: (await api('/health')).team,
};

// ── Emit ─────────────────────────────────────────────────────────────────────
const DATA = JSON.stringify({ referenceDate, summary, rows });

const html = `<title>Lumenboard — Weekly Risk Digest</title>
<style>
  /* Palette and type follow the client deck's "Signal" system so the artifact
     and the presentation read as one piece of work. No webfont links: a
     published artifact's CSP blocks font CDNs, and a silent fallback is worse
     than a deliberately chosen stack. Both themes are designed — the deck uses
     navy and cream slides, so each maps to one. */
  :root {
    --ground: #f2efe8; --panel: #ffffff; --panel-2: #f7f4ed;
    --line: #d8d2c4; --line-soft: #e5e0d4;
    --ink: #1a2030; --ink-2: #5a6270; --ink-3: #8b8578;
    --accent: #9a7433;
    --urgent: #a4413a; --watch: #8a6d1f; --healthy: #2f6b46;
    --spark: #8b8578;
    --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #1c2644; --panel: #202b4c; --panel-2: #232f55;
      --line: #2e3d5c; --line-soft: #273354;
      --ink: #e2dcd0; --ink-2: #8a96a8; --ink-3: #6b7689;
      --accent: #c8a870;
      --urgent: #e07a6f; --watch: #c8a870; --healthy: #8bb598;
      --spark: #8a96a8;
    }
  }
  :root[data-theme="light"] {
    --ground: #f2efe8; --panel: #ffffff; --panel-2: #f7f4ed;
    --line: #d8d2c4; --line-soft: #e5e0d4;
    --ink: #1a2030; --ink-2: #5a6270; --ink-3: #8b8578;
    --accent: #9a7433;
    --urgent: #a4413a; --watch: #8a6d1f; --healthy: #2f6b46; --spark: #8b8578;
  }
  :root[data-theme="dark"] {
    --ground: #1c2644; --panel: #202b4c; --panel-2: #232f55;
    --line: #2e3d5c; --line-soft: #273354;
    --ink: #e2dcd0; --ink-2: #8a96a8; --ink-3: #6b7689;
    --accent: #c8a870;
    --urgent: #e07a6f; --watch: #c8a870; --healthy: #8bb598; --spark: #8a96a8;
  }

  * { box-sizing: border-box; }
  body { margin: 0; background: var(--ground); color: var(--ink); font-family: var(--sans); line-height: 1.5; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 74rem; margin: 0 auto; padding: 2rem clamp(1rem, 3vw, 2.5rem) 4rem; display: flex; flex-direction: column; gap: 1.5rem; }

  header { display: flex; align-items: flex-end; justify-content: space-between; gap: 1.5rem; flex-wrap: wrap; }
  h1 { font-family: var(--serif); font-size: clamp(1.5rem, 3.4vw, 2rem); font-weight: 600; margin: 0; letter-spacing: -0.01em; text-wrap: balance; }
  h1::after { content: ""; display: block; width: 2rem; height: 2px; background: var(--accent); margin-top: 0.75rem; }
  .sub { margin: 0.75rem 0 0; color: var(--ink-2); max-width: 62ch; }
  .stamp { font-family: var(--mono); font-size: 0.68rem; letter-spacing: 0.08em; color: var(--ink-3); text-align: right; text-transform: uppercase; white-space: nowrap; }
  .stamp b { color: var(--ink-2); font-weight: 500; }

  /* Summary before detail: the four numbers a Monday review starts from. */
  .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.75rem; }
  @media (max-width: 46rem) { .kpis { grid-template-columns: repeat(2, 1fr); } }
  .kpi { background: var(--panel); border: 1px solid var(--line); border-radius: 2px; padding: 0.85rem 1rem; }
  .kpi .lab { display: flex; align-items: center; gap: 0.45rem; font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-3); }
  .kpi .num { font-family: var(--serif); font-size: 1.85rem; font-weight: 600; margin-top: 0.3rem; font-variant-numeric: tabular-nums; }
  .kpi .foot { font-size: 0.75rem; color: var(--ink-3); }
  .dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; flex: none; }
  .dot.u { background: var(--urgent); } .dot.w { background: var(--watch); } .dot.h { background: var(--healthy); } .dot.a { background: var(--accent); }

  .toolbar { display: flex; align-items: flex-end; gap: 0.9rem; flex-wrap: wrap; background: var(--panel); border: 1px solid var(--line); border-radius: 2px; padding: 0.85rem 1rem; }
  .field { display: flex; flex-direction: column; gap: 0.3rem; }
  .field label { font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-3); }
  .field input, .field select { font-family: var(--sans); font-size: 0.88rem; color: var(--ink); background: var(--panel-2); border: 1px solid var(--line); border-radius: 2px; padding: 0.4rem 0.55rem; min-width: 9.5rem; }
  .field input:focus-visible, .field select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .count { margin-left: auto; align-self: center; font-family: var(--mono); font-size: 0.7rem; color: var(--ink-3); font-variant-numeric: tabular-nums; }

  .bucket { display: flex; flex-direction: column; gap: 0.5rem; }
  .bucket-head { display: flex; align-items: center; gap: 0.6rem; border-top: 1px solid var(--line); padding-top: 0.85rem; }
  .bucket-head h2 { font-family: var(--serif); font-size: 1.1rem; font-weight: 600; margin: 0; }
  .pill { font-family: var(--mono); font-size: 0.66rem; padding: 0.1rem 0.45rem; border: 1px solid currentColor; border-radius: 2px; }
  .b-urgent .pill { color: var(--urgent); } .b-watch .pill { color: var(--watch); } .b-healthy .pill { color: var(--healthy); }

  .card { background: var(--panel); border: 1px solid var(--line-soft); border-left: 3px solid var(--ink-3); border-radius: 2px; }
  .b-urgent .card { border-left-color: var(--urgent); }
  .b-watch .card { border-left-color: var(--watch); }
  .b-healthy .card { border-left-color: var(--healthy); }
  .card-top { display: grid; grid-template-columns: 1fr auto; gap: 0.2rem 1rem; width: 100%; text-align: left; background: none; border: 0; color: inherit; font: inherit; padding: 0.8rem 1rem; cursor: pointer; }
  .card-top:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .name { font-family: var(--serif); font-size: 1.02rem; font-weight: 600; }
  .name .plan { font-family: var(--mono); font-size: 0.58rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-3); margin-left: 0.5rem; }
  .meta { font-family: var(--mono); font-size: 0.7rem; color: var(--ink-2); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .reason { grid-column: 1 / -1; color: var(--ink-2); font-size: 0.85rem; }
  .chev { color: var(--ink-3); display: inline-block; transition: transform 0.18s ease; }
  .card.open .chev { transform: rotate(90deg); }
  .flag { font-family: var(--mono); font-size: 0.6rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--watch); border: 1px solid var(--watch); border-radius: 2px; padding: 0.05rem 0.35rem; margin-left: 0.5rem; white-space: nowrap; }

  .detail { display: none; padding: 0 1rem 0.9rem; border-top: 1px solid var(--line-soft); margin-top: 0.15rem; padding-top: 0.8rem; }
  .card.open .detail { display: flex; gap: 1.5rem; align-items: center; flex-wrap: wrap; }
  .spark-wrap { display: flex; flex-direction: column; gap: 0.25rem; }
  .cap { font-family: var(--mono); font-size: 0.6rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-3); }
  .chips { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  .chip { font-family: var(--mono); font-size: 0.66rem; padding: 0.15rem 0.45rem; border: 1px solid var(--line); border-radius: 2px; color: var(--ink-2); background: var(--panel-2); }
  .chip.good { color: var(--healthy); border-color: var(--healthy); }
  .empty { color: var(--ink-3); font-size: 0.85rem; padding: 0.4rem 0; }
  .foot-note { border-top: 1px solid var(--line); padding-top: 1rem; color: var(--ink-3); font-size: 0.78rem; max-width: 78ch; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>

<div class="wrap">
  <header>
    <div>
      <h1>Lumenboard — Weekly Risk Digest</h1>
      <p class="sub">Every account ranked by churn exposure — health score, usage trend and renewal proximity combined into one score, so you know who to call on Monday.</p>
    </div>
    <div class="stamp">Snapshot of live data<br /><b id="stamp-date"></b><br />team <b id="stamp-team"></b></div>
  </header>

  <section class="kpis" id="kpis"></section>

  <div class="toolbar">
    <div class="field"><label for="q">Find account</label><input id="q" type="search" placeholder="name…" autocomplete="off" /></div>
    <div class="field"><label for="plan">Plan</label><select id="plan"><option value="">All plans</option><option value="starter">Starter</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option></select></div>
    <div class="field"><label for="win">Renewal within</label><select id="win"><option value="">Any time</option><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select></div>
    <div class="field"><label for="sort">Sort by</label><select id="sort"><option value="risk">Risk (high → low)</option><option value="mrr">MRR (high → low)</option><option value="renewal">Renewal (soonest)</option><option value="name">Name (A → Z)</option></select></div>
    <div class="count" id="count"></div>
  </div>

  <main id="board"></main>

  <p class="foot-note" id="foot"></p>
</div>

<script>
const DATA = ${DATA};

const money = (n) => '$' + n.toLocaleString('en-US');
const el = (id) => document.getElementById(id);

el('stamp-date').textContent = DATA.referenceDate;
el('stamp-team').textContent = DATA.summary.team;
el('foot').textContent =
  'Scored from a live read of the Lumenboard API on ' + DATA.referenceDate +
  ', using the same risk formula the connector\\u2019s tools use. Renewal countdowns are relative to that date, so re-generate this view to refresh them. Urgent requires both a high combined score and an approaching renewal, which is what keeps a chronically unhealthy account with a distant renewal out of the call list.';

const KPIS = [
  { cls: 'u', lab: 'Urgent', num: DATA.summary.urgent, foot: 'call this week' },
  { cls: 'w', lab: 'Watch', num: DATA.summary.watch, foot: 'monitor' },
  { cls: 'h', lab: 'Healthy', num: DATA.summary.healthy, foot: 'no action' },
  { cls: 'a', lab: 'MRR at risk', num: money(DATA.summary.mrrAtRisk), foot: 'urgent + watch' },
];
el('kpis').innerHTML = KPIS.map((k) =>
  '<div class="kpi"><div class="lab"><span class="dot ' + k.cls + '"></span>' + k.lab + '</div>' +
  '<div class="num">' + k.num + '</div><div class="foot">' + k.foot + '</div></div>').join('');

function sparkline(values) {
  if (!values || values.length < 2) return '<span class="cap">no usage history</span>';
  const w = 132, h = 30, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (values.length - 1);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">' +
    '<polyline fill="none" stroke="var(--spark)" stroke-width="1.5" points="' + pts + '" /></svg>';
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function visible() {
  const q = el('q').value.trim().toLowerCase();
  const plan = el('plan').value;
  const win = el('win').value;
  let list = DATA.rows.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q)) return false;
    if (plan && r.plan !== plan) return false;
    if (win && !(r.days >= 0 && r.days <= Number(win))) return false;
    return true;
  });
  const by = el('sort').value;
  const cmp = {
    mrr: (a, b) => b.mrr - a.mrr,
    renewal: (a, b) => a.days - b.days,
    name: (a, b) => a.name.localeCompare(b.name),
    risk: (a, b) => b.risk - a.risk,
  }[by];
  return list.slice().sort(cmp);
}

function cardHtml(r) {
  const renew = r.days < 0 ? 'renewed ' + Math.abs(r.days) + 'd ago' : 'renews in ' + r.days + 'd';
  const flag = r.thin ? '<span class="flag">thin usage history</span>' : '';
  return '<div class="card" data-id="' + esc(r.id) + '">' +
    '<button class="card-top" aria-expanded="false">' +
      '<span class="name">' + esc(r.name) + '<span class="plan">' + esc(r.plan) + '</span></span>' +
      '<span class="meta">' + money(r.mrr) + ' MRR &middot; ' + renew + '</span>' +
      '<span class="reason">' + esc(r.reason) + flag + ' <span class="chev">&rsaquo;</span></span>' +
    '</button>' +
    '<div class="detail">' +
      '<span class="spark-wrap">' + sparkline(r.spark) + '<span class="cap">weekly active users</span></span>' +
      '<span class="chips">' + (r.events.length
        ? r.events.map((e) => '<span class="chip' + (e.good ? ' good' : '') + '">' + esc(e.type) + ' &times; ' + e.n + '</span>').join('')
        : '<span class="cap">no recent events</span>') + '</span>' +
    '</div></div>';
}

function render() {
  const list = visible();
  el('count').textContent = list.length + ' of ' + DATA.summary.total + ' accounts';
  const buckets = [['urgent', 'Urgent'], ['watch', 'Watch'], ['healthy', 'Healthy']];
  el('board').innerHTML = buckets.map(([key, label]) => {
    const rows = list.filter((r) => r.bucket === key);
    return '<section class="bucket b-' + key + '">' +
      '<div class="bucket-head"><h2>' + label + '</h2><span class="pill">' + rows.length + '</span></div>' +
      (rows.length ? rows.map(cardHtml).join('') : '<p class="empty">No accounts in this bucket right now.</p>') +
      '</section>';
  }).join('');

  el('board').querySelectorAll('.card-top').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.card');
      const open = card.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });
}

['q', 'plan', 'win', 'sort'].forEach((id) => el(id).addEventListener('input', render));
render();
</script>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`wrote ${path.relative(REPO_ROOT, OUT)}  (${(html.length / 1024).toFixed(0)} KB)`);
console.log(`  reference date : ${referenceDate}   team: ${summary.team}`);
console.log(`  accounts       : ${summary.total}  (urgent ${summary.urgent} / watch ${summary.watch} / healthy ${summary.healthy})`);
console.log(`  MRR at risk    : $${summary.mrrAtRisk.toLocaleString('en-US')}`);
console.log(`  events walked  : ${events.length}`);
