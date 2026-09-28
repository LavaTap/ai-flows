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
  --bg:#16120c; --surface:#1c1610; --surface-2:#221b14; --elevated:#2a221a;
  --border:rgba(255,196,148,.10); --border-strong:rgba(255,196,148,.20);
  --text:#f7f5f2; --muted:#b3a99d; --dim:#7a7164;
  --accent:#ff724c; --ok:#7adcc0; --warn:#ffd462; --block:#f05545; --info:#86b4ff;
  --accent-soft:rgba(255,114,76,.12); --ok-soft:rgba(122,220,192,.12);
  --warn-soft:rgba(255,212,98,.13); --block-soft:rgba(240,85,69,.13); --info-soft:rgba(134,180,255,.12);
  --flash:rgba(255,212,98,.35);
  --ok-line:rgba(122,220,192,.22); --ok-line-strong:rgba(122,220,192,.4);
  --ok-glow:rgba(122,220,192,.5); --ok-grad-1:rgba(122,220,192,.06); --ok-grad-2:rgba(122,220,192,.02);
  --block-line:rgba(240,85,69,.24); --block-line-strong:rgba(240,85,69,.42);
  --block-glow:rgba(240,85,69,.5); --block-grad-1:rgba(240,85,69,.07); --block-grad-2:rgba(240,85,69,.02);
  --diff-hunk-bg:rgba(255,196,148,.04); --diff-add-bg:rgba(122,220,192,.09); --diff-del-bg:rgba(240,85,69,.09);
  --body-grad-1:rgba(255,114,76,.07); --body-grad-2:rgba(122,220,192,.05);
  --btn-grad-1:rgba(255,114,76,.20); --btn-grad-2:rgba(255,114,76,.08);
  --btn-grad-hover-1:rgba(255,114,76,.30); --btn-grad-hover-2:rgba(255,114,76,.14);
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",Roboto,sans-serif;
}
/* 日间主题：覆盖变量 + 局部硬编码 rgba 适配浅底（前景色整体加深，保证正文/小字达到 WCAG AA 4.5:1） */
[data-theme="light"] {
  --bg:#f6f2ea; --surface:#ffffff; --surface-2:#f1ece3; --elevated:#faf6ef;
  --border:rgba(60,40,20,.10); --border-strong:rgba(60,40,20,.20);
  --text:#2a2018; --muted:#52483f; --dim:#6f6459;
  --accent:#bd411d; --ok:#14754f; --warn:#8a5f00; --block:#bf3222; --info:#2760b8;
  --accent-soft:rgba(189,65,29,.10); --ok-soft:rgba(20,117,79,.10);
  --warn-soft:rgba(138,95,0,.12); --block-soft:rgba(191,50,34,.10); --info-soft:rgba(39,96,184,.10);
  --flash:rgba(138,95,0,.30);
  --ok-line:rgba(20,117,79,.25); --ok-line-strong:rgba(20,117,79,.4);
  --ok-glow:rgba(20,117,79,.45); --ok-grad-1:rgba(20,117,79,.08); --ok-grad-2:rgba(20,117,79,.02);
  --block-line:rgba(191,50,34,.26); --block-line-strong:rgba(191,50,34,.42);
  --block-glow:rgba(191,50,34,.45); --block-grad-1:rgba(191,50,34,.08); --block-grad-2:rgba(191,50,34,.02);
  --diff-hunk-bg:rgba(60,40,20,.04); --diff-add-bg:rgba(20,117,79,.10); --diff-del-bg:rgba(191,50,34,.10);
  --body-grad-1:rgba(189,65,29,.06); --body-grad-2:rgba(20,117,79,.04);
  --btn-grad-1:rgba(189,65,29,.10); --btn-grad-2:rgba(189,65,29,.05);
  --btn-grad-hover-1:rgba(189,65,29,.18); --btn-grad-hover-2:rgba(189,65,29,.09);
}
.theme-toggle { appearance:none; background:var(--surface); border:1px solid var(--border); color:var(--muted); width:34px; height:34px; border-radius:8px; display:inline-grid; place-items:center; cursor:pointer; transition:all 150ms ease; padding:0; }
.theme-toggle:hover { color:var(--text); border-color:var(--border-strong); }
.theme-toggle:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.theme-toggle svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.theme-toggle .icon-sun { display:none; }
[data-theme="light"] .theme-toggle .icon-sun { display:block; }
[data-theme="light"] .theme-toggle .icon-moon { display:none; }
[data-theme="light"] .topbar { background:rgba(255,255,255,.94); }
* { box-sizing:border-box; }
html, body { margin:0; padding:0; background:var(--bg); color:var(--text); font-family:var(--sans); font-size:15px; line-height:1.6; -webkit-font-smoothing:antialiased; }
body {
  background:
    radial-gradient(1200px 600px at 80% -10%, var(--body-grad-1), transparent 60%),
    radial-gradient(900px 500px at 0% 100%, var(--body-grad-2), transparent 60%),
    var(--bg);
  background-attachment:fixed; min-height:100vh;
}
a { color:var(--info); text-decoration:none; }
a:hover { text-decoration:underline; }
.topbar { width:100%; padding:14px 16px; display:flex; align-items:center; justify-content:space-between; gap:16px; border-bottom:1px solid var(--border); background:rgba(22,18,12,.85); backdrop-filter:blur(10px); position:sticky; top:0; z-index:10; }
.brand { display:inline-flex; align-items:center; gap:10px; font-weight:700; letter-spacing:-.2px; font-size:15px; }
.brand-mark { width:22px; height:22px; border-radius:6px; background:linear-gradient(145deg,#ff9a71 0%,#ff724c 60%,#e95235 100%); box-shadow:0 0 12px rgba(255,112,69,.45), inset 0 1px 0 rgba(255,255,255,.3); position:relative; }
.brand-mark::before, .brand-mark::after { content:""; position:absolute; left:50%; transform:translateX(-50%); border-left:4px solid transparent; border-right:4px solid transparent; }
.brand-mark::before { top:4px; border-bottom:5px solid #1a130c; }
.brand-mark::after { bottom:4px; border-top:5px solid #1a130c; }
.back-link { font-size:13px; color:var(--muted); padding:6px 12px; border:1px solid var(--border); border-radius:8px; transition:all 150ms ease; }
.back-link:hover { color:var(--text); border-color:var(--border-strong); background:var(--surface); text-decoration:none; }
.main { width:100%; padding:16px 16px 28px; }
.verdict { display:flex; align-items:center; gap:22px; padding:26px 28px; background:linear-gradient(180deg, var(--ok-grad-1), var(--ok-grad-2)); border:1px solid var(--ok-line); border-radius:14px; position:relative; overflow:hidden; }
.verdict::before { content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--ok); box-shadow:0 0 18px var(--ok-glow); }
.verdict-icon { width:52px; height:52px; flex:0 0 auto; border-radius:50%; display:grid; place-items:center; background:var(--ok-soft); border:1px solid var(--ok-line-strong); }
.verdict-icon svg { width:26px; height:26px; stroke:var(--ok); }
.verdict-text { flex:1; min-width:0; }
.verdict-text h1 { margin:0 0 4px; font-size:26px; font-weight:700; letter-spacing:-.5px; }
.verdict-meta { margin:0; font-size:13.5px; color:var(--muted); font-family:var(--mono); }
.verdict-pill { flex:0 0 auto; align-self:flex-start; padding:6px 14px; border-radius:999px; font-size:12px; font-weight:700; letter-spacing:1.5px; color:var(--ok); background:var(--ok-soft); border:1px solid var(--ok-line-strong); }
/* 未通过态 */
.verdict.block { background:linear-gradient(180deg, var(--block-grad-1), var(--block-grad-2)); border-color:var(--block-line); }
.verdict.block::before { background:var(--block); box-shadow:0 0 18px var(--block-glow); }
.verdict.block .verdict-icon { background:var(--block-soft); border-color:var(--block-line-strong); }
.verdict.block .verdict-icon svg { stroke:var(--block); }
.verdict-pill.block { color:var(--block); background:var(--block-soft); border-color:var(--block-line-strong); }
.topbar-actions { display:inline-flex; align-items:center; gap:8px; }
.summary { margin-top:18px; padding:18px 22px; background:var(--surface); border:1px solid var(--border); border-radius:12px; }
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
.stats { margin-top:26px; display:grid; grid-template-columns:repeat(6,1fr); gap:12px; }
.stat { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px 18px; position:relative; overflow:hidden; }
.stat .num { font-size:28px; font-weight:700; font-variant-numeric:tabular-nums; letter-spacing:-1px; line-height:1.1; }
.stat .lbl { margin-top:4px; font-size:12px; color:var(--dim); letter-spacing:.2px; }
.stat .bar { position:absolute; left:0; top:0; bottom:0; width:2px; background:transparent; }
.stat.n-red .num { color:var(--block); } .stat.n-red .bar { background:var(--block); }
.stat.n-yellow .num { color:var(--warn); } .stat.n-yellow .bar { background:var(--warn); }
.stat.n-green .num { color:var(--ok); } .stat.n-green .bar { background:var(--ok); }
.stat.sev-tog { cursor:pointer; transition:border-color 150ms ease, box-shadow 150ms ease; }
.stat.sev-tog:hover { border-color:var(--border-strong); }
.stat.sev-tog.active { box-shadow:0 0 0 2px var(--accent); }
.stat.n-red.active { box-shadow:0 0 0 2px var(--block); }
.stat.n-yellow.active { box-shadow:0 0 0 2px var(--warn); }
.stat.n-green.active { box-shadow:0 0 0 2px var(--ok); }
.filter-clear { display:none; align-items:center; gap:6px; font-size:12px; color:var(--accent); cursor:pointer; padding:2px 10px; border:1px solid var(--accent); border-radius:999px; background:var(--accent-soft); user-select:none; }
.filter-clear:hover { text-decoration:underline; }
.filter-clear.show { display:inline-flex; }
.issue.hidden { display:none; }
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
.push-btn { appearance:none; border:1px solid var(--accent); background:linear-gradient(180deg, var(--btn-grad-1), var(--btn-grad-2)); color:var(--accent); font-family:var(--sans); font-size:14px; font-weight:700; letter-spacing:.3px; padding:10px 22px; border-radius:10px; cursor:pointer; transition:all 150ms ease; }
.push-btn:hover:not(:disabled) { background:linear-gradient(180deg, var(--btn-grad-hover-1), var(--btn-grad-hover-2)); box-shadow:0 0 0 3px var(--accent-soft); }
.push-btn:active:not(:disabled) { transform:translateY(1px); }
.push-btn:disabled { opacity:.6; cursor:not-allowed; border-color:var(--border-strong); color:var(--muted); background:var(--surface-2); }
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
.workspace { display:grid; grid-template-columns:320px 1fr; gap:14px; align-items:stretch; }
/* 左侧：单一面板，内含仓库目录/变更文件/违反条例三段，冻结不随页面滚动 */
.left-stack { position:sticky; top:64px; height:calc(100vh - 84px); }
.left-panel { height:100%; background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow:hidden; display:flex; flex-direction:column; }
.left-panel-body { flex:1; min-height:0; overflow:auto; }
.left-panel-body::-webkit-scrollbar { width:6px; }
.left-panel-body::-webkit-scrollbar-thumb { background:var(--border-strong); border-radius:3px; }
.left-section { border-bottom:1px solid var(--border); }
.left-section:last-child { border-bottom:none; }
.left-summary { padding:11px 14px; cursor:pointer; font-size:12px; font-weight:700; letter-spacing:1px; color:var(--dim); background:var(--surface-2); display:flex; align-items:center; gap:8px; list-style:none; }
.left-summary::-webkit-details-marker { display:none; }
.left-summary .icon { font-size:14px; }
.left-summary .count { margin-left:auto; font-family:var(--mono); font-size:10.5px; padding:1px 7px; border-radius:999px; background:var(--accent-soft); color:var(--accent); }
.left-sec-body { padding:4px 0; }
/* 违反条例列表（按 category 分组） */
.rule-list { padding:2px 0; }
.rule-item { display:flex; align-items:center; gap:8px; padding:8px 14px; border-bottom:1px solid var(--border); cursor:pointer; transition:background 150ms ease; }
.rule-item:last-child { border-bottom:none; }
.rule-item:hover { background:var(--surface-2); }
.rule-item .rule-sev { flex:0 0 auto; width:8px; height:8px; border-radius:50%; }
.rule-item .rule-sev.blocker { background:var(--block); box-shadow:0 0 6px var(--block); }
.rule-item .rule-sev.warning { background:var(--warn); box-shadow:0 0 6px var(--warn); }
.rule-item .rule-sev.info { background:var(--ok); box-shadow:0 0 6px var(--ok); }
.rule-item .rule-name { flex:1; min-width:0; font-size:12px; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rule-item .rule-count { flex:0 0 auto; font-size:10.5px; font-weight:700; padding:1px 8px; border-radius:999px; background:var(--accent-soft); color:var(--accent); }

/* 右栏 */
.right-col { display:flex; flex-direction:column; gap:12px; min-width:0; flex:1; min-height:0; }
/* 评审结果板块：可折叠 */
.result-section { background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow:hidden; }
.result-head { padding:11px 16px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:10px; cursor:pointer; user-select:none; background:var(--surface-2); }
.result-head h2 { margin:0; font-size:13px; font-weight:700; letter-spacing:.5px; }
.result-head .result-caret { flex:0 0 auto; font-size:11px; color:var(--dim); transition:transform 200ms ease; }
.result-section.collapsed .result-caret { transform:rotate(-90deg); }
.result-body { padding:14px 16px 16px; }
.result-section.collapsed .result-body { display:none; }
.result-body .verdict { margin:0; }
.result-body .summary { margin-top:12px; }
.result-body .stats { margin-top:14px; }
.result-body .pushes { margin-top:14px; }

/* 提交按钮（顶栏） */
.submit-toggle { appearance:none; border:1px solid var(--accent); background:linear-gradient(180deg, var(--btn-grad-1), var(--btn-grad-2)); color:var(--accent); font-family:var(--sans); font-size:13px; font-weight:700; padding:7px 16px; border-radius:8px; cursor:pointer; transition:all 150ms ease; display:inline-flex; align-items:center; gap:6px; }
.submit-toggle:hover { background:linear-gradient(180deg, var(--btn-grad-hover-1), var(--btn-grad-hover-2)); box-shadow:0 0 0 3px var(--accent-soft); }
.submit-toggle .dot { width:7px; height:7px; border-radius:50%; background:var(--accent); box-shadow:0 0 8px var(--accent); }
/* 确认提交栏（顶栏下方展开） */
.submit-bar-wrap { max-height:0; overflow:hidden; transition:max-height 300ms ease; }
.submit-bar-wrap.open { max-height:300px; }
.submit-bar { margin:10px 16px 0; padding:14px 20px; background:var(--surface); border:1px solid var(--border); border-radius:12px; display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
/* 代码变更区（右侧，可滚动） */
.diff-panel { background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow:auto; display:flex; flex-direction:column; flex:1; min-height:0; }
.diff-panel-head { padding:12px 16px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:10px; background:var(--surface-2); position:sticky; top:0; z-index:2; }
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
.diff-line.add { background:var(--diff-add-bg); }
.diff-line.add .content { color:var(--ok); }
.diff-line.del { background:var(--diff-del-bg); }
.diff-line.del .content { color:var(--block); }
.diff-line.ctx .content { color:var(--muted); }
.diff-line.target { animation:flash 1.4s ease-out; box-shadow:inset 3px 0 0 var(--warn); }
.diff-line.target-range { background:var(--warn-soft); box-shadow:inset 3px 0 0 var(--warn); }
/* 点击问题项按 severity 高亮区间（blocker 红 / warning 琥珀 / info 青绿，遵守禁蓝色约束） */
.diff-line.hl-blocker { background:rgba(173,49,77,.20); box-shadow:inset 3px 0 0 var(--block); }
.diff-line.hl-warning { background:var(--warn-soft); box-shadow:inset 3px 0 0 var(--warn); }
.diff-line.hl-info { background:var(--ok-soft); box-shadow:inset 3px 0 0 var(--ok); }
/* 堆叠菜单（点击问题项在 diff 区间末尾展开；卡片默认折叠，点击 head 展开） */
.issue-menu { margin:6px 0 10px; padding:0; border-radius:10px; overflow:hidden; display:flex; flex-direction:column; gap:8px; background:var(--surface-2); border:1px solid var(--border-strong); }
.issue-menu-card { padding:10px 14px; border-left:3px solid var(--dim); background:var(--surface); border-radius:8px; }
.issue-menu-card.sev-blocker { border-left-color:var(--block); background:var(--block-soft); }
.issue-menu-card.sev-warning { border-left-color:var(--warn); background:var(--warn-soft); }
.issue-menu-card.sev-info { border-left-color:var(--ok); background:var(--ok-soft); }
.issue-menu-card .menu-head { display:flex; align-items:center; gap:8px; margin-bottom:0; flex-wrap:wrap; cursor:pointer; user-select:none; }
.issue-menu-card:not(.collapsed) .menu-head { margin-bottom:6px; }
.issue-menu-card .menu-head .menu-caret { flex:0 0 auto; font-size:10px; color:var(--dim); transition:transform 200ms ease; display:inline-block; }
.issue-menu-card:not(.collapsed) .menu-head .menu-caret { transform:rotate(90deg); }
.issue-menu-card.collapsed .menu-body { display:none; }
.issue-menu-card .menu-head .sev { font-size:10.5px; font-weight:700; letter-spacing:1px; text-transform:uppercase; padding:2px 7px; border-radius:4px; }
.issue-menu-card .menu-head .sev.blocker { background:var(--block); color:#fff; }
.issue-menu-card .menu-head .sev.warning { background:var(--warn); color:#1a130c; }
.issue-menu-card .menu-head .sev.info { background:var(--ok); color:#1a130c; }
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
.tree-root > summary, .tree-summary { padding:4px 10px; cursor:pointer; font-size:12.5px; color:var(--muted); display:flex; align-items:center; gap:6px; border-radius:6px; transition:background 120ms ease; list-style:none; }
.tree-root > summary:hover, .tree-summary:hover { background:var(--surface-2); color:var(--text); }
.tree-summary::-webkit-details-marker { display:none; }
.tree-icon { font-size:13px; flex:0 0 auto; }
.tree-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--mono); font-size:12px; }
.tree-list { list-style:none; margin:0; padding:0 0 0 14px; }
.tree-dir, .tree-file { padding:0; margin:0; }
.tree-file { padding:4px 10px; color:var(--dim); font-size:12px; display:flex; align-items:center; gap:6px; border-radius:6px; cursor:default; }
.tree-file:hover { color:var(--muted); background:var(--surface-2); }
.tree-empty { padding:12px 16px; color:var(--dim); font-size:12px; }
/* 变更文件列表（沿用原 .file-list / .file-entry） */
.file-list { list-style:none; margin:0; padding:0; }
.file-entry { display:flex; align-items:center; gap:8px; padding:7px 14px; border-bottom:1px solid var(--border); font-family:var(--mono); font-size:11.5px; color:var(--muted); cursor:pointer; transition:background 150ms ease, color 150ms ease; text-decoration:none; }
.file-entry:last-child { border-bottom:none; }
.file-entry:hover, .file-entry.active { background:var(--surface-2); color:var(--text); text-decoration:none; }
.file-entry .file-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.file-entry .file-count { flex:0 0 auto; font-size:10px; font-weight:700; padding:1px 7px; border-radius:999px; background:var(--accent-soft); color:var(--accent); }
.file-entry .file-count.zero { background:transparent; color:var(--dim); }
.file-empty { padding:18px 16px; text-align:center; color:var(--dim); font-size:12px; }
.empty { padding:18px 16px; text-align:center; color:var(--dim); font-size:12px; }
/* 顶栏左对齐标题 + 右侧账号信息 */
.topbar-left { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
.brand-name { font-weight:700; font-size:14px; }
.page-title { font-family:var(--mono); font-size:13px; color:var(--muted); display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.page-title .sep { color:var(--dim); }
.page-title .here { color:var(--text); font-weight:600; }
.account-info { display:inline-flex; align-items:center; gap:8px; padding:6px 12px; border:1px solid var(--border); border-radius:8px; font-family:var(--mono); font-size:11.5px; color:var(--muted); background:var(--surface); flex-wrap:wrap; max-width:100%; }
.account-info .ai-badge { display:inline-flex; align-items:center; gap:5px; padding:2px 8px; border-radius:999px; background:var(--accent-soft); color:var(--accent); font-weight:700; letter-spacing:.5px; font-size:10.5px; }
.account-info .acc-sep { color:var(--dim); }
.account-info .acc-ref { color:var(--accent); }
.account-info .acc-time { color:var(--muted); }
.account-info .acc-author { color:var(--dim); }
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

/** 顶栏标题 HTML：pipeline / repo / report */
function titleHtml(v: ReportView): string {
  const { pipeline, repo } = titleParts(v);
  return `<span>${esc(pipeline)}</span><span class="sep">/</span><span>${esc(repo)}</span><span class="sep">/</span><span class="here">report</span>`;
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
  const cards: [number, string, string, string][] = [
    [v.filesReviewed, "评审文件", "", ""],
    [v.degradedCount, "降级文件", "", ""],
    [v.total, "问题总数", "", ""],
    [v.counts.blocker, "blocker", "n-red", "sev-tog"],
    [v.counts.warning, "warning", "n-yellow", "sev-tog"],
    [v.counts.info, "info", "n-green", "sev-tog"],
  ];
  return cards
    .map(
      ([num, lbl, cls, tog]) => {
        const sev = tog ? ` data-severity="${lbl}"` : "";
        return `<div class="stat ${cls} ${tog}"${sev}><div class="num">${num}</div><div class="lbl">${lbl}</div><div class="bar"></div></div>`;
      }
    )
    .join("\n    ");
}

/** 违反条例列表：按 category（条例名）分组，统计命中次数，取最高 severity 着色。
 *  点击某项 → 自动展开对应 diff 文件并弹出该条例首条问题的菜单。 */
function ruleList(v: ReportView): string {
  if (!v.issues.length) return `<div class="empty">未发现问题。</div>`;
  const groups = new Map<string, { count: number; sev: string }>();
  const rank: Record<string, number> = { blocker: 3, warning: 2, info: 1 };
  for (const i of v.issues) {
    const g = groups.get(i.category) ?? { count: 0, sev: "info" };
    g.count++;
    if (rank[i.severity] > rank[g.sev]) g.sev = i.severity;
    groups.set(i.category, g);
  }
  const items = [...groups.entries()]
    .sort((a, b) => rank[b[1].sev] - rank[a[1].sev] || b[1].count - a[1].count)
    .map(([cat, g]) => {
      return `<div class="rule-item" data-rule="${esc(cat)}"><span class="rule-sev ${g.sev}"></span><span class="rule-name" title="${esc(cat)}">${esc(cat)}</span><span class="rule-count">${g.count}</span></div>`;
    });
  return `<div class="rule-list">${items.join("\n")}</div>`;
}

/** 右侧 diff 面板：按文件渲染 hunks，新增绿、删除红、上下文灰，行号对应 AI 报告行号。
 *  每个文件默认折叠（仅显示文件名 + 增删行数 + 问题数），点击表头展开。
 *  问题行在渲染时预标注 hl-{severity} 类，便于用户直接看到问题位置并点击展开菜单。 */
function diffPanel(v: ReportView): string {
  if (!v.diffFiles || !v.diffFiles.length) {
    return `<div class="diff-empty">无代码变更数据。</div>`;
  }
  // 按文件统计问题数
  const issueCount = new Map<string, number>();
  for (const i of v.issues) {
    issueCount.set(i.file, (issueCount.get(i.file) ?? 0) + 1);
  }
  // 预计算每行的最高 severity（blocker > warning > info），用于初始高亮
  const sevRank: Record<string, number> = { blocker: 3, warning: 2, info: 1 };
  const lineSev = new Map<string, Map<number, string>>();
  for (const i of v.issues) {
    if (!lineSev.has(i.file)) lineSev.set(i.file, new Map());
    const m = lineSev.get(i.file)!;
    for (let n = i.lineStart; n <= i.lineEnd; n++) {
      const cur = m.get(n);
      if (!cur || sevRank[i.severity] > sevRank[cur]) m.set(n, i.severity);
    }
  }
  return v.diffFiles
    .map((f) => {
      let addCount = 0;
      let delCount = 0;
      const sevMap = lineSev.get(f.path);
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
              // 预标注问题行高亮
              const hlCls =
                l.newNo !== undefined && sevMap?.has(l.newNo)
                  ? ` hl-${sevMap.get(l.newNo)}`
                  : "";
              return `      <div class="diff-line ${l.type}${hlCls}"${dataLine}>
        <span class="gutter">${oldG}</span>
        <span class="gutter">${newG}</span>
        <code class="content">${esc(l.text)}</code>
      </div>`;
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
<meta name="theme-color" content="#16120c" />
<title>AI 代码评审报告 · ai-review</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%23ff724c'/%3E%3Cpath d='M7 8l5 5 5-5' stroke='%231a130c' stroke-width='2.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E" />
<style>${REPORT_CSS}</style>
<script>
  (function(){
    try {
      var t = localStorage.getItem('ai-review-theme');
      if (t !== 'light' && t !== 'dark') t = 'dark';
      document.documentElement.setAttribute('data-theme', t);
    } catch (e) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  })();
</script>
</head>
<body>

<header class="topbar">
  <div class="topbar-left">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <span class="brand-name">ai-review</span>
    </div>
    <div class="page-title">${titleHtml(v)}</div>
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
            <summary class="left-summary"><span class="icon">📁</span>仓库目录</summary>
            <div class="left-sec-body">${repoTreeHtml(v)}</div>
          </details>
          <details class="left-section" open>
            <summary class="left-summary"><span class="icon">📝</span>变更文件 <span class="count">${v.diffFiles?.length ?? 0}</span></summary>
            <div class="left-sec-body">${filePanel(v)}</div>
          </details>
          <details class="left-section" open>
            <summary class="left-summary"><span class="icon">⚠</span>违反条例 <span class="count">${v.total}</span></summary>
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
          <span class="filter-clear" id="filterClear">清除筛选 &times;</span>
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
    if(meta) meta.setAttribute('content', t === 'light' ? '#f6f2ea' : '#16120c');
    try { localStorage.setItem('ai-review-theme', t); } catch(e){}
  }
  if(meta) meta.setAttribute('content', document.documentElement.getAttribute('data-theme') === 'light' ? '#f6f2ea' : '#16120c');
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
  /* 统计卡点击：定位到该 severity 首条问题并展开 diff + 问题菜单 */
  var sevCards = document.querySelectorAll('.stat.sev-tog[data-severity]');
  var filterClear = document.getElementById('filterClear');
  var currentFilter = null;
  function findFirstIssueBySev(sev){
    if(!issueStore) return null;
    var keys = Object.keys(issueStore);
    for(var i=0;i<keys.length;i++){
      var items = issueStore[keys[i]];
      for(var j=0;j<items.length;j++){
        if(items[j].severity === sev){
          var parts = keys[i].split('#');
          return { file: parts[0], ls: items[j].lineStart, le: items[j].lineEnd, sev: sev };
        }
      }
    }
    return null;
  }
  function applyFilter(sev){
    currentFilter = sev;
    sevCards.forEach(function(c){
      c.classList.toggle('active', c.getAttribute('data-severity') === sev);
    });
    if(filterClear) filterClear.classList.toggle('show', !!sev);
    if(!sev) return;
    var hit = findFirstIssueBySev(sev);
    if(hit) showIssueMenu(hit.file, hit.ls, hit.le, hit.sev);
  }
  sevCards.forEach(function(c){
    c.addEventListener('click', function(){
      var sev = c.getAttribute('data-severity');
      applyFilter(currentFilter === sev ? null : sev);
    });
  });
  if(filterClear){
    filterClear.addEventListener('click', function(){ applyFilter(null); });
  }
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
  /* 在 issueStore 中查找指定条例（category）的首条问题 */
  function findFirstIssueByRule(rule){
    if(!issueStore) return null;
    var keys = Object.keys(issueStore);
    for(var i=0;i<keys.length;i++){
      var items = issueStore[keys[i]];
      for(var j=0;j<items.length;j++){
        if(items[j].category === rule){
          var parts = keys[i].split('#');
          return { file: parts[0], ls: items[j].lineStart, le: items[j].lineEnd, sev: items[j].severity };
        }
      }
    }
    return null;
  }
  /* 点击高亮 diff 行 → 弹出该行问题菜单 */
  var panel = document.querySelector('.diff-panel');
  var issueStore = null;
  try {
    var storeEl = document.getElementById('issueStore');
    if(storeEl) issueStore = JSON.parse(storeEl.textContent || '{}');
  } catch(e){ issueStore = null; }
  if(panel){
    panel.addEventListener('click', function(e){
      var line = e.target.closest('.diff-line.hl-blocker, .diff-line.hl-warning, .diff-line.hl-info');
      if(!line) return;
      var file = line.getAttribute('data-file');
      var ln = parseInt(line.getAttribute('data-line'),10);
      if(!file || !ln) return;
      // 在 issueStore 中找覆盖该行的问题
      var hit = null;
      var keys = Object.keys(issueStore || {});
      for(var i=0;i<keys.length;i++){
        if(keys[i].indexOf(file + '#') !== 0) continue;
        var items = issueStore[keys[i]];
        for(var j=0;j<items.length;j++){
          if(ln >= items[j].lineStart && ln <= items[j].lineEnd){
            hit = { file: file, ls: items[j].lineStart, le: items[j].lineEnd, sev: items[j].severity };
            break;
          }
        }
        if(hit) break;
      }
      if(hit) showIssueMenu(hit.file, hit.ls, hit.le, hit.sev);
    });
  }
  /* 违反条例项点击 → 展开该条例首条问题的菜单 */
  var ruleItems = document.querySelectorAll('.rule-item');
  ruleItems.forEach(function(item){
    item.addEventListener('click', function(){
      var rule = item.getAttribute('data-rule');
      if(!rule) return;
      var hit = findFirstIssueByRule(rule);
      if(hit) showIssueMenu(hit.file, hit.ls, hit.le, hit.sev);
    });
  });
  function clearIssueMenus(){
    document.querySelectorAll('.issue-menu').forEach(function(el){ el.remove(); });
  }
  function clearHighlight(){
    panel.querySelectorAll('.diff-line').forEach(function(l){
      l.classList.remove('hl-blocker','hl-warning','hl-info','target','target-range');
    });
  }
  function highlightRange(file, ls, le, sev){
    var cls = 'hl-' + (sev === 'blocker' ? 'blocker' : (sev === 'warning' ? 'warning' : 'info'));
    var firstHit = null;
    var bestDist = Infinity;
    panel.querySelectorAll('.diff-line[data-line]').forEach(function(l){
      if(l.getAttribute('data-file') !== file) return;
      var n = parseInt(l.getAttribute('data-line'),10);
      if(n >= ls && n <= le){
        l.classList.add(cls);
        if(!firstHit) firstHit = l;
      }
    });
    if(!firstHit){
      panel.querySelectorAll('.diff-line[data-line]').forEach(function(l){
        if(l.getAttribute('data-file') !== file) return;
        var n = parseInt(l.getAttribute('data-line'),10);
        var diff = Math.abs(n - ls);
        if(diff < bestDist){ bestDist = diff; firstHit = l; }
      });
      if(firstHit) firstHit.classList.add(cls);
    }
    return firstHit;
  }
  function buildMenuHtml(items){
    return items.map(function(it){
      var sev = it.severity || 'info';
      var sevCls = 'sev-' + (sev === 'blocker' ? 'blocker' : (sev === 'warning' ? 'warning' : 'info'));
      var sug = it.suggestion ? '<div class="menu-sug"><span class="tag">INFO</span><p>' + escS(it.suggestion) + '</p></div>' : '';
      /* 默认展开：severity + rule + loc + 问题描述 + 建议，一直显示不折叠 */
      return '<div class="issue-menu-card ' + sevCls + '">' +
        '<div class="menu-head"><span class="sev ' + sev + '">' + escS(sev) + '</span><code class="rule">' + escS(it.category || '') + '</code><code class="loc">' + escS(it.loc || '') + '</code></div>' +
        '<div class="menu-body"><p class="menu-msg">' + escS(it.message || '') + '</p>' + sug + '</div></div>';
    }).join('');
  }
  function showIssueMenu(file, ls, le, sev){
    clearIssueMenus();
    clearHighlight();
    var df = findDiffFile(file);
    if(!df) return;
    df.setAttribute('data-collapsed', 'false');
    var body = df.querySelector('.diff-file-body');
    if(!body) return;
    var anchor = highlightRange(file, ls, le, sev);
    /* 找 le 对应的行作为菜单插入点；找不到则取 anchor */
    var insertAfter = null;
    if(le){
      body.querySelectorAll('.diff-line[data-line]').forEach(function(l){
        if(l.getAttribute('data-file') !== file) return;
        if(parseInt(l.getAttribute('data-line'),10) === le) insertAfter = l;
      });
    }
    if(!insertAfter) insertAfter = anchor;
    if(!insertAfter) return;
    /* 从 issueStore 取该区间所有问题堆叠渲染 */
    var key = file + '#' + le;
    var items = (issueStore && issueStore[key]) || [];
    if(!items.length){
      items = [{ severity: sev, category: '', message: '', loc: ls === le ? 'L' + ls : ('L' + ls + '-' + le) }];
    }
    var menu = document.createElement('div');
    menu.className = 'issue-menu';
    menu.innerHTML = buildMenuHtml(items);
    /* 在 insertAfter 行后插入菜单（若是最后一个子元素则 appendChild） */
    if(insertAfter.nextSibling && insertAfter.parentNode){
      insertAfter.parentNode.insertBefore(menu, insertAfter.nextSibling);
    } else {
      body.appendChild(menu);
    }
    menu.scrollIntoView({behavior:'smooth', block:'center'});
  }
  /* 查找指定路径对应的 diff 文件块（用属性值逐项比较，避免 CSS 选择器转义问题） */
  function findDiffFile(path){
    var all = document.querySelectorAll('.diff-file[data-file]');
    for(var i=0;i<all.length;i++){
      if(all[i].getAttribute('data-file') === path) return all[i];
    }
    return null;
  }
  /* diff 文件表头点击：折叠/展开代码内容（默认折叠，仅显示文件名 + 问题数） */
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
  /* 左侧变更文件点击：展开对应 diff 文件并弹出首条问题菜单 */
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
          showIssueMenu(hit.file, hit.ls, hit.le, hit.sev);
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
  meta?: { repo?: string; ref?: string; repoCwd?: string; targets?: TargetRemote[]; repoTree?: RepoTreeNode[] }
): ReportView {
  return formatReport(result, files, gate, { ...meta, pushes });
}