import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveApiKey, type ModelConfig, type TargetRemote } from "./config.js";
import type { DiffFile } from "./collector.js";
import type { ReviewIssue, ReviewResult, Severity } from "./gate.js";
import type { CommitInfo } from "./git.js";
import type { PushResult } from "./publisher.js";
import { maskSecrets } from "./redact.js";
import { recordAi } from "./log.js";
import { recordTokenUsage } from "./db.js";

const SEVERITY_DEF = `- "blocker": 阻塞级。会造成 bug / 崩溃 / 安全问题 / 明显逻辑错误，或与本次变更直接相关的严重缺陷。
- "warning": 需要注意。潜在风险、可维护性差、命名混乱、遗漏边界处理，但不必然导致故障。
- "info": 仅INFO。风格、优化空间，不影响合入。`;

/** 允许的严重级别白名单：输出格式由代码强约束，不依赖 prompt 自觉 */
const SEVERITIES: readonly Severity[] = ["blocker", "warning", "info"];
/** 模型给出非法 severity 时的兜底级别（避免脏级别穿透门禁） */
const SEVERITY_FALLBACK: Severity = "warning";
/** 模型未给 category 时的兜底 */
const CATEGORY_FALLBACK = "其他";

/** 评审输出契约：字段定义由代码持有，prompt 仅引用；实际归一以 normalizeIssues 为准 */
const OUTPUT_CONTRACT = `{"summary": "<本文件改动的一句话总结>", "issues": [
  {"file": "<相对路径>", "lineStart": <起始行号>, "lineEnd": <结束行号>, "severity": "blocker|warning|info", "category": "<所属维度>", "message": "<问题描述>", "suggestion": "<修改INFO>"}
]}`;

/** 生成单个文件的评审 prompt */
function buildPrompt(file: DiffFile): string {
  const degradedNote = file.degraded
    ? `\n注意：该文件变更较大，请改为「摘要式评审」，仍列问题但只挑最重要的一条，并在 messages 里给出整体风险概述。`
    : "";
  return [
    `你是一名资深代码评审工程师。请评审以下 git diff。`,
    ``,
    `评审维度（每项问题必须落到具体行号范围 lineStart/lineEnd，禁止空泛评价）：`,
    `1) 正确性：空指针、资源泄露、并发、明显逻辑错误、边界条件`,
    `2) 安全：注入、XSS、硬编码密钥、越权、路径穿越`,
    `3) 可维护性：命名、重复代码、魔法数字、注释缺失`,
    ``,
    `严重级别定义：`,
    SEVERITY_DEF,
    ``,
    `要求：`,
    `- 只输出一个合法的 JSON，不要任何其他文字、代码块标记或解释。`,
    `- JSON 结构（字段契约见代码常量 OUTPUT_CONTRACT，格式由下游归一器兜底）：`,
    OUTPUT_CONTRACT,
    `- 行号取「变更后（新文件）」的行号。问题若跨多行，lineStart/lineEnd 表示起止行号；单行问题二者相等。`,
    `- 没有问题时 issues 返回空数组。没把握就别说，宁缺毋滥，降低误报。`,
    degradedNote,
    ``,
    `文件：${file.path}`,
    `diff：`,
    file.diff,
  ].join("\n");
}

/** 调用 OpenAI/DeepSeek 兼容的 chat/completions 接口。
 *  opts.json=false 时关闭 JSON 模式（自由文本，供 skill 生成复用）；opts.system 追加 system 消息；
 *  opts.source/target/email 仅用于写模型请求日志与 token 用量归属（评审缺省 source=review）。 */
