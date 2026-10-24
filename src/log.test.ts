import test from "node:test";
import assert from "node:assert/strict";
import { formatEntry, formatLogLine, localIso, parseLine, shouldLogWeb, type AiLogEntry, type WebLogEntry } from "./log.js";

const aiEntry: AiLogEntry = {
  at: "2026-09-30T12:34:56.000Z",
  source: "review",
  model: "deepseek-chat",
  target: "src/index.ts",
  ms: 1234,
  ok: true,
  promptChars: 100,
  replyChars: 200,
};

const webEntry: WebLogEntry = {
  at: "2026-09-30T12:34:56.000Z",
  method: "GET",
  path: "/pipeline",
  status: 200,
  ms: 12,
  email: "a@b.com",
};

test("should round-trip an entry when serialized then parsed", () => {
  const parsed = parseLine(formatEntry(aiEntry));
  assert.deepEqual(parsed, aiEntry);
});

test("should escape newlines inside the line when the entry contains them", () => {
  const line = formatEntry({ ...aiEntry, error: "第一行\n第二行" });
  assert.equal(line.includes("\n"), false, "单行 JSON 不得含裸换行");
  assert.equal((parseLine(line) as AiLogEntry).error, "第一行\n第二行");
});

test("should return null when the line is blank or broken json", () => {
  assert.equal(parseLine(""), null);
  assert.equal(parseLine("   "), null);
  assert.equal(parseLine("{坏行"), null);
  assert.equal(parseLine('{"noAt":1}'), null);
});

test("should skip logs page polling, health check and static assets when deciding web log", () => {
  assert.equal(shouldLogWeb("/api/logs"), false);
  assert.equal(shouldLogWeb("/health"), false);
  assert.equal(shouldLogWeb("/favicon.ico"), false);
  assert.equal(shouldLogWeb("/ai-pipeline.css"), false);
  assert.equal(shouldLogWeb("/chat.js"), false);
  assert.equal(shouldLogWeb("/api/avatars/abc123.png"), false);
});

test("should keep page and api requests when deciding web log", () => {
  assert.equal(shouldLogWeb("/pipeline"), true);
  assert.equal(shouldLogWeb("/api/tickets"), true);
  assert.equal(shouldLogWeb("/reports/review-abc"), true);
  assert.equal(shouldLogWeb("/api/chat/upload"), true);
});

test("should format an ai line with source, model, status and chars", () => {
  const line = formatLogLine("ai", aiEntry);
  assert.equal(line.startsWith("2026-09-30 12:34:56 [ai] review deepseek-chat"), true);
  assert.equal(line.includes("ok 1234ms"), true);
  assert.equal(line.includes("提示100字 回复200字"), true);
});

test("should format a failed ai line with the error reason", () => {
  const line = formatLogLine("ai", { ...aiEntry, ok: false, error: "模型接口 429" });
  assert.equal(line.includes("失败(模型接口 429)"), true);
});

test("should format a web line with method, path, status and user", () => {
  const line = formatLogLine("web", webEntry);
  assert.equal(line, "2026-09-30 12:34:56 [web] GET /pipeline 200 12ms a@b.com");
});

test("should keep the local timezone offset when stamping an entry time", () => {
  const d = new Date("2026-09-30T12:34:56Z");
  const iso = localIso(d);
  assert.match(iso, /^2026-09-30T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const local =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  assert.equal(iso.slice(0, 19), local, "前 19 位应是本地墙上时间");
});