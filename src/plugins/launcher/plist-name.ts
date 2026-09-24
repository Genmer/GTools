const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g: string) => {
    if (g.startsWith('#x') || g.startsWith('#X')) return String.fromCodePoint(Number.parseInt(g.slice(2), 16))
    if (g.startsWith('#')) return String.fromCodePoint(Number.parseInt(g.slice(1), 10))
    return ENTITIES[g] ?? m
  })
}

/**
 * 从 XML 格式 Info.plist 提取应用名（CFBundleDisplayName 优先于 CFBundleName）。
 * 二进制 plist（bplist00 开头）不解析，返回 null 由调用方回退目录名——不引入 plist 依赖。
 */
export function appNameFromPlist(plistText: string): string | null {
  if (plistText.startsWith('bplist')) return null
  for (const key of ['CFBundleDisplayName', 'CFBundleName']) {
    const m = plistText.match(new RegExp(`<key>\\s*${key}\\s*</key>\\s*<string>([\\s\\S]*?)</string>`))
    if (m) {
      const name = decodeXmlEntities(m[1]).trim()
      if (name !== '') return name
    }
  }
  return null
}
