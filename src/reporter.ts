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