export async function callModel(
  model: ModelConfig,
  userPrompt: string,
  opts: { json?: boolean; system?: string; source?: "review" | "skill"; target?: string; email?: string } = {}
): Promise<string> {
  const apiKey = resolveApiKey(model);
  if (!apiKey) {
    const hint = model.apiKeyEnv
      ? `请设置环境变量 ${model.apiKeyEnv}`
      : "请配置 model.apiKey 或 model.apiKeyEnv";
    throw new Error(`缺少模型 API Key。${hint}`);
  }

  const baseUrl = model.baseUrl.replace(/\/+$/, "");
  const messages: { role: string; content: string }[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: userPrompt });
  // 模型请求日志：只记元数据（耗时 / 字数 / 成败），不落 prompt 正文
  const started = Date.now();
  const promptChars = userPrompt.length + (opts.system?.length ?? 0);
  let ok = false;
  let replyChars = 0;
  let error: string | undefined;
  // 接口回传的真实 token 用量（非流式响应默认带 usage），用于 Token 面板统计
  let usage: { prompt: number; completion: number; total: number } | undefined;
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(model.timeoutMs ?? 120000),
      body: JSON.stringify({
        model: model.model,
        messages,
        temperature: 0.2,
        ...(opts.json === false ? {} : { response_format: { type: "json_object" } }),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`模型接口 ${res.status} ${res.statusText}：${body.slice(0, 500)}`);
    }
    const data: any = await res.json();
    const content = String(data?.choices?.[0]?.message?.content ?? "");
    const u = data?.usage;
    if (u) {
      const prompt = Number(u.prompt_tokens) || 0;
      const completion = Number(u.completion_tokens) || 0;
      usage = { prompt, completion, total: Number(u.total_tokens) || prompt + completion };
    }
    ok = true;
    replyChars = content.length;
    return content;
  } catch (err: any) {
    error = String(err?.message ?? err);
    throw err;
  } finally {
    recordAi({
      source: opts.source ?? "review",
      model: model.model,
      target: opts.target,
      ms: Date.now() - started,
      ok,
      promptChars,
      replyChars,
      error,
    });
    if (ok && usage && usage.total > 0) {
      recordTokenUsage({
        email: opts.email ?? "",
        source: opts.source ?? "review",
        model: model.model,
        promptTokens: usage.prompt,
        completionTokens: usage.completion,
        totalTokens: usage.total,
      });
    }
  }
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
      // severity 走白名单小写归一：非法值兜底为 warning，避免脏级别穿透门禁
      const sevRaw = String(raw.severity ?? "").trim().toLowerCase();
      const severity = (SEVERITIES as readonly string[]).includes(sevRaw)
        ? (sevRaw as Severity)
        : SEVERITY_FALLBACK;
      // 兼容 lineStart/lineEnd 与旧 line 字段，并保证 lineEnd 不小于 lineStart
      const lineStart = Number(raw.lineStart ?? raw.line) || 0;
      const lineEndRaw = Number(raw.lineEnd ?? raw.lineStart ?? raw.line) || lineStart;
      const lineEnd = lineEndRaw >= lineStart ? lineEndRaw : lineStart;
      return {
        file: raw.file || path,
        line: lineStart,
        lineEnd: lineEnd !== lineStart ? lineEnd : undefined,
        severity,
        category: String(raw.category ?? "").trim() || CATEGORY_FALLBACK,
        message: String(raw.message ?? "").trim(),
        suggestion: raw.suggestion ? String(raw.suggestion).trim() : undefined,
      } as ReviewIssue;
    })
    .filter((i: ReviewIssue | null): i is ReviewIssue => i !== null && !!i.message);
}

