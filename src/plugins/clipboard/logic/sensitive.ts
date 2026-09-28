// 敏感内容保守判定：命中即不入剪贴板历史。宁漏勿拦——拦掉用户无感知，误拦伤可用性；
// UUID/URL/普通 base64 等高频无害内容必须不命中。URL 携带 ?token= 查询串属已知会命中（本身即凭证泄漏形态）。

const PEM_PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/
// JWT 三段式且首段 base64url 以 eyJ 开头（{"al… 的固定前缀）；签名段允许为空（alg:none）
const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/
const AWS_ACCESS_KEY_RE = /\bAKIA[0-9A-Z]{16}\b/
const CREDENTIAL_KV_RE = /(password|passwd|token|secret|api[_-]?key)\s*[:=]\s*\S+/i

export function isSensitiveText(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return false
  return (
    PEM_PRIVATE_KEY_RE.test(text) || JWT_RE.test(trimmed) || AWS_ACCESS_KEY_RE.test(text) || CREDENTIAL_KV_RE.test(text)
  )
}
