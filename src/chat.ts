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
 * 拼装 prompt 消息：[system, ...history.slice(-maxHistory), user]。
 * 纯函数，过滤空 content。复刻 ai-chat characterChat.ts 的 50 条历史截断逻辑。
 */
export function buildChatMessages(
  system: string,
  history: ChatMessage[],
  userContent: string,
  maxHistory = 50
): ChatPromptMessage[] {
  const messages: ChatPromptMessage[] = [];
  if (system.trim()) messages.push({ role: "system", content: system });
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