/** 评审单个文件，返回该文件的结果 */
async function reviewFile(model: ModelConfig, file: DiffFile, email?: string): Promise<ReviewResult> {
  const text = await callModel(model, buildPrompt(file), { target: file.path, email });
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

/** 对数位补零（本地时区时间格式化用） */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 本地时区时间戳，精确到秒：YYYYMMDDHHmmss（与 normalize-review.mjs 命名一致） */
export function logStamp(d: Date = new Date()): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

/** 评审日志目录：默认 ai-flows 仓库内 .agents/skills/ai-flows/log/code-review，可用 AI_REVIEW_LOG_DIR 覆盖。
 *  按模块自身定位，不受 cwd 影响——评审其他仓库时日志仍落在 ai-flows skill 目录，不污染目标仓库。 */
export function reviewLogDir(): string {
  const override = process.env.AI_REVIEW_LOG_DIR;
  if (override) return override;
  // src/reviewer.ts → 上级即仓库根；dist/reviewer.js → 上级同样是仓库根
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  return join(repoRoot, ".agents", "skills", "ai-flows", "log", "code-review");
}

/** 写一份评审日志（时间戳命名，精确到秒）。失败不阻断评审，返回日志路径或 undefined。 */
export function writeReviewLog(result: ReviewResult, files: number): string | undefined {
  try {
    const counts = { blocker: 0, warning: 0, info: 0 };
    for (const i of result.issues) counts[i.severity]++;
    const now = new Date();
    const dir = reviewLogDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${logStamp(now)}.log`);
    const body = [
      "# ai-review 评审规范输出日志",
      `# 时间：${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`,
      `# 参与文件：${files}`,
      `# 统计：total=${result.issues.length} blocker=${counts.blocker} warning=${counts.warning} info=${counts.info}`,
      "--- 标准评审 JSON ---",
      JSON.stringify(
        {
          summary: result.summary,
          // 落盘用标准契约字段名（lineStart/lineEnd），与 normalize-review.mjs 一致
          issues: result.issues.map((i) => ({
            file: i.file,
            lineStart: i.line,
            lineEnd: i.lineEnd ?? i.line,
            severity: i.severity,
            category: i.category,
            message: i.message,
            ...(i.suggestion ? { suggestion: i.suggestion } : {}),
          })),
          counts,
          total: result.issues.length,
        },
        null,
        2
      ),
      "",
    ].join("\n");
    writeFileSync(file, body, "utf8");
    return file;
  } catch {
    return undefined; // 日志失败不影响评审主流程
  }
}

/** 对整批文件评审，合并为一条结果（并落一份时间戳评审日志）。
 *  opts.email 为触发人邮箱，仅用于把本次 token 用量归到本人（外部触发缺省不归属）。 */
export async function reviewBatch(
  files: DiffFile[],
  model: ModelConfig,
  opts: { email?: string } = {}
): Promise<ReviewResult> {
  const perFile = await mapConcurrent(files, 3, (f) => reviewFile(model, f, opts.email));
  const issues = perFile
    .flatMap((r) => r.issues)
    .map((i) => ({
      ...i,
      message: maskSecrets(i.message),
      suggestion: i.suggestion ? maskSecrets(i.suggestion) : undefined,
    }));
  const result: ReviewResult = {
    passed: !issues.some((i) => i.severity === "blocker"),
    summary: maskSecrets(buildSummary(files, perFile)),
    issues,
    stats: {
      filesReviewed: files.length,
      degradedCount: perFile.reduce((n, r) => n + r.stats.degradedCount, 0),
    },
  };
  writeReviewLog(result, files.length);
  return result;
}

// ────────────────────────────────────────────────────────────────
// 报告格式化接口
// 把 AI 返回的结构化 JSON 整理成「视图模型」，供 reporter 直接注入 HTML 模板。
// ────────────────────────────────────────────────────────────────

/** 单条问题的渲染视图 */
export interface ReportIssueView {
  severity: Severity;
  /** "文件:行号" 或 "文件:起始-结束"（无行号时仅文件），用于展示 */
  loc: string;
  /** 联动定位用：文件路径 */
  file: string;
  /** 联动定位用：起始行号 */
  lineStart: number;
  /** 联动定位用：结束行号 */
  lineEnd: number;
  category: string;
  message: string;
  suggestion?: string;
}

/** diff 视图按行拆分的结构，供 reporter 直接渲染 */
export interface DiffLineView {
  type: "add" | "del" | "ctx";
  /** 新增/上下文行的新文件行号；删除行为 undefined */
  newNo?: number;
  /** 删除/上下文行的旧文件行号；新增行为 undefined */
  oldNo?: number;
  text: string;
}

export interface DiffHunkView {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  lines: DiffLineView[];
}

export interface DiffFileView {
  path: string;
  hunks: DiffHunkView[];
}

