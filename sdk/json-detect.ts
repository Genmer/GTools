// JSON 识别与剪贴板 JSON 预检：主进程 peek-json 网关与渲染层 matcher 共用的纯函数
import { isSensitiveText } from './sensitive'

/** 大文本不进 JSON.parse，防解析卡顿 */
const JSON_PARSE_MAX_LENGTH = 100_000

/** trim 后以 {/[ 开头且可解析且顶层为 object/array 才算 JSON */
export function looksLikeJson(text: string): boolean {
  const t = text.trim()
  if (t === '' || t.length > JSON_PARSE_MAX_LENGTH) return false
  if (!t.startsWith('{') && !t.startsWith('[')) return false
  try {
    const v: unknown = JSON.parse(t)
    return typeof v === 'object' && v !== null
  } catch {
    return false
  }
}

/** 剪贴板 JSON 预检：非 JSON/敏感文本返回 null，只把通过预检的文本下发渲染层 */
export function peekJsonCandidate(text: string): string | null {
  if (text === '' || !looksLikeJson(text) || isSensitiveText(text)) return null
  return text
}
