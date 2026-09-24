import { describe, expect, it } from 'vitest'
import { basename, join } from 'node:path'
import {
  NativeAppsService,
  extractIcnsPngForSize,
  orderApps,
  parseBinaryPlistStrings,
  parseNativeAppsCache,
  parsePlistMeta,
  parseXmlPlistStrings,
  resolveIconPath,
  sanitizePinnedIds,
  type NativeAppEntry,
  type NativeAppsFs
} from '../src/main/services/native-apps'

// ---------- 纯逻辑：XML plist ----------

describe('parseXmlPlistStrings / parsePlistMeta', () => {
  const KEYS = ['CFBundleDisplayName', 'CFBundleName', 'CFBundleIconFile', 'CFBundleIdentifier']

  it('提取四个目标 key，实体解码生效', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleDisplayName</key><string>A&amp;B &lt;App&gt;</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>com.example.ab</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
</dict></plist>`
    const meta = parsePlistMeta(Buffer.from(xml, 'utf8'))
    expect(meta.name).toBe('A&B <App>')
    expect(meta.iconFile).toBe('AppIcon')
    expect(meta.bundleId).toBe('com.example.ab')
  })

  it('DOCTYPE 开头同样可解析（部分应用无 xml 声明）', () => {
    const xml = `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist><dict><key>CFBundleName</key><string>计算器</string></dict></plist>`
    expect(parsePlistMeta(Buffer.from(xml, 'utf8')).name).toBe('计算器')
  })

  it('无任何目标 key 时 meta 为空对象（调用方回退目录名）', () => {
    const meta = parsePlistMeta(Buffer.from('<plist><dict><key>Other</key><string>x</string></dict></plist>', 'utf8'))
    expect(meta).toEqual({})
    expect(parseXmlPlistStrings('garbage not xml', KEYS)).toEqual({})
  })
})

// ---------- 纯逻辑：二进制 plist（builder 手工构造 bplist00） ----------

function buildBinaryPlist(objects: Uint8Array[], topIndex: number): Buffer {
  let body = Buffer.alloc(8)
  body.write('bplist00', 0, 'latin1')
  const offsets: number[] = []
  for (const obj of objects) {
    offsets.push(body.length)
    body = Buffer.concat([body, Buffer.from(obj)])
  }
  const tableOff = body.length
  const maxOffset = tableOff + objects.length // 偏移表按 refSize=1、offsetSize 覆盖最大偏移取宽
  const offsetSize = maxOffset < 256 ? 1 : maxOffset < 65536 ? 2 : 4
  const table = Buffer.alloc(objects.length * offsetSize)
  offsets.forEach((o, i) => table.writeUIntBE(o, i * offsetSize, offsetSize))
  const trailer = Buffer.alloc(32)
  trailer[6] = offsetSize
  trailer[7] = 1 // objectRefSize
  trailer.writeBigUInt64BE(BigInt(objects.length), 8)
  trailer.writeBigUInt64BE(BigInt(topIndex), 16)
  trailer.writeBigUInt64BE(BigInt(tableOff), 24)
  return Buffer.concat([body, table, trailer])
}

const bpAscii = (s: string): Uint8Array => {
  const bytes = Buffer.from(s, 'latin1')
  // 短形式长度只到 14（0x5f 是扩展转义），≥15 的串走 0x5f + int 长度
  if (bytes.length < 15) return new Uint8Array([0x50 | bytes.length, ...bytes])
  return new Uint8Array([0x5f, 0x10, bytes.length, ...bytes])
}

const bpUtf16 = (s: string): Uint8Array => {
  // Node Buffer 无 utf16be 编码，手工按 LE 换字节序
  const le = Buffer.from(s, 'utf16le')
  const be = Buffer.from(le)
  for (let i = 0; i + 1 < be.length; i += 2) {
    const t = be[i]
    be[i] = be[i + 1]
    be[i + 1] = t
  }
  return new Uint8Array([0x60 | [...s].length, ...be]) // len = 码元数 < 15
}

const bpLongAscii = (s: string): Uint8Array => {
  // 扩展长度：0x5f + int 对象（0x10 = 1 字节整数）+ 数据
  const bytes = Buffer.from(s, 'latin1')
  return new Uint8Array([0x5f, 0x10, bytes.length, ...bytes])
}

const bpInt = (v: number): Uint8Array => new Uint8Array([0x10, v])

const bpDict = (keyRefs: number[], valRefs: number[]): Uint8Array =>
  new Uint8Array([0xd0 | keyRefs.length, ...keyRefs, ...valRefs])

describe('parseBinaryPlistStrings', () => {
  const KEYS = ['CFBundleDisplayName', 'CFBundleName', 'CFBundleIconFile', 'CFBundleIdentifier']

  it('顶层 dict 字符串键值提取，非字符串值（int）跳过', () => {
    const objects: Uint8Array[] = [
      bpDict([1, 2, 3, 4], [5, 6, 7, 8]),
      bpAscii('CFBundleDisplayName'),
      bpAscii('CFBundleIconFile'),
      bpAscii('CFBundleIdentifier'),
      bpAscii('CFBundleVersion'),
      bpUtf16('企业微信'),
      bpAscii('AppIcon'),
      bpLongAscii('com.tencent.wework.macos.long'),
      bpInt(123)
    ]
    const out = parseBinaryPlistStrings(buildBinaryPlist(objects, 0), KEYS)!
    expect(out).toEqual({
      CFBundleDisplayName: '企业微信',
      CFBundleIconFile: 'AppIcon',
      CFBundleIdentifier: 'com.tencent.wework.macos.long'
    })
    const meta = parsePlistMeta(buildBinaryPlist(objects, 0))
    expect(meta.name).toBe('企业微信')
    expect(meta.bundleId).toBe('com.tencent.wework.macos.long')
  })

  it('结构异常返回 null（截断/非 bplist/顶层非 dict）', () => {
    expect(parseBinaryPlistStrings(Buffer.from('bplist00truncated'), KEYS)).toBeNull()
    expect(parseBinaryPlistStrings(Buffer.from('<xml/>'), KEYS)).toBeNull()
    const notDict = buildBinaryPlist([bpAscii('x')], 0)
    expect(parseBinaryPlistStrings(notDict, KEYS)).toBeNull()
  })
})

// ---------- 纯逻辑：icns PNG 条目抽取 ----------

function fakePng(w: number): Buffer {
  const b = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(w, 20)
  return b
}

function buildIcns(entries: Array<{ type: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [Buffer.alloc(8)]
  parts[0].write('icns', 0, 'latin1')
  for (const e of entries) {
    const head = Buffer.alloc(8)
    head.write(e.type, 0, 'latin1')
    head.writeUInt32BE(8 + e.data.length, 4)
    parts.push(head, e.data)
  }
  const total = parts.reduce((n, p) => n + p.length, 0)
  parts[0].writeUInt32BE(total, 4)
  return Buffer.concat(parts)
}

describe('extractIcnsPngForSize', () => {
  it('取实际宽度 ≥ target 的最小 PNG 条目（不信任条目类型声明）', () => {
    const buf = buildIcns([
      { type: 'ic11', data: fakePng(32) },
      { type: 'ic07', data: fakePng(128) },
      { type: 'ic13', data: fakePng(512) }
    ])
    const png = extractIcnsPngForSize(buf, 64)!
    expect(png.readUInt32BE(16)).toBe(128)
  })

  it('全部小于 target 时取最大者；非 PNG 条目忽略', () => {
    const buf = buildIcns([
      { type: 'is32', data: Buffer.from([1, 2, 3]) },
      { type: 'ic11', data: fakePng(32) },
      { type: 'icp6', data: fakePng(48) }
    ])
    expect(extractIcnsPngForSize(buf, 64)!.readUInt32BE(16)).toBe(48)
  })

  it('无 PNG 条目/坏魔数/截断返回 null（老式 ARGB icns 走字母块兜底）', () => {
    expect(extractIcnsPngForSize(buildIcns([{ type: 'ic04', data: Buffer.alloc(1024) }]), 64)).toBeNull()
    expect(extractIcnsPngForSize(Buffer.from('noticns'), 64)).toBeNull()
    const broken = buildIcns([{ type: 'ic07', data: fakePng(128) }])
    expect(extractIcnsPngForSize(broken.subarray(0, broken.length - 5), 64)).toBeNull()
  })
})

// ---------- 纯逻辑：图标路径 / 排序 / sanitize ----------

describe('resolveIconPath / orderApps / sanitize', () => {
  it('CFBundleIconFile 无扩展名补 .icns，有扩展名原样', () => {
    expect(resolveIconPath('/Applications/X.app', 'AppIcon')).toBe(
      join('/Applications/X.app', 'Contents', 'Resources', 'AppIcon.icns')
    )
    expect(resolveIconPath('/Applications/X.app', 'Weird.tiff')).toBe(
      join('/Applications/X.app', 'Contents', 'Resources', 'Weird.tiff')
    )
  })

  const apps: NativeAppEntry[] = [
    { id: 't', name: 'Terminal', path: '/Applications/t.app' },
    { id: 'c', name: 'Chrome', path: '/Applications/c.app' },
    { id: 'n', name: 'Notes', path: '/Applications/n.app' }
  ]

  it('置顶按置顶顺序排最前，其余名称排序；未知置顶 id 忽略', () => {
    expect(orderApps(apps, ['n', 'c']).map((x) => x.id)).toEqual(['n', 'c', 't'])
    expect(orderApps(apps, ['ghost']).map((x) => x.id)).toEqual(['c', 'n', 't'])
    expect(orderApps(apps, []).map((x) => x.id)).toEqual(['c', 'n', 't'])
  })

  it('sanitizePinnedIds 只留非空字符串并去重；缓存形状校验', () => {
    expect(sanitizePinnedIds(['a', '', 'a', 3, null, 'b'])).toEqual(['a', 'b'])
    expect(sanitizePinnedIds('x')).toEqual([])
    expect(parseNativeAppsCache({ version: 1, scannedAt: 1, apps: 'no' })).toBeNull()
    expect(parseNativeAppsCache({ version: 2, scannedAt: 1, apps: [] })).toBeNull()
    const ok = parseNativeAppsCache({
      version: 1,
      scannedAt: 5,
      apps: [{ id: 'x', name: 'X', path: '/x.app', iconPath: '/i.icns' }, { id: '', name: 'y', path: '/y.app' }]
    })!
    expect(ok.apps).toHaveLength(1)
    expect(ok.apps[0]).toEqual({ id: 'x', name: 'X', path: '/x.app', bundleId: undefined, iconPath: '/i.icns' })
  })
})

// ---------- 服务（fs/openPath/loadIcon 全注入） ----------

interface FakeFs {
  fs: NativeAppsFs
  files: Map<string, Buffer>
  dirs: Map<string, Array<{ name: string; isDirectory(): boolean }>>
  state: { readdirCalls: number }
}

function fakeFs(): FakeFs {
  const files = new Map<string, Buffer>()
  const dirs = new Map<string, Array<{ name: string; isDirectory(): boolean }>>()
  const state = { readdirCalls: 0 }
  const fs: NativeAppsFs = {
    async readdir(d, _opts) {
      state.readdirCalls++
      const list = dirs.get(d)
      if (!list) throw new Error(`ENOENT ${d}`)
      return list
    },
    async readFile(p) {
      const f = files.get(p)
      if (!f) throw new Error(`ENOENT ${p}`)
      return f
    },
    async writeFile(p, data) {
      files.set(p, Buffer.from(data, 'utf8'))
    },
    async rename(from, to) {
      const f = files.get(from)
      if (!f) throw new Error(`ENOENT ${from}`)
      files.delete(from)
      files.set(to, f)
    },
    async mkdir() {
      return undefined
    }
  }
  return { fs, files, dirs, state }
}

function xmlPlist(fields: Record<string, string>): Buffer {
  const body = Object.entries(fields)
    .map(([k, v]) => `<key>${k}</key><string>${v}</string>`)
    .join('')
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>${body}</dict></plist>`, 'utf8')
}

function regApp(f: FakeFs, dir: string, appName: string, plist?: Buffer): void {
  const list = f.dirs.get(dir) ?? []
  list.push({ name: appName, isDirectory: () => true })
  f.dirs.set(dir, list)
  if (plist) f.files.set(join(dir, appName, 'Contents', 'Info.plist'), plist)
}

function makeService(f: FakeFs, over: Partial<ConstructorParameters<typeof NativeAppsService>[0]> = {}) {
  let clock = 1000
  const opened: string[] = []
  const iconCalls: string[] = []
  const svc = new NativeAppsService({
    platform: 'darwin',
    homeDir: '/Users/t',
    userDataDir: '/data',
    fs: f.fs,
    openPath: async (p) => {
      opened.push(p)
      return p.includes('bad') ? '打开失败：未知错误' : ''
    },
    loadIcon: async (iconPath) => {
      iconCalls.push(iconPath)
      if (iconPath.includes('broken')) throw new Error('decode fail')
      return `data:image/png;base64,${basename(iconPath)}`
    },
    now: () => clock,
    ...over
  })
  return { svc, tick: (ms: number) => (clock += ms), opened, iconCalls }
}

describe('NativeAppsService（darwin）', () => {
  function standardFixture(): FakeFs {
    const f = fakeFs()
    regApp(f, '/Applications', 'Notes.app', xmlPlist({
      CFBundleDisplayName: 'Notes',
      CFBundleIdentifier: 'com.x.notes',
      CFBundleIconFile: 'AppIcon'
    }))
    regApp(f, '/Applications', 'Weird.app') // 无 Info.plist → 目录名兜底、id 回退路径
    regApp(f, '/Applications', 'Utilities') // 分组目录 → 深度 2
    regApp(f, '/Applications/Utilities', 'Terminal.app', Buffer.from(
      buildBinaryPlist(
        [
          bpDict([1, 2], [3, 4]),
          bpAscii('CFBundleDisplayName'),
          bpAscii('CFBundleIconFile'),
          bpUtf16('终端'),
          bpAscii('TermIcon.icns')
        ],
        0
      )
    ))
    regApp(f, '/Users/t/Applications', 'Dup.app', xmlPlist({ CFBundleName: 'Dup', CFBundleIdentifier: 'com.x.notes' }))
    regApp(f, '/System/Applications', 'Calc.app', xmlPlist({ CFBundleName: '计算器', CFBundleIdentifier: 'com.x.calc' }))
    return f
  }

  it('扫描：名称/图标路径解析、目录名兜底、深度 2、跨根 bundleId 去重（先扫根优先）', async () => {
    const f = standardFixture()
    const { svc } = makeService(f)
    const snap = await svc.list()
    expect(snap.fromCache).toBe(false)
    const byId = new Map(snap.apps.map((a) => [a.id, a]))
    expect(byId.get('com.x.notes')).toMatchObject({
      name: 'Notes',
      path: '/Applications/Notes.app',
      iconPath: join('/Applications/Notes.app', 'Contents', 'Resources', 'AppIcon.icns'),
      icon: `data:image/png;base64,${'AppIcon.icns'}`
    })
    expect(byId.get('/Applications/Weird.app')).toMatchObject({ name: 'Weird', bundleId: undefined })
    expect(byId.get('/Applications/Weird.app')!.icon).toBeUndefined()
    // 系统目录默认排除（只扫用户自装应用），Dup 与 Notes 同 bundleId 只留先扫的
    expect(snap.apps).toHaveLength(3)
    expect(byId.has('/Users/t/Applications/Dup.app')).toBe(false)
    expect(byId.has('com.x.calc')).toBe(false)
  })

  it('兜底：用户根皆空时扫 /System/Applications', async () => {
    const f = fakeFs()
    regApp(f, '/System/Applications', 'Calc.app', xmlPlist({ CFBundleName: '计算器', CFBundleIdentifier: 'com.x.calc' }))
    const snap = await makeService(f).svc.list()
    expect(snap.apps.map((a) => a.id)).toEqual(['com.x.calc'])
  })

  it('内存缓存：TTL 内二次 list 不重扫；refresh 强制重扫', async () => {
    const f = standardFixture()
    const { svc, tick } = makeService(f)
    await svc.list()
    const calls1 = f.state.readdirCalls
    tick(60_000) // < 10min
    const snap2 = await svc.list()
    expect(snap2.fromCache).toBe(true)
    expect(f.state.readdirCalls).toBe(calls1)
    tick(60_000)
    await svc.list({ refresh: true })
    expect(f.state.readdirCalls).toBeGreaterThan(calls1)
  })

  it('磁盘缓存：扫描结果落盘，新实例 TTL 内直接采用（不扫盘），过期后重扫', async () => {
    const f = standardFixture()
    const first = makeService(f)
    const snap1 = await first.svc.list()
    expect([...f.files.keys()].some((p) => p.endsWith('native-apps-cache.v2.json'))).toBe(true)

    const second = makeService(f, { memoryTtlMs: 0 })
    const snap2 = await second.svc.list()
    expect(snap2.fromCache).toBe(true)
    expect(snap2.apps.map((a) => a.id)).toEqual(snap1.apps.map((a) => a.id))
    const before = f.state.readdirCalls
    expect(before).toBeGreaterThan(0)

    const third = makeService(f, { memoryTtlMs: 0, diskTtlMs: 0, now: () => 999_999 })
    const snap3 = await third.svc.list()
    expect(snap3.fromCache).toBe(false)
    expect(f.state.readdirCalls).toBe(before + 3) // 一次扫描 = 2 个用户根 + Utilities 二层（系统根已默认排除）
  })

  it('图标：解码失败为 undefined 且负缓存（两轮 list 只解码一次）', async () => {
    const f = fakeFs()
    regApp(f, '/Applications', 'Bad.app', xmlPlist({ CFBundleName: 'Bad', CFBundleIdentifier: 'com.x.bad', CFBundleIconFile: 'broken' }))
    const { svc, iconCalls } = makeService(f)
    const s1 = await svc.list()
    expect(s1.apps[0].icon).toBeUndefined()
    await svc.list({ refresh: true })
    expect(iconCalls).toHaveLength(1)
  })

  it('open：成功/失败回传，非法路径拒绝', async () => {
    const f = fakeFs()
    const { svc, opened } = makeService(f)
    expect(await svc.open('/Applications/Notes.app')).toEqual({ ok: true })
    expect(await svc.open('/Applications/bad.app')).toEqual({ ok: false, error: '打开失败：未知错误' })
    expect(await svc.open('/etc/passwd')).toMatchObject({ ok: false })
    expect(opened).toEqual(['/Applications/Notes.app', '/Applications/bad.app'])
  })

  it('置顶：增删查 + 落盘（新实例读回）+ 影响输出排序', async () => {
    const f = standardFixture()
    const { svc } = makeService(f)
    expect(await svc.pinnedIds()).toEqual([])
    expect(await svc.pin('/Applications/Weird.app')).toEqual(['/Applications/Weird.app'])
    expect(await svc.pin('com.x.notes')).toEqual(['/Applications/Weird.app', 'com.x.notes'])
    expect(await svc.pin('/Applications/Weird.app')).toEqual(['/Applications/Weird.app', 'com.x.notes']) // 重复 pin 不变

    const snap = await svc.list()
    expect(snap.apps.map((a) => a.id).slice(0, 2)).toEqual(['/Applications/Weird.app', 'com.x.notes'])
    // 渲染层 parseAppsSnapshot 靠 snapshot.pinned 画角标（App.vue 不从 apps 反推），字段缺失=重启后角标丢失
    expect(snap.pinned).toEqual(['/Applications/Weird.app', 'com.x.notes'])

    expect(await svc.unpin('/Applications/Weird.app')).toEqual(['com.x.notes'])
    const again = makeService(f)
    expect(await again.svc.pinnedIds()).toEqual(['com.x.notes']) // 从 pinned-apps.json 读回
    const snap2 = await again.svc.list()
    expect(snap2.apps[0].id).toBe('com.x.notes')
    expect(snap2.pinned).toEqual(['com.x.notes']) // 重启（新实例）后快照仍带置顶序
  })

  it('win32：接口占位返回空列表，不触扫描', async () => {
    const f = fakeFs()
    const { svc } = makeService(f, { platform: 'win32' })
    const snap = await svc.list()
    expect(snap.apps).toEqual([])
    expect(snap.fromCache).toBe(false)
    expect(f.state.readdirCalls).toBe(0)
  })

  it('pinned-apps.json 坏 JSON / 形状脏数据：空列表起步，脏项被清理', async () => {
    const f1 = fakeFs()
    f1.files.set(join('/data', 'pinned-apps.json'), Buffer.from('{oops', 'utf8'))
    expect(await makeService(f1).svc.pinnedIds()).toEqual([])

    const f2 = fakeFs()
    f2.files.set(
      join('/data', 'pinned-apps.json'),
      Buffer.from(JSON.stringify({ version: 1, pinned: ['a', '', 2, 'a', null] }), 'utf8')
    )
    expect(await makeService(f2).svc.pinnedIds()).toEqual(['a'])
  })

  it('unpin 未知 id 不变；落盘形状 { version, pinned } 且临时文件已换名', async () => {
    const f = standardFixture()
    const { svc } = makeService(f)
    await svc.pin('com.x.calc')
    expect(await svc.unpin('ghost')).toEqual(['com.x.calc'])
    expect(JSON.parse(f.files.get(join('/data', 'pinned-apps.json'))!.toString('utf8'))).toEqual({
      version: 1,
      pinned: ['com.x.calc']
    })
    expect(f.files.has(join('/data', 'pinned-apps.json.tmp'))).toBe(false)
  })

  it('磁盘缓存坏 JSON / 坏形状：忽略并重扫', async () => {
    const f = standardFixture()
    await makeService(f).svc.list() // 先落一份好缓存
    for (const bad of ['{corrupt', JSON.stringify({ version: 2, scannedAt: 1, apps: [] })]) {
      f.files.set(join('/data', 'native-apps-cache.v2.json'), Buffer.from(bad, 'utf8'))
      const snap = await makeService(f, { memoryTtlMs: 0 }).svc.list()
      expect(snap.fromCache).toBe(false)
      expect(snap.apps).not.toHaveLength(0)
    }
  })
})
