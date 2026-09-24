import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { loadUsers, type UserAccount } from "./db.js";

/** 会话 cookie 名 */
export const SESSION_COOKIE = "ai_flows_session";

/** 会话有效期 24 小时 */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** 内存会话条目 */
interface Session {
  /** 登录邮箱 */
  email: string;
  /** 过期时间戳（毫秒） */
  expires: number;
}

/** 内存会话表：token → 会话。零依赖实现，服务重启即全部失效（演示环境足够） */
const sessions = new Map<string, Session>();

/** 登录成功后创建会话，返回 token（写入 cookie 用） */
export function createSession(email: string): string {
  const token = randomBytes(24).toString("hex");
  sessions.set(token, { email, expires: Date.now() + SESSION_TTL_MS });
  return token;
}

/** 注销会话 */
export function destroySession(token: string | undefined): void {
  if (token) sessions.delete(token);
}

/** 解析 Cookie 请求头为键值表 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

/** 取请求当前登录账号；未登录或会话过期返回 null（过期会话顺带清理） */
export function currentUser(req: IncomingMessage): UserAccount | null {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expires) {
    sessions.delete(token);
    return null;
  }
  return loadUsers().find((u) => u.email === session.email) ?? null;
}

/** 生成会话 Set-Cookie 响应头 */
export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

/** 生成注销 Set-Cookie 响应头（立即过期） */
export function clearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
