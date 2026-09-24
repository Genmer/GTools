// launcher 共享纯函数单测：缓存时效/校验与路径拼接。
import { describe, expect, it } from 'vitest'
import { CACHE_STALE_MS, isCacheStale, joinPath, parseCache, type AppsCache } from './types'

const NOW = 1_000_000

describe('isCacheStale', () => {
  it('null 恒过期；恰好 24h 不过期，超过即过期', () => {
    expect(isCacheStale(null, NOW)).toBe(true)
    const scanned = NOW - CACHE_STALE_MS
    expect(isCacheStale({ version: 1, scannedAt: scanned, apps: [] }, NOW)).toBe(false)
    expect(isCacheStale({ version: 1, scannedAt: scanned - 1, apps: [] }, NOW)).toBe(true)
  })

  it('未来时间戳（时钟回拨场景）不过期', () => {
    expect(isCacheStale({ version: 1, scannedAt: NOW + 60_000, apps: [] }, NOW)).toBe(false)
  })

  it('CACHE_STALE_MS 为一天', () => {
    expect(CACHE_STALE_MS).toBe(24 * 60 * 60 * 1000)
  })
})

describe('parseCache', () => {
  it('合法缓存原样解析', () => {
    const cache: AppsCache = { version: 1, scannedAt: 123, apps: [{ name: 'A', path: '/a.app' }] }
    expect(parseCache(JSON.parse(JSON.stringify(cache)))).toEqual(cache)
  })

  it('version / scannedAt / apps 形状不对返回 null', () => {
    expect(parseCache(null)).toBeNull()
    expect(parseCache('x')).toBeNull()
    expect(parseCache({ version: 2, scannedAt: 1, apps: [] })).toBeNull()
    expect(parseCache({ version: 1, scannedAt: Number.NaN, apps: [] })).toBeNull()
    expect(parseCache({ version: 1, scannedAt: 1 })).toBeNull()
    expect(parseCache({ version: 1, scannedAt: 1, apps: {} })).toBeNull()
  })

  it('坏 app 条目丢弃、好条目保留', () => {
    const parsed = parseCache({
      version: 1,
      scannedAt: 5,
      apps: [
        { name: 'ok', path: '/ok.app' },
        { name: '', path: '/x.app' },
        { name: 'no-path' },
        { path: '/y.app' },
        null,
        42,
        { name: 'num-path', path: 7 }
      ]
    })
    expect(parsed?.apps).toEqual([{ name: 'ok', path: '/ok.app' }])
    expect(parsed?.scannedAt).toBe(5)
  })

  it('解析结果是新对象，不与输入共享条目引用', () => {
    const raw = { version: 1, scannedAt: 1, apps: [{ name: 'A', path: '/a' }] }
    const parsed = parseCache(raw)
    expect(parsed).not.toBeNull()
    if (parsed === null) return
    parsed.apps[0].name = 'mutated'
    expect(raw.apps[0].name).toBe('A')
  })
})

describe('joinPath', () => {
  it('posix 拼接，尾斜杠与空段忽略', () => {
    expect(joinPath('/Applications', 'Safari.app')).toBe('/Applications/Safari.app')
    expect(joinPath('/Applications/', 'X', 'Y.app')).toBe('/Applications/X/Y.app')
    expect(joinPath('/a', '', 'b')).toBe('/a/b')
    expect(joinPath()).toBe('')
  })

  it('首段含反斜杠且无正斜杠时用 \\ 连接', () => {
    expect(joinPath('C:\\ProgramData', 'Microsoft', 'Menu')).toBe('C:\\ProgramData\\Microsoft\\Menu')
    expect(joinPath('C:\\a/b', 'c')).toBe('C:\\a/b/c') // 首段同时含 / 则用 /
  })

  it('只有一段时去掉尾斜杠', () => {
    expect(joinPath('/Applications//')).toBe('/Applications')
  })
})
