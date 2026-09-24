import { writeFileSync } from "node:fs";
import type { ReviewResult, ReviewIssue } from "./gate.js";
import type { PushResult } from "./publisher.js";
import type { DiffFile } from "./collector.js";
import { formatReport, type ReportView } from "./reviewer.js";

export type { ReportView } from "./reviewer.js";

export interface GateSummary {
  passed: boolean;
  blockers: ReviewIssue[];
  warnings: ReviewIssue[];
}

function escapeCell(text: string): string {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function severityCounts(issues: ReviewIssue[]): {
  blocker: number;
  warning: number;
  info: number;
} {
  const c = { blocker: 0, warning: 0, info: 0 };
  for (const i of issues) {
    if (i.severity === "blocker") c.blocker++;
    else if (i.severity === "warning") c.warning++;
    else c.info++;
  }
  return c;
}

/** 把评审结果 + 门禁判定（+ 可选推送结果）组装成 Markdown 报告文本 */
export function buildReviewMarkdown(
  result: ReviewResult,
  gate: GateSummary,
  pushes?: PushResult[]
): string {
  const counts = severityCounts(result.issues);
  const L: string[] = [];

  L.push("# AI 代码评审报告");
  L.push("");
  L.push(`> 由 **ai-review** 生成 · ${new Date().toISOString()}`);
  L.push("");
  L.push("## 总览");
  L.push("");
  L.push("| 项目 | 数值 |");
  L.push("|---|---|");
  L.push(`| 门禁结果 | ${gate.passed ? "✔ 通过" : "✖ 未通过（已拦截）"} |`);
  L.push(`| 评审文件数 | ${result.stats.filesReviewed} |`);
  L.push(`| 降级文件数 | ${result.stats.degradedCount} |`);
  L.push(`| 问题总数 | ${result.issues.length} |`);
  L.push(`| 🔴 blocker | ${counts.blocker} |`);
  L.push(`| 🟡 warning | ${counts.warning} |`);
  L.push(`| 🔵 info | ${counts.info} |`);
  L.push("");
  L.push(`**评审摘要**：`);
  L.push("");
  L.push(result.summary);

  if (pushes) {
    L.push("");
    L.push("## 目标推送");
    L.push("");
    L.push("| 目标 | 结果 | 详情 |");
    L.push("|---|---|---|");
    for (const p of pushes) {
      L.push(`| ${escapeCell(p.name)} | ${p.ok ? "✔ 成功" : "✖ 失败"} | ${escapeCell(p.message)} |`);
    }
    L.push("");
  }

  L.push("");
  L.push("## 问题明细");
  L.push("");
  if (result.issues.length === 0) {
    L.push("未发现问题。");
  } else {
    L.push("| 严重级别 | 位置 | 类别 | 问题 | 建议 |");
    L.push("|---|---|---|---|---|");
    for (const i of result.issues) {
      const loc = i.line ? `${i.file}:${i.line}` : i.file;
      L.push(
        `| ${i.severity} | \`${escapeCell(loc)}\` | ${escapeCell(i.category)} | ${escapeCell(i.message)} | ${escapeCell(i.suggestion ?? "-")} |`
      );
    }
  }
  L.push("");
  return L.join("\n");
}

/** 写报告到 outPath（默认 cwd/review-report.md），返回实际路径 */
export function writeReviewReport(
  result: ReviewResult,
  gate: GateSummary,
  opts: { outPath?: string; pushes?: PushResult[] } = {}
): string {
  const outPath = opts.outPath ?? "review-report.md";
  const md = buildReviewMarkdown(result, gate, opts.pushes);
  writeFileSync(outPath, md, "utf-8");
  return outPath;
}

function esc(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 转义后把 `code` 反引号片段转成 <code>，贴合参考模板的行内代码样式 */
function rich(text: string): string {
  return esc(text).replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** 参考模板样式（Vela 暖暗黑）。内联以保证报告 HTML 自包含、可离线打开 */
const REPORT_CSS = `
:root {
  --bg:#16120c; --surface:#1c1610; --surface-2:#221b14; --elevated:#2a221a;
  --border:rgba(255,196,148,.10); --border-strong:rgba(255,196,148,.20);
  --text:#f7f5f2; --muted:#b3a99d; --dim:#7a7164;
  --accent:#ff724c; --ok:#7adcc0; --warn:#ffd462; --block:#f05545; --info:#86b4ff;
  --accent-soft:rgba(255,114,76,.12); --ok-soft:rgba(122,220,192,.12);
  --warn-soft:rgba(255,212,98,.13); --block-soft:rgba(240,85,69,.13); --info-soft:rgba(134,180,255,.12);
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",Roboto,sans-serif;
}
* { box-sizing:border-box; }
html, body { margin:0; padding:0; background:var(--bg); color:var(--text); font-family:var(--sans); font-size:15px; line-height:1.6; -webkit-font-smoothing:antialiased; }
body {
  background:
    radial-gradient(1200px 600px at 80% -10%, rgba(255,114,76,.07), transparent 60%),
    radial-gradient(900px 500px at 0% 100%, rgba(122,220,192,.05), transparent 60%),
    var(--bg);
  background-attachment:fixed; min-height:100vh;
}
a { color:var(--info); text-decoration:none; }
a:hover { text-decoration:underline; }
.topbar { max-width:1320px; margin:0 auto; padding:22px 28px; display:flex; align-items:center; justify-content:space-between; gap:16px; border-bottom:1px solid var(--border); }
.brand { display:inline-flex; align-items:center; gap:10px; font-weight:700; letter-spacing:-.2px; font-size:15px; }
.brand-mark { width:22px; height:22px; border-radius:6px; background:linear-gradient(145deg,#ff9a71 0%,#ff724c 60%,#e95235 100%); box-shadow:0 0 12px rgba(255,112,69,.45), inset 0 1px 0 rgba(255,255,255,.3); position:relative; }
.brand-mark::before, .brand-mark::after { content:""; position:absolute; left:50%; transform:translateX(-50%); border-left:4px solid transparent; border-right:4px solid transparent; }
.brand-mark::before { top:4px; border-bottom:5px solid #1a130c; }
.brand-mark::after { bottom:4px; border-top:5px solid #1a130c; }
.crumbs { font-family:var(--mono); font-size:12.5px; color:var(--dim); display:flex; align-items:center; gap:8px; }
.crumbs .sep { opacity:.5; }
.crumbs .here { color:var(--muted); }
.back-link { font-size:13px; color:var(--muted); padding:6px 12px; border:1px solid var(--border); border-radius:8px; transition:all 150ms ease; }
.back-link:hover { color:var(--text); border-color:var(--border-strong); background:var(--surface); text-decoration:none; }
.main { max-width:1320px; margin:0 auto; padding:36px 28px 80px; }
.verdict { display:flex; align-items:center; gap:22px; padding:26px 28px; background:linear-gradient(180deg, rgba(122,220,192,.06), rgba(122,220,192,.02)); border:1px solid rgba(122,220,192,.22); border-radius:14px; position:relative; overflow:hidden; }
.verdict::before { content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--ok); box-shadow:0 0 18px rgba(122,220,192,.5); }
.verdict-icon { width:52px; height:52px; flex:0 0 auto; border-radius:50%; display:grid; place-items:center; background:var(--ok-soft); border:1px solid rgba(122,220,192,.4); }
.verdict-icon svg { width:26px; height:26px; stroke:var(--ok); }
.verdict-text { flex:1; min-width:0; }
.verdict-text h1 { margin:0 0 4px; font-size:26px; font-weight:700; letter-spacing:-.5px; }
.verdict-meta { margin:0; font-size:13.5px; color:var(--muted); font-family:var(--mono); }
.verdict-pill { flex:0 0 auto; align-self:flex-start; padding:6px 14px; border-radius:999px; font-size:12px; font-weight:700; letter-spacing:1.5px; color:var(--ok); background:var(--ok-soft); border:1px solid rgba(122,220,192,.35); }
/* 未通过态 */
.verdict.block { background:linear-gradient(180deg, rgba(240,85,69,.07), rgba(240,85,69,.02)); border-color:rgba(240,85,69,.24); }
.verdict.block::before { background:var(--block); box-shadow:0 0 18px rgba(240,85,69,.5); }
.verdict.block .verdict-icon { background:var(--block-soft); border-color:rgba(240,85,69,.42); }
.verdict.block .verdict-icon svg { stroke:var(--block); }
.verdict-pill.block { color:var(--block); background:var(--block-soft); border-color:rgba(240,85,69,.38); }
.summary { margin-top:18px; padding:18px 22px; background:var(--surface); border:1px solid var(--border); border-radius:12px; }
.summary h2 { margin:0 0 6px; font-size:12px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:var(--dim); }
.summary p { margin:0; color:var(--text); font-size:14.5px; white-space:pre-line; }
.stats { margin-top:26px; display:grid; grid-template-columns:repeat(6,1fr); gap:12px; }
.stat { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px 18px; position:relative; overflow:hidden; }
.stat .num { font-size:28px; font-weight:700; font-variant-numeric:tabular-nums; letter-spacing:-1px; line-height:1.1; }
.stat .lbl { margin-top:4px; font-size:12px; color:var(--dim); letter-spacing:.2px; }
.stat .bar { position:absolute; left:0; top:0; bottom:0; width:2px; background:transparent; }
.stat.n-red .num { color:var(--block); } .stat.n-red .bar { background:var(--block); }
.stat.n-yellow .num { color:var(--warn); } .stat.n-yellow .bar { background:var(--warn); }
.stat.n-green .num { color:var(--ok); } .stat.n-green .bar { background:var(--ok); }
.section-head { margin:40px 0 16px; display:flex; align-items:baseline; justify-content:space-between; }
.section-head h2 { margin:0; font-size:18px; font-weight:700; letter-spacing:-.3px; }
.section-head .count { font-family:var(--mono); font-size:12.5px; color:var(--dim); }
.issue { background:var(--surface); border:1px solid var(--border); border-radius:12px; margin-bottom:14px; overflow:hidden; transition:border-color 160ms ease, transform 160ms ease; }
.issue:hover { border-color:var(--border-strong); }
.issue-body { padding:18px 22px 20px; border-left:3px solid transparent; }
.issue.info .issue-body { border-left-color:var(--info); }
.issue.warning .issue-body { border-left-color:var(--warn); }
.issue.blocker .issue-body { border-left-color:var(--block); }
.issue-head { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-bottom:10px; }
.sev { display:inline-flex; align-items:center; gap:6px; padding:2px 10px; border-radius:999px; font-size:11px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; }
.sev::before { content:""; width:6px; height:6px; border-radius:50%; background:currentColor; box-shadow:0 0 6px currentColor; }
.sev.info { color:var(--info); background:var(--info-soft); }
.sev.warning { color:var(--warn); background:var(--warn-soft); }
.sev.blocker { color:var(--block); background:var(--block-soft); }
.loc { font-family:var(--mono); font-size:12.5px; color:var(--accent); background:var(--accent-soft); padding:2px 8px; border-radius:6px; }
.cat { font-size:12px; color:var(--muted); padding:2px 8px; border:1px solid var(--border); border-radius:6px; }
.issue-problem { margin:0; font-size:14.5px; color:var(--text); line-height:1.65; }
.suggestion { margin-top:12px; padding:12px 14px; background:var(--surface-2); border-radius:8px; border-left:2px solid var(--dim); }
.suggestion .tag { display:inline-block; font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--dim); margin-bottom:4px; }
.suggestion p { margin:0; font-size:13.5px; color:var(--muted); }
code { font-family:var(--mono); font-size:.92em; }
.empty { padding:60px 20px; text-align:center; color:var(--dim); }
.pushes { margin-top:18px; padding:18px 22px; background:var(--surface); border:1px solid var(--border); border-radius:12px; }
.pushes h2 { margin:0 0 10px; font-size:12px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:var(--dim); }
.pushes .row { display:flex; gap:10px; align-items:baseline; font-family:var(--mono); font-size:13px; padding:3px 0; }
.pushes .ok { color:var(--ok); } .pushes .bad { color:var(--block); }
.footer { margin-top:50px; padding-top:20px; border-top:1px solid var(--border); font-size:12px; color:var(--dim); display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; }
/* 左右分栏布局 */
.split { display:grid; grid-template-columns:4fr 6fr; gap:24px; align-items:start; margin-top:8px; }
.split-left, .split-right { min-width:0; }
.diff-panel { position:sticky; top:20px; max-height:calc(100vh - 40px); overflow:auto; background:var(--surface); border:1px solid var(--border); border-radius:12px; }
.diff-panel-head { padding:14px 18px; border-bottom:1px solid var(--border); display:flex; align-items:baseline; justify-content:space-between; background:var(--surface-2); border-radius:12px 12px 0 0; }
.diff-panel-head h2 { margin:0; font-size:14px; font-weight:700; }
.diff-panel-head .count { font-family:var(--mono); font-size:12px; color:var(--dim); }
.diff-file { border-bottom:1px solid var(--border); }
.diff-file:last-child { border-bottom:none; }
.diff-file-head { display:flex; align-items:center; gap:10px; padding:8px 14px; font-family:var(--mono); font-size:12.5px; color:var(--accent); background:var(--surface-2); }
.diff-file-head .badge { color:var(--dim); font-size:11px; }
.diff-hunk-head { padding:4px 14px; font-family:var(--mono); font-size:11px; color:var(--dim); background:rgba(255,196,148,.04); }
.diff-line { display:flex; align-items:flex-start; font-family:var(--mono); font-size:12.5px; line-height:1.55; }
.diff-line .gutter { flex:0 0 42px; padding:0 6px; text-align:right; color:var(--dim); background:var(--surface-2); user-select:none; border-right:1px solid var(--border); }
.diff-line .content { flex:1; padding:0 10px; white-space:pre-wrap; word-break:break-word; min-width:0; }
.diff-line.add { background:rgba(122,220,192,.09); }
.diff-line.add .content { color:var(--ok); }
.diff-line.del { background:rgba(240,85,69,.09); }
.diff-line.del .content { color:var(--block); }
.diff-line.ctx .content { color:var(--muted); }
.diff-line.target { animation:flash 1.4s ease-out; box-shadow:inset 3px 0 0 var(--warn); }
@keyframes flash { 0%{background:rgba(255,212,98,.35);} 100%{background:transparent;} }
.diff-empty { padding:32px 20px; text-align:center; color:var(--dim); font-size:13px; }
.issue { cursor:pointer; }
.issue[data-file]:focus { outline:none; border-color:var(--accent); }
@media (max-width:980px) { .split { grid-template-columns:1fr; } .diff-panel { position:static; max-height:none; } }
@media (max-width:860px) { .stats { grid-template-columns:repeat(3,1fr); } }
@media (max-width:560px) {
  .topbar { flex-wrap:wrap; padding:16px 18px; } .crumbs { order:3; width:100%; }
  .main { padding:24px 18px 60px; }
  .verdict { flex-direction:column; align-items:flex-start; gap:14px; padding:20px; }
  .stats { grid-template-columns:repeat(2,1fr); } .stat .num { font-size:24px; }
  .issue-body { padding:14px 16px 16px; }
}
`;

/** 顶栏面包屑：repo / ref / report（缺失项自动省略） */
function crumbs(v: ReportView): string {
  const parts: string[] = [];
  if (v.repo) parts.push(`<span>${esc(v.repo)}</span>`);
  if (v.ref) parts.push(`<span>${esc(v.ref)}</span>`);
  parts.push(`<span class="here">report</span>`);
  return parts.join(`<span class="sep">/</span>`);
}

/** 问题区标题右侧的统计文案 */
function countText(v: ReportView): string {
  if (!v.total) return "0 条";
  const parts: string[] = [];
  if (v.counts.blocker) parts.push(`${v.counts.blocker} blocker`);
  if (v.counts.warning) parts.push(`${v.counts.warning} warning`);
  if (v.counts.info) parts.push(`${v.counts.info} info`);
  return `${v.total} 条 · ${parts.join(" / ")}`;
}

function statCards(v: ReportView): string {
  const cards: [number, string, string][] = [
    [v.filesReviewed, "评审文件", ""],
    [v.degradedCount, "降级文件", ""],
    [v.total, "问题总数", ""],
    [v.counts.blocker, "blocker", "n-red"],
    [v.counts.warning, "warning", "n-yellow"],
    [v.counts.info, "info", "n-green"],
  ];
  return cards
    .map(
      ([num, lbl, cls]) =>
        `<div class="stat ${cls}"><div class="num">${num}</div><div class="lbl">${lbl}</div><div class="bar"></div></div>`
    )
    .join("\n    ");
}

function issueList(v: ReportView): string {
  if (!v.issues.length) return `<div class="empty">未发现问题。</div>`;
  return v.issues
    .map(
      (i) => `<article class="issue ${i.severity}" data-file="${esc(i.file)}" data-line-start="${i.lineStart}" data-line-end="${i.lineEnd}" tabindex="0">
    <div class="issue-body">
      <div class="issue-head">
        <span class="sev ${i.severity}">${esc(i.severity)}</span>
        <code class="loc">${esc(i.loc)}</code>
        <span class="cat">${esc(i.category)}</span>
      </div>
      <p class="issue-problem">${rich(i.message)}</p>
      ${
        i.suggestion
          ? `<div class="suggestion">
        <span class="tag">建议</span>
        <p>${rich(i.suggestion)}</p>
      </div>`
          : ""
      }
    </div>
  </article>`
    )
    .join("\n\n  ");
}

/** 右侧 diff 面板：按文件渲染 hunks，新增绿、删除红、上下文灰，行号对应 AI 报告行号 */
function diffPanel(v: ReportView): string {
  if (!v.diffFiles || !v.diffFiles.length) {
    return `<div class="diff-empty">无代码变更数据。</div>`;
  }
  return v.diffFiles
    .map((f) => {
      let addCount = 0;
      let delCount = 0;
      const body = f.hunks
        .map((h) => {
          const head = `<div class="diff-hunk-head">@@ -${h.oldStart},${h.oldEnd - h.oldStart + 1} +${h.newStart},${h.newEnd - h.newStart + 1} @@</div>`;
          const lines = h.lines
            .map((l) => {
              if (l.type === "add") addCount++;
              else if (l.type === "del") delCount++;
              const oldG = l.oldNo !== undefined ? String(l.oldNo) : "";
              const newG = l.newNo !== undefined ? String(l.newNo) : "";
              // 仅 add/ctx 行带 data-line（newNo），供左侧问题联动定位；del 行无 newNo 不参与
              const dataLine =
                l.newNo !== undefined
                  ? ` data-file="${esc(f.path)}" data-line="${l.newNo}"`
                  : "";
              return `      <div class="diff-line ${l.type}"${dataLine}>
        <span class="gutter">${oldG}</span>
        <span class="gutter">${newG}</span>
        <code class="content">${esc(l.text)}</code>
      </div>`;
            })
            .join("\n");
          return `    ${head}\n${lines}`;
        })
        .join("\n");
      return `  <div class="diff-file">
    <div class="diff-file-head">
      <span>${esc(f.path)}</span>
      <span class="badge">+${addCount} / -${delCount}</span>
    </div>
${body}
  </div>`;
    })
    .join("\n");
}

function pushSection(v: ReportView): string {
  if (!v.pushes || !v.pushes.length) return "";
  const rows = v.pushes
    .map(
      (p) =>
        `<div class="row"><span class="${p.ok ? "ok" : "bad"}">${p.ok ? "✔" : "✖"} ${esc(
          p.name
        )}</span><span>${esc(p.message)}</span></div>`
    )
    .join("\n    ");
  return `<section class="pushes">
    <h2>目标推送</h2>
    ${rows}
  </section>`;
}

/** 把评审视图模型注入参考 HTML 模板（自包含单文件） */
export function renderTemplate(v: ReportView): string {
  const passIcon = `<polyline points="4 12 10 18 20 6"></polyline>`;
  const blockIcon = `<line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line>`;
  const rules = v.categories.length ? v.categories.join(" · ") : "default";
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#16120c" />
<title>AI 代码评审报告 · ai-review</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%23ff724c'/%3E%3Cpath d='M7 8l5 5 5-5' stroke='%231a130c' stroke-width='2.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E" />
<style>${REPORT_CSS}</style>
</head>
<body>

<header class="topbar">
  <div class="brand">
    <span class="brand-mark" aria-hidden="true"></span>
    <span>ai-review</span>
  </div>
  <nav class="crumbs" aria-label="breadcrumb">${crumbs(v)}</nav>
  <a class="back-link" href="/">&larr; 全部报告</a>
</header>

<main class="main">

  <section class="verdict ${v.passed ? "" : "block"}" aria-label="评审结论">
    <div class="verdict-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        ${v.passed ? passIcon : blockIcon}
      </svg>
    </div>
    <div class="verdict-text">
      <h1>${v.passed ? "评审通过" : "评审未通过"}</h1>
      <p class="verdict-meta">${esc(v.generatedAt)} · 由 ai-review 自动生成 · ${v.filesReviewed} 个文件参与评审${
        v.passed ? "" : ` · ${v.counts.blocker} 个阻塞级问题已拦截`
      }</p>
    </div>
    <span class="verdict-pill ${v.passed ? "" : "block"}">${v.passed ? "PASS" : "BLOCK"}</span>
  </section>

  <section class="summary" aria-label="评审摘要">
    <h2>评审摘要</h2>
    <p>${esc(v.summary)}</p>
  </section>

  <section class="stats" aria-label="评审指标">
    ${statCards(v)}
  </section>

  ${pushSection(v)}

  <div class="split">
    <section class="split-left">
      <div class="section-head">
        <h2>问题明细</h2>
        <span class="count">${countText(v)}</span>
      </div>
      ${issueList(v)}
    </section>
    <section class="split-right diff-panel">
      <div class="diff-panel-head">
        <h2>代码变更</h2>
        <span class="count">${v.diffFiles?.length ?? 0} 个文件</span>
      </div>
      ${diffPanel(v)}
    </section>
  </div>

  <footer class="footer">
    <span>ai-review · AI 代码评审工作流</span>
    <span>规则集：${esc(rules)}</span>
  </footer>

</main>
<script>
(function(){
  var issues = document.querySelectorAll('.issue[data-file]');
  var panel = document.querySelector('.diff-panel');
  if(!issues.length || !panel) return;
  issues.forEach(function(el){
    el.addEventListener('click', function(){
      var file = el.getAttribute('data-file');
      var ls = parseInt(el.getAttribute('data-line-start'),10) || 0;
      var le = parseInt(el.getAttribute('data-line-end'),10) || ls;
      if(!ls) return;
      var lines = panel.querySelectorAll('.diff-line[data-line]');
      lines.forEach(function(l){ l.classList.remove('target'); });
      var hit = null;
      lines.forEach(function(l){
        if(hit) return;
        if(l.getAttribute('data-file') !== file) return;
        var n = parseInt(l.getAttribute('data-line'),10);
        if(n >= ls && n <= le) hit = l;
      });
      if(hit){
        hit.classList.add('target');
        hit.scrollIntoView({behavior:'smooth', block:'center'});
      }
    });
  });
})();
</script>
</body>
</html>`;
}

/** 组装报告视图模型（落盘为 JSON，由报告服务按需渲染成 HTML） */
export function buildReportView(
  result: ReviewResult,
  files: DiffFile[],
  gate: GateSummary,
  pushes?: PushResult[],
  meta?: { repo?: string; ref?: string }
): ReportView {
  return formatReport(result, files, gate, { ...meta, pushes });
}