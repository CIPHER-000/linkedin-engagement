#!/usr/bin/env node
/*
 * build-report.js — lightweight, zero-dependency report archival.
 *
 * Takes the working dashboard (audit.html), computes its headline metrics
 * straight from the embedded data, and:
 *   1. Writes an immutable snapshot to /reports/<date>/index.html
 *   2. Refreshes the root /index.html so it always serves the latest report
 *   3. Updates /reports/manifest.json (the index the archive page reads)
 *
 * Snapshots are never rewritten once created, so history stays immutable.
 * Output is 100% static — no backend, Vercel-friendly.
 *
 * Usage:
 *   node build-report.js                # archive using today's date
 *   node build-report.js 2026-06-13     # archive under a specific date
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MASTER = path.join(ROOT, 'audit.html');
const REPORTS_DIR = path.join(ROOT, 'reports');
const MANIFEST = path.join(REPORTS_DIR, 'manifest.json');
const MANIFEST_JS = path.join(REPORTS_DIR, 'manifest.js');

function today() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function formatShortDate(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function auditPeriodFor(reportDate) {
  const end = new Date(reportDate + 'T00:00:00');
  const start = new Date(end);
  start.setDate(start.getDate() - 13); // 14-day inclusive bi-weekly window
  const sameYear = start.getFullYear() === end.getFullYear();
  const startStr = formatShortDate(start);
  const endStr = formatShortDate(end) + (sameYear ? '' : `, ${end.getFullYear()}`);
  return `${startStr} – ${endStr}, ${start.getFullYear()}`;
}

const date = process.argv[2] || today();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`Invalid date "${date}". Expected YYYY-MM-DD.`);
  process.exit(1);
}

if (!fs.existsSync(MASTER)) {
  console.error('Could not find audit.html (the working dashboard).');
  process.exit(1);
}

const masterHtml = fs.readFileSync(MASTER, 'utf8');

/* ---- Extract the embedded dataset and recompute headline metrics ---- */
function extractArray(name) {
  const m = masterHtml.match(new RegExp('const\\s+' + name + '\\s*=\\s*(\\[[\\s\\S]*?\\]);'));
  if (!m) throw new Error(`Could not locate "${name}" in audit.html`);
  // eslint-disable-next-line no-new-func
  return Function('"use strict";return (' + m[1] + ');')();
}

function computeMetrics() {
  const members = extractArray('members');
  const posts = extractArray('posts');
  const fStart = posts.findIndex(p => p.n === 8);
  const cell = (mName, i) => {
    const p = posts[i];
    if (mName === 'Franklin' && i < fStart) return 'na';
    if (p.owner === mName) return 'owner';
    if (p.excused && p.excused.includes(mName)) return 'excused';
    if (p.engaged.includes(mName)) return 'engaged';
    return 'missed';
  };
  const stats = members.map(mName => {
    let e = 0, el = 0;
    posts.forEach((p, i) => {
      const s = cell(mName, i);
      if (s === 'owner' || s === 'na' || s === 'excused') return;
      el++; if (s === 'engaged') e++;
    });
    const pct = el ? (e / el) * 100 : 0;
    const tier = mName === 'Franklin' ? 'New Member' : pct >= 80 ? 'Core' : pct >= 50 ? 'Borderline' : 'At Risk';
    return { e, el, tier };
  });
  const totalE = stats.reduce((x, s) => x + s.e, 0);
  const totalOpp = stats.reduce((x, s) => x + s.el, 0);
  const overall = totalOpp ? (totalE / totalOpp) * 100 : 0;
  const status = overall < 55 ? 'Needs Intervention' : overall < 70 ? 'Watch' : 'Healthy';
  return {
    participation: +overall.toFixed(1),
    status,
    members: members.length,
    validPosts: posts.length,
  };
}

/* ---- Produce a self-contained report HTML carrying its own date ---- */
function makeReportHtml(reportDate) {
  const period = auditPeriodFor(reportDate);
  const config = `<script>window.__REPORT__={date:"${reportDate}",auditPeriod:"${period}"};<\/script>`;
  if (masterHtml.includes('<!-- REPORT_CONFIG -->')) {
    return masterHtml.replace('<!-- REPORT_CONFIG -->', config);
  }
  // Fallback: inject right after the <title> tag.
  return masterHtml.replace(/(<\/title>)/, `$1\n${config}`);
}

/* ---- Write snapshot (immutable) + refresh root ---- */
const reportHtml = makeReportHtml(date);
const snapshotDir = path.join(REPORTS_DIR, date);
fs.mkdirSync(snapshotDir, { recursive: true });
const snapshotFile = path.join(snapshotDir, 'index.html');

if (fs.existsSync(snapshotFile)) {
  console.warn(`! Snapshot for ${date} already exists — leaving it immutable, only refreshing root + manifest.`);
} else {
  fs.writeFileSync(snapshotFile, reportHtml);
  console.log(`+ Snapshot written: /reports/${date}/index.html`);
}

fs.writeFileSync(path.join(ROOT, 'index.html'), reportHtml);
console.log('+ Root refreshed: /index.html now serves the latest report');

/* ---- Update the manifest ---- */
const metrics = computeMetrics();
let manifest = { generator: 'linkedin-engagement-audit', latest: date, reports: [] };
if (fs.existsSync(MANIFEST)) {
  try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (_) {}
}
manifest.reports = (manifest.reports || []).filter(r => r.date !== date);
manifest.reports.push({
  date,
  path: `/reports/${date}/`,
  participation: metrics.participation,
  status: metrics.status,
  members: metrics.members,
  validPosts: metrics.validPosts,
  generatedAt: date,
});
manifest.reports.sort((a, b) => b.date.localeCompare(a.date));
manifest.latest = manifest.reports[0].date;
const manifestJson = JSON.stringify(manifest, null, 2);
fs.writeFileSync(MANIFEST, manifestJson + '\n');
fs.writeFileSync(
  MANIFEST_JS,
  '// Auto-generated by build-report.js. Mirrors manifest.json so the archive page\n' +
  '// can load report metadata via a <script> tag (works over file:// and HTTP).\n' +
  'window.__REPORT_MANIFEST__ = ' + manifestJson + ';\n'
);
console.log(`+ Manifest updated: ${manifest.reports.length} report(s), latest = ${manifest.latest} (manifest.json + manifest.js)`);

console.log('\nDone. Commit the new files and deploy — fully static, no backend required.');
