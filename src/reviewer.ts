import { resolveApiKey, type ModelConfig } from "./config.js";
import type { DiffFile } from "./collector.js";
import type { ReviewIssue, ReviewResult, Severity } from "./gate.js";
import type { PushResult } from "./publisher.js";
import { maskSecrets } from "./redact.js";

const SEVERITY_DEF = `- "blocker": 阻塞级。会造成 bug / 崩溃 / 安全问题 / 明显逻辑错误，或与本次变更直接相关的严重缺陷。
- "warning": 需要注意。潜在风险、可维护性差、命名混乱、遗漏边界处理，但不必然导致故障。
- "info": 仅建议。风格、优化空间，不影响合入。`;

/** 生成单个文件的评审 prompt */
function buildPrompt(file: DiffFile): string {
  const degradedNote = file.degraded
    ? `\n注意：该文件变更较大，请改为「摘要式评审」，仍列问题但只挑最重要的一条，并在 messages 里给出整体风险概述。`
    : "";
  return [
    `你是一名资深代码评审工程师。请评审以下 git diff。`,
    ``,
    `评审维度（每项问题必须落到具体行号，禁止空泛评价）：`,
    `1) 正确性：空指针、资源泄露、并发、明显逻辑错误、边界条件`,
    `2) 安全：注入、XSS、硬编码密钥、越权、路径穿越`,
    `3) 可维护性：命名、重复代码、魔法数字、注释缺失`,
    ``,
    `严重级别定义：`,
    SEVERITY_DEF,
    ``,
    `要求：`,
    `- 只输出一个合法的 JSON，不要任何其他文字、代码块标记或解释。`,
    `- JSON 结构：`,
    `{"summary": "<本文件改动的一句话总结>", "issues": [`,
    `  {"file": "<相对路径>", "line": <行号>, "severity": "blocker|warning|info", "category": "<所属维度>", "message": "<问题描述>", "suggestion": "<修改建议>"}`,
    `]}`,
    `- 没有问题时 issues 返回空数组。没把握就别说，宁缺毋滥，降低误报。`,
    degradedNote,
    ``,
    `文件：${file.path}`,
    `diff：`,
    file.diff,
  ].join("\n");
}

/** 调用 OpenAI/DeepSeek 兼容的 chat/completions 接口 */
async function callModel(
  model: ModelConfig,
  userPrompt: string
): Promise<string> {
  const apiKey = resolveApiKey(model);
  if (!apiKey) {
    const hint = model.apiKeyEnv
      ? `请设置环境变量 ${model.apiKeyEnv}`
      : "请配置 model.apiKey 或 model.apiKeyEnv";
    throw new Error(`缺少模型 API Key。${hint}`);
  }

  const baseUrl = model.baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(model.timeoutMs ?? 120000),
    body: JSON.stringify({
      model: model.model,
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`模型接口 ${res.status} ${res.statusText}：${body.slice(0, 500)}`);
  }
  const data: any = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  return String(content);
}

/** 从模型输出中尽力提取 JSON */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // 尝试截取第一个 { 到最后一个 } 或 [ 到 ]
    const objStart = trimmed.indexOf("{");
    const arrStart = trimmed.indexOf("[");
    const start =
      objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);
    if (start !== -1) {
      const isObj = trimmed[start] === "{";
      const end = trimmed.lastIndexOf(isObj ? "}" : "]");
      if (end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
          /* fallthrough */
        }
      }
    }
  }
  throw new Error("模型输出不是合法 JSON，请重试或调整 prompt");
}

function normalizeIssues(parsed: any, path: string): ReviewIssue[] {
  const arr = Array.isArray(parsed) ? parsed : parsed?.issues;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((raw: any) => {
      if (!raw || typeof raw !== "object") return null;
      const sev = String(raw.severity || "warning") as Severity;
      return {
        file: raw.file || path,
        line: Number(raw.line) || 0,
        severity: sev,
        category: raw.category || "其他",
        message: String(raw.message || ""),
        suggestion: raw.suggestion ? String(raw.suggestion) : undefined,
      } as ReviewIssue;
    })
    .filter((i: ReviewIssue | null): i is ReviewIssue => i !== null && !!i.message);
}

/** 评审单个文件，返回该文件的结果 */
async function reviewFile(model: ModelConfig, file: DiffFile): Promise<ReviewResult> {
  const text = await callModel(model, buildPrompt(file));
  const parsed = extractJson(text);
  const summary =
    (parsed && typeof parsed === "object" && typeof (parsed as any).summary === "string"
      ? (parsed as any).summary
      : "") || `已评审 ${file.path}`;

  let issues: ReviewIssue[];
  if (file.degraded) {
    // 降级文件仅保留最重要的一条，避免淹没
    const all = normalizeIssues(parsed, file.path);
    issues = all.slice(0, 1);
  } else {
    issues = normalizeIssues(parsed, file.path);
  }

  // 行号补全：若缺失，尝试从 issue 所在 diff 片段反推；此处简化不填时标记 0
  return {
    passed: !issues.some((i) => i.severity === "blocker"),
    summary,
    issues,
    stats: { filesReviewed: 1, degradedCount: file.degraded ? 1 : 0 },
  };
}

