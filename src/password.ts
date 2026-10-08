import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** 密码有效期（天）：距上次改密超过该天数即提示强制更换 */
export const PASSWORD_MAX_AGE_DAYS = 10;

/** 哈希存储前缀：带此前缀按 scrypt 校验，否则按旧明文比对（演示账号 123456 的兼容路径） */
const HASH_PREFIX = "scrypt$";

/** 密码最小长度（改密校验） */
export const PASSWORD_MIN_LENGTH = 6;

/** 生成加盐 scrypt 哈希（格式 scrypt$<saltHex>$<hashHex>） */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64);
  return `${HASH_PREFIX}${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** 判断库中密码是否为哈希存储（旧账号仍为明文） */
export function isHashed(stored: string): boolean {
  return stored.startsWith(HASH_PREFIX);
}

/** 校验密码：哈希走 scrypt 恒时比对，旧明文走直接比对（兼容演示账号） */
export function verifyPassword(stored: string, plain: string): boolean {
  if (!isHashed(stored)) return stored === plain;
  const parts = stored.slice(HASH_PREFIX.length).split("$");
  if (parts.length !== 2) return false;
  const salt = Buffer.from(parts[0], "hex");
  const expect = Buffer.from(parts[1], "hex");
  if (!salt.length || !expect.length) return false;
  const actual = scryptSync(plain, salt, expect.length);
  return actual.length === expect.length && timingSafeEqual(actual, expect);
}

/** 密码有效期状态 */
export interface PasswordStatus {
  /** 起算时刻（改密时间；缺省按 now） */
  since: string;
  /** 到期时刻 */
  dueAt: string;
  /** 距到期剩余天数（已到期为 0） */
  daysLeft: number;
  /** 是否已到期（需提醒更换） */
  expired: boolean;
}

/** 计算密码有效期：changedAt 为空或非法时按 now 起算（现有账号「从今天起算 N 天」）。
 *  纯函数，now 可注入便于测试。 */
export function passwordStatus(
  changedAt: string | null | undefined,
  now: Date = new Date(),
  days: number = PASSWORD_MAX_AGE_DAYS
): PasswordStatus {
  const parsed = changedAt ? Date.parse(changedAt) : NaN;
  const base = Number.isFinite(parsed) ? parsed : now.getTime();
  const due = base + days * 86400000;
  const remain = due - now.getTime();
  return {
    since: new Date(base).toISOString(),
    dueAt: new Date(due).toISOString(),
    daysLeft: remain > 0 ? Math.ceil(remain / 86400000) : 0,
    expired: remain <= 0,
  };
}