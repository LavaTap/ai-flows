/** 富文本白名单净化：工单正文 / 评论来自前端 contenteditable，视为不可信输入。
 *  零依赖实现——只保留编辑器会产出的标签与属性，其余一律丢弃，
 *  保证落库并回显的 HTML 不含脚本、事件处理器与外部资源引用。 */

/** 允许保留的标签（覆盖 execCommand 产出：font / strike / u / img / 列表 / 引用） */
const ALLOWED_TAGS = new Set([
  "p", "br", "div", "span",
  "b", "strong", "i", "em", "u", "s", "strike", "del", "ins", "sub", "sup",
  "font", "ul", "ol", "li", "blockquote",
  "h1", "h2", "h3", "h4",
  "a", "img", "code", "pre", "hr",
  "table", "thead", "tbody", "tr", "th", "td",
]);

/** 空元素：只输出开标签，不输出闭合标签 */
const VOID_TAGS = new Set(["br", "hr", "img"]);

/** 各标签允许的属性白名单（未列出 = 该标签不允许任何属性） */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title", "data-email", "data-kb-id"]),
  img: new Set(["src", "alt", "width", "height", "style"]),
  font: new Set(["size", "color"]),
  p: new Set(["style"]),
  div: new Set(["style"]),
  span: new Set(["style"]),
  h1: new Set(["style"]),
  h2: new Set(["style"]),
  h3: new Set(["style"]),
  h4: new Set(["style"]),
  li: new Set(["style"]),
  blockquote: new Set(["style"]),
  table: new Set(["style"]),
  th: new Set(["style", "align"]),
  td: new Set(["style", "align"]),
  tr: new Set(["style"]),
  thead: new Set([]),
  tbody: new Set([]),
};

/** 允许携带 style 的标签（正文容器与图片） */
const STYLE_TAGS = new Set(Object.keys(ALLOWED_ATTRS).filter((t) => ALLOWED_ATTRS[t].has("style")));

/** 行内样式属性白名单：只放行编辑器会产出的排版属性，值用正则严格限定（杜绝 url() 等注入） */
const ALLOWED_STYLES: Record<string, RegExp> = {
  "font-size": /^\d{1,3}(\.\d+)?(px|em|rem|%)$/,
  "font-weight": /^(normal|bold|[1-9]00)$/,
  "text-align": /^(left|right|center|justify)$/,
  "float": /^(left|right|none)$/,
  "display": /^(block|inline|inline-block)$/,
  margin: /^-?\d{1,3}(\.\d+)?(px|em|%)?(\s+-?\d{1,3}(\.\d+)?(px|em|%)?){0,3}$/,
  width: /^\d{1,4}(\.\d+)?(px|%)$/,
  height: /^\d{1,4}(\.\d+)?(px|%)$/,
  "max-width": /^\d{1,4}(\.\d+)?(px|%)$/,
  "border-collapse": /^(collapse|separate)$/,
  "vertical-align": /^(top|middle|bottom|baseline)$/,
};

/** 清洗 style：逐条声明匹配白名单，全部非法则丢弃该属性 */
function cleanStyle(raw: string): string | null {
  const out: string[] = [];
  for (const decl of raw.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim().toLowerCase();
    const re = ALLOWED_STYLES[prop];
    if (!re || !re.test(val)) continue;
    out.push(`${prop}: ${val}`);
  }
  return out.length ? out.join("; ") : null;
}

/** 图片只能引用本平台上传接口的地址（禁止外链，避免信息外泄与追踪） */
const IMG_SRC_RE = /^\/api\/tickets\/images\/[A-Za-z0-9._-]+$/;

/** @提及链接带上的被提及人邮箱（前端据此渲染头像 + 名字与悬停用户卡片） */
const EMAIL_RE = /^[^\s<>"'@/\\]+@[^\s<>"'@/\\]+\.[^\s<>"'@/\\]+$/;