/** 仓库目录树节点（来自 GitHub Trees API 或本地 fs 递归） */
export interface RepoTreeNode {
  /** 相对仓库根的路径（目录含尾斜杠，文件不含） */
  path: string;
  /** "tree" 目录 / "blob" 文件 */
  type: "tree" | "blob";
  /** 文件大小（字节），目录恒为 0 */
  size?: number;
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
  /** 仓库根路径，供报告服务在「确认提交」时作为 git 推送的工作目录 */
  repoCwd?: string;
  /** 推送目标配置（脱敏：只含 tokenEnv 名，不含 token 明文；供页面按钮触发推送） */
  targets?: TargetRemote[];
  /** 仓库 HEAD 提交元信息（报告服务渲染时实时注入，供提交栏展示与改写预填；可能缺省） */
  head?: CommitInfo;
  /** 代码变更视图：按文件拆分的 hunks，供右侧 diff 面板渲染 */
  diffFiles: DiffFileView[];
  /** 仓库目录树（GitHub Trees API 优先，失败回退本地 fs 递归），供左侧目录树面板渲染；可能缺省 */
  repoTree?: RepoTreeNode[];
}

function formatTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 拼接问题位置文案：单行 "file:N"，跨行 "file:S-E"，无行号 "file" */
function formatLoc(file: string, line: number, lineEnd?: number): string {
  if (!line) return file;
  return lineEnd && lineEnd !== line ? `${file}:${line}-${lineEnd}` : `${file}:${line}`;
}

/**
 * 解析 git unified diff 文本为按行拆分的 hunks。
 * 纯函数，无副作用：按 `@@ -a,b +c,d @@` 切 hunk，逐行推进新旧行号。
 * - ' ' 上下文行（oldNo + newNo 同时推进）
 * - '+' 新增行（只推进 newNo）
 * - '-' 删除行（只推进 oldNo）
 * - '\' No newline 行跳过
 */
export function parseDiff(diffText: string): DiffHunkView[] {
  const hunks: DiffHunkView[] = [];
  const lines = diffText.split("\n");
  let cur: DiffHunkView | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const line of lines) {
    const h = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (h) {
      const oldStart = Number(h[1]);
      const newStart = Number(h[3]);
      const oldCount = h[2] !== undefined ? Number(h[2]) : 1;
      const newCount = h[4] !== undefined ? Number(h[4]) : 1;
      oldNo = oldStart;
      newNo = newStart;
      cur = {
        oldStart,
        oldEnd: oldStart + oldCount - 1,
        newStart,
        newEnd: newStart + newCount - 1,
        lines: [],
      };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue; // hunk 外的文件头（diff --git / index / --- / +++）跳过
    const c = line[0];
    if (c === "+") {
      cur.lines.push({ type: "add", newNo, text: line.slice(1) });
      newNo++;
    } else if (c === "-") {
      cur.lines.push({ type: "del", oldNo, text: line.slice(1) });
      oldNo++;
    } else if (c === "\\") {
      // "No newline at end of file" 标记，跳过不渲染
      continue;
    } else if (c === " ") {
      cur.lines.push({ type: "ctx", oldNo, newNo, text: line.slice(1) });
      oldNo++;
      newNo++;
    }
    // 其余（含空行，hunk 内真正的空上下文行是 " "）跳过，避免行号错乱
  }
  return hunks;
}

/**
 * 【格式化接口】把 AI 返回的评审结果 + 门禁判定整理成 ReportView。
 * reporter 只需消费该视图模型即可渲染 HTML / Markdown，无需关心原始 JSON 结构。
 */
export function formatReport(
  result: ReviewResult,
  files: DiffFile[],
  gate: { passed: boolean; blockers: ReviewIssue[] },
  meta: { repo?: string; ref?: string; generatedAt?: Date; pushes?: PushResult[]; repoCwd?: string; targets?: TargetRemote[]; repoTree?: RepoTreeNode[] } = {}
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
      file: i.file,
      lineStart: i.line,
      lineEnd: i.lineEnd ?? i.line,
      loc: formatLoc(i.file, i.line, i.lineEnd),
      category: i.category,
      message: i.message,
      suggestion: i.suggestion,
    })),
    pushes: meta.pushes,
    repoCwd: meta.repoCwd,
    targets: meta.targets,
    diffFiles: files.map((f) => ({ path: f.path, hunks: parseDiff(f.diff) })),
    repoTree: meta.repoTree,
  };
}