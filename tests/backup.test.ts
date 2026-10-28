import { describe, expect, it } from 'vitest'
import {
  BACKUP_VERSION,
  HOME_TOKEN,
  USER_DATA_TOKEN,
  defaultBackupFileName,
  parseBackup,
  restorePathTokens,
  serializeBackup,
  stringifyBackupChunked,
  tokenizePathValues
} from '../src/main/services/backup'
import { DEFAULT_SETTINGS } from '@sdk/settings'

const MAC_ROOTS = {
  userData: '/Users/genmer/Library/Application Support/GTools',
  home: '/Users/genmer',
  caseInsensitive: true
}

const WIN_ROOTS = {
  userData: 'C:\\Users\\genmer\\AppData\\Roaming\\gtools',
  home: 'C:\\Users\\genmer',
  caseInsensitive: true
}

describe('backup 序列化与文件名', () => {
  it('serializeBackup 固定形状（v2 起含可选 apiServices 段）', () => {
    const b = serializeBackup({
      settings: DEFAULT_SETTINGS,
      pluginStorage: { clipboard: { state: { a: 1 } } },
      platform: 'darwin',
      appVersion: '0.2.0',
      now: new Date('2026-09-24T10:00:00Z')
    })
    expect(b.format).toBe('gtools-backup')
    expect(b.version).toBe(2)
    expect(b.apiServices).toBeUndefined()
    expect(b.createdAt).toBe('2026-09-24T10:00:00.000Z')
    expect(b.sourcePlatform).toBe('darwin')
    expect(b.appVersion).toBe('0.2.0')
    expect(b.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('serializeBackup 携带 apiServices（密钥为不透明字符串，原样保留）', () => {
    const b = serializeBackup({
      settings: DEFAULT_SETTINGS,
      pluginStorage: {},
      platform: 'darwin',
      appVersion: '0.1.1',
      apiServices: {
        services: {
          translate: {
            activeProviderId: 'u-abcd1234',
            providers: [{ id: 'u-abcd1234', type: 'http-template', name: 'DeepL', enabled: true, endpoint: 'https://x/?key={key}', secrets: { apiKey: 'sk-1' }, method: 'GET' }]
          },
          ai: { activeProviderId: '', providers: [] }
        }
      }
    })
    expect(b.apiServices?.services.translate.providers[0].secrets?.apiKey).toBe('sk-1')
  })

  it('默认文件名含日期时间与 .gtools 后缀', () => {
    const name = defaultBackupFileName(new Date(2026, 8, 24, 9, 5, 3))
    expect(name).toBe('gtools-backup-20260924-090503.gtools')
  })
})

describe('路径 token 归一化（跨 win/mac 迁移核心）', () => {
  it('mac 导出：userData/home 前缀替换为 token，其余原样', () => {
    const out = tokenizePathValues(
      {
        icons: { app: '/Users/genmer/Library/Application Support/GTools/storage/launcher/icons/wx.png' },
        doc: '/Users/genmer/Documents/readme.md',
        plain: 'hello',
        n: 42,
        arr: ['/Users/genmer/Library/Application Support/GTools/x', '/opt/other']
      },
      MAC_ROOTS
    )
    expect(out.icons.app).toBe(`${USER_DATA_TOKEN}/storage/launcher/icons/wx.png`)
    expect(out.doc).toBe(`${HOME_TOKEN}/Documents/readme.md`)
    expect(out.plain).toBe('hello')
    expect(out.n).toBe(42)
    expect(out.arr[0]).toBe(`${USER_DATA_TOKEN}/x`)
    expect(out.arr[1]).toBe('/opt/other')
  })

  it('win 导出：反斜杠归一为 /，大小写不敏感命中前缀', () => {
    const out = tokenizePathValues({ p: 'c:\\users\\genmer\\AppData\\Roaming\\gtools\\storage\\a\\kv.json' }, WIN_ROOTS)
    expect(out.p).toBe(`${USER_DATA_TOKEN}/storage/a/kv.json`)
  })

  it('userData 优先于 home（userData 是 home 的子路径）', () => {
    const out = tokenizePathValues({ p: `${MAC_ROOTS.userData}/storage/x` }, MAC_ROOTS)
    expect(out.p.startsWith(USER_DATA_TOKEN)).toBe(true)
  })

  it('还原：token 展开为当前平台路径（win 备份 → mac 恢复）', () => {
    const backup = { kv: { path: `${USER_DATA_TOKEN}/storage/clipboard/records.json`, home2: `${HOME_TOKEN}/Downloads/x.md`, s: 'plain' } }
    const out = restorePathTokens(backup, { ...MAC_ROOTS, sep: '/' })
    expect(out.kv.path).toBe(`${MAC_ROOTS.userData}/storage/clipboard/records.json`)
    expect(out.kv.home2).toBe('/Users/genmer/Downloads/x.md')
    expect(out.kv.s).toBe('plain')
  })

  it('还原到 win：分隔符转换', () => {
    const out = restorePathTokens(
      { p: `${USER_DATA_TOKEN}/storage/launcher/apps.json` },
      { ...WIN_ROOTS, sep: '\\' }
    )
    expect(out.p).toBe(`${WIN_ROOTS.userData}\\storage\\launcher\\apps.json`)
  })

  it('往返：win 导出 → mac 导入后路径指向 mac 的 userData', () => {
    const original = { p: `${WIN_ROOTS.userData}\\storage\\notes\\notes.json` }
    const tokenized = tokenizePathValues(original, WIN_ROOTS)
    const restored = restorePathTokens(tokenized, { ...MAC_ROOTS, sep: '/' })
    expect(restored.p).toBe(`${MAC_ROOTS.userData}/storage/notes/notes.json`)
  })
})

describe('parseBackup 导入校验', () => {
  const known = new Set(['clipboard', 'launcher'])

  function wrap(body: unknown): string {
    return JSON.stringify(body)
  }

  it('合法备份解析成功', () => {
    const raw = wrap({
      format: 'gtools-backup',
      version: 1,
      createdAt: '2026-09-24T00:00:00Z',
      sourcePlatform: 'win32',
      appVersion: '0.2.0',
      settings: { ...DEFAULT_SETTINGS, theme: 'dark' },
      pluginStorage: { clipboard: { state: 1 }, 'unknown-plugin': { x: 1 } }
    })
    const r = parseBackup(raw, { knownPluginIds: known })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.backup.pluginStorage).toEqual({ clipboard: { state: 1 } })
      expect(r.warnings).toHaveLength(1)
      expect(r.warnings[0]).toContain('unknown-plugin')
      expect(r.backup.settings.theme).toBe('dark')
    }
  })

  it('非备份 JSON / 坏 JSON / 空内容拒绝', () => {
    expect(parseBackup('{"format":"other"}', { knownPluginIds: known })).toMatchObject({ ok: false })
    expect(parseBackup('not json', { knownPluginIds: known })).toMatchObject({ ok: false })
    expect(parseBackup('', { knownPluginIds: known })).toMatchObject({ ok: false })
    expect(parseBackup('null', { knownPluginIds: known })).toMatchObject({ ok: false })
  })

  it('更高版本备份拒绝（不猜兼容）', () => {
    const raw = wrap({ format: 'gtools-backup', version: BACKUP_VERSION + 1, settings: {}, pluginStorage: {} })
    const r = parseBackup(raw, { knownPluginIds: known })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('更高版本')
  })

  it('缺 settings / pluginStorage 拒绝；段内坏结构带段名报错', () => {
    expect(
      parseBackup(wrap({ format: 'gtools-backup', version: 1, pluginStorage: {} }), { knownPluginIds: known })
    ).toMatchObject({ ok: false })
    expect(
      parseBackup(wrap({ format: 'gtools-backup', version: 1, settings: {} }), { knownPluginIds: known })
    ).toMatchObject({ ok: false })
    // settings 段为数组等非对象形态：拒绝且错误信息带段名
    const badSettings = parseBackup(
      wrap({ format: 'gtools-backup', version: 1, settings: [1], pluginStorage: {} }),
      { knownPluginIds: known }
    )
    expect(badSettings.ok).toBe(false)
    if (!badSettings.ok) expect(badSettings.error).toContain('settings')

    const badKv = parseBackup(
      wrap({ format: 'gtools-backup', version: 1, settings: {}, pluginStorage: { clipboard: [1, 2] } }),
      { knownPluginIds: known }
    )
    expect(badKv.ok).toBe(false)
    if (!badKv.ok) {
      expect(badKv.error).toContain('pluginStorage')
      expect(badKv.error).toContain('clipboard')
    }
  })

  it('超大文件拒绝', () => {
    const r = parseBackup('x'.repeat(64 * 1024 * 1024 + 1), { knownPluginIds: known })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('64MB')
  })

  it('v1 备份（无 apiServices 段）可导入：输出归一为 v2，段保持 undefined', () => {
    const r = parseBackup(
      wrap({ format: 'gtools-backup', version: 1, settings: {}, pluginStorage: {}, createdAt: '', sourcePlatform: '', appVersion: '' }),
      { knownPluginIds: known }
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.backup.version).toBe(2)
      expect(r.backup.apiServices).toBeUndefined()
    }
  })

  it('v2 备份的 apiServices 段原样透传（sanitize 由 api-center.replaceAll 兜底）；坏段带段名拒绝', () => {
    const good = parseBackup(
      wrap({
        format: 'gtools-backup',
        version: 2,
        settings: {},
        pluginStorage: {},
        apiServices: { services: { translate: { activeProviderId: 'x', providers: [] } } }
      }),
      { knownPluginIds: known }
    )
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.backup.apiServices?.services.translate.activeProviderId).toBe('x')

    // 段整体非对象 / providers 非数组 / 元素缺 id/type：一律拒绝（防 replaceAll 覆盖后静默清掉本机配置）
    const bad = parseBackup(
      wrap({ format: 'gtools-backup', version: 2, settings: {}, pluginStorage: {}, apiServices: 'oops' }),
      { knownPluginIds: known }
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('apiServices')

    const badProviders = parseBackup(
      wrap({
        format: 'gtools-backup',
        version: 2,
        settings: {},
        pluginStorage: {},
        apiServices: { services: { translate: { activeProviderId: 'x', providers: 'nope' } } }
      }),
      { knownPluginIds: known }
    )
    expect(badProviders.ok).toBe(false)
    if (!badProviders.ok) expect(badProviders.error).toContain('providers')

    const badItem = parseBackup(
      wrap({
        format: 'gtools-backup',
        version: 2,
        settings: {},
        pluginStorage: {},
        apiServices: { services: { ai: { activeProviderId: 'z', providers: [{ id: 'z', name: 'n' }] } } }
      }),
      { knownPluginIds: known }
    )
    expect(badItem.ok).toBe(false)
    if (!badItem.ok) expect(badItem.error).toContain('id/type')
  })
})

