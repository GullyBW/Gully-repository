'use strict';
// Architecture Compliance Dashboard — a self-contained, zero-dependency static HTML
// page (inline CSS/SVG, no external assets, theme-aware). Renders the assurance
// results for engineers, auditors, governance boards, and executives.
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function pct(n) { return `${n}%`; }
function bar(label, value, total) {
  const p = total ? Math.round((value / total) * 100) : 0;
  const cls = p === 100 ? 'ok' : p >= 80 ? 'warn' : 'bad';
  return `<div class="row"><span class="lbl">${esc(label)}</span><span class="track"><span class="fill ${cls}" style="width:${p}%"></span></span><span class="val">${value}/${total} (${p}%)</span></div>`;
}
function chip(label, ok) { return `<span class="chip ${ok ? 'ok' : 'bad'}">${esc(label)}: ${ok ? 'PASS' : 'FAIL'}</span>`; }

function sparkline(history, pick) {
  if (!history.length) return '<em>no history yet</em>';
  const vals = history.map(pick);
  const w = 220, h = 40, max = 100, min = 0;
  const step = vals.length > 1 ? w / (vals.length - 1) : 0;
  const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / (max - min)) * h).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="trend"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
}

function renderDashboard(A, history = []) {
  const compliancePct = A.summary.fitnessTotal ? Math.round((A.summary.fitnessPassed / A.summary.fitnessTotal) * 100) : 0;
  const heat = A.verification.map((v) => `<td class="cell ${v.pass ? 'ok' : 'bad'}" title="${esc(v.id)}">${v.severity[0].toUpperCase()}</td>`).join('');
  const sims = A.adversarial.map((s) => `<span class="dot ${s.pass ? 'ok' : 'bad'}" title="${esc(s.id)}"></span>`).join('');
  const frameworks = A.compliance.frameworkSummary.map((f) => bar(f.framework, f.controlsEvidenced, f.controlsMapped)).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NJTIP Twin — Architecture Compliance Dashboard</title>
<style>
:root{--bg:#fff;--fg:#111;--mut:#666;--card:#f6f7f9;--ok:#1e874b;--warn:#b8860b;--bad:#c0392b;--line:#e3e6ea}
@media(prefers-color-scheme:dark){:root{--bg:#0f1216;--fg:#e8eaed;--mut:#9aa0a6;--card:#171b21;--line:#2a2f36}}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
.wrap{max-width:1000px;margin:0 auto;padding:24px}
.banner{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px;color:var(--mut);font-size:13px}
h1{font-size:20px;margin:16px 0 4px}h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid var(--line);padding-bottom:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px}
.big{font-size:26px;font-weight:700}.mut{color:var(--mut);font-size:12px}
.row{display:flex;align-items:center;gap:10px;margin:6px 0}.lbl{flex:0 0 160px}.val{flex:0 0 130px;text-align:right;font-variant-numeric:tabular-nums}
.track{flex:1;height:10px;background:var(--line);border-radius:6px;overflow:hidden}.fill{display:block;height:100%}
.fill.ok{background:var(--ok)}.fill.warn{background:var(--warn)}.fill.bad{background:var(--bad)}
.chip{display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;margin:2px;color:#fff}.chip.ok{background:var(--ok)}.chip.bad{background:var(--bad)}
table{border-collapse:collapse}.cell{width:20px;height:20px;text-align:center;color:#fff;font-size:11px;border:1px solid var(--bg)}.cell.ok{background:var(--ok)}.cell.bad{background:var(--bad)}
.dot{display:inline-block;width:11px;height:11px;border-radius:50%;margin:2px}.dot.ok{background:var(--ok)}.dot.bad{background:var(--bad)}
code{background:var(--line);padding:1px 5px;border-radius:4px;font-size:12px}
</style></head><body><div class="wrap">
<div class="banner"><b>SYNTHETIC DATA ONLY.</b> Engineering evidence for human review — <b>not a production go-live approval</b>. Legal, constitutional, judicial, governance, and ethical decisions remain human.</div>
<h1>Architecture Compliance Dashboard</h1>
<div class="mut">Twin v${esc(A.version)} · digest <code>${esc(A.digest.slice(0, 16))}…</code> · generated ${esc(A.generatedAt || '')}</div>
<h2>Scorecards</h2>
<div class="grid">
  <div class="card"><div class="big">${compliancePct}%</div><div class="mut">Architecture compliance (${A.summary.fitnessPassed}/${A.summary.fitnessTotal})</div></div>
  <div class="card"><div class="big">${pct(A.traceability.coverage.percentEnforced)}</div><div class="mut">Requirements enforced (cov ${A.traceability.coverage.percentCovered}%)</div></div>
  <div class="card"><div class="big">${A.summary.adversarialResisted}/${A.summary.adversarialTotal}</div><div class="mut">Adversarial resisted</div></div>
  <div class="card"><div class="big">${A.summary.chaosPassed}/${A.summary.chaosTotal}</div><div class="mut">Chaos experiments</div></div>
  <div class="card"><div class="big">${A.summary.formalPassed}/${A.summary.formalTotal}</div><div class="mut">Formal proofs</div></div>
  <div class="card"><div class="big">L${A.maturity.achievedLevel}</div><div class="mut">Maturity (cap ${A.maturity.automatedCap}; 7–10 human)</div></div>
</div>
<h2>Posture</h2>
<div>${chip('Security', A.summary.adversarialResisted === A.summary.adversarialTotal)} ${chip('Privacy', A.verification.filter((v) => /IDENTITY|ENCRYPTION/.test(v.id)).every((v) => v.pass))} ${chip('Governance', A.verification.filter((v) => /GOVERNANCE|AUDIT|EMERGENCY/.test(v.id)).every((v) => v.pass))} ${chip('Drift-free', !A.drift.drift)}</div>
<h2>Fitness heat map (O=ok, C/H severity)</h2>
<table><tr>${heat}</tr></table>
<div class="mut">${A.verification.filter((v) => !v.pass).length ? 'Failed: ' + A.verification.filter((v) => !v.pass).map((v) => esc(v.id)).join(', ') : 'No failed fitness functions.'}</div>
<h2>Adversarial simulation outcomes (${A.summary.adversarialResisted}/${A.summary.adversarialTotal})</h2><div>${sims}</div>
<h2>Compliance framework coverage (illustrative)</h2>${frameworks}
<h2>CI/CD verification history — requirements-enforced trend</h2><div style="color:var(--ok)">${sparkline(history, (h) => h.percentEnforced || 0)}</div>
<div class="mut">${history.length} run(s) recorded.</div>
<h2>Evidence status</h2>
<div class="card mut">Digest <code>${esc(A.digest)}</code><br>Signature (Ed25519, synthetic): <code>${esc((A.signature || '').slice(0, 32))}…</code><br>Archive integrity: <b>${A.archiveOk ? 'VERIFIED' : 'n/a'}</b> · Timestamp seq: ${A.timestampSeq != null ? A.timestampSeq : 'n/a'}</div>
</div></body></html>`;
}

module.exports = { renderDashboard };