/** 简单并发池，避免触发模型限流 */
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/**
 * 汇总各文件的一句话总结：按描述去重，相同描述的文件合并为一行。
 * 避免同一类改动（如批量生成的报告文件）产生大段重复摘要。
 */
function buildSummary(files: DiffFile[], perFile: ReviewResult[]): string {
  const groups = new Map<string, string[]>();
  perFile.forEach((r, i) => {
    const s = (r.summary || `已评审 ${files[i].path}`).trim();
    const paths = groups.get(s) ?? [];
    paths.push(files[i].path);
    groups.set(s, paths);
  });
  const lines = [...groups.entries()].map(([s, paths]) =>
    paths.length > 1 ? `- ${s}（共 ${paths.length} 个文件）` : `- ${s}（${paths[0]}）`
  );
  return `共 ${files.length} 个文件参与评审：\n${lines.join("\n")}`;
}

/** 对整批文件评审，合并为一条结果 */
export async function reviewBatch(
  files: DiffFile[],
  model: ModelConfig
): Promise<ReviewResult> {
  const perFile = await mapConcurrent(files, 3, (f) => reviewFile(model, f));
  const issues = perFile
    .flatMap((r) => r.issues)
    .map((i) => ({
      ...i,
      message: maskSecrets(i.message),
      suggestion: i.suggestion ? maskSecrets(i.suggestion) : undefined,
    }));
  return {
    passed: !issues.some((i) => i.severity === "blocker"),
    summary: maskSecrets(buildSummary(files, perFile)),
    issues,
    stats: {
      filesReviewed: files.length,
      degradedCount: perFile.reduce((n, r) => n + r.stats.degradedCount, 0),
    },
  };
}

// ────────────────────────────────────────────────────────────────
// 报告格式化接口
// 把 AI 返回的结构化 JSON 整理成「视图模型」，供 reporter 直接注入 HTML 模板。
// ────────────────────────────────────────────────────────────────

/** 单条问题的渲染视图 */
export interface ReportIssueView {
  severity: Severity;
  /** "文件:行号"（无行号时仅文件） */
  loc: string;
  category: string;
  message: string;
  suggestion?: string;
}

/** 评审报告视图模型：模板渲染的唯一输入 */
export interface ReportView {
  passed: boolean;
  /** 生成时间（本地化 "YYYY-MM-DD HH:mm"） */
  generatedAt: string;
  /** 面包屑：仓库名 */
  repo?: string;
  /** 面包屑：分支 / 提交 */
  ref?: string;
  filesReviewed: number;
  degradedCount: number;
  /** 问题总数 */
  total: number;
  counts: { blocker: number; warning: number; info: number };
  /** 问题涉及的去重类别，用于页脚「规则集」 */
  categories: string[];
  summary: string;
  issues: ReportIssueView[];
  /** 可选的推送结果（有 target 时展示） */
  pushes?: PushResult[];
}

function formatTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 【格式化接口】把 AI 返回的评审结果 + 门禁判定整理成 ReportView。
 * reporter 只需消费该视图模型即可渲染 HTML / Markdown，无需关心原始 JSON 结构。
 */
export function formatReport(
  result: ReviewResult,
  gate: { passed: boolean; blockers: ReviewIssue[] },
  meta: { repo?: string; ref?: string; generatedAt?: Date; pushes?: PushResult[] } = {}
): ReportView {
  const counts = { blocker: 0, warning: 0, info: 0 };
  for (const i of result.issues) {
    if (i.severity === "blocker") counts.blocker++;
    else if (i.severity === "warning") counts.warning++;
    else counts.info++;
  }
  const categories = [...new Set(result.issues.map((i) => i.category).filter(Boolean))];
  return {
    passed: gate.passed,
    generatedAt: formatTime(meta.generatedAt ?? new Date()),
    repo: meta.repo,
    ref: meta.ref,
    filesReviewed: result.stats.filesReviewed,
    degradedCount: result.stats.degradedCount,
    total: result.issues.length,
    counts,
    categories,
    summary: result.summary,
    issues: result.issues.map((i) => ({
      severity: i.severity,
      loc: i.line ? `${i.file}:${i.line}` : i.file,
      category: i.category,
      message: i.message,
      suggestion: i.suggestion,
    })),
    pushes: meta.pushes,
  };
}