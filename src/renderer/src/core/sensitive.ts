// 宿主级敏感判定，与 clipboard 插件内同源独立（插件两两禁 import）

const PEM_PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/
const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/
const AWS_ACCESS_KEY_RE = /\bAKIA[0-9A-Z]{16}\b/
const CREDENTIAL_KV_RE = /(password|passwd|token|secret|api[_-]?key)\s*[:=]\s*\S+/i
const JSON_CREDENTIAL_RE = /"(password|passwd|pwd|token|secret|api[_-]?key|authorization|cookie|session)"?\s*:\s*"/i

export function isSensitiveText(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return false
  return (
    PEM_PRIVATE_KEY_RE.test(text) ||
    JWT_RE.test(trimmed) ||
    AWS_ACCESS_KEY_RE.test(text) ||
    CREDENTIAL_KV_RE.test(text) ||
    JSON_CREDENTIAL_RE.test(text)
  )
}
