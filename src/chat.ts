import { resolveApiKey, type ModelConfig } from "./config.js";
import type { ChatMessage } from "./db.js";

/** 多 provider 默认 endpoint 映射（移植自 ai-chat） */
export const PROVIDER_DEFAULT_ENDPOINTS: Record<string, string> = {
  deepseek: "https://api.deepseek.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  aliyun: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  xfyun: "https://spark-api-open.xf-yun.com/v1",
  bytedance: "https://ark.cn-beijing.volces.com/api/v3",
  baidu: "https://qianfan.baidubce.com/v2",
};

/** 聊天消息（拼装进 LLM prompt 的最小结构） */
export interface ChatPromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 流式调用产出的 chunk */
export interface StreamChunk {
  type: "delta" | "usage" | "done";
  /** 增量文本（type=delta 时有值） */
  delta?: string;
  /** token 用量（type=usage 时有值） */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/**
 * 流式调用 OpenAI/DeepSeek 兼容的 chat/completions 接口。
 * 零依赖：用全局 fetch + ReadableStream 按行解析 SSE chunks（data: {...}\n\n）。
 * 不传 response_format（chat 是自由文本，不走 JSON 模式）。
 */
export async function* callModelStream(
  model: ModelConfig,
  messages: ChatPromptMessage[],
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal } = {}
): AsyncGenerator<StreamChunk> {
  const apiKey = resolveApiKey(model);
  if (!apiKey) {
    const hint = model.apiKeyEnv ? `请设置环境变量 ${model.apiKeyEnv}` : "请配置 model.apiKey 或 model.apiKeyEnv";
    throw new Error(`缺少模型 API Key。${hint}`);
  }

  const baseUrl = (model.baseUrl || "").replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: opts.signal,
    body: JSON.stringify({
      model: model.model,
      messages,
      max_tokens: opts.maxTokens ?? 2000,
      temperature: opts.temperature ?? 0.7,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`模型接口 ${res.status} ${res.statusText}：${body.slice(0, 500)}`);
  }

  if (!res.body) {
    throw new Error("模型响应缺少 body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  // 按行扫描 SSE：data: {...}\n\n 为一个事件块
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = pending.indexOf("\n\n")) !== -1) {
        const block = pending.slice(0, idx);
        pending = pending.slice(idx + 2);
        for (const line of block.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            yield { type: "done" };
            return;
          }
          try {
            const data = JSON.parse(payload) as {
              choices?: { delta?: { content?: string | null } }[];
              usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
            };
            const delta = data.choices?.[0]?.delta?.content;
            if (delta) {
              yield { type: "delta", delta };
            }
            if (data.usage) {
              yield {
                type: "usage",
                usage: {
                  promptTokens: data.usage.prompt_tokens ?? 0,
                  completionTokens: data.usage.completion_tokens ?? 0,
                  totalTokens: data.usage.total_tokens ?? 0,
                },
              };
            }
          } catch {
            // 非法 JSON 行忽略（部分 provider 会发注释行）
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: "done" };
}

/**
 * 非流式调用 chat/completions，一次性返回完整回复文本。
 * 用于记忆压缩（摘要生成）这类内部调用，需要完整文本而非增量流。
 */
export async function callModelOnce(
  model: ModelConfig,
  messages: ChatPromptMessage[],
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal } = {}
): Promise<string> {
  const apiKey = resolveApiKey(model);
  if (!apiKey) {
    const hint = model.apiKeyEnv ? `请设置环境变量 ${model.apiKeyEnv}` : "请配置 model.apiKey 或 model.apiKeyEnv";
    throw new Error(`缺少模型 API Key。${hint}`);
  }

  const baseUrl = (model.baseUrl || "").replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: opts.signal,
    body: JSON.stringify({
      model: model.model,
      messages,
      max_tokens: opts.maxTokens ?? 800,
      temperature: opts.temperature ?? 0.3,
      stream: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`模型接口 ${res.status} ${res.statusText}：${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

/** 记忆压缩的系统提示词（把历史对话蒸馏成要点，供后续 prompt 顶部的记忆区使用） */
export const MEMORY_SUMMARY_SYSTEM =
  "你是对话记忆压缩器。把给定的历史对话压缩成简洁的中文要点摘要，保留关键事实、用户偏好、已确认结论与未完成事项，不要臆造。直接输出摘要正文，不要加标题或解释。";

/** 历史消息拼成纯文本（压缩输入）：user/AI 逐条标注 */
export function historyToText(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.content && m.content.trim())
    .map((m) => `${m.role === "user" ? "用户" : "AI"}：${m.content.trim()}`)
    .join("\n");
}

/** 未压缩历史原文的累计字符数（判断是否触发压缩） */
export function countChars(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
}

/** 组装记忆压缩 prompt：已有摘要 + 新增对话 → 合并压缩为一段新摘要 */
export function buildSummaryMessages(previousSummary: string, historyText: string): ChatPromptMessage[] {
  const parts: string[] = [];
  if (previousSummary.trim()) parts.push(`【已有记忆摘要】\n${previousSummary.trim()}`);
  parts.push(`【新增对话记录】\n${historyText.trim()}`);
  parts.push("请把上述内容合并压缩为一段不超过 300 字的记忆摘要。");
  return [
    { role: "system", content: MEMORY_SUMMARY_SYSTEM },
    { role: "user", content: parts.join("\n\n") },
  ];
}

/**
 * 拼装 prompt 消息：[system, (memory), ...history.slice(-maxHistory), user]。
 * 纯函数，过滤空 content。复刻 ai-chat characterChat.ts 的 50 条历史截断逻辑；
 * memory 为历史记忆摘要，命中时插在 system 之后作为补充上下文。
 */
export function buildChatMessages(
  system: string,
  history: ChatMessage[],
  userContent: string,
  maxHistory = 50,
  memory?: string
): ChatPromptMessage[] {
  const messages: ChatPromptMessage[] = [];
  if (system.trim()) messages.push({ role: "system", content: system });
  if (memory && memory.trim()) {
    messages.push({ role: "system", content: `【历史记忆摘要】\n${memory.trim()}` });
  }
  const recent = history.slice(-maxHistory);
  for (const m of recent) {
    if (!m.content || !m.content.trim()) continue;
    messages.push({ role: m.role === "user" ? "user" : "assistant", content: m.content });
  }
  if (userContent.trim()) messages.push({ role: "user", content: userContent });
  return messages;
}

/** 会话标题：取文本前 n 字，超长加省略号；空文本返回「新对话」。纯函数。 */
export function truncateTitle(text: string, n = 30): string {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return "新对话";
  return t.length > n ? t.slice(0, n) + "…" : t;
}

/** HTML 转义：把不可信文本安全插入 HTML。与 reporter.head.ts:esc 同实现。 */
export function esc(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