/** 知识库引用链接带上的文章 id（前端据此渲染知识卡片：名称 / 撰写人 / 最近更新时间 / 更新人） */
const KB_ID_RE = /^k-[A-Za-z0-9-]{1,40}$/;

/** 剥离控制字符（避免零宽 / 换行注入进属性值） */
function stripControl(v: string): string {
  return v.replace(/[\u0000-\u001f\u007f]/g, "");
}

/** 文本节点转义 */
function escapeText(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 属性值转义（输出前统一调用） */
function escapeAttr(v: string): string {
  return escapeText(v).replace(/"/g, "&quot;");
}

/** 校验并归一化单个属性值：非法返回 null（该属性丢弃） */
function cleanAttrValue(tag: string, name: string, raw: string): string | null {
  const val = stripControl(raw).trim();
  if (name === "style") return STYLE_TAGS.has(tag) ? cleanStyle(val) : null;
  if (tag === "img") {
    if (name === "src") return IMG_SRC_RE.test(val) ? val : null;
    if (name === "alt") return val.slice(0, 200);
    if (name === "width" || name === "height") return /^\d{1,4}$/.test(val) ? val : null;
    return null;
  }
  if (tag === "a") {
    if (name === "href") return /^(https?:\/\/|mailto:|\/)/i.test(val) ? val : null;
    if (name === "title") return val.slice(0, 200);
    if (name === "data-email") return EMAIL_RE.test(val) ? val.slice(0, 120) : null;
    if (name === "data-kb-id") return KB_ID_RE.test(val) ? val : null;
    return null;
  }
  if (tag === "font") {
    if (name === "size") return /^[1-7]$/.test(val) ? val : null;
    if (name === "color") {
      return /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/.test(val) ? val : null;
    }
    return null;
  }
  return null;
}

/** 从标签内部的属性串中挑出白名单属性并重建 */
function buildAttrs(tag: string, src: string): string {
  const allowed = ALLOWED_ATTRS[tag];
  if (!allowed || !src) return "";
  const out: string[] = [];
  const re = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase();
    if (!allowed.has(name)) continue;
    const clean = cleanAttrValue(tag, name, m[2] ?? m[3] ?? m[4] ?? "");
    if (clean === null) continue;
    out.push(` ${name}="${escapeAttr(clean)}"`);
  }
  return out.join("");
}

/** 净化单个标签串；形状不合法时整体当文本转义 */
function sanitizeTag(rawTag: string): string {
  const m = rawTag.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)\/?\s*>$/);
  if (!m) return escapeText(rawTag);
  const name = m[2].toLowerCase();
  if (!ALLOWED_TAGS.has(name)) return "";
  if (m[1]) return VOID_TAGS.has(name) ? "" : `</${name}>`;
  return `<${name}${buildAttrs(name, m[3] ?? "")}>`;
}

/** 净化富文本：去注释 / 危险块 → 逐段扫描标签与文本 → 重建白名单 HTML */
export function sanitizeRichHtml(raw: string): string {
  if (!raw) return "";
  let src = raw;
  // 1. 去注释与危险块（含其内部文本）
  src = src.replace(/<!--[\s\S]*?-->/g, "");
  const DANGEROUS =
    "script|style|iframe|object|embed|svg|math|template|link|meta|base|form|input|button|textarea|select|option|noscript";
  src = src.replace(
    new RegExp(`<\\s*(${DANGEROUS})\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`, "gi"),
    ""
  );
  src = src.replace(new RegExp(`<\\s*\\/?\\s*(${DANGEROUS})\\b[^>]*>`, "gi"), "");
  // 2. 逐段重建
  const out: string[] = [];
  const tagRe = /<[^>]*>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(src))) {
    if (m.index > last) out.push(escapeText(src.slice(last, m.index)));
    out.push(sanitizeTag(m[0]));
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(escapeText(src.slice(last)));
  return out.join("");
}

/** 富文本是否为空（去掉标签与空白后无内容，用于「正文不能为空」校验） */
export function isEmptyRichHtml(raw: string): boolean {
  return !raw.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
}