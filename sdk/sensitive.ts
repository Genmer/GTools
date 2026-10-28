// 宿主与插件共享的敏感内容判定单源（sdk 是两侧唯一合法共享面）：命中即不入剪贴板历史。
// 宁漏勿拦——拦掉用户无感知，误拦伤可用性；UUID/URL/普通 base64 等高频无害内容必须不命中。
// URL 携带 ?token= 查询串属已知会命中（本身即凭证泄漏形态）。
// 厂商裸 token 走清单制：新厂商 = VENDOR_TOKEN_RES 加一行 + 测试补用例；高熵启发式已否决。

const PEM_PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/
// JWT 三段式且首段 base64url 以 eyJ 开头（{"al… 的固定前缀）；签名段允许为空（alg:none）
const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/
const AWS_ACCESS_KEY_RE = /\bAKIA[0-9A-Z]{16}\b/
const CREDENTIAL_KV_RE = /(password|passwd|token|secret|api[_-]?key)\s*[:=]\s*\S+/i
// JSON 形态的凭证字段（渲染层曾为独立超集）：键值都带引号才命中，防误伤普通文档；复合键为 OAuth 凭证常见形态
const JSON_CREDENTIAL_RE =
  /"(password|passwd|pwd|token|secret|api[_-]?key|authorization|cookie|session|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|bearer[_-]?token)"?\s*:\s*"/i
// 整段即 Bearer 凭证（Authorization 头值复制形态）；值 <20 视为短占位不拦，正文提及 Bearer 不拦
const BEARER_TOKEN_RE = /^Bearer\s+[A-Za-z0-9._~+/=-]{20,}$/i
// 厂商裸 token 清单：前缀 + 最低长度护栏（按各厂商真实形态取保守值，护栏之下不命中防误伤）
const VENDOR_TOKEN_RES = [
  /\bghp_[A-Za-z0-9]{30,}\b/, // GitHub 经典 PAT
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/, // GitHub 细粒度 PAT
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, // Slack
  /\bglpat-[A-Za-z0-9_-]{20,}\b/, // GitLab PAT
  /\bsk-(?:proj|ant)-[A-Za-z0-9_-]{20,}\b/, // OpenAI / Anthropic
  /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/, // Stripe
  /\bnpm_[A-Za-z0-9]{30,}\b/, // npm
  /\bAIza[A-Za-z0-9_-]{30,}\b/, // Google API key
  /\bpypi-[A-Za-z0-9_-]{20,}\b/ // PyPI 上传 token
]

export function isSensitiveText(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return false
  return (
    PEM_PRIVATE_KEY_RE.test(text) ||
    JWT_RE.test(trimmed) ||
    AWS_ACCESS_KEY_RE.test(text) ||
    CREDENTIAL_KV_RE.test(text) ||
    JSON_CREDENTIAL_RE.test(text) ||
    BEARER_TOKEN_RE.test(trimmed) ||
    VENDOR_TOKEN_RES.some((re) => re.test(text))
  )
}
