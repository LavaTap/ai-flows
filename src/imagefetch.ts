/** 外链图片转存：正文里出现 http(s) 图片时，服务端下载到本地上传目录并把 src 改写成
 *  `/api/tickets/images/<name>`，从而守住「正文只引用本平台图片」的规则
 *  （避免外链追踪、https 页面混合内容、原图失效）。
 *
 *  下载失败时把该 <img> 降级成可点链接，保证原文信息不丢。
 *  零依赖：只用 `node:*` 内置模块 + 全局 fetch。 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { TICKET_IMAGES_DIR } from "./db.js";

/** 允许的图片扩展名 → MIME（与工单图片上传白名单一致） */
export const IMAGE_EXT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** 响应 Content-Type → 扩展名 */
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** 单张图片体积上限 */
const MAX_BYTES = 6 * 1024 * 1024;

/** 单次保存最多转存的外链图片数（防止一篇正文塞几百个链接拖垮保存） */
const MAX_IMAGES = 10;

/** 单个下载超时 */
const TIMEOUT_MS = 8000;

/** 最多跟随的跳转次数（每一跳都重新做地址校验，避免 302 到内网绕过防护） */
const MAX_REDIRECTS = 3;

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SRC_RE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;

function escapeText(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(v: string): string {
  return escapeText(v).replace(/"/g, "&quot;");
}

/** 内网 / 回环地址判定：服务端代抓外链属不可信输入，必须挡住 SSRF */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h === "0.0.0.0") {
    return true;
  }
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
    return false;
  }
  // IPv6 字面量不做完整解析，一律拒绝
  if (h.includes(":")) return true;
  return false;
}

/** 按 MIME 优先、URL 路径兜底推断扩展名；不在白名单内返回 null */
export function pickExt(pathname: string, contentType: string): string | null {
  const byMime = EXT_BY_MIME[contentType];
  if (byMime) return byMime;
  const ext = pathname.toLowerCase().split(".").pop() ?? "";
  return IMAGE_EXT_TYPES[ext] ? ext : null;
}

/** 下载单张外链图片并落盘，成功返回本地地址，失败返回 null */
async function downloadOne(url: string): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (isBlockedHost(u.hostname)) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // 手动跟随跳转：每一跳都重新校验协议与地址，防止 302 到内网绕过上面的防护
    let cur = u;
    let res: Response | null = null;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const r = await fetch(cur.toString(), {
        signal: ctrl.signal,
        redirect: "manual",
        headers: { "User-Agent": "ai-flows/1.0 (+image-localize)" },
      });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get("location");
        if (!loc) return null;
        let next: URL;
        try {
          next = new URL(loc, cur);
        } catch {
          return null;
        }
        if (next.protocol !== "http:" && next.protocol !== "https:") return null;
        if (isBlockedHost(next.hostname)) return null;
        cur = next;
        continue;
      }
      res = r;
      break;
    }
    if (!res || !res.ok) return null;
    const ctype = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const ext = pickExt(cur.pathname, ctype);
    if (!ext) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;
    const name = `${randomBytes(6).toString("hex")}.${ext}`;
    mkdirSync(TICKET_IMAGES_DIR, { recursive: true });
    writeFileSync(join(TICKET_IMAGES_DIR, name), buf);
    return `/api/tickets/images/${name}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把正文里的外链图片转存到本地：`<img src="http(s)://…">` → `<img src="/api/tickets/images/…">`。
 * 下载失败时整段 `<img>` 降级为 `<a href="原地址">原地址</a>`（后续仍会过一遍净化白名单）。
 * 非外链图片（本地地址 / data URL）原样保留。
 */
export async function localizeExternalImages(html: string): Promise<string> {
  if (!html || html.indexOf("<img") === -1) return html;

  const tags: string[] = [];
  const urls: string[] = [];
  IMG_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMG_TAG_RE.exec(html))) {
    const tag = m[0];
    const sm = tag.match(SRC_RE);
    if (!sm) continue;
    const url = (sm[1] ?? sm[2] ?? sm[3] ?? "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    tags.push(tag);
    urls.push(url);
  }
  if (!tags.length) return html;

  // 同一地址只抓一次（按出现顺序取前 MAX_IMAGES 个不同地址）
  const unique = [...new Set(urls)].slice(0, MAX_IMAGES);
  const cache = new Map<string, string | null>();
  await Promise.all(
    unique.map(async (u) => {
      cache.set(u, await downloadOne(u));
    })
  );

  let out = html;
  for (const tag of tags) {
    const sm = tag.match(SRC_RE);
    if (!sm) continue;
    const url = (sm[1] ?? sm[2] ?? sm[3] ?? "").trim();
    const local = cache.get(url);
    const next = local
      ? tag.replace(sm[0], `src="${escapeAttr(local)}"`)
      : `<a href="${escapeAttr(url)}">${escapeText(url)}</a>`;
    // 用函数形式替换，避免 URL 里的 $& / $1 被当成替换模式
    out = out.replace(tag, () => next);
  }
  return out;
}
