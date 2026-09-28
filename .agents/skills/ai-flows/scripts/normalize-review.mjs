#!/usr/bin/env node
/**
 * 评审规范输出脚本（code-review）
 *
 * 作用：把模型原始输出ERROR归一成「标准评审 JSON」。输出格式由本脚本保证，
 *       不再依赖 prompt 约束模型自觉守格式；同时落一份时间戳评审日志。
 *
 * 用法：
 *   node normalize-review.mjs <input-file>        # 输入文件（模型原始输出或评审 JSON）
 *   node normalize-review.mjs -                   # 从 stdin 读取
 *   node normalize-review.mjs raw.txt --out out.json --log-dir <dir>
 *   node normalize-review.mjs raw.txt --no-log    # 只归一，不落日志
 *
 * 退出码：0 归一成功；1 输入无法解析为标准评审 JSON
 *
 * 标准评审 JSON（与 src/reviewer.ts 的 ReviewIssue 契约保持一致）：
 * {
 *   "summary": string,
 *   "issues": [{ "file": string, "lineStart": number, "lineEnd": number,
 *                "severity": "blocker"|"warning"|"info", "category": string,
 *                "message": string, "suggestion"?: string }],
 *   "counts": { "blocker": number, "warning": number, "info": number },
 *   "total": number
 * }
 *
 * 仅用 node 内置模块，零依赖。
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
/** 默认日志目录：<skill-dir>/log/code-review */
const DEFAULT_LOG_DIR = resolve(SCRIPT_DIR, "..", "log", "code-review");

/** 允许的严重级别（白名单，代码强约束） */
const SEVERITIES = ["blocker", "warning", "info"];
/** 模型给出非法 severity 时的兜底级别 */
const SEVERITY_FALLBACK = "warning";
/** 模型未给 category 时的兜底 */
const CATEGORY_FALLBACK = "其他";

/** 本地时区时间戳，精确到秒：YYYYMMDDHHmmss */
export function logStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 本地时区可读时间：YYYY-MM-DD HH:mm:ss */
export function readableTime(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 从模型输出中尽力提取 JSON：先整段 parse，失败则截取首个 {/[ 到末个 }/] */
export function extractJson(text) {
  const trimmed = String(text ?? "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
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
  throw new Error("模型输出不是合法 JSON，无法归一");
}

/**
 * 归一化评审结果：校验 severity 白名单、补默认值、丢弃无描述条目、兼容旧 line 字段。
 * 纯函数，无副作用。
 */
export function normalizeReview(parsed, fallbackFile = "") {
  const arr = Array.isArray(parsed) ? parsed : parsed?.issues;
  const rawIssues = Array.isArray(arr) ? arr : [];
  const issues = [];
  for (const raw of rawIssues) {
    if (!raw || typeof raw !== "object") continue;
    const message = String(raw.message ?? "").trim();
    if (!message) continue; // 无问题描述，丢弃
    const sevRaw = String(raw.severity ?? "").trim().toLowerCase();
    const severity = SEVERITIES.includes(sevRaw) ? sevRaw : SEVERITY_FALLBACK;
    const lineStart = Number(raw.lineStart ?? raw.line) || 0;
    const lineEndNum = Number(raw.lineEnd ?? raw.lineStart ?? raw.line) || lineStart;
    const lineEnd = lineEndNum >= lineStart ? lineEndNum : lineStart;
    const issue = {
      file: String(raw.file ?? fallbackFile) || fallbackFile,
      lineStart,
      lineEnd,
      severity,
      category: String(raw.category ?? "").trim() || CATEGORY_FALLBACK,
      message,
    };
    const suggestion = raw.suggestion == null ? "" : String(raw.suggestion).trim();
    if (suggestion) issue.suggestion = suggestion;
    issues.push(issue);
  }
  const counts = { blocker: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  const summaryRaw = typeof parsed?.summary === "string" ? parsed.summary.trim() : "";
  return {
    summary: summaryRaw || `已评审，共 ${issues.length} 条问题`,
    issues,
    counts,
    total: issues.length,
  };
}

/** 拼评审日志正文（可读文本 + 标准 JSON） */
export function renderLog(review, meta = {}) {
  const lines = [
    "# ai-review 评审规范输出日志",
    `# 时间：${readableTime()}`,
    `# 来源：${meta.source ?? "未知"}`,
    `# 统计：total=${review.total} blocker=${review.counts.blocker} warning=${review.counts.warning} info=${review.counts.info}`,
    "--- 标准评审 JSON ---",
    JSON.stringify(review, null, 2),
    "",
  ];
  return lines.join("\n");
}

/** 落一份时间戳评审日志，返回文件路径；写失败抛错由调用方决定是否兜底 */
export function writeLog(review, meta = {}, logDir = DEFAULT_LOG_DIR) {
  mkdirSync(logDir, { recursive: true });
  const file = join(logDir, `${logStamp()}.log`);
  writeFileSync(file, renderLog(review, meta), "utf8");
  return file;
}

function parseArgs(argv) {
  const opts = { input: "", out: "", logDir: DEFAULT_LOG_DIR, log: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = argv[++i] ?? "";
    else if (a === "--log-dir") opts.logDir = argv[++i] ?? opts.logDir;
    else if (a === "--no-log") opts.log = false;
    else if (!a.startsWith("--") && !opts.input) opts.input = a;
  }
  return opts;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.input) {
    console.error(`${RED}缺少输入。用法：node normalize-review.mjs <input-file|->${RESET}`);
    process.exitCode = 1;
    return;
  }

  let text;
  let source;
  try {
    if (opts.input === "-") {
      text = await readStdin();
      source = "stdin";
    } else {
      text = readFileSync(resolve(opts.input), "utf8");
      source = resolve(opts.input);
    }
  } catch (err) {
    console.error(`${RED}读取输入失败：${err?.message ?? err}${RESET}`);
    process.exitCode = 1;
    return;
  }

  let review;
  try {
    review = normalizeReview(extractJson(text));
  } catch (err) {
    console.error(`${RED}✖ 归一失败：${err?.message ?? err}${RESET}`);
    process.exitCode = 1;
    return;
  }

  const json = JSON.stringify(review, null, 2);
  if (opts.out) {
    writeFileSync(resolve(opts.out), json, "utf8");
    console.log(`${DIM}已写出标准 JSON：${resolve(opts.out)}${RESET}`);
  } else {
    console.log(json);
  }

  if (opts.log) {
    try {
      const file = writeLog(review, { source });
      console.log(`${GREEN}✔ 评审日志：${file}${RESET}`);
    } catch (err) {
      console.error(`${DIM}（日志写入失败，不影响归一结果：${err?.message ?? err}）${RESET}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
