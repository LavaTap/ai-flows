import { resolveApiKey, type ModelConfig } from "./config.js";
import type { DiffFile } from "./collector.js";
import type { ReviewIssue, ReviewResult, Severity } from "./gate.js";

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

/** 对整批文件评审，合并为一条结果 */
export async function reviewBatch(
  files: DiffFile[],
  model: ModelConfig
): Promise<ReviewResult> {
  const perFile = await mapConcurrent(files, 3, (f) => reviewFile(model, f));
  const issues = perFile.flatMap((r) => r.issues);
  const summary = perFile.map((r) => r.summary).join(" ");
  return {
    passed: !issues.some((i) => i.severity === "blocker"),
    summary,
    issues,
    stats: {
      filesReviewed: files.length,
      degradedCount: perFile.reduce((n, r) => n + r.stats.degradedCount, 0),
    },
  };
}