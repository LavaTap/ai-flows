import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { maskSecrets } from "./redact.js";

/** 日志目录：src/ 与 dist/ 均在仓库根下一级，向上取根 → <仓库根>/logs */
export const LOG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "logs");

/** 单个日志文件上限（字节）：超出后轮转，只保留最后 KEEP_LINES 行 */
const MAX_BYTES = 1024 * 1024;
/** 轮转后保留的行数 */
const KEEP_LINES = 500;

/** 日志种类：ai = 模型请求（评审 / AI 对话 / skill），web = 网页与 API 访问 */
export type LogKind = "ai" | "web";

/** 单条模型请求日志（只记元数据，不落 prompt 正文，避免敏感内容进日志） */
export interface AiLogEntry {
  /** ISO 时间 */
  at: string;
  /** 来源：review 评审 / chat AI 对话 / skill 技能执行 */
  source: "review" | "chat" | "skill";
  /** 模型名 */
  model: string;
  /** 触发对象：评审=文件名；对话=会话 id；skill=技能目录名 */
  target?: string;
  /** 耗时（毫秒） */
  ms: number;
  ok: boolean;
  /** 发送给模型的字符数（不含图片） */
  promptChars: number;
  /** 模型回复的字符数 */
  replyChars: number;
  /** 失败原因（已打码） */
  error?: string;
}

/** 单条网页访问日志 */
export interface WebLogEntry {
  at: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  /** 登录用户邮箱（无会话时缺省） */
  email?: string;
}

export type LogEntry = AiLogEntry | WebLogEntry;

/** 日志文件路径：<仓库根>/logs/ai.log 或 web.log */
export function logFilePath(kind: LogKind): string {
  return join(LOG_DIR, kind === "ai" ? "ai.log" : "web.log");
}

/** 行序列化：单行 JSON（换行符被 JSON 转义，天然防换行注入） */
export function formatEntry(entry: LogEntry): string {
  return JSON.stringify(entry);
}

/** 行反序列化：空行 / 坏行返回 null（调用方跳过，日志容错不阻断） */
export function parseLine(line: string): LogEntry | null {
  const t = line.trim();
  if (!t) return null;
  try {
    const v = JSON.parse(t) as LogEntry;
    if (!v || typeof v !== "object" || typeof v.at !== "string") return null;
    return v;
  } catch {
    return null;
  }
}

/** 该请求是否值得记网页日志：跳过日志页自身轮询、健康检查与静态资源（噪声） */
export function shouldLogWeb(pathname: string): boolean {
  if (pathname === "/api/logs" || pathname === "/health" || pathname === "/favicon.ico") return false;
  return !/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|map)$/i.test(pathname);
}

/** 追加一条日志；文件超上限时轮转保留最后 KEEP_LINES 行。失败静默——日志不能影响主流程 */
export function appendLog(kind: LogKind, entry: LogEntry): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const file = logFilePath(kind);
    appendFileSync(file, formatEntry(entry) + "\n", "utf8");
    if (existsSync(file) && statSync(file).size > MAX_BYTES) rotate(file);
  } catch {
    /* 日志失败不影响业务 */
  }
}

/** 轮转：文件过大时只保留最后 KEEP_LINES 行，原地重写 */
function rotate(file: string): void {
  try {
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
    writeFileSync(file, lines.slice(-KEEP_LINES).join("\n") + "\n", "utf8");
  } catch {
    /* 轮转失败忽略 */
  }
}

/** 记一条模型请求日志（时间由本函数补） */
export function recordAi(entry: Omit<AiLogEntry, "at">): void {
  appendLog("ai", {
    at: new Date().toISOString(),
    ...entry,
    ...(entry.error ? { error: maskSecrets(entry.error) } : {}),
  });
}

/** 记一条网页访问日志（时间由本函数补） */
export function recordWeb(entry: Omit<WebLogEntry, "at">): void {
  appendLog("web", { at: new Date().toISOString(), ...entry });
}

/** 读某个日志文件末尾若干条（新的在后）。文件不存在或无有效行返回空数组 */
export function readLogTail(kind: LogKind, limit = 200): LogEntry[] {
  try {
    const file = logFilePath(kind);
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, "utf8").split("\n");
    const out: LogEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      const e = parseLine(lines[i]);
      if (e) out.push(e);
    }
    return out.reverse();
  } catch {
    return [];
  }
}

/** 日志文件当前字节数（不存在返回 0），供 --follow 从末尾开始跟读 */
export function logFileSize(kind: LogKind): number {
  try {
    const file = logFilePath(kind);
    return existsSync(file) ? statSync(file).size : 0;
  } catch {
    return 0;
  }
}

/** 从字节偏移处读日志增量（--follow 轮询用）。文件被轮转/重建（变小）时自动从头读 */
export function readLogChunk(kind: LogKind, offset: number): { text: string; offset: number } {
  try {
    const file = logFilePath(kind);
    if (!existsSync(file)) return { text: "", offset: 0 };
    const size = statSync(file).size;
    if (size < offset) offset = 0;
    if (size === offset) return { text: "", offset };
    const buf = Buffer.alloc(size - offset);
    const fd = openSync(file, "r");
    try {
      readSync(fd, buf, 0, buf.length, offset);
    } finally {
      closeSync(fd);
    }
    return { text: buf.toString("utf8"), offset: size };
  } catch {
    return { text: "", offset };
  }
}

/** 把一条日志格式化成一行可读文本（CLI 打印 / --follow 用） */
export function formatLogLine(kind: LogKind, entry: LogEntry): string {
  const at = entry.at.replace("T", " ").slice(0, 19);
  if (kind === "ai") {
    const e = entry as AiLogEntry;
    const status = e.ok ? "ok" : `失败(${e.error ?? "未知错误"})`;
    const target = e.target ? ` ${e.target}` : "";
    return `${at} [ai] ${e.source} ${e.model}${target} ${status} ${e.ms}ms 提示${e.promptChars}字 回复${e.replyChars}字`;
  }
  const w = entry as WebLogEntry;
  const who = w.email ? ` ${w.email}` : "";
  return `${at} [web] ${w.method} ${w.path} ${w.status} ${w.ms}ms${who}`;
}