/**
 * 宽松 JSON 预处理：MongoDB shell 导出（ObjectId/ISODate/NumberLong 等包裹语法、
 * 文档间与结尾逗号）等"近似 JSON"归一化为可解析文本。
 * 供宿主推荐判定（recommend）与 json-editor 展开共用，两侧口径必须一致，勿各自复制。
 * 单遍替换里字符串字面量分支排在最前，后续分支不可能命中字符串内部内容。
 */

// Timestamp(T, I) 真实形态恒为两参，此模式只认单参，不支持（保持原样不归一化）
const LOOSE_TOKEN_RE =
  /("(?:[^"\\\r\n]|\\.)*")|\b(?:new\s+Date|ObjectId|ISODate|NumberLong|NumberInt|NumberDecimal|Date)\s*\(\s*("(?:[^"\\\r\n]|\\.)*"|-?\d+(?:\.\d+)?)\s*\)|(,)(?=\s*[}\]])/g

/** 包裹语法换成参数本身（带引号则保持字符串），尾随逗号（后随 }/]）删除；字符串字面量内不动 */
export function normalizeLooseJson(text: string): string {
  return text.replace(LOOSE_TOKEN_RE, (_m, str: string | undefined, arg: string | undefined, _comma: string | undefined) => {
    if (str !== undefined) return str
    if (arg !== undefined) return arg
    return ''
  })
}

function parsesAsContainer(s: string): boolean {
  if (!s.startsWith('{') && !s.startsWith('[')) return false
  try {
    const v: unknown = JSON.parse(s)
    return typeof v === 'object' && v !== null
  } catch {
    return false
  }
}

const EOF_COMMA_RE = /[,\s]+$/

/**
 * 严格 → 归一化 → 去 EOF 逗号 → 数组包裹（文档逗号清单）四档尝试，
 * 返回首个能解析为顶层 object/array 的文本；均败返回 null。
 * 输入约定与消费方一致：trim 后以 {/[ 开头，顶层标量/数字清单不在此列。
 */
export function looseJsonText(text: string): string | null {
  const t = text.trim()
  if (t === '' || (!t.startsWith('{') && !t.startsWith('['))) return null
  if (parsesAsContainer(t)) return t
  const n = normalizeLooseJson(t)
  if (n !== t && parsesAsContainer(n)) return n
  const noEof = n.replace(EOF_COMMA_RE, '')
  if (noEof !== n && parsesAsContainer(noEof)) return noEof
  if (parsesAsContainer(`[${noEof}]`)) return `[${noEof}]`
  return null
}
