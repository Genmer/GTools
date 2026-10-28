// JSON 识别与剪贴板 JSON 预检：主进程 peek-json 网关与渲染层 matcher 共用的纯函数
import { isSensitiveText } from './sensitive'
import { looseJsonText } from './loose-json'

/** 大文本不进 JSON.parse，防解析卡顿 */
const JSON_PARSE_MAX_LENGTH = 100_000

/** 引号键计数（"key" : 形态），宽松兜底档用：键密度足够说明是对象字面量而非碰巧带花括号的文本 */
const QUOTED_KEY_RE = /"(?:[^"\\\r\n]|\\.)*"\s*:/g
const LOOSE_MIN_QUOTED_KEYS = 3

/**
 * 顶层切段（O(n) 单次扫描）：depth=0 遇 {/[ 记段起点、遇 }/] 归零即段尾；引号内内容跳过（含转义）。
 * 段间出现非空白字符（垃圾文本/多余闭合）返回 null；未闭合尾段原样入列，交逐段判兜底。
 */
function topLevelSegments(text: string): string[] | null {
  const segs: string[] = []
  let depth = 0
  let start = -1
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (c === '\\') i++
      else if (c === '"') inStr = false
      continue
    }
    if (depth === 0) {
      if (c === '{' || c === '[') {
        start = i
        depth = 1
      } else if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') {
        return null
      }
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      if (--depth === 0) segs.push(text.slice(start, i + 1))
    }
  }
  if (depth > 0) segs.push(text.slice(start))
  return segs
}

function isLikelyJsonText(c: string): boolean {
  if (!c.startsWith('{') && !c.startsWith('[')) return false
  // 严格 → Mongo 导出归一化 → 文档清单包裹，见 ./loose-json
  if (looseJsonText(c) !== null) return true
  // 兜底：截断的 dump/console 输出（引号键够多但整体不可解析），进编辑器看原文
  return (c.match(QUOTED_KEY_RE) ?? []).length >= LOOSE_MIN_QUOTED_KEYS
}

/**
 * trim 后以 {/[ 开头且宽松判定通过才算 JSON；多段拼接（≥2 段）段段皆须通过。
 * 主进程 peek-json 网关与渲染层 matcher 共用，两侧口径必须一致，勿各自复制。
 */
export function looksLikeJson(text: string): boolean {
  const t = text.trim()
  if (t === '' || t.length > JSON_PARSE_MAX_LENGTH) return false
  const segs = topLevelSegments(t)
  if (segs !== null && segs.length >= 2) {
    return segs.every((seg) => (seg.startsWith('{') || seg.startsWith('[')) && isLikelyJsonText(seg))
  }
  return isLikelyJsonText(t)
}

/** 剪贴板 JSON 预检：非 JSON/敏感文本返回 null，只把通过预检的文本下发渲染层 */
export function peekJsonCandidate(text: string): string | null {
  if (text === '' || !looksLikeJson(text) || isSensitiveText(text)) return null
  return text
}
