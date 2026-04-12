export function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tokei Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --bg: #f8f6f0; --fg: #111; --border: #222; --muted: #888; --accent: #000; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #1a1a1a; --fg: #e8e6dd; --border: #555; --muted: #999; --accent: #fff; }
  }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--fg);
    max-width: 600px; margin: 0 auto; padding: 16px;
  }
  h1 { font-size: 14px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase;
       border-bottom: 2px solid var(--fg); padding-bottom: 8px; margin-bottom: 16px; }
  .auth { margin-bottom: 16px; }
  .auth input { font-family: monospace; padding: 6px 10px; border: 1.5px solid var(--border);
                background: var(--bg); color: var(--fg); width: 100%; font-size: 13px; }
  .auth button { margin-top: 6px; padding: 6px 16px; background: var(--fg); color: var(--bg);
                 border: none; cursor: pointer; font-weight: 700; font-size: 13px; }
  #content { display: none; }
  .row { display: flex; gap: 12px; margin-bottom: 12px; }
  .card { flex: 1; border: 1.5px solid var(--border); padding: 12px; }
  .card .label { font-size: 10px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;
                 color: var(--muted); margin-bottom: 4px; }
  .card .big { font-size: 32px; font-weight: 900; letter-spacing: -1px; line-height: 1;
               font-variant-numeric: tabular-nums; }
  .card .sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .spark-row { display: flex; gap: 12px; margin-bottom: 12px; }
  .spark-card { flex: 1; border: 1.5px solid var(--border); padding: 12px; }
  .spark-card .title { font-size: 11px; font-weight: 700; letter-spacing: 1px; margin-bottom: 8px;
                       display: flex; justify-content: space-between; }
  .spark { display: flex; align-items: flex-end; gap: 2px; height: 40px; }
  .spark .bar { flex: 1; background: var(--fg); min-width: 0; transition: height 0.3s; }
  .spark .bar.zero { background: var(--border); opacity: 0.3; height: 1px !important; }
  .spark-labels { display: flex; gap: 2px; margin-top: 4px; }
  .spark-labels span { flex: 1; text-align: center; font-size: 8px; color: var(--muted); }
  .tools { margin-bottom: 12px; }
  .tool { border: 1.5px solid var(--border); padding: 10px 12px; margin-bottom: -1.5px; }
  .tool .tool-top { display: flex; justify-content: space-between; align-items: baseline; }
  .tool .tool-name { font-size: 13px; font-weight: 700; }
  .tool .tool-val { font-size: 20px; font-weight: 900; font-variant-numeric: tabular-nums; }
  .tool .tool-usd { font-size: 11px; color: var(--muted); }
  .tool .spark { height: 24px; margin-top: 6px; }
  .quote { border: 1.5px solid var(--border); padding: 14px;
           background: repeating-linear-gradient(135deg, transparent 0 6px, rgba(128,128,128,0.04) 6px 7px); }
  .quote .q-label { font-size: 9px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;
                    display: flex; justify-content: space-between; color: var(--muted); margin-bottom: 6px; }
  .quote .q-text { font-size: 14px; font-family: Georgia, serif; font-style: italic; line-height: 1.4;
                   text-align: center; margin: 8px 0; }
  .quote .q-attr { font-size: 11px; text-align: right; font-weight: 600; }
  .sync { font-size: 10px; color: var(--muted); text-align: right; margin-top: 8px; }
  .error { color: #c00; padding: 12px; border: 1.5px solid #c00; margin-bottom: 12px; font-size: 13px; }
</style>
</head>
<body>
<h1>Tokei</h1>

<div class="auth" id="auth">
  <input type="password" id="token" placeholder="Bearer token" autocomplete="off">
  <button onclick="doAuth()">Connect</button>
</div>

<div id="error" style="display:none" class="error"></div>
<div id="content">
  <div class="row">
    <div class="card">
      <div class="label">Today</div>
      <div class="big" id="today-tokens"></div>
      <div class="sub" id="today-usd"></div>
    </div>
    <div class="card">
      <div class="label">This Month</div>
      <div class="big" id="month-tokens"></div>
      <div class="sub" id="month-usd"></div>
    </div>
  </div>

  <div class="spark-row">
    <div class="spark-card">
      <div class="title"><span>7-Day Trend</span><span id="spark-avg"></span></div>
      <div class="spark" id="spark-global"></div>
      <div class="spark-labels" id="spark-labels"></div>
    </div>
  </div>

  <div class="tools" id="tools-today"></div>

  <div class="tools" id="tools-month" style="margin-top:4px"></div>

  <div class="quote" id="quote"></div>
  <div class="sync" id="sync"></div>
</div>

<script>
const NAMES = { claude_code: 'Claude Code', cursor: 'Cursor', codex: 'Codex', gemini: 'Gemini' }

function doAuth() {
  const t = document.getElementById('token').value.trim()
  if (!t) return
  sessionStorage.setItem('tokei_token', t)
  load(t)
}

function init() {
  const t = sessionStorage.getItem('tokei_token')
  if (t) { document.getElementById('auth').style.display = 'none'; load(t) }
}

async function load(token) {
  document.getElementById('error').style.display = 'none'
  try {
    const r = await fetch('/v1/summary', { headers: { Authorization: 'Bearer ' + token } })
    if (r.status === 401) { show('error', 'Invalid token'); return }
    if (!r.ok) { show('error', 'HTTP ' + r.status); return }
    const d = await r.json()
    document.getElementById('auth').style.display = 'none'
    document.getElementById('content').style.display = 'block'
    render(d)
  } catch (e) { show('error', e.message) }
}

function render(d) {
  document.getElementById('today-tokens').textContent = fmt(d.today.total_tokens)
  document.getElementById('today-usd').textContent = '$' + d.today.total_usd.toFixed(2)
  document.getElementById('month-tokens').textContent = fmt(d.month.total_tokens)
  document.getElementById('month-usd').textContent = '$' + d.month.total_usd.toFixed(2)

  const avg = d.sparkline_7d.reduce((a, b) => a + b, 0) / 7
  document.getElementById('spark-avg').textContent = 'avg ' + fmt(avg * 1000) + '/day'
  renderSpark('spark-global', d.sparkline_7d)
  renderSparkLabels('spark-labels', d.sync_ts)

  // Today tools
  const todayEl = document.getElementById('tools-today')
  todayEl.innerHTML = '<div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--muted);margin-bottom:4px">TODAY BY TOOL</div>'
  for (const t of d.today.tools) {
    const div = document.createElement('div')
    div.className = 'tool'
    div.innerHTML = '<div class="tool-top">' +
      '<span class="tool-name">' + (NAMES[t.name] || t.name) + '</span>' +
      '<span class="tool-val">' + fmt(t.tokens) + '</span>' +
      '</div>' +
      '<div class="tool-usd">$' + t.usd.toFixed(2) + '</div>' +
      '<div class="spark" id="spark-' + t.name + '"></div>'
    todayEl.appendChild(div)
    if (t.sparkline_7d) renderSpark('spark-' + t.name, t.sparkline_7d)
  }

  // Month tools
  const monthEl = document.getElementById('tools-month')
  if (d.month.tools && d.month.tools.length > 0) {
    monthEl.innerHTML = '<div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--muted);margin-bottom:4px">THIS MONTH BY TOOL</div>'
    for (const t of d.month.tools) {
      const div = document.createElement('div')
      div.className = 'tool'
      div.innerHTML = '<div class="tool-top">' +
        '<span class="tool-name">' + (NAMES[t.name] || t.name) + '</span>' +
        '<span class="tool-val">' + fmt(t.tokens) + '</span>' +
        '</div>' +
        '<div class="tool-usd">$' + t.usd.toFixed(2) + '</div>'
      monthEl.appendChild(div)
    }
  }

  const q = d.quote
  document.getElementById('quote').innerHTML =
    '<div class="q-label"><span>DAILY</span><span>' + q.category + '</span></div>' +
    '<div class="q-text">"' + esc(q.text) + '"</div>' +
    '<div class="q-attr">- ' + esc(q.attr) + '</div>'

  const ago = Math.floor(Date.now() / 1000) - d.sync_ts
  document.getElementById('sync').textContent = 'synced ' + fmtAge(ago) + ' ago'
}

function renderSpark(id, data) {
  const el = document.getElementById(id)
  if (!el) return
  const max = Math.max(...data, 1)
  el.innerHTML = data.map(v => {
    const h = v > 0 ? Math.max(2, (v / max) * 100) : 0
    return '<div class="bar' + (v === 0 ? ' zero' : '') + '" style="height:' + h + '%"></div>'
  }).join('')
}

function renderSparkLabels(id, syncTs) {
  const el = document.getElementById(id)
  if (!el) return
  const days = []
  const now = new Date(syncTs * 1000)
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 86400000)
    days.push(d.toLocaleDateString('en', { weekday: 'narrow' }))
  }
  el.innerHTML = days.map(d => '<span>' + d + '</span>').join('')
}

function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e8) return (n / 1e6).toFixed(0) + 'M'
  if (n >= 1e7) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k'
  return String(Math.round(n))
}

function fmtAge(s) {
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  return Math.floor(s / 3600) + 'h'
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML }
function show(id, msg) { const e = document.getElementById(id); e.textContent = msg; e.style.display = 'block' }

init()
</script>
</body>
</html>`
}
