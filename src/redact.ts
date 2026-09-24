/**
 * 报告脱敏：AI 评审结果里可能原样引用被评审代码中的密钥/令牌，
 * 若直接写入报告（md / JSON / 页面）就等于二次泄露，故统一打码。
 */

/** 保留首尾各 4 位，中间打码；过短则整体打码 */
function maskValue(v: string): string {
  if (v.length <= 8) return "***";
  return `${v.slice(0, 4)}***${v.slice(-4)}`;
}

/**
 * 对文本中的疑似敏感值打码，覆盖三类：
 *  1) 敏感字段赋值：API_KEY = "xxx" / token: xxx
 *  2) sk- 前缀的模型密钥
 *  3) 含 token/secret/key 等关键字的连字符令牌：prod-pay-token-9f3a2b7c8d4e
 */
export function maskSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(
      /\b(api[_-]?key|access[_-]?key|secret|token|password|passwd)\b(\s*[:=]\s*["']?)([A-Za-z0-9_\-]{6,})/gi,
      (_m, name: string, sep: string, val: string) => `${name}${sep}${maskValue(val)}`
    )
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, (m) => `sk-${maskValue(m.slice(3))}`)
    .replace(
      /\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-(?:token|secret|passwd|password|apikey|key)(?:-[A-Za-z0-9]+)+\b/gi,
      (m) => maskValue(m)
    );
}
