import type { ReviewConfig } from "./config.js";

export type Severity = "blocker" | "warning" | "info";

export interface ReviewIssue {
  /** 相对仓库根的文件路径 */
  file: string;
  /** 问题起始行号（约数即可） */
  line: number;
  /** 问题结束行号（缺省 = line，即单行问题） */
  lineEnd?: number;
  severity: Severity;
  category: string;
  message: string;
  suggestion?: string;
}

export interface ReviewResult {
  /** 整体结论是否通过（拦截层基于此判断） */
  passed: boolean;
  /** 简短摘要 */
  summary: string;
  issues: ReviewIssue[];
  stats: { filesReviewed: number; degradedCount: number };
}

/**
 * 门禁判定：只要存在命中 severityBlocked 的 issue，整体即不通过。
 * warning / info 只提示，不阻塞。
 */
export function decideGate(
  result: ReviewResult,
  config: ReviewConfig
): { passed: boolean; blockers: ReviewIssue[]; warnings: ReviewIssue[] } {
  const blockedSet = new Set(config.severityBlocked);
  const blockers = result.issues.filter((i) => blockedSet.has(i.severity));
  const warnings = result.issues.filter((i) => !blockedSet.has(i.severity));
  return { passed: blockers.length === 0, blockers, warnings };
}