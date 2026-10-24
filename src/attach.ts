import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

/** 对话图片附件允许的扩展名 → MIME（多模态送模型） */
export const CHAT_IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** 对话文本类附件允许的扩展名（读取内容拼进 prompt）。
 *  零依赖约束下不解析 pdf/docx/office 等二进制格式，只吃纯文本/代码类。 */
export const CHAT_TEXT_EXTS: string[] = [
  "txt", "md", "markdown", "json", "jsonl", "csv", "tsv", "log", "env",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "vue", "svelte",
  "py", "java", "go", "rs", "rb", "php", "cs", "c", "h", "cpp", "hpp",
  "sh", "bash", "zsh", "ps1", "bat", "cmd",
  "sql", "yaml", "yml", "toml", "ini", "conf", "properties",
  "html", "htm", "css", "scss", "less", "xml", "svg",
  "kt", "swift", "dart", "lua", "r", "pl", "tex", "gradle", "gitignore",
];

/** 单个文本附件注入 prompt 的字符上限（超出截断，防上下文溢出） */
export const CHAT_TEXT_LIMIT = 16000;

/** 取小写扩展名（无点返回空串） */
export function extOf(name: string): string {
  return extname(name || "").replace(/^\./, "").toLowerCase();
}

/** 是否图片附件（按扩展名判定） */
export function isImageName(name: string): boolean {
  return !!CHAT_IMAGE_TYPES[extOf(name)];
}

/** 是否文本类附件（按扩展名判定） */
export function isTextName(name: string): boolean {
  return CHAT_TEXT_EXTS.includes(extOf(name));
}

/** 读文本类附件内容；二进制 / 读取失败 / 超限时按规则降级。
 *  含 \0 或出现替换字符视为二进制，返回 null（只保留文件名不注入正文）。 */
export function readTextAttachment(absPath: string, limit = CHAT_TEXT_LIMIT): string | null {
  let buf: Buffer;
  try {
    buf = readFileSync(absPath);
  } catch {
    return null;
  }
  if (buf.includes(0)) return null;
  const text = buf.toString("utf8");
  if (/\uFFFD/.test(text.slice(0, 2000))) return null;
  return text.length > limit ? text.slice(0, limit) + "\n…（内容过长已截断）" : text;
}

/** 净化附件展示名：只取 basename，去掉控制字符，空名兜底 */
export function cleanAttachmentName(name: string): string {
  const base = basename((name || "").replace(/[\r\n\t]+/g, " ")).trim();
  return base || "未命名文件";
}

/** 图片附件转 data URL（多模态 content 用）；读不到返回 null */
export function imageToDataUrl(absPath: string, mime: string): string | null {
  try {
    const buf = readFileSync(absPath);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}