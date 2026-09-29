import { test } from "node:test";
import assert from "node:assert";
import { buildChatMessages, truncateTitle, esc, PROVIDER_DEFAULT_ENDPOINTS } from "./chat.js";
import type { ChatMessage } from "./db.js";

test("should inject system prompt and append user message", () => {
  const msgs = buildChatMessages("你是助手", [], "你好");
  assert.strictEqual(msgs.length, 2);
  assert.strictEqual(msgs[0].role, "system");
  assert.strictEqual(msgs[0].content, "你是助手");
  assert.strictEqual(msgs[1].role, "user");
  assert.strictEqual(msgs[1].content, "你好");
});

test("should skip empty system prompt when blank", () => {
  const msgs = buildChatMessages("   ", [], "hi");
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(msgs[0].role, "user");
});

test("should skip empty user content when blank", () => {
  const msgs = buildChatMessages("sys", [], "   ");
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(msgs[0].role, "system");
});

test("should keep only the last N history messages", () => {
  const history: ChatMessage[] = [];
  for (let i = 0; i < 60; i++) {
    history.push({ id: `m${i}`, role: i % 2 === 0 ? "user" : "assistant", content: `msg${i}`, at: "2026-01-01T00:00:00Z" });
  }
  const msgs = buildChatMessages("sys", history, "final");
  // system + 50 history + 1 user = 52
  assert.strictEqual(msgs.length, 52);
  // 首条历史应为 msg10（60-50=10）
  assert.strictEqual(msgs[1].content, "msg10");
  // 最后一条是用户最新消息
  assert.strictEqual(msgs[msgs.length - 1].role, "user");
  assert.strictEqual(msgs[msgs.length - 1].content, "final");
});

test("should filter out messages with empty content from history", () => {
  const history: ChatMessage[] = [
    { id: "1", role: "user", content: "hi", at: "2026-01-01T00:00:00Z" },
    { id: "2", role: "assistant", content: "", at: "2026-01-01T00:00:00Z" },
    { id: "3", role: "user", content: "   ", at: "2026-01-01T00:00:00Z" },
    { id: "4", role: "assistant", content: "hello", at: "2026-01-01T00:00:00Z" },
  ];
  const msgs = buildChatMessages("sys", history, "next");
  // system + hi(assistant? no, user hi) + hello + next = 4
  assert.strictEqual(msgs.length, 4);
  assert.strictEqual(msgs[1].content, "hi");
  assert.strictEqual(msgs[2].content, "hello");
});

test("should truncate title to n chars with ellipsis", () => {
  const long = "这是一段很长的对话标题用于测试截断功能是否正常工作超过三十个字符";
  const title = truncateTitle(long, 10);
  assert.strictEqual(title.length, 11); // 10 chars + …
  assert.ok(title.endsWith("…"));
});

test("should not truncate short title", () => {
  assert.strictEqual(truncateTitle("短标题"), "短标题");
});

test("should collapse whitespace and return fallback for empty", () => {
  assert.strictEqual(truncateTitle("  hello   world  "), "hello world");
  assert.strictEqual(truncateTitle(""), "新对话");
  assert.strictEqual(truncateTitle("   "), "新对话");
});

test("should escape html special characters", () => {
  assert.strictEqual(esc("<script>alert('x')</script>"), "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
  assert.strictEqual(esc('a&b"c'), "a&amp;b&quot;c");
  assert.strictEqual(esc(null), "");
  assert.strictEqual(esc(undefined), "");
  assert.strictEqual(esc(123), "123");
});

test("should include deepseek default endpoint", () => {
  assert.strictEqual(PROVIDER_DEFAULT_ENDPOINTS.deepseek, "https://api.deepseek.com/v1");
  assert.ok(PROVIDER_DEFAULT_ENDPOINTS.aliyun.startsWith("https://"));
});
