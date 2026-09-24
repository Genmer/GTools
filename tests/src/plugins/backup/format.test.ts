import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@sdk/settings'
import {
  BACKUP_FORMAT,
  HOME_TOKEN,
  USER_DATA_TOKEN,
  canonicalJson,
  defaultBackupFileName,
  normalizeSettings,
  parseBackup,
  restorePathTokens,
  serializeBackup,
  tokenizePathValues
} from '../../../../src/plugins/backup/logic/format'

const macRoots = { userData: '/Users/tom/Library/Application Support/GTools', home: '/Users/tom', caseInsensitive: true, sep: '/' }
const winRoots = { userData: 'C:\\Users\\tom\\AppData\\Roaming\\GTools', home: 'C:\\Users\\tom', caseInsensitive: true, sep: '\\' }

function sampleBackup() {
  return serializeBackup({
    settings: { ...DEFAULT_SETTINGS, theme: 'dark' },
    pluginStorage: { clipboard: { state: { a: 1 } }, backup: { foo: 'bar' } },
    platform: 'darwin',
    appVersion: '0.1.0',
    now: new Date('2026-01-02T03:04:05Z')
  })
}

describe('backup format：序列化与文件名', () => {
  it('serializeBackup 产出宿主同构的 v2 结构（apiServices 可选）', () => {
    const b = sampleBackup()
    expect(b.format).toBe(BACKUP_FORMAT)
    expect(b.version).toBe(2)
    expect(b.apiServices).toBeUndefined()
    expect(b.createdAt).toBe('2026-01-02T03:04:05.000Z')
    expect(b.sourcePlatform).toBe('darwin')
    expect(b.appVersion).toBe('0.1.0')
    expect(Object.keys(b.pluginStorage)).toEqual(['clipboard', 'backup'])

    const withApi = serializeBackup({
      settings: DEFAULT_SETTINGS,
      pluginStorage: {},
      platform: 'win32',
      appVersion: '0.1.1',
      apiServices: { services: { translate: { activeProviderId: '', providers: [] } } }
    })
    expect(withApi.apiServices).toEqual({ services: { translate: { activeProviderId: '', providers: [] } } })
  })

  it('defaultBackupFileName 含时间戳与 .gtools 扩展名', () => {
    expect(defaultBackupFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe('gtools-backup-20260102-030405.gtools')
    expect(defaultBackupFileName(new Date(2026, 0, 2, 3, 4, 5), '.json')).toBe('gtools-backup-20260102-030405.json')
  })
})

describe('backup format：路径 token 化（跨 win/mac 归一化）', () => {
  it('userData 前缀优先于 home（userData 在 home 之下）', () => {
    const out = tokenizePathValues({ p: macRoots.userData + '/storage/x.json', q: macRoots.home + '/docs/a.md' }, macRoots)
    expect(out.p).toBe(USER_DATA_TOKEN + '/storage/x.json')
    expect(out.q).toBe(HOME_TOKEN + '/docs/a.md')
  })

  it('win 反斜杠路径导出时归一为 token + 正斜杠', () => {
    const out = tokenizePathValues({ p: winRoots.userData + '\\storage\\x.json' }, winRoots)
    expect(out.p).toBe(USER_DATA_TOKEN + '/storage/x.json')
  })

  it('大小写不敏感平台前缀可命中；无关绝对路径原样保留', () => {
    const out = tokenizePathValues(
      { p: '/users/TOM/Documents/f.txt', q: 'D:\\data\\f.txt', r: 'relative/path.txt' },
      { ...macRoots, caseInsensitive: true }
    )
    expect(out.p).toBe(HOME_TOKEN + '/Documents/f.txt')
    expect(out.q).toBe('D:\\data\\f.txt')
    expect(out.r).toBe('relative/path.txt')
  })

  it('home 为空串时不误伤所有路径（渲染层环境缺失的兜底）', () => {
    const out = tokenizePathValues({ p: '/some/abs/path' }, { userData: '/x', home: '', caseInsensitive: false })
    expect(out.p).toBe('/some/abs/path')
  })

  it('mac 导出 → win 导入：token 还原为反斜杠本机路径', () => {
    const exported = tokenizePathValues({ p: macRoots.userData + '/storage/x.json' }, macRoots)
    const restored = restorePathTokens(exported, { ...winRoots, sep: '\\' })
    expect(restored.p).toBe('C:\\Users\\tom\\AppData\\Roaming\\GTools\\storage\\x.json')
  })

  it('win 导出 → mac 导入：token 还原为正斜杠本机路径', () => {
    const exported = tokenizePathValues({ p: winRoots.userData + '\\a\\b.json', q: winRoots.home + '\\Docs\\c.md' }, winRoots)
    expect(exported.p).toBe(USER_DATA_TOKEN + '/a/b.json')
    expect(exported.q).toBe(HOME_TOKEN + '/Docs/c.md')
    const restored = restorePathTokens(exported, { ...macRoots, sep: '/' })
    expect(restored.p).toBe(macRoots.userData + '/a/b.json')
    expect(restored.q).toBe('/Users/tom/Docs/c.md')
  })

  it('token 只在字符串前缀位置生效，嵌套对象与数组全量遍历', () => {
    const src = { list: [macRoots.home + '/a', { inner: macRoots.home + '/b' }], name: 'x' }
    const out = tokenizePathValues(src, macRoots)
    expect(out.list[0]).toBe(HOME_TOKEN + '/a')
    expect((out.list[1] as { inner: string }).inner).toBe(HOME_TOKEN + '/b')
    expect(out.name).toBe('x')
  })
})

describe('backup format：parseBackup 校验（宁可拒绝也不猜）', () => {
  it('合法备份解析成功并保留插件数据', () => {
    const r = parseBackup(JSON.stringify(sampleBackup()))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.warnings).toEqual([])
      expect(r.backup.settings.theme).toBe('dark')
      expect(r.backup.pluginStorage.clipboard).toEqual({ state: { a: 1 } })
    }
  })

  it('空内容 / 非 JSON / 非对象 / format 不符逐项拒绝', () => {
    expect(parseBackup('')).toEqual({ ok: false, error: '备份文件为空' })
    expect(parseBackup('not json').ok).toBe(false)
    expect(parseBackup('"str"').ok).toBe(false)
    const bad = JSON.stringify({ ...sampleBackup(), format: 'other' })
    expect(parseBackup(bad).ok).toBe(false)
  })

  it('更高版本备份拒绝导入，错误信息含双方版本', () => {
    const r = parseBackup(JSON.stringify({ ...sampleBackup(), version: 3 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('v3')
  })

  it('v2 的 apiServices 段原样透传（不解析内部结构）；结构异常丢弃并告警；v1 无段保持 undefined', () => {
    const api = { services: { translate: { activeProviderId: 'u-1', providers: [{ id: 'u-1', apiKey: 'sk' }] } } }
    const ok = parseBackup(JSON.stringify({ ...sampleBackup(), apiServices: api }))
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.backup.apiServices).toEqual(api)

    const bad = parseBackup(JSON.stringify({ ...sampleBackup(), apiServices: 'oops' }))
    expect(bad.ok).toBe(true)
    if (bad.ok) {
      expect(bad.backup.apiServices).toBeUndefined()
      expect(bad.warnings.join()).toContain('API 服务')
    }

    const v1 = parseBackup(JSON.stringify({ ...sampleBackup(), version: 1 }))
    expect(v1.ok).toBe(true)
    if (v1.ok) expect(v1.backup.apiServices).toBeUndefined()
  })

  it('结构异常的插件数据跳过并记 warning；空命名空间丢弃', () => {
    const raw = JSON.stringify({
      ...sampleBackup(),
      pluginStorage: { good: { a: 1 }, bad: [1, 2], empty: {}, worse: 'str' }
    })
    const r = parseBackup(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(Object.keys(r.backup.pluginStorage)).toEqual(['good'])
      expect(r.warnings.some((w) => w.includes('bad'))).toBe(true)
      expect(r.warnings.some((w) => w.includes('worse'))).toBe(true)
    }
  })

  it('超过大小上限拒绝（maxBytes 可注入便于测试）', () => {
    const r = parseBackup('x'.repeat(100), { maxBytes: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('上限')
  })

  it('settings 坏值规整回默认（与宿主 SettingsStore 同语义）', () => {
    const r = parseBackup(
      JSON.stringify({ ...sampleBackup(), settings: { theme: 'pink', hotkey: { darwin: 'Ctrl+' }, disabledPlugins: 'x' } })
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.backup.settings).toEqual(DEFAULT_SETTINGS)
    }
  })
})

describe('canonicalJson', () => {
  it('键序无关地判等', () => {
    expect(canonicalJson({ a: 1, b: [2, { c: 3 }] })).toBe(canonicalJson({ b: [2, { c: 3 }], a: 1 }))
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }))
  })
})

describe('normalizeSettings', () => {
  it('null/非对象回退默认', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('x')).toEqual(DEFAULT_SETTINGS)
  })
  it('合法字段全保留', () => {
    const s = normalizeSettings({ theme: 'glass', hotkey: { darwin: 'Cmd+Shift+P', win32: 'Ctrl+Alt+Space' }, disabledPlugins: ['hello'] })
    expect(s).toEqual({ theme: 'glass', hotkey: { darwin: 'Cmd+Shift+P', win32: 'Ctrl+Alt+Space' }, disabledPlugins: ['hello'] })
  })
})
