import { diffRaw, diffFiles } from "./git.js";
import type { DiffConfig } from "./config.js";

/** 单个文件的评审单元 */
export interface DiffFile {
  path: string;
  diff: string;
  /** 该文件变更行数约等于 diff 里 + / - 行数 */
  changedLines: number;
  /** 是否因过大被降级为摘要评审 */
  degraded: boolean;
}

/** 简单的 glob → 正则，支持 * ? ** ，用于排除文件 */
export function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "." || c === "+" || c === "(" || c === ")" || c === "$" || c === "^" || c === "{" || c === "}" || c === "[" || c === "]" || c === "|") {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

function isExcluded(path: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    // 允许路径前缀匹配（如 dist/ 命中 dist/a.ts）
    if (p.endsWith("/")) return path.startsWith(p);
    return globToRegExp(p).test(path) || globToRegExp(p).test(path.split("/").pop() || "");
  });
}

function countChangedLines(diff: string): number {
  let n = 0;
  for (const line of diff.split("\n")) {
    const c = line[0];
    if (c === "+" || c === "-") n++;
  }
  return n;
}

/** 把整段 diff 按 `diff --git` 头拆分，返回 { path, diff, changedLines } */
function splitByFile(diffText: string): { path: string; diff: string }[] {
  if (!diffText.trim()) return [];
  const blocks = diffText.split(/\n(?=diff --git )/);
  return blocks.map((b) => {
    const m = b.match(/^diff --git a\/(.*?) b\//);
    const path = m ? m[1] : "(unknown)";
    return { path, diff: b };
  });
}

/**
 * 采集本轮评审的增量 diff：
 * 1. 拉取 diff 与变更文件清单
 * 2. 过滤 exclude 规则
 * 3. 按文件拆分，超大文件标记 degraded 供评审器走摘要逻辑
 */
export async function collectDiff(
  config: DiffConfig,
  cwd?: string
): Promise<DiffFile[]> {
  const raw = await diffRaw(config.scope, config.base, cwd);
  if (!raw.trim()) {
    throw new Error("没有检测到任何代码变更（diff 为空）。请先改动代码并 git add/commit。");
  }

  const changedPaths = await diffFiles(config.scope, config.base, cwd);
  const excludes = config.exclude ?? [];
  const included = new Set(
    changedPaths.filter((p) => !isExcluded(p, excludes))
  );

  const out: DiffFile[] = [];
  for (const f of splitByFile(raw)) {
    if (included.size > 0 && !included.has(f.path)) continue;
    const changedLines = countChangedLines(f.diff);
    const degraded = changedLines > (config.maxFileLines ?? 500);
    out.push({ path: f.path, diff: f.diff, changedLines, degraded });
  }

  if (out.length === 0) {
    throw new Error("变更文件中没有需要评审的代码（可能都被 exclude 过滤了）。");
  }
  return out;
}