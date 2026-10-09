import { writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReviewResult, ReviewIssue } from "./gate.js";
import type { PushResult } from "./publisher.js";
import type { DiffFile } from "./collector.js";
import type { TargetRemote } from "./config.js";
import { formatReport, type ReportView, type RepoTreeNode } from "./reviewer.js";
import { getRemoteUrl, parseGithubRemote, currentBranch } from "./git.js";

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
    L.push("| 严重级别 | 位置 | 类别 | 问题 | INFO |");
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
  /* ===== ai-pipeline 标准变量（亮色） ===== */
  --paper:#f8fafc; --paper-2:#f1f5f9;
  --ink:#0f172a; --ink-soft:#334155; --copy:#334155;
  --muted:#64748b; --muted-2:#94a3b8;
  --glass-line:#e2e8f0; --glass-line-strong:#cbd5e1;
  --glass-fill:#ffffff; --glass-fill-soft:#ffffff;
  --led:#4f46e5; --led-soft:rgba(79,70,229,.10); --led-glow:rgba(79,70,229,.30);
  --ok:#10b981; --block:#ef4444; --amber:#f59e0b;
  --amber-soft:rgba(245,158,11,.12); --amber-line:rgba(245,158,11,.35);
  --teal:#10b981; --teal-soft:rgba(16,185,129,.12); --teal-line:rgba(16,185,129,.35);
  --purple:#8b5cf6; --purple-soft:rgba(139,92,246,.12); --purple-line:rgba(139,92,246,.35);
  --info:#3b82f6; --info-soft:rgba(59,130,246,.10);
  --radius:10px; --radius-card:16px; --radius-pill:999px;
  --font-sans:"Inter","PingFang SC",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;

  /* ===== 评审页旧变量名（别名，指向标准变量） ===== */
  --bg:var(--paper);
  --surface:var(--glass-fill);
  --surface-2:var(--paper-2);
  --elevated:var(--glass-fill-soft);
  --border:var(--glass-line);
  --border-strong:var(--glass-line-strong);
  --text:var(--ink);
  --dim:var(--muted-2);
  --accent:var(--led);
  --accent-soft:var(--led-soft);
  --warn:var(--amber);
  --warn-soft:var(--amber-soft);
  --ok-soft:rgba(16,185,129,.10);
  --block-soft:rgba(239,68,68,.10);
  --flash:rgba(245,158,11,.30);
  --ok-line:rgba(16,185,129,.25); --ok-line-strong:rgba(16,185,129,.4);
  --ok-glow:rgba(16,185,129,.45); --ok-grad-1:rgba(16,185,129,.08); --ok-grad-2:rgba(16,185,129,.02);
  --block-line:rgba(239,68,68,.26); --block-line-strong:rgba(239,68,68,.42);
  --block-glow:rgba(239,68,68,.45); --block-grad-1:rgba(239,68,68,.08); --block-grad-2:rgba(239,68,68,.02);
  --diff-hunk-bg:rgba(15,23,42,.04);
  --btn-grad-1:rgba(79,70,229,.12); --btn-grad-2:rgba(79,70,229,.05);
  --btn-grad-hover-1:rgba(79,70,229,.20); --btn-grad-hover-2:rgba(79,70,229,.10);
  --sans:var(--font-sans);
  --mono:var(--font-mono);
}
/* 暗色主题 */
[data-theme="dark"] {
  /* ===== ai-pipeline 标准变量（暗色） ===== */
  --paper:#0f172a; --paper-2:#1e293b;
  --ink:#f1f5f9; --ink-soft:#cbd5e1; --copy:#cbd5e1;
  --muted:#94a3b8; --muted-2:#64748b;
  --glass-line:rgba(148,163,184,.15); --glass-line-strong:rgba(148,163,184,.25);
  --glass-fill:#1e293b; --glass-fill-soft:#1e293b;
  --led:#818cf8; --led-soft:rgba(129,140,248,.14); --led-glow:rgba(129,140,248,.30);
  --ok:#34d399; --block:#f87171; --amber:#fbbf24;
  --amber-soft:rgba(251,191,36,.14); --amber-line:rgba(251,191,36,.35);
  --teal:#34d399; --teal-soft:rgba(52,211,153,.14); --teal-line:rgba(52,211,153,.35);
  --purple:#a78bfa; --purple-soft:rgba(167,139,250,.14); --purple-line:rgba(167,139,250,.35);
  --info:#60a5fa; --info-soft:rgba(96,165,250,.14);

  /* ===== 评审页旧变量名（别名） ===== */
  --bg:var(--paper);
  --surface:var(--glass-fill);
  --surface-2:var(--paper-2);
  --elevated:var(--glass-fill-soft);
  --border:var(--glass-line);
  --border-strong:var(--glass-line-strong);
  --text:var(--ink);
  --dim:var(--muted-2);
  --accent:var(--led);
  --accent-soft:var(--led-soft);
  --warn:var(--amber);
  --warn-soft:var(--amber-soft);
  --ok-soft:rgba(52,211,153,.14);
  --block-soft:rgba(248,113,113,.15);
  --flash:rgba(251,191,36,.35);
  --ok-line:rgba(52,211,153,.25); --ok-line-strong:rgba(52,211,153,.45);
  --ok-glow:rgba(52,211,153,.5); --ok-grad-1:rgba(52,211,153,.08); --ok-grad-2:rgba(52,211,153,.02);
  --block-line:rgba(248,113,113,.28); --block-line-strong:rgba(248,113,113,.45);
  --block-glow:rgba(248,113,113,.5); --block-grad-1:rgba(248,113,113,.09); --block-grad-2:rgba(248,113,113,.02);
  --diff-hunk-bg:rgba(148,163,184,.06);
  --btn-grad-1:rgba(129,140,248,.22); --btn-grad-2:rgba(129,140,248,.08);
  --btn-grad-hover-1:rgba(129,140,248,.32); --btn-grad-hover-2:rgba(129,140,248,.14);
}
.theme-toggle { appearance:none; background:var(--surface); border:1px solid var(--border); color:var(--muted); width:30px; height:30px; border-radius:8px; display:inline-grid; place-items:center; cursor:pointer; transition:all 150ms ease; padding:0; }
.theme-toggle:hover { color:var(--text); border-color:var(--border-strong); }
.theme-toggle svg { width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.theme-toggle .icon-sun { display:none; }
[data-theme="dark"] .theme-toggle .icon-sun { display:block; }
[data-theme="dark"] .theme-toggle .icon-moon { display:none; }
* { box-sizing:border-box; }
html, body { margin:0; padding:0; background:var(--bg); color:var(--text); font-family:var(--sans); font-size:14px; line-height:20px; -webkit-font-smoothing:antialiased; text-rendering:geometricPrecision; }
body { background:var(--bg); min-height:100vh; }
a { color:var(--info); text-decoration:none; }
a:hover { text-decoration:underline; }
/* 顶栏：与管线页风格一致（纯白底 + 细边框 + LED 圆点 + 三级标题） */
.topbar { width:100%; padding:14px 28px; display:flex; align-items:center; justify-content:space-between; gap:16px; border-bottom:1px solid var(--border); background:var(--surface); position:sticky; top:0; z-index:10; }
.brand { display:flex; align-items:center; gap:12px; min-width:0; }
/* LED 品牌圆点 */
.brand-dot { width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 6px var(--accent-soft), 0 0 12px var(--accent-soft); flex:none; }
/* 顶栏标题：管线名 / 仓库名 / report */
.brand-title { display:flex; align-items:baseline; gap:0; margin:0; font-size:19px; font-weight:300; line-height:1.15; letter-spacing:.01em; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.brand-title .tt-pipeline { color:var(--accent); font-weight:500; }
.brand-title .tt-sep { color:var(--dim); margin:0 .35em; font-weight:300; }
.brand-title .tt-repo { color:var(--text); font-weight:400; }
.brand-title .tt-page { color:var(--muted); font-weight:300; font-family:var(--mono); font-size:16px; }
.topbar-actions { display:flex; align-items:center; gap:8px; flex:none; }
.account-info { display:inline-flex; align-items:center; gap:8px; padding:4px 12px; border:1px solid var(--border); border-radius:999px; font-family:var(--mono); font-size:11.5px; color:var(--muted); background:var(--surface); flex-wrap:wrap; max-width:100%; }
.account-info .ai-badge { display:inline-flex; align-items:center; gap:5px; padding:2px 8px; border-radius:999px; background:var(--accent-soft); color:var(--accent); font-weight:700; letter-spacing:.5px; font-size:10.5px; }
.account-info .acc-sep { color:var(--dim); }
.account-info .acc-ref { color:var(--accent); }
.account-info .acc-time { color:var(--muted); }
.account-info .acc-author { color:var(--dim); }
.submit-toggle { appearance:none; border:1px solid var(--border); background:var(--surface-2); color:var(--text); font:500 12px/18px var(--sans); padding:4px 12px; border-radius:999px; cursor:pointer; white-space:nowrap; display:inline-flex; align-items:center; gap:6px; transition:all 150ms ease; }
.submit-toggle:hover { border-color:var(--border-strong); background:var(--surface); }
.submit-toggle .dot { width:6px; height:6px; border-radius:50%; background:var(--accent); box-shadow:0 0 4px var(--accent-soft); }
.back-link { font-size:12px; color:var(--muted); padding:4px 12px; border:1px solid var(--border); border-radius:999px; transition:all 150ms ease; text-decoration:none; white-space:nowrap; }
.back-link:hover { color:var(--text); border-color:var(--border-strong); background:var(--surface-2); text-decoration:none; }
.main { width:100%; padding:0; }
.verdict { display:flex; align-items:center; gap:20px; padding:20px 0; position:relative; }
.verdict-icon { width:48px; height:48px; flex:0 0 auto; border-radius:12px; display:grid; place-items:center; background:var(--ok-soft); }
.verdict-icon svg { width:24px; height:24px; stroke:var(--ok); }
.verdict-text { flex:1; min-width:0; }
.verdict-text h1 { margin:0 0 4px; font-size:24px; font-weight:700; letter-spacing:-.3px; color:var(--text); }
.verdict-meta { margin:0; font-size:13px; color:var(--muted); font-family:var(--mono); }
.verdict-pill { flex:0 0 auto; align-self:flex-start; padding:5px 14px; border-radius:var(--radius-pill); font-size:11px; font-weight:700; letter-spacing:1px; color:var(--ok); background:var(--ok-soft); border:1px solid var(--teal-line); }
/* 未通过态 */
.verdict.block .verdict-icon { background:var(--block-soft); }
.verdict.block .verdict-icon svg { stroke:var(--block); }
.verdict-pill.block { color:var(--block); background:var(--block-soft); border-color:var(--block-line); }
.topbar-actions { display:inline-flex; align-items:center; gap:8px; }
.summary { padding:20px 0; border-top:1px solid var(--border); }
.summary-head { display:flex; align-items:center; justify-content:space-between; gap:12px; cursor:pointer; user-select:none; }
.summary h2 { margin:0; font-size:12px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:var(--dim); }
.summary-toggle { flex:0 0 auto; appearance:none; background:var(--surface-2); border:1px solid var(--border); color:var(--muted); width:28px; height:28px; border-radius:6px; display:grid; place-items:center; cursor:pointer; transition:all 150ms ease; padding:0; }
.summary-toggle:hover { color:var(--text); border-color:var(--border-strong); }
.summary-toggle svg { width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round; transition:transform 200ms ease; }
.summary.collapsed .summary-toggle svg { transform:rotate(-90deg); }
.summary-body { margin-top:10px; max-height:2000px; overflow:hidden; transition:max-height 300ms ease, margin-top 200ms ease; }
.summary.collapsed .summary-body { max-height:0; margin-top:0; }
.summary p { margin:0; color:var(--text); font-size:14.5px; white-space:pre-line; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:10; overflow:hidden; }
.summary-body.expanded p { -webkit-line-clamp:unset; display:block; }
.summary-toggle-all { margin-top:12px; appearance:none; background:var(--surface-2); border:1px solid var(--border); color:var(--accent); font-family:var(--sans); font-size:12px; font-weight:600; padding:5px 14px; border-radius:8px; cursor:pointer; transition:all 150ms ease; }
.summary-toggle-all:hover { border-color:var(--border-strong); background:var(--elevated); }
.summary-toggle-all[data-expanded="true"]::before { content:"收起"; }
.summary-toggle-all[data-expanded="false"]::before { content:"展开全部"; }
.stats { margin-top:20px; display:grid; grid-template-columns:repeat(6,1fr); gap:10px; }
.stat { padding:12px 0; }
.stat .num { font-size:26px; font-weight:700; font-variant-numeric:tabular-nums; letter-spacing:-.5px; line-height:1.1; color:var(--text); }
.stat .lbl { margin-top:4px; font-size:11px; color:var(--muted); letter-spacing:.2px; }
.stat.n-red .num { color:var(--block); }
.stat.n-yellow .num { color:var(--warn); }
.stat.n-green .num { color:var(--ok); }
.section-head { margin:40px 0 16px; display:flex; align-items:baseline; justify-content:space-between; }
.section-head h2 { margin:0; font-size:18px; font-weight:700; letter-spacing:-.3px; }
.section-head .count { font-family:var(--mono); font-size:12.5px; color:var(--dim); }
.issue { padding:16px 24px; border-bottom:1px solid var(--border); }
.issue:hover { background:var(--surface); }
.issue-body { border-left:3px solid transparent; padding-left:14px; }
.issue.info .issue-body { border-left-color:var(--info); }
.issue.warning .issue-body { border-left-color:var(--warn); }
.issue.blocker .issue-body { border-left-color:var(--block); }
.issue-head { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-bottom:10px; }
.sev { display:inline-flex; align-items:center; gap:6px; padding:2px 10px; border-radius:999px; font-size:11px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; }
.sev::before { content:""; width:6px; height:6px; border-radius:50%; background:currentColor; }
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
.pushes { padding:20px 0; border-top:1px solid var(--border); }
.pushes h2 { margin:0 0 10px; font-size:12px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:var(--dim); }
.pushes .row { display:flex; gap:10px; align-items:baseline; font-family:var(--mono); font-size:13px; padding:3px 0; }
.pushes .ok { color:var(--ok); } .pushes .bad { color:var(--block); }
.push-btn { appearance:none; border:1px solid var(--accent); background:var(--accent); color:#fff; font-family:var(--sans); font-size:13px; font-weight:600; padding:9px 20px; border-radius:8px; cursor:pointer; transition:all 150ms ease; white-space:nowrap; }
.push-btn:hover:not(:disabled) { background:#4338ca; border-color:#4338ca; }
.push-btn:active:not(:disabled) { transform:translateY(1px); }
.push-btn:disabled { opacity:.5; cursor:not-allowed; border-color:var(--border); background:var(--surface-2); color:var(--muted); }
.commit-input { flex:1; min-width:240px; appearance:none; background:var(--surface-2); border:1px solid var(--border-strong); color:var(--text); font-family:var(--mono); font-size:13.5px; line-height:1.5; padding:10px 14px; border-radius:10px; transition:border-color 150ms ease, box-shadow 150ms ease; resize:vertical; }
.commit-input::placeholder { color:var(--dim); }
.commit-input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); }
.commit-meta { flex-basis:100%; display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; font-family:var(--mono); font-size:12.5px; }
.commit-meta .commit-hash { color:var(--accent); background:var(--accent-soft); padding:2px 8px; border-radius:6px; }
.commit-meta .commit-author { color:var(--dim); }
.commit-meta .commit-subject { color:var(--muted); }
.push-hint { font-size:12.5px; color:var(--dim); }
.push-result { flex:1; min-width:200px; font-family:var(--mono); font-size:12.5px; }
.push-result .row { display:flex; gap:8px; align-items:baseline; padding:2px 0; flex-wrap:wrap; }
.push-result .ok { color:var(--ok); } .push-result .bad { color:var(--block); }
/* ===== 主体两栏：左 320 + 右 1fr ===== */
.workspace { display:grid; grid-template-columns:300px 1fr; gap:0; align-items:stretch; }
/* 左侧：单一面板，内含仓库目录/变更文件/违反条例三段，冻结不随页面滚动 */
.left-stack { position:sticky; top:64px; height:calc(100vh - 84px); border-right:1px solid var(--border); }
.left-panel { height:100%; overflow:hidden; display:flex; flex-direction:column; }
.left-panel-body { flex:1; min-height:0; overflow:auto; }
.left-panel-body::-webkit-scrollbar { width:6px; }
.left-panel-body::-webkit-scrollbar-thumb { background:var(--border-strong); border-radius:3px; }
.left-section { border-bottom:1px solid var(--border); padding:4px 16px; }
.left-section:last-child { border-bottom:none; padding-bottom:4px; }
.left-summary { padding:10px 0; cursor:pointer; font-size:11px; font-weight:700; letter-spacing:1px; color:var(--muted); display:flex; align-items:center; gap:10px; list-style:none; text-transform:uppercase; }
.left-summary::-webkit-details-marker { display:none; }
.left-summary .sec-icon { width:14px; height:14px; flex:none; color:var(--accent); }
.left-summary .count { margin-left:auto; font-family:var(--mono); font-size:10.5px; padding:1px 7px; border-radius:999px; background:var(--accent-soft); color:var(--accent); }
.left-sec-body { padding:4px 0 8px; }
/* 违反条例列表（按 severity 分组） */
.rule-list { padding:2px 0; }
/* severity 筛选条 */
.sev-filter { display:flex; align-items:center; gap:6px; padding:6px 0 10px; flex-wrap:wrap; }
.sev-filter .sf-label { font-size:10.5px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--dim); }
.sev-filter .sf-btn { appearance:none; border:1px solid transparent; background:transparent; color:var(--muted); font-size:11px; font-weight:500; padding:3px 12px; border-radius:999px; cursor:pointer; transition:all 120ms ease; font-family:var(--sans); }
.sev-filter .sf-btn:hover { color:var(--text); background:var(--surface-2); }
.sev-filter .sf-btn.active.blocker { background:var(--block-soft); border-color:var(--block-line); color:var(--block); }
.sev-filter .sf-btn.active.warning { background:var(--warn-soft); border-color:var(--amber-line); color:var(--warn); }
.sev-filter .sf-btn.active.info { background:var(--ok-soft); border-color:var(--teal-line); color:var(--ok); }
.sev-filter .sf-btn.active.all { background:var(--surface-2); border-color:var(--border); color:var(--text); }
.sev-filter .sf-clear { margin-left:auto; appearance:none; background:none; border:none; color:var(--dim); font-size:10.5px; cursor:pointer; font-family:var(--sans); }
.sev-filter .sf-clear:hover { color:var(--text); }
.sev-filter .sf-export { appearance:none; border:1px solid var(--border); background:var(--surface); color:var(--muted); font-size:10.5px; font-weight:600; padding:3px 11px; border-radius:999px; cursor:pointer; font-family:var(--sans); transition:all 120ms ease; }
.sev-filter .sf-export:hover { color:var(--text); border-color:var(--dim); }
/* 单个问题项：左侧条例名 + 问题描述占满，最右侧行号区间，无 severity 色点 */
.rule-issue { display:flex; align-items:center; gap:8px; padding:7px 0; border-top:1px solid var(--border); cursor:pointer; transition:background 120ms ease; }
.rule-issue:first-child { border-top:none; }
.rule-issue:hover { background:var(--surface-2); }
.rule-issue .ri-rule { font-family:var(--mono); font-size:11px; color:var(--text); font-weight:600; white-space:nowrap; flex:0 0 auto; }
.rule-issue[data-sev="blocker"] .ri-rule { color:var(--block); }
.rule-issue[data-sev="warning"] .ri-rule { color:var(--warn); }
.rule-issue[data-sev="info"] .ri-rule { color:var(--ok); }
.rule-issue .ri-msg { font-size:11px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }
.rule-issue .ri-loc { font-family:var(--mono); font-size:10.5px; color:var(--dim); white-space:nowrap; flex:0 0 auto; margin-left:auto; }

/* 右栏 */
.right-col { display:flex; flex-direction:column; gap:0; min-width:0; flex:1; min-height:0; }
/* 评审结果板块：可折叠 */
.result-section { padding:0; }
.result-head { padding:14px 28px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:10px; cursor:pointer; user-select:none; }
.result-head h2 { margin:0; font-size:13px; font-weight:700; letter-spacing:.5px; }
.result-head .result-caret { flex:0 0 auto; font-size:11px; color:var(--dim); transition:transform 200ms ease; }
.result-section.collapsed .result-caret { transform:rotate(-90deg); }
.result-body { padding:0 28px; }
.result-section.collapsed .result-body { display:none; }
.result-body .verdict { margin:0; padding:20px 0; gap:14px; }
.result-body .verdict-icon { width:36px; height:36px; }
.result-body .verdict-icon svg { width:18px; height:18px; }
.result-body .verdict-text h1 { font-size:15px; margin:0 0 2px; }
.result-body .verdict-meta { font-size:10.5px; }
.result-body .verdict-pill { font-size:10px; padding:4px 10px; letter-spacing:1px; }
.result-body .summary { margin-top:10px; padding:12px 0; }
.result-body .summary p { font-size:10.5px; }
.result-body .summary h2 { font-size:10px; }
.result-body .stats { margin-top:10px; gap:8px; }
.result-body .stat { padding:6px 0; }
.result-body .stat .num { font-size:16px; }
.result-body .stat .lbl { font-size:10px; }
.result-body .pushes { margin-top:10px; padding:12px 0; }

/* 提交按钮（顶栏） */
.submit-toggle { appearance:none; border:1px solid var(--accent); background:var(--accent); color:#fff; font-family:var(--sans); font-size:13px; font-weight:700; padding:7px 16px; border-radius:8px; cursor:pointer; transition:all 150ms ease; display:inline-flex; align-items:center; gap:6px; }
.submit-toggle:hover { background:#4338ca; border-color:#4338ca; }
.submit-toggle .dot { width:7px; height:7px; border-radius:50%; background:var(--accent); ; }
/* 确认提交栏（顶栏下方展开） */
.submit-bar-wrap { max-height:0; overflow:hidden; transition:max-height 300ms ease; }
.submit-bar-wrap.open { max-height:300px; }
.submit-bar { padding:14px 28px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:14px; flex-wrap:wrap; background:var(--surface); }
/* 代码变更区（右侧，可滚动） */
.diff-panel { overflow:auto; display:flex; flex-direction:column; flex:1; min-height:0; }
.diff-panel-head { display:flex; align-items:center; gap:10px; padding:14px 28px; border-bottom:1px solid var(--border); }
.diff-panel-head h2 { margin:0; font-size:13px; font-weight:700; }
.diff-panel-head .count { font-family:var(--mono); font-size:11.5px; color:var(--dim); }
.diff-panel-head .filter-clear { margin-left:auto; }
.diff-file { border-bottom:1px solid var(--border); }
.diff-file:last-child { border-bottom:none; }
.diff-file-head { display:flex; align-items:center; gap:10px; padding:8px 14px; font-family:var(--mono); font-size:12.5px; color:var(--accent); background:var(--surface-2); cursor:pointer; user-select:none; }
.diff-file-head .badge { color:var(--dim); font-size:11px; }
.diff-file-head .chevron { flex:0 0 auto; width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round; transition:transform 200ms ease; color:var(--dim); }
.diff-file[data-collapsed="true"] .diff-file-head .chevron { transform:rotate(-90deg); }
.diff-file-head .issue-count { margin-left:auto; flex:0 0 auto; font-size:11px; font-weight:700; padding:1px 8px; border-radius:999px; background:var(--warn-soft); color:var(--warn); }
.diff-file-head .issue-count.zero { background:transparent; color:var(--dim); }
.diff-file-body { overflow:visible; }
.diff-file[data-collapsed="true"] .diff-file-body { max-height:0; overflow:hidden; }
.diff-hunk-head { padding:4px 14px; font-family:var(--mono); font-size:11px; color:var(--dim); background:var(--diff-hunk-bg); }
.diff-line { display:flex; align-items:flex-start; font-family:var(--mono); font-size:12.5px; line-height:1.55; }
.diff-line .gutter { flex:0 0 42px; padding:0 6px; text-align:right; color:var(--dim); background:var(--surface-2); user-select:none; border-right:1px solid var(--border); }
.diff-line .content { flex:1; padding:0 10px; white-space:pre-wrap; word-break:break-word; min-width:0; }
/* 以下代码批注色值为神圣不可改（AGENTS.md），全部硬编码锁定 */
.diff-line.add { background:rgba(122,220,192,.09); }
.diff-line.add .content { color:#14754f; }
.diff-line.del { background:rgba(240,85,69,.09); }
.diff-line.del .content { color:#bf3222; }
.diff-line.ctx .content { color:var(--muted); }
.diff-line.target { animation:flash 1.4s ease-out; box-shadow:inset 3px 0 0 #f59e0b; }
.diff-line.target-range { background:rgba(255,212,98,.13); box-shadow:inset 3px 0 0 #f59e0b; }
/* 点击问题项按 severity 高亮区间（blocker 红 / warning 琥珀 / info 青绿，遵守禁蓝色约束） */
.diff-line.hl-blocker { background:rgba(173,49,77,.20); box-shadow:inset 3px 0 0 #ef4444; }
.diff-line.hl-warning { background:rgba(255,212,98,.13); box-shadow:inset 3px 0 0 #f59e0b; }
.diff-line.hl-info { background:rgba(122,220,192,.12); box-shadow:inset 3px 0 0 #10b981; }
/* 堆叠菜单（内联渲染在 diff 行后，卡片默认折叠，点击 head 展开） */
.issue-menu-card { margin:0; padding:10px 14px; border-left:3px solid var(--dim); background:var(--surface); border-radius:0; }
.issue-menu-card.sev-blocker { border-left-color:var(--block); background:var(--block-soft); }
.issue-menu-card.sev-warning { border-left-color:var(--warn); background:var(--warn-soft); }
.issue-menu-card.sev-info { border-left-color:var(--ok); background:var(--ok-soft); }
.issue-menu-card .menu-head { display:flex; align-items:center; gap:8px; margin-bottom:0; flex-wrap:wrap; cursor:pointer; user-select:none; }
.issue-menu-card:not(.collapsed) .menu-head { margin-bottom:6px; }
.issue-menu-card .menu-head .menu-caret { flex:0 0 auto; font-size:10px; color:var(--dim); transition:transform 200ms ease; display:inline-block; }
.issue-menu-card:not(.collapsed) .menu-head .menu-caret { transform:rotate(90deg); }
.issue-menu-card.collapsed .menu-body { display:none; }
/* 收纳态：上下内边距收窄，整行宽度不变，视觉上更紧凑 */
.issue-menu-card.collapsed { padding-top:6px; padding-bottom:6px; }
.issue-menu-card .menu-head .sev { font-size:10.5px; font-weight:700; letter-spacing:1px; text-transform:uppercase; padding:2px 7px; border-radius:4px; }
.issue-menu-card .menu-head .sev.blocker { background:var(--block); color:#fff; }
.issue-menu-card .menu-head .sev.warning { background:var(--warn); color:#fff; }
.issue-menu-card .menu-head .sev.info { background:var(--ok); color:#ffffff; }
.issue-menu-card .menu-head .rule { font-family:var(--mono); font-size:12px; color:var(--text); font-weight:600; }
.issue-menu-card .menu-head .loc { font-family:var(--mono); font-size:11.5px; color:var(--dim); margin-left:auto; }
.issue-menu-card .menu-msg { margin:0; font-size:13.5px; color:var(--text); line-height:1.6; white-space:pre-wrap; word-break:break-word; }
.issue-menu-card .menu-sug { margin-top:8px; padding:8px 10px; background:var(--surface-2); border-radius:6px; border-left:2px solid var(--dim); }
.issue-menu-card .menu-sug .tag { display:inline-block; font-size:10px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--dim); margin-bottom:4px; }
.issue-menu-card .menu-sug p { margin:0; font-size:12.5px; color:var(--muted); line-height:1.55; white-space:pre-wrap; word-break:break-word; }
@keyframes flash { 0%{background:var(--flash);} 100%{background:transparent;} }
.diff-empty { padding:32px 20px; text-align:center; color:var(--dim); font-size:13px; }
/* 目录树 */
.tree-root, .tree-dir details { margin:0; }
.tree-root > summary, .tree-summary { padding:4px 0; cursor:pointer; font-size:12.5px; color:var(--muted); display:flex; align-items:center; gap:6px; border-radius:6px; transition:background 120ms ease; list-style:none; }
.tree-root > summary:hover, .tree-summary:hover { background:var(--surface-2); color:var(--text); }
.tree-summary::-webkit-details-marker { display:none; }
.tree-icon { font-size:13px; flex:0 0 auto; }
.tree-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--mono); font-size:12px; }
.tree-list { list-style:none; margin:0; padding:0 0 0 14px; }
.tree-dir, .tree-file { padding:0; margin:0; }
.tree-file { padding:4px 0; color:var(--dim); font-size:12px; display:flex; align-items:center; gap:6px; border-radius:6px; cursor:default; }
.tree-file:hover { color:var(--muted); background:var(--surface-2); }
.tree-empty { padding:12px 16px; color:var(--dim); font-size:12px; }
/* 变更文件列表（沿用原 .file-list / .file-entry） */
.file-list { list-style:none; margin:0; padding:0; }
.file-entry { display:flex; align-items:center; gap:8px; padding:7px 0; border-bottom:1px solid var(--border); font-family:var(--mono); font-size:11.5px; color:var(--muted); cursor:pointer; transition:background 150ms ease, color 150ms ease; text-decoration:none; }
.file-entry:last-child { border-bottom:none; }
.file-entry:hover, .file-entry.active { background:var(--surface-2); color:var(--text); text-decoration:none; }
.file-entry .file-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.file-entry .file-count { flex:0 0 auto; font-size:10px; font-weight:700; padding:1px 7px; border-radius:999px; background:var(--accent-soft); color:var(--accent); }
.file-entry .file-count.zero { background:transparent; color:var(--dim); }
.file-empty { padding:18px 16px; text-align:center; color:var(--dim); font-size:12px; }
.empty { padding:18px 16px; text-align:center; color:var(--dim); font-size:12px; }
@media (max-width:1180px){ .workspace { grid-template-columns:1fr; } .left-stack { position:static; height:auto; } .diff-panel { max-height:none; } }
@media (max-width:980px) { .diff-panel { position:static; max-height:none; } }
@media (max-width:860px) { .stats { grid-template-columns:repeat(3,1fr); } }
@media (max-width:560px) {
  .topbar { flex-wrap:wrap; padding:16px 18px; }
  .main { padding:24px 18px 60px; }
  .verdict { flex-direction:column; align-items:flex-start; gap:14px; padding:20px; }
  .stats { grid-template-columns:repeat(2,1fr); } .stat .num { font-size:24px; }
}
`;

/** 顶栏左对齐标题：管线名 / 仓库名 / report。
 *  管线名取自 ref（分支），仓库名取自 repo 或 repoCwd 末段，缺省时各回退到占位文案。 */
function titleParts(v: ReportView): { pipeline: string; repo: string } {
  const pipeline = v.ref || "评审管线";
  let repo = v.repo || "";
  if (!repo && v.repoCwd) {
    const segs = v.repoCwd.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
    repo = segs[segs.length - 1] || v.repoCwd;
  }
  if (!repo) repo = "未命名仓库";
  return { pipeline, repo };
}

/** 顶栏标题 HTML：pipeline / repo / report —— 与管线页 .brand-title 结构一致 */
function titleHtml(v: ReportView): string {
  const { pipeline, repo } = titleParts(v);
  return `<h1 class="brand-title">
    <span class="tt-pipeline">${esc(pipeline)}</span>
    <span class="tt-sep">/</span>
    <span class="tt-repo">${esc(repo)}</span>
    <span class="tt-sep">/</span>
    <span class="tt-page">report</span>
  </h1>`;
}

/** 右上账号信息：AI Review 徽标 + 分支 + 生成时间 + HEAD 作者（缺省项自动省略） */
function accountHtml(v: ReportView): string {
  const parts: string[] = [];
  parts.push(`<span class="ai-badge">AI Review</span>`);
  if (v.ref) parts.push(`<span class="acc-ref">${esc(v.ref)}</span>`);
  if (v.generatedAt) parts.push(`<span class="acc-time">${esc(v.generatedAt)}</span>`);
  if (v.head?.author) parts.push(`<span class="acc-author">${esc(v.head.author)}</span>`);
  return parts.join(`<span class="acc-sep">·</span>`);
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
        `<div class="stat ${cls}"><div class="num">${num}</div><div class="lbl">${lbl}</div><div class="bar"></div></div>`,
    )
    .join("\n    ");
}

/** 违反条例列表：拍平为单一列表（不按 severity 分组收纳），左侧条例名 + 问题描述，最右侧行号区间。 */
function ruleList(v: ReportView): string {
  if (!v.issues.length) return `<div class="empty">未发现问题。</div>`;
  /* 拍平为单一列表：左侧条例名，中间问题描述，最右侧行号区间；不按 severity 分组收纳 */
  const sevRank: Record<string, number> = { blocker: 3, warning: 2, info: 1 };
  const items = [...v.issues].sort((a, b) => sevRank[b.severity] - sevRank[a.severity]);
  const itemHtml = items
    .map((i) => {
      const range = i.lineStart === i.lineEnd ? String(i.lineStart) : `${i.lineStart}-${i.lineEnd}`;
      return `<div class="rule-issue" data-rule="${esc(i.category)}" data-file="${esc(i.file)}" data-ls="${i.lineStart}" data-le="${i.lineEnd}" data-sev="${i.severity}">
        <code class="ri-rule" title="${esc(i.category)}">${esc(i.category)}</code>
        <span class="ri-msg">${esc(i.message)}</span>
        <code class="ri-loc">${esc(range)}</code>
      </div>`;
    })
    .join("\n");
  return `<div class="sev-filter">
    <span class="sf-label">筛选</span>
    <button type="button" class="sf-btn all active" data-sev="all">全部 · ${v.issues.length}</button>
    <button type="button" class="sf-btn blocker" data-sev="blocker">Blocker · ${v.counts.blocker}</button>
    <button type="button" class="sf-btn warning" data-sev="warning">Warning · ${v.counts.warning}</button>
    <button type="button" class="sf-btn info" data-sev="info">Info · ${v.counts.info}</button>
    <button type="button" class="sf-clear" id="sevFilterClear">清除</button>
    <button type="button" class="sf-export" id="sevFilterExport" title="把当前筛选出的问题导出为 CSV">导出 CSV</button>
  </div>
  <div class="rule-list">${itemHtml}</div>`;
}

/** 右侧 diff 面板：按文件渲染 hunks，新增绿、删除红、上下文灰，行号对应 AI 报告行号。
 *  每个文件默认折叠（仅显示文件名 + 增删行数 + 问题数），点击表头展开。
 *  问题行不预高亮；仅点击左侧「违反条例」项时才高亮对应区间。问题菜单卡内联渲染。 */
function diffPanel(v: ReportView): string {
  if (!v.diffFiles || !v.diffFiles.length) {
    return `<div class="diff-empty">无代码变更数据。</div>`;
  }
  // 按文件统计问题数
  const issueCount = new Map<string, number>();
  for (const i of v.issues) {
    issueCount.set(i.file, (issueCount.get(i.file) ?? 0) + 1);
  }
  // 按文件 + lineEnd 分组问题（用于内联渲染菜单卡）
  const issuesByLineEnd = new Map<string, Map<number, typeof v.issues>>();
  for (const i of v.issues) {
    if (!issuesByLineEnd.has(i.file)) issuesByLineEnd.set(i.file, new Map());
    const m = issuesByLineEnd.get(i.file)!;
    if (!m.has(i.lineEnd)) m.set(i.lineEnd, []);
    m.get(i.lineEnd)!.push(i);
  }
  return v.diffFiles
    .map((f) => {
      let addCount = 0;
      let delCount = 0;
      const lineIssues = issuesByLineEnd.get(f.path);
      const body = f.hunks
        .map((h) => {
          const head = `<div class="diff-hunk-head">@@ -${h.oldStart},${h.oldEnd - h.oldStart + 1} +${h.newStart},${h.newEnd - h.newStart + 1} @@</div>`;
          const lines = h.lines
            .map((l) => {
              if (l.type === "add") addCount++;
              else if (l.type === "del") delCount++;
              const oldG = l.oldNo !== undefined ? String(l.oldNo) : "";
              const newG = l.newNo !== undefined ? String(l.newNo) : "";
              // 仅 add/ctx 行带 data-line（newNo），供问题联动定位；del 行无 newNo 不参与
              const dataLine =
                l.newNo !== undefined
                  ? ` data-file="${esc(f.path)}" data-line="${l.newNo}"`
                  : "";
              const lineHtml = `      <div class="diff-line ${l.type}"${dataLine}>
        <span class="gutter">${oldG}</span>
        <span class="gutter">${newG}</span>
        <code class="content">${esc(l.text)}</code>
      </div>`;
              // 如果该行是某个问题的 lineEnd，在行后内联插入问题菜单卡（默认 collapsed）
              let menuHtml = "";
              if (l.newNo !== undefined && lineIssues?.has(l.newNo)) {
                const items = lineIssues.get(l.newNo)!;
                menuHtml = items
                  .map((it) => {
                    const sevCls = `sev-${it.severity}`;
                    const sug = it.suggestion
                      ? `<div class="menu-sug"><span class="tag">建议</span><p>${esc(it.suggestion)}</p></div>`
                      : "";
                    return `      <div class="issue-menu-card collapsed ${sevCls}" data-file="${esc(f.path)}" data-ls="${it.lineStart}" data-le="${it.lineEnd}">
        <div class="menu-head"><span class="menu-caret">›</span><span class="sev ${it.severity}">${esc(it.severity)}</span><code class="rule">${esc(it.category || "")}</code><code class="loc">${esc(it.loc || "")}</code></div>
        <div class="menu-body"><p class="menu-msg">${esc(it.message || "")}</p>${sug}</div>
      </div>`;
                  })
                  .join("\n");
              }
              return lineHtml + (menuHtml ? "\n" + menuHtml : "");
            })
            .join("\n");
          return `    ${head}\n${lines}`;
        })
        .join("\n");
      const ic = issueCount.get(f.path) ?? 0;
      const icClass = ic === 0 ? " zero" : "";
      return `  <div class="diff-file" data-file="${esc(f.path)}" data-collapsed="true">
    <div class="diff-file-head">
      <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
      <span>${esc(f.path)}</span>
      <span class="badge">+${addCount} / -${delCount}</span>
      <span class="issue-count${icClass}">${ic} 问题</span>
    </div>
    <div class="diff-file-body">
${body}
    </div>
  </div>`;
    })
    .join("\n");
}

/** 左侧文件目录面板：列出全部变更文件 + 各自问题数，点击滚动到对应评审段
 *  注：head 由外部 <details><summary> 提供，本函数只返回 <ul> 列表体 */
function filePanel(v: ReportView): string {
  if (!v.diffFiles || !v.diffFiles.length) {
    return `<div class="file-empty">无文件变更。</div>`;
  }
  const issueCount = new Map<string, number>();
  for (const i of v.issues) {
    issueCount.set(i.file, (issueCount.get(i.file) ?? 0) + 1);
  }
  const items = v.diffFiles.map((f) => {
    const ic = issueCount.get(f.path) ?? 0;
    const cls = ic === 0 ? " zero" : "";
    return `<li><a class="file-entry" data-file="${esc(f.path)}" href="#" title="${esc(f.path)}"><span class="file-name">${esc(f.path)}</span><span class="file-count${cls}">${ic}</span></a></li>`;
  });
  return `<ul class="file-list">${items.join("")}</ul>`;
}

/* ==================== 仓库目录树（GitHub Trees API 优先，本地 fs 兜底） ==================== */

/** 本地目录树扫描时跳过这些目录名（无论位置） */
const TREE_SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", ".ai-review-reports",
  ".ai-flows-uploads", ".vscode", ".idea", "coverage", ".next", ".cache", ".turbo",
]);

/** 递归扫描本地仓库目录树（GitHub API 不可用时的 fallback），平铺返回所有节点 */
function scanLocalTree(root: string, maxFiles = 2000): RepoTreeNode[] {
  const out: RepoTreeNode[] = [];
  const walk = (dir: string, prefix: string) => {
    if (out.length >= maxFiles) return;
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.length >= maxFiles) return;
      if (TREE_SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      let s: { isDirectory(): boolean; isFile(): boolean; size: number };
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        out.push({ path: `${rel}/`, type: "tree" });
        walk(full, rel);
      } else if (s.isFile()) {
        out.push({ path: rel, type: "blob", size: s.size });
      }
    }
  };
  walk(root, "");
  return out;
}

/** 拉取仓库目录树：优先 GitHub Trees API（recursive=1），失败回退本地 fs 递归。
 *  - 走 API：git remote get-url origin → parseGithubRemote → GET /repos/{o}/{r}/git/trees/{branch}?recursive=1
 *  - 兜底：node:fs 递归扫描（过滤 .git/node_modules/dist 等）
 *  任何环节失败（无 token / 无 origin / 非 GitHub / 请求超时 / 树被截断）自动回退 fs */
export async function fetchRepoTree(
  repoCwd: string,
  opts: { tokenEnv?: string } = {}
): Promise<RepoTreeNode[]> {
  const token = process.env[opts.tokenEnv ?? "GH_TOKEN"];
  if (token) {
    try {
      const url = await getRemoteUrl(repoCwd);
      if (url) {
        const gh = parseGithubRemote(url);
        if (gh) {
          let branch: string | undefined;
          try {
            branch = await currentBranch(repoCwd);
          } catch {
            /* detached HEAD */
          }
          const u = `https://api.github.com/repos/${gh.owner}/${gh.repo}/git/trees/${encodeURIComponent(
            branch ?? "main"
          )}?recursive=1`;
          const r = await fetch(u, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "ai-review",
            },
            signal: AbortSignal.timeout(8000),
          });
          if (r.ok) {
            const data: any = await r.json();
            if (data && data.truncated !== true && Array.isArray(data.tree)) {
              const nodes: RepoTreeNode[] = [];
              for (const t of data.tree) {
                if (!t || typeof t.path !== "string") continue;
                if (t.path.startsWith(".git/")) continue;
                if (t.type === "tree") {
                  nodes.push({ path: `${t.path}/`, type: "tree" });
                } else if (t.type === "blob") {
                  nodes.push({ path: t.path, type: "blob", size: t.size });
                }
              }
              if (nodes.length) return nodes;
            }
          }
        }
      }
    } catch {
      /* API 失败回退 fs */
    }
  }
  try {
    return scanLocalTree(repoCwd);
  } catch {
    return [];
  }
}

/* ==================== 目录树嵌套渲染 ==================== */

interface TreeNode {
  name: string;
  type: "tree" | "blob";
  children: Map<string, TreeNode>;
  fullPath: string;
  size?: number;
}

/** 把平铺的 RepoTreeNode[] 构建为嵌套树（根节点 name=""） */
function buildTreeFromFlat(nodes: RepoTreeNode[]): TreeNode {
  const root: TreeNode = { name: "", type: "tree", children: new Map(), fullPath: "" };
  for (const n of nodes) {
    const parts = n.path.replace(/\/$/, "").split("/").filter(Boolean);
    if (!parts.length) continue;
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1;
      const name = parts[i];
      let next = cur.children.get(name);
      if (!next) {
        next = {
          name,
          type: last ? n.type : "tree",
          children: new Map(),
          fullPath: parts.slice(0, i + 1).join("/"),
          size: last ? n.size : undefined,
        };
        cur.children.set(name, next);
      }
      cur = next;
    }
  }
  return root;
}

/** 递归渲染嵌套树为 <details> 折叠结构；根默认 open，子层默认收起 */
function renderTreeNode(node: TreeNode, depth: number, maxDepth = 6): string {
  if (node.children.size === 0 || depth > maxDepth) return "";
  const items: string[] = [];
  for (const [name, child] of node.children) {
    if (child.type === "tree") {
      items.push(
        `<li class="tree-dir"><details${depth < 1 ? " open" : ""}><summary class="tree-summary"><span class="tree-icon">📁</span><span class="tree-name">${esc(name)}/</span></summary>${renderTreeNode(
          child,
          depth + 1,
          maxDepth
        )}</details></li>`
      );
    } else {
      items.push(
        `<li class="tree-file" title="${esc(child.fullPath)}"><span class="tree-icon">📄</span><span class="tree-name">${esc(name)}</span></li>`
      );
    }
  }
  return `<ul class="tree-list">${items.join("")}</ul>`;
}

/** 渲染仓库目录树 HTML（左侧仓库面板上半段） */
function repoTreeHtml(v: ReportView): string {
  if (!v.repoTree || !v.repoTree.length) {
    return `<div class="tree-empty">无目录树数据。</div>`;
  }
  const root = buildTreeFromFlat(v.repoTree);
  if (root.children.size === 0) {
    return `<div class="tree-empty">无目录树数据。</div>`;
  }
  const rootName = v.repo || "仓库根";
  return `<details open class="tree-root"><summary class="tree-summary"><span class="tree-icon">📁</span><span class="tree-name">${esc(rootName)}/</span></summary>${renderTreeNode(root, 1)}</details>`;
}

/* ==================== 问题列表精简 + 堆叠菜单数据 ==================== */

/** 把所有问题按 "file#lineEnd" 分组序列化为 JSON script，供 JS 点击列表项时按区间堆叠渲染菜单。
 *  转义 < 避免提前结束 <script>，data-* 属性不存长文本避免 HTML 转义问题 */
function buildIssueStore(v: ReportView): string {
  const store: Record<string, Array<{
    severity: string;
    category: string;
    message: string;
    suggestion?: string;
    lineStart: number;
    lineEnd: number;
    loc: string;
  }>> = {};
  for (const i of v.issues) {
    const key = `${i.file}#${i.lineEnd}`;
    if (!store[key]) store[key] = [];
    store[key].push({
      severity: i.severity,
      category: i.category,
      message: i.message,
      suggestion: i.suggestion,
      lineStart: i.lineStart,
      lineEnd: i.lineEnd,
      loc: i.loc,
    });
  }
  return JSON.stringify(store).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
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

/** 确认提交栏：评审通过 + 配置目标远端 + 用户输入非空 commit 信息后才允许提交。
 * 展示 HEAD 提交描述（hash/作者/时间/首行），输入框预填完整提交信息，
 * 改写后确认将 amend 最近一次提交。有 blocker 时置灰禁用。无目标远端时提示。 */
function submitBar(v: ReportView): string {
  const head = v.head;
  const metaLine = head
    ? `<div class="commit-meta"><span class="commit-hash" id="headHash">${esc(head.short)}</span><span class="commit-author">${esc((head.date || "").slice(0, 16).replace("T", " "))}${head.author ? ` · ${esc(head.author)}` : ""}</span><span class="commit-subject" id="headSubject">${esc(head.subject)}</span></div>`
    : "";
  if (!v.targets || v.targets.length === 0) {
    return `<section class="submit-bar"><span class="push-hint">未配置推送目标远端（config.targets 为空）。</span></section>`;
  }
  if (!v.passed) {
    return `<section class="submit-bar">
      ${metaLine}
      <button type="button" class="push-btn" disabled>评审未通过 · 禁止推送</button>
      <span class="push-hint">存在阻塞级问题，请先修复后再提交。</span>
    </section>`;
  }
  const names = v.targets.map((t) => t.name).join(" / ");
  return `<section class="submit-bar">
    ${metaLine}
    <textarea class="commit-input" id="commitMsg" rows="2" placeholder="输入或修改 commit 提交信息（必填，确认提交时生效）" autocomplete="off">${esc(head?.message ?? "")}</textarea>
    <button type="button" class="push-btn" id="pushBtn" disabled>确认提交到远端</button>
    <span class="push-hint">目标：${esc(names)} · 修改上方提交信息后确认，将改写最近一次提交（amend）并推送</span>
    <span class="push-result" id="pushResult"></span>
  </section>`;
}

/** 把评审视图模型注入参考 HTML 模板（自包含单文件） */
export function renderTemplate(v: ReportView): string {
  const passIcon = `<polyline points="4 12 10 18 20 6"></polyline>`;
  const blockIcon = `<line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line>`;
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#0f172a" />
<title>AI 代码评审报告 · ai-review</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%234f46e5'/%3E%3Cpath d='M7 8l5 5 5-5' stroke='%231e1b4b' stroke-width='2.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E" />
<style>${REPORT_CSS}</style>
<script>
  (function(){
    try {
      var t = localStorage.getItem('theme');
      if (!t) {
        t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      document.documentElement.setAttribute('data-theme', t);
    } catch (e) {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  })();
</script>
</head>
<body>

<header class="topbar">
  <div class="brand">
    <span class="brand-dot" aria-hidden="true"></span>
    ${titleHtml(v)}
  </div>
  <div class="topbar-actions">
    <span class="account-info">${accountHtml(v)}</span>
    <button type="button" class="submit-toggle" id="submitToggle" title="展开确认提交栏"><span class="dot"></span>提交</button>
    <button type="button" class="theme-toggle" id="themeToggle" title="切换日间/夜间主题" aria-label="切换日间/夜间主题">
      <svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>
      <svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><line x1="12" y1="2" x2="12" y2="5"></line><line x1="12" y1="19" x2="12" y2="22"></line><line x1="2" y1="12" x2="5" y2="12"></line><line x1="19" y1="12" x2="22" y2="12"></line><line x1="4.6" y1="4.6" x2="6.7" y2="6.7"></line><line x1="17.3" y1="17.3" x2="19.4" y2="19.4"></line><line x1="4.6" y1="19.4" x2="6.7" y2="17.3"></line><line x1="17.3" y1="6.7" x2="19.4" y2="4.6"></line></svg>
    </button>
    <a class="back-link" href="/">&larr; 全部报告</a>
  </div>
</header>

<div class="submit-bar-wrap" id="submitBarWrap">${submitBar(v)}</div>

<main class="main">
  <div class="workspace">
    <!-- 左栏：单一面板，内含仓库目录/变更文件/违反条例三段 -->
    <div class="left-stack">
      <div class="left-panel">
        <div class="left-panel-body">
          <details class="left-section" open>
            <summary class="left-summary"><svg class="sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>仓库目录</summary>
            <div class="left-sec-body">${repoTreeHtml(v)}</div>
          </details>
          <details class="left-section" open>
            <summary class="left-summary"><svg class="sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>变更文件 <span class="count">${v.diffFiles?.length ?? 0}</span></summary>
            <div class="left-sec-body">${filePanel(v)}</div>
          </details>
          <details class="left-section" open>
            <summary class="left-summary"><svg class="sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>违反条例 <span class="count">${v.total}</span></summary>
            <div class="left-sec-body">${ruleList(v)}</div>
          </details>
        </div>
      </div>
    </div>

    <!-- 右栏：评审结果 + 代码变更 -->
    <div class="right-col">
      <section class="result-section" id="resultSection">
        <div class="result-head" id="resultHead">
          <span class="result-caret">▾</span>
          <h2>评审结果</h2>
        </div>
        <div class="result-body">
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

          <section class="summary" id="summary" aria-label="评审摘要">
            <div class="summary-head" id="summaryHead">
              <h2>评审摘要</h2>
              <button type="button" class="summary-toggle" aria-label="展开/收纳摘要" aria-expanded="true">
                <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
            </div>
            <div class="summary-body" id="summaryBody">
              <p>${esc(v.summary)}</p>
              <button type="button" class="summary-toggle-all" id="summaryToggleAll" data-expanded="false" aria-label="展开/收起摘要全部"></button>
            </div>
          </section>

          <section class="stats" aria-label="评审指标">
            ${statCards(v)}
          </section>

          ${pushSection(v)}
        </div>
      </section>

      <section class="diff-panel">
        <div class="diff-panel-head">
          <h2>代码变更</h2>
          <span class="count">${v.diffFiles?.length ?? 0} 个文件</span>
        </div>
        ${diffPanel(v)}
      </section>
    </div>
  </div>
</main>
<script type="application/json" id="issueStore">${buildIssueStore(v)}</script>
<script>
(function(){
  function escS(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  var toggle = document.getElementById('themeToggle');
  var meta = document.querySelector('meta[name="theme-color"]');
  function applyTheme(t){
    document.documentElement.setAttribute('data-theme', t);
    if(meta) meta.setAttribute('content', t === 'light' ? '#f8fafc' : '#0f172a');
    try { localStorage.setItem('theme', t); } catch(e){}
  }
  if(meta) meta.setAttribute('content', document.documentElement.getAttribute('data-theme') === 'light' ? '#f8fafc' : '#0f172a');
  if(toggle){
    toggle.addEventListener('click', function(){
      var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next);
    });
  }
  /* 摘要展开/收纳 */
  var summaryHead = document.getElementById('summaryHead');
  var summary = document.getElementById('summary');
  if(summaryHead && summary){
    summaryHead.addEventListener('click', function(){
      summary.classList.toggle('collapsed');
      var btn = summaryHead.querySelector('.summary-toggle');
      if(btn) btn.setAttribute('aria-expanded', summary.classList.contains('collapsed') ? 'false' : 'true');
    });
  }
  /* 提交栏展开/收起 */
  var submitToggle = document.getElementById('submitToggle');
  var submitBarWrap = document.getElementById('submitBarWrap');
  if(submitToggle && submitBarWrap){
    submitToggle.addEventListener('click', function(){
      submitBarWrap.classList.toggle('open');
    });
  }
  /* 评审结果板块收纳 */
  var resultSection = document.getElementById('resultSection');
  var resultHead = document.getElementById('resultHead');
  if(resultSection && resultHead){
    resultHead.addEventListener('click', function(){
      resultSection.classList.toggle('collapsed');
    });
  }
  /* issueStore 供行→问题查找 */
  var issueStore = null;
  try {
    var storeEl = document.getElementById('issueStore');
    if(storeEl) issueStore = JSON.parse(storeEl.textContent || '{}');
  } catch(e){ issueStore = null; }
  /* 在 issueStore 中查找指定文件的首条问题 */
  function findFirstIssueByFile(file){
    if(!issueStore) return null;
    var keys = Object.keys(issueStore);
    for(var i=0;i<keys.length;i++){
      if(keys[i].indexOf(file + '#') === 0){
        var items = issueStore[keys[i]];
        if(items && items.length){
          return { file: file, ls: items[0].lineStart, le: items[0].lineEnd, sev: items[0].severity };
        }
      }
    }
    return null;
  }
  /* severity 筛选：点击按钮切换 active，按 data-sev 过滤问题列表；「全部」为默认态 */
  var sevFilterBtns = document.querySelectorAll('.sev-filter .sf-btn');
  var sevFilterClear = document.getElementById('sevFilterClear');
  var sevFilterExport = document.getElementById('sevFilterExport');
  function activeSevs(){
    var active = [];
    sevFilterBtns.forEach(function(b){
      if(b.classList.contains('active') && b.getAttribute('data-sev') !== 'all') active.push(b.getAttribute('data-sev'));
    });
    return active;
  }
  function syncAllBtn(){
    var allBtn = document.querySelector('.sev-filter .sf-btn.all');
    if(allBtn) allBtn.classList.toggle('active', activeSevs().length === 0);
  }
  function applySevFilter(){
    var active = activeSevs();
    document.querySelectorAll('.rule-issue').forEach(function(it){
      var sev = it.getAttribute('data-sev');
      it.style.display = (active.length === 0 || active.indexOf(sev) >= 0) ? '' : 'none';
    });
    syncAllBtn();
  }
  sevFilterBtns.forEach(function(btn){
    btn.addEventListener('click', function(){
      if(btn.getAttribute('data-sev') === 'all'){
        sevFilterBtns.forEach(function(b){ if(b.getAttribute('data-sev') !== 'all') b.classList.remove('active'); });
      } else {
        btn.classList.toggle('active');
      }
      applySevFilter();
    });
  });
  if(sevFilterClear){
    sevFilterClear.addEventListener('click', function(){
      sevFilterBtns.forEach(function(b){ b.classList.remove('active'); });
      applySevFilter();
    });
  }
  /* 导出：把当前筛选出的（可见）问题写成 CSV 下载 */
  function csvCell(s){
    s = String(s == null ? '' : s);
    return /[",\\n\\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportIssuesCsv(){
    var rows = [['严重级别', '条例', '文件', '行号', '问题描述']];
    document.querySelectorAll('.rule-issue').forEach(function(it){
      if(it.style.display === 'none') return;
      var rule = it.querySelector('.ri-rule');
      var msg = it.querySelector('.ri-msg');
      var loc = it.querySelector('.ri-loc');
      rows.push([
        it.getAttribute('data-sev') || '',
        rule ? rule.textContent : '',
        it.getAttribute('data-file') || '',
        loc ? loc.textContent : '',
        msg ? msg.textContent : ''
      ]);
    });
    var csv = rows.map(function(r){ return r.map(csvCell).join(','); }).join('\\r\\n');
    var blob = new Blob(['\\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'review-issues.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }
  if(sevFilterExport){
    sevFilterExport.addEventListener('click', exportIssuesCsv);
  }
  /* 违反条例项点击 → 高亮对应 diff 行区间 + 展开 diff 文件并定位到菜单卡 */
  var ruleItems = document.querySelectorAll('.rule-issue');
  ruleItems.forEach(function(item){
    item.addEventListener('click', function(){
      var file = item.getAttribute('data-file');
      var ls = parseInt(item.getAttribute('data-ls'),10);
      var le = parseInt(item.getAttribute('data-le'),10);
      var sev = item.getAttribute('data-sev') || 'warning';
      if(!file || !le) return;
      /* 清除已有高亮 */
      document.querySelectorAll('.diff-line.hl-blocker, .diff-line.hl-warning, .diff-line.hl-info').forEach(function(l){
        l.classList.remove('hl-blocker','hl-warning','hl-info');
      });
      /* 高亮 [ls, le] 区间 */
      var lines = document.querySelectorAll('.diff-line[data-file="' + cssEsc(file) + '"][data-line]');
      lines.forEach(function(l){
        var ln = parseInt(l.getAttribute('data-line'),10);
        if(ln >= ls && ln <= le) l.classList.add('hl-' + sev);
      });
      var df = findDiffFile(file);
      if(df) df.setAttribute('data-collapsed', 'false');
      expandIssueCard(file, le);
    });
  });
  /* 问题菜单卡点击展开/收纳 */
  document.querySelectorAll('.issue-menu-card .menu-head').forEach(function(head){
    head.addEventListener('click', function(e){
      e.stopPropagation();
      head.closest('.issue-menu-card').classList.toggle('collapsed');
    });
  });
  /* 点击高亮 diff 行 → 找到对应菜单卡并展开 + 滚动 */
  var panel = document.querySelector('.diff-panel');
  if(panel){
    panel.addEventListener('click', function(e){
      var line = e.target.closest('.diff-line.hl-blocker, .diff-line.hl-warning, .diff-line.hl-info');
      if(!line) return;
      var file = line.getAttribute('data-file');
      var ln = parseInt(line.getAttribute('data-line'),10);
      if(!file || !ln) return;
      expandIssueCard(file, ln);
    });
  }
  /* 违反条例项点击 → 展开 diff 文件并定位到对应菜单卡 */
  var ruleItems = document.querySelectorAll('.rule-issue');
  ruleItems.forEach(function(item){
    item.addEventListener('click', function(){
      var file = item.getAttribute('data-file');
      var ls = parseInt(item.getAttribute('data-ls'),10);
      var le = parseInt(item.getAttribute('data-le'),10);
      if(!file || !le) return;
      var df = findDiffFile(file);
      if(df) df.setAttribute('data-collapsed', 'false');
      expandIssueCard(file, le);
    });
  });
  /* 展开 file#lineEnd 对应的菜单卡（取消 collapsed、高亮区间、滚动） */
  function expandIssueCard(file, lineEnd){
    var cards = document.querySelectorAll('.issue-menu-card[data-file="' + cssEsc(file) + '"]');
    var target = null;
    for(var i=0;i<cards.length;i++){
      var le = parseInt(cards[i].getAttribute('data-le'),10);
      if(le === lineEnd){ target = cards[i]; break; }
    }
    if(!target){
      /* 回退：找最接近的 */
      var bestDist = Infinity;
      for(var j=0;j<cards.length;j++){
        var d = Math.abs(parseInt(cards[j].getAttribute('data-le'),10) - lineEnd);
        if(d < bestDist){ bestDist = d; target = cards[j]; }
      }
    }
    if(!target) return;
    var df = target.closest('.diff-file');
    if(df) df.setAttribute('data-collapsed', 'false');
    target.classList.remove('collapsed');
    target.scrollIntoView({behavior:'smooth', block:'center'});
  }
  /* CSS 属性值转义（文件路径含特殊字符时安全用于 querySelector） */
  function cssEsc(s){ return String(s).replace(/["\\\\]/g, '\\\\$&'); }
  /* 查找指定路径对应的 diff 文件块 */
  function findDiffFile(path){
    var all = document.querySelectorAll('.diff-file[data-file]');
    for(var i=0;i<all.length;i++){
      if(all[i].getAttribute('data-file') === path) return all[i];
    }
    return null;
  }
  /* diff 文件表头点击：折叠/展开代码内容 */
  var diffFileHeads = document.querySelectorAll('.diff-file-head');
  diffFileHeads.forEach(function(head){
    head.addEventListener('click', function(){
      var fileEl = head.closest('.diff-file');
      if(!fileEl) return;
      var collapsed = fileEl.getAttribute('data-collapsed') === 'true';
      fileEl.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
    });
  });
  /* 摘要「展开全部 / 收起」按钮：默认仅显示前 10 行 */
  var summaryToggleAll = document.getElementById('summaryToggleAll');
  var summaryBody = document.getElementById('summaryBody');
  if(summaryToggleAll && summaryBody){
    summaryToggleAll.addEventListener('click', function(){
      var expanded = summaryBody.classList.toggle('expanded');
      summaryToggleAll.setAttribute('data-expanded', expanded ? 'true' : 'false');
    });
  }
  /* 左侧变更文件点击：展开对应 diff 文件并定位到首条问题菜单卡 */
  var fileEntries = document.querySelectorAll('.file-entry');
  fileEntries.forEach(function(entry){
    entry.addEventListener('click', function(e){
      e.preventDefault();
      var path = entry.getAttribute('data-file');
      if(!path) return;
      document.querySelectorAll('.file-entry').forEach(function(f){ f.classList.remove('active'); });
      entry.classList.add('active');
      var df = findDiffFile(path);
      if(df){
        df.setAttribute('data-collapsed', 'false');
        var hit = findFirstIssueByFile(path);
        if(hit){
          expandIssueCard(hit.file, hit.le);
        } else {
          df.scrollIntoView({behavior:'smooth', block:'start'});
        }
      }
    });
  });
  var btn = document.getElementById('pushBtn');
  var commitInput = document.getElementById('commitMsg');
  // 提交按钮只在用户输入非空 commit 信息后启用
  function syncBtn(){
    if(!btn || !commitInput) return;
    btn.disabled = !commitInput.value || !commitInput.value.trim();
  }
  if(commitInput){
    commitInput.addEventListener('input', syncBtn);
    commitInput.addEventListener('change', syncBtn);
    syncBtn(); // 预填了 HEAD 提交信息时，初始即启用按钮
  }
  if(btn){
    btn.addEventListener('click', async function(){
      var out = document.getElementById('pushResult');
      var id = encodeURIComponent((location.pathname.split('/').filter(Boolean).pop()) || '');
      var message = (commitInput && commitInput.value || '').trim();
      if(!message){
        out.innerHTML = '<span class="bad">请先输入 commit 提交信息</span>';
        return;
      }
      btn.disabled = true;
      var orig = btn.textContent;
      btn.textContent = '提交中...';
      out.innerHTML = '<span class="push-hint">正在提交并推送，请稍候...</span>';
      try{
        var r = await fetch('/reports/' + id + '/push', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ message: message })
        });
        var data = await r.json();
        var h = '';
        if(data.commit){
          var cdesc = data.commit.committed
            ? ('已 commit ' + data.commit.files + ' 个文件')
            : (data.commit.amended ? '已改写最近提交信息（amend）' : '提交信息未变，直接推送');
          h += '<div class="row"><span class="ok">✔ 提交：' + escS(cdesc) + '</span></div>';
          if(data.commit.hash){
            var hh = document.getElementById('headHash');
            var hj = document.getElementById('headSubject');
            if(hh) hh.textContent = data.commit.hash;
            if(hj) hj.textContent = data.commit.subject || '';
          }
        }
        if(Array.isArray(data.pushes)){
          data.pushes.forEach(function(p){
            h += '<div class="row"><span class="' + (p.ok ? 'ok' : 'bad') + '">' + (p.ok ? '✔ ' : '✖ ') + escS(p.name) + '</span><span>' + escS(p.message) + '</span></div>';
          });
        } else if(data.error){
          h = '<span class="bad">' + escS(data.error) + '</span>';
        }
        out.innerHTML = h || '<span class="push-hint">无返回内容</span>';
      } catch(e){
        out.innerHTML = '<span class="bad">推送请求失败：' + escS(e && e.message ? e.message : String(e)) + '</span>';
      } finally {
        btn.textContent = orig;
        syncBtn();
      }
    });
  }
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
  meta?: { repo?: string; ref?: string; repoCwd?: string; targets?: TargetRemote[]; repoTree?: RepoTreeNode[]; reviewedCommit?: string }
): ReportView {
  return formatReport(result, files, gate, { ...meta, pushes });
}