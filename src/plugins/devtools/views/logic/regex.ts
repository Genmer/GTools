export interface RegexOk {
  ok: true
  matches: { match: string; index: number; groups: string[] }[]
}
export type RegexResult = RegexOk | { ok: false; message: string }

export function buildRegex(pattern: string, flags: string): RegExp | { error: string } {
  try {
    // 列举全部匹配必须 g；不改变用户语义，副本上强制补 g
    const f = flags.includes('g') ? flags : flags + 'g'
    return new RegExp(pattern, f)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export function runPattern(pattern: string, flags: string, text: string): RegexResult {
  const re = buildRegex(pattern, flags)
  if ('error' in re) return { ok: false, message: re.error }
  const matches: { match: string; index: number; groups: string[] }[] = []
  for (const m of text.matchAll(re)) {
    matches.push({ match: m[0], index: m.index ?? 0, groups: m.slice(1).map((g) => g ?? '') })
    if (matches.length >= 1000) break // 防病态回溯撑爆 UI
  }
  return { ok: true, matches }
}
