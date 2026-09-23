import { writeFileSync } from "node:fs";
import type { ReviewResult, ReviewIssue } from "./gate.js";
import type { PushResult } from "./publisher.js";

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
  L.push(`**评审摘要**：${result.summary}`);

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

function badge(severity: string): string {
  const cls =
    severity === "blocker" ? "sev-blocker" : severity === "warning" ? "sev-warning" : "sev-info";
  return `<span class="badge ${cls}">${severity}</span>`;
}

/** 把评审结果渲染成自包含的 HTML 页面 */
export function buildReviewHtml(
  result: ReviewResult,
  gate: GateSummary,
  pushes?: PushResult[]
): string {
  const counts = { blocker: 0, warning: 0, info: 0 };
  for (const i of result.issues) {
    if (i.severity === "blocker") counts.blocker++;
    else if (i.severity === "warning") counts.warning++;
    else counts.info++;
  }

  const rows = result.issues
    .map((i) => {
      const loc = i.line ? `${i.file}:${i.line}` : i.file;
      return `<tr>
        <td>${badge(i.severity)}</td>
        <td><code class="loc">${esc(loc)}</code></td>
        <td>${esc(i.category)}</td>
        <td>${esc(i.message)}</td>
        <td class="sug">${esc(i.suggestion ?? "-")}</td>
      </tr>`;
    })
    .join("\n");

  const pushRows = pushes
    ? pushes
        .map(
          (p) =>
            `<tr>
        <td>${esc(p.name)}</td>
        <td>${p.ok ? '<span class="ok">✔ 成功</span>' : '<span class="bad">✖ 失败</span>'}</td>
        <td>${esc(p.message)}</td>
      </tr>`
        )
        .join("\n")
    : "";

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AI 代码评审报告</title>
<style>
  :root { --bg:#0b0f1a; --panel:#111827; --panel2:#0f172a; --border:#1e293b;
          --text:#e2e8f0; --muted:#94a3b8; --accent:#38bdf8; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
         background:var(--bg); color:var(--text); line-height:1.6; }
  .wrap { max-width:1080px; margin:0 auto; padding:32px 24px; }
  h1 { font-size:24px; margin:0 0 4px; }
  .sub { color:var(--muted); font-size:12px; }
  .gate { display:flex; align-items:center; gap:10px; margin:20px 0;
          padding:14px 18px; border-radius:10px; font-weight:600; }
  .gate.pass { background:rgba(16,185,129,.12); border:1px solid #10b981; color:#6ee7b7; }
  .gate.block { background:rgba(239,68,68,.12); border:1px solid #ef4444; color:#fca5a5; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:12px; margin:16px 0; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:14px 16px; }
  .card .num { font-size:26px; font-weight:700; }
  .card .lbl { color:var(--muted); font-size:12px; }
  .card .n-red { color:#f87171; } .card .n-yellow { color:#fbbf24; } .card .n-green { color:#34d399; }
  .summary { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:14px 18px; margin:16px 0; }
  table { width:100%; border-collapse:collapse; margin:16px 0; background:var(--panel);
          border:1px solid var(--border); border-radius:10px; overflow:hidden; }
  th, td { text-align:left; padding:10px 14px; border-bottom:1px solid var(--border); vertical-align:top; }
  th { background:var(--panel2); color:var(--muted); font-weight:600; font-size:13px; }
  tr:last-child td { border-bottom:none; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
  .loc { color:var(--accent); }
  .sug { color:var(--muted); }
  .badge { display:inline-block; padding:1px 8px; border-radius:999px; font-size:11px; font-weight:700; }
  .sev-blocker { background:rgba(239,68,68,.15); color:#f87171; }
  .sev-warning { background:rgba(251,191,36,.13); color:#fbbf24; }
  .sev-info { background:rgba(56,189,248,.13); color:#38bdf8; }
  .ok { color:#34d399; } .bad { color:#f87171; }
  .muted { color:var(--muted); }
  .footer { color:var(--muted); font-size:12px; margin-top:24px; }
  h2 { font-size:16px; margin:24px 0 4px; }
</style>
</head>
<body class="wrap">
  <h1>AI 代码评审报告</h1>
  <div class="sub">由 <b>ai-review</b> 生成 · <span id="ts">${new Date().toISOString()}</span> · <a href="/">← 全部报告</a></div>

  <div class="gate ${gate.passed ? "pass" : "block"}">
    ${gate.passed ? "✔ 评审通过" : `✖ 评审未通过：存在 ${gate.blockers.length} 个阻塞级问题，已拦截`}
  </div>

  <div class="cards">
    <div class="card"><div class="num">${result.stats.filesReviewed}</div><div class="lbl">评审文件</div></div>
    <div class="card"><div class="num">${result.stats.degradedCount}</div><div class="lbl">降级文件</div></div>
    <div class="card"><div class="num">${result.issues.length}</div><div class="lbl">问题总数</div></div>
    <div class="card"><div class="num n-red">${counts.blocker}</div><div class="lbl">blocker</div></div>
    <div class="card"><div class="num n-yellow">${counts.warning}</div><div class="lbl">warning</div></div>
    <div class="card"><div class="num n-green">${counts.info}</div><div class="lbl">info</div></div>
  </div>

  <div class="summary"><b>评审摘要</b><br>${esc(result.summary)}</div>

  ${pushes && pushes.length ? `<h2>目标推送</h2>
  <table><thead><tr><th>目标</th><th>结果</th><th>详情</th></tr></thead>
  <tbody>${pushRows}</tbody></table>` : ""}

  <h2>问题明细</h2>
  ${result.issues.length
    ? `<table><thead><tr><th>严重级别</th><th>位置</th><th>类别</th><th>问题</th><th>建议</th></tr></thead>
       <tbody>${rows}</tbody></table>`
    : "<p class='muted'>未发现问题。</p>"}

  <div class="footer">ai-review · AI 代码评审工作流</div>
</body>
</html>`;
}