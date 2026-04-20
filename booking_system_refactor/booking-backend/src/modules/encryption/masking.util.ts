/**
 * PII 脱敏工具函数
 * 用于前端展示的脱敏手机号和邮箱
 */

/**
 * 手机号脱敏
 * 保留前 3 位和后 4 位，中间用 **** 替代
 * @param phone - 原始手机号（如 13800138000）
 * @returns 脱敏后的手机号（如 138****8000）
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) {
    return phone;
  }
  const prefix = phone.slice(0, 3);
  const suffix = phone.slice(-4);
  return `${prefix}****${suffix}`;
}

/**
 * 邮箱脱敏
 * 保留前 2 位字符和 @ 后的域名，中间用 *** 替代
 * @param email - 原始邮箱（如 user@example.com）
 * @returns 脱敏后的邮箱（如 us***@example.com）
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) {
    return email;
  }
  const [localPart, domain] = email.split('@');
  if (localPart.length <= 2) {
    return `${localPart}***@${domain}`;
  }
  const prefix = localPart.slice(0, 2);
  return `${prefix}***@${domain}`;
}
