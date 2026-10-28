// 查找历史纯逻辑（照 query-history.ts 模式）：storage 值归一、同词去重顶置、截断。
// 入参是宿主 storage 已解析的 JSON 值（unknown），不在此处 JSON.parse

export const FIND_HISTORY_MAX = 10
export const FIND_HISTORY_TEXT_MAX = 100

/** storage 任意值 → 历史词列表：非数组返 []；元素非 string / trim 空 / trim 后超 FIND_HISTORY_TEXT_MAX 跳过；同词去重保序，截 FIND_HISTORY_MAX */
export function parseFindHistory(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string') continue
    const q = x.trim()
    if (q === '' || q.length > FIND_HISTORY_TEXT_MAX || out.includes(q)) continue
    out.push(q)
    if (out.length >= FIND_HISTORY_MAX) break
  }
  return out
}

/** 记一次查找：trim 非空且 ≤FIND_HISTORY_TEXT_MAX 才入，同词移除顶置，截 FIND_HISTORY_MAX；不满足返回原数组浅拷贝 */
export function pushFindHistory(records: readonly string[], next: string): string[] {
  const q = next.trim()
  if (q === '' || q.length > FIND_HISTORY_TEXT_MAX) return [...records]
  return [q, ...records.filter((r) => r !== q)].slice(0, FIND_HISTORY_MAX)
}