describe('stringifyBackupChunked 分块序列化（黄金值 = 整体 JSON.stringify）', () => {
  const makeBackup = (withApi: boolean) =>
    serializeBackup({
      settings: DEFAULT_SETTINGS,
      pluginStorage: {
        clipboard: { state: { items: [{ text: 'a"b\\c\n中文🚀', at: 1 }], big: 'x'.repeat(500) } },
        'weird"id': { 'k:ey': { nested: { deep: [1, { s: null, t: true }] } } },
        empty: {},
        notes: { drafts: [], meta: { tags: ['t1', 't2'] } },
        ...Object.fromEntries(
          Array.from({ length: 20 }, (_, i) => [`pad-${i}`, { seq: i, blob: { text: 'y'.repeat(200) } }])
        )
      },
      platform: 'darwin',
      appVersion: '0.2.0',
      apiServices: withApi
        ? {
            services: {
              translate: {
                activeProviderId: 'u-1',
                providers: [
                  { id: 'u-1', type: 'http-template', name: 'DeepL', enabled: true, endpoint: 'https://x/?key={key}', secrets: { apiKey: 'sk-1' }, method: 'GET' }
                ]
              },
              ai: { activeProviderId: '', providers: [] }
            }
          }
        : undefined
    })

  it('含 apiServices：分块输出与整体 stringify 逐字节一致', async () => {
    const b = makeBackup(true)
    expect(await stringifyBackupChunked(b)).toBe(JSON.stringify(b, null, 2))
  })

  it('apiServices 缺省（键省略）：同样逐字节一致', async () => {
    const b = makeBackup(false)
    expect(await stringifyBackupChunked(b)).toBe(JSON.stringify(b, null, 2))
  })

  it('yieldEvery=1（每插件让步一次）输出仍一致；空 pluginStorage 输出 {}', async () => {
    const b = makeBackup(true)
    expect(await stringifyBackupChunked(b, { yieldEvery: 1 })).toBe(JSON.stringify(b, null, 2))
    const empty = serializeBackup({ settings: DEFAULT_SETTINGS, pluginStorage: {}, platform: 'win32', appVersion: '0' })
    expect(await stringifyBackupChunked(empty)).toBe(JSON.stringify(empty, null, 2))
  })

  it('yieldEvery 大于插件数（全程不让步）与 yieldEvery=0（取模永不命中）输出仍一致', async () => {
    const b = makeBackup(true)
    expect(await stringifyBackupChunked(b, { yieldEvery: 999 })).toBe(JSON.stringify(b, null, 2))
    expect(await stringifyBackupChunked(b, { yieldEvery: 0 })).toBe(JSON.stringify(b, null, 2))
  })

  it('plugin id 含换行/制表/控制字符、键为空串：输出与整体 stringify 逐字节一致', async () => {
    const b = serializeBackup({
      settings: DEFAULT_SETTINGS,
      pluginStorage: {
        'weird\nid\ttab\x00ctl': { 'key\nwith\nnewlines': [1, 2] },
        '': { k: 'v' }
      },
      platform: 'darwin',
      appVersion: '0.2.0'
    })
    expect(await stringifyBackupChunked(b)).toBe(JSON.stringify(b, null, 2))
  })

  it('pluginStorage 值为极端类型（NaN/Infinity→null、1e21、-0、undefined 丢弃、深嵌套）：逐字节一致', async () => {
    const b = serializeBackup({
      settings: DEFAULT_SETTINGS,
      pluginStorage: {
        ext: {
          nan: Number.NaN,
          inf: Number.POSITIVE_INFINITY,
          big: 1e21,
          negZero: -0,
          dropped: undefined,
          empty: '',
          deep: [[[{ a: [null, true] }]]]
        }
      },
      platform: 'win32',
      appVersion: '0.2.0'
    })
    expect(await stringifyBackupChunked(b)).toBe(JSON.stringify(b, null, 2))
  })
})
