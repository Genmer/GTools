// 搜索历史纯逻辑（照 recent-records.ts 模式，从 App.vue 抽出供单测）：坏 JSON 归一、同词去重顶置、截断。
// 属外壳 UI 状态，走 localStorage 不新开 IPC（RECENT_KEY 先例）

export const QUERY_HISTORY_MAX = 10

/** localStorage 原文 → 历史词列表：坏 JSON/非数组返回 []，非字符串/空白词跳过；同词去重保序（对齐 pushQueryHistory），截断 QUERY_HISTORY_MAX */
export function parseQueryHistory(raw: string | null): string[] {
  let arr: unknown
  try {
    arr = JSON.parse(raw ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  // 去重必在此处：EmptyState 历史 chips 以词本身作 :key，手改 localStorage 含重复词会产生重复 key
  const out: string[] = []
  for (const x of arr) {
    if (typeof x !== 'string') continue
    const q = x.trim()
    if (q === '' || out.includes(q)) continue
    out.push(q)
    if (out.length >= QUERY_HISTORY_MAX) break
  }
  return out
}

/** 记一次搜索：trim 非空才入、同词旧记录移除顶到最前、截断 QUERY_HISTORY_MAX */
export function pushQueryHistory(records: readonly string[], next: string): string[] {
  const q = next.trim()
  if (q === '') return [...records]
  return [q, ...records.filter((r) => r !== q)].slice(0, QUERY_HISTORY_MAX)
}
