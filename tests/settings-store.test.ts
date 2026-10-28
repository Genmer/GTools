import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsStore, DEFAULT_SETTINGS } from '../src/main/settings-store'
import type { FsLike } from '../src/main/settings-store'
import type { TransparencySettings } from '@sdk/settings'

const platformDefaults = (): typeof DEFAULT_SETTINGS => structuredClone(DEFAULT_SETTINGS)

type FakeFs = FsLike & {
  writes: { path: string; data: string }[]
  renames: { from: string; to: string }[]
  files: Map<string, string>
  readFailCode: string | null
}

function fakeFs(initial?: Record<string, string>): FakeFs {
  const files = new Map<string, string>(Object.entries(initial ?? {}))
  const writes: { path: string; data: string }[] = []
  const renames: { from: string; to: string }[] = []
  // 非 null 时 readFile 一律抛该错误码（模拟杀软/备份软件瞬时锁文件）
  let readFailCode: string | null = null
  const fs: FakeFs = {
    writes,
    renames,
    files,
    get readFailCode(): string | null {
      return readFailCode
    },
    set readFailCode(code: string | null) {
      readFailCode = code
    },
    async readFile(path) {
      if (readFailCode !== null) {
        throw Object.assign(new Error(`${readFailCode}: read failed: ${path}`), { code: readFailCode })
      }
      const v = files.get(path)
      if (v === undefined) throw Object.assign(new Error(`ENOENT: no such file: ${path}`), { code: 'ENOENT' })
      return v
    },
    async writeFile(path, data) {
      writes.push({ path, data })
      files.set(path, data)
    },
    async rename(from, to) {
      renames.push({ from, to })
      const v = files.get(from)
      if (v !== undefined) {
        files.delete(from)
        files.set(to, v)
      }
    },
    async mkdir() {}
  }
  return fs
}

const dir = '/tmp/gtools-test'

describe('settings-store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('无文件时用默认值，update 合并字段级覆盖（向前兼容）', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings).toEqual(platformDefaults())
    await store.update({ theme: 'dark' })
    expect(store.settings.theme).toBe('dark')
    expect(store.settings.hotkey).toEqual(DEFAULT_SETTINGS.hotkey) // 未传字段不丢
  })

  it('旧版本文件缺字段时深合并默认值', async () => {
    const fs = fakeFs({ [`${dir}/settings.json`]: JSON.stringify({ theme: 'dark' }) })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.theme).toBe('dark')
    expect(store.settings.hotkey.darwin).toBe(DEFAULT_SETTINGS.hotkey.darwin)
  })

  it('outlineEnabled 轮廓环开关：默认开，boolean 原样收录，坏类型丢弃回退现值', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.outlineEnabled).toBe(true)
    await store.update({ outlineEnabled: false })
    expect(store.settings.outlineEnabled).toBe(false)
    await store.update({ outlineEnabled: 'yes' as unknown as boolean })
    expect(store.settings.outlineEnabled).toBe(false)
  })

  it('outlineWidth 环宽：默认 3，越界夹 0-5，小数四舍五入，坏值剔除保现值', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.outlineWidth).toBe(3)
    await store.update({ outlineWidth: 9 })
    expect(store.settings.outlineWidth).toBe(5)
    await store.update({ outlineWidth: -3 })
    expect(store.settings.outlineWidth).toBe(0)
    await store.update({ outlineWidth: 2.6 })
    expect(store.settings.outlineWidth).toBe(3)
    for (const bad of ['x', Number.NaN, Number.POSITIVE_INFINITY, null]) {
      await store.update({ outlineWidth: bad as unknown as number })
      expect(store.settings.outlineWidth).toBe(3) // 坏值剔除，保留现值
    }
  })

  it('outlineColor 环色：默认 auto，六枚举生效，非枚举剔除保现值', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.outlineColor).toBe('auto')
    await store.update({ outlineColor: 'rainbow' })
    expect(store.settings.outlineColor).toBe('rainbow')
    await store.update({ outlineColor: 'rainbow-gradient' })
    expect(store.settings.outlineColor).toBe('rainbow-gradient')
    await store.update({ outlineColor: 'custom' })
    expect(store.settings.outlineColor).toBe('custom')
    await store.update({ outlineColor: 'red' as unknown as 'auto' })
    expect(store.settings.outlineColor).toBe('custom')
  })

  it('outlineCustomColor 自定义环色：默认 #42a5f5，3 位扩位小写化，坏 hex 剔除保现值', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.outlineCustomColor).toBe('#42a5f5')
    await store.update({ outlineCustomColor: '#aabbcc' })
    expect(store.settings.outlineCustomColor).toBe('#aabbcc')
    await store.update({ outlineCustomColor: '#ABC' })
    expect(store.settings.outlineCustomColor).toBe('#aabbcc')
    for (const bad of ['red', '#aabb', '#aabbccd', 42, null]) {
      await store.update({ outlineCustomColor: bad as unknown as string })
      expect(store.settings.outlineCustomColor).toBe('#aabbcc') // 坏值剔除，保留现值
    }
  })

  it('appLogSkin 日志底色：默认 black，white 生效，非法值剔除保现值', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.appLogSkin).toBe('black')
    await store.update({ appLogSkin: 'white' })
    expect(store.settings.appLogSkin).toBe('white')
    await store.update({ appLogSkin: 'dark' as unknown as 'white' })
    expect(store.settings.appLogSkin).toBe('white')
  })

  it('appLogoSkin logo 底色：默认 black，white 生效，非法值剔除保现值', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.appLogoSkin).toBe('black')
    await store.update({ appLogoSkin: 'white' })
    expect(store.settings.appLogoSkin).toBe('white')
    await store.update({ appLogoSkin: 'blue' as unknown as 'white' })
    expect(store.settings.appLogoSkin).toBe('white')
  })

  it('旧文件缺 outlineWidth/outlineColor 字段：load 后深合并为默认 3/auto', async () => {
    const fs = fakeFs({ [`${dir}/settings.json`]: JSON.stringify({ theme: 'dark' }) })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.outlineWidth).toBe(3)
    expect(store.settings.outlineColor).toBe('auto')
    expect(store.settings.outlineCustomColor).toBe('#42a5f5')
    expect(store.settings.theme).toBe('dark')
  })

  it('outlineWidth 边界值 0/5 本身合法收录（夹取不伤端点，0=隐形）', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({ outlineWidth: 0 })
    expect(store.settings.outlineWidth).toBe(0)
    await store.update({ outlineWidth: 5 })
    expect(store.settings.outlineWidth).toBe(5)
  })

  it('轮廓环宽/色随文件持久化往返：update→flush 落盘，新 store load 回显', async () => {
    const fs = fakeFs()
    const a = new SettingsStore(dir, fs)
    await a.load()
    await a.update({ outlineEnabled: false, outlineWidth: 0, outlineColor: 'custom', outlineCustomColor: '#123456' })
    await a.flush()
    const onDisk = JSON.parse(fs.files.get(`${dir}/settings.json`)!)
    expect(onDisk.outlineWidth).toBe(0)
    expect(onDisk.outlineColor).toBe('custom')
    expect(onDisk.outlineCustomColor).toBe('#123456')
    const b = new SettingsStore(dir, fs)
    await b.load()
    expect(b.settings.outlineEnabled).toBe(false)
    expect(b.settings.outlineWidth).toBe(0)
    expect(b.settings.outlineColor).toBe('custom')
    expect(b.settings.outlineCustomColor).toBe('#123456')
  })

  it('手改文件 outline 三字段坏值：load 后各自回退默认 3/auto/true，合法字段不受牵连', async () => {
    const fs = fakeFs({
      [`${dir}/settings.json`]: JSON.stringify({
        theme: 'dark',
        outlineEnabled: 'yes',
        outlineWidth: 'fat',
        outlineColor: 'red',
        outlineCustomColor: 'nope'
      })
    })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.outlineEnabled).toBe(true)
    expect(store.settings.outlineWidth).toBe(3)
    expect(store.settings.outlineColor).toBe('auto')
    expect(store.settings.outlineCustomColor).toBe('#42a5f5')
    expect(store.settings.theme).toBe('dark')
  })

  it('glass 主题：load 原样保留（合法三态之一），transparency 取默认', async () => {
    const fs = fakeFs({ [`${dir}/settings.json`]: JSON.stringify({ theme: 'glass' }) })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.theme).toBe('glass')
    expect(store.settings.transparency).toEqual({ enabled: true, opacity: 55, blur: true, glassFrost: 45 })
  })

  it('transparency 校验：合法字段收录，opacity 越界夹取 0-100，坏类型丢弃', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({ transparency: { enabled: true, opacity: 150, blur: false } })
    expect(store.settings.transparency).toEqual({ enabled: true, opacity: 100, blur: false, glassFrost: 45 })
    await store.update({ transparency: { opacity: -5 } })
    expect(store.settings.transparency.opacity).toBe(0)
    await store.update({ transparency: { opacity: 'x' as unknown as number } })
    expect(store.settings.transparency.opacity).toBe(0) // 坏类型丢弃，保留现值
    await store.update({ transparency: { blur: 'yes' as unknown as boolean } })
    expect(store.settings.transparency.blur).toBe(false) // 坏类型丢弃，保留现值
  })

  it('transparency 字段级合并：只传 opacity 不丢 enabled/blur', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({ transparency: { enabled: false } })
    await store.update({ transparency: { opacity: 30 } })
    expect(store.settings.transparency).toEqual({ enabled: false, opacity: 30, blur: true, glassFrost: 45 })
  })

  it('旧档含已废弃的 glassMaterial 字段：加载忽略不报错，其余字段照常', async () => {
    const fs = fakeFs({ [`${dir}/settings.json`]: JSON.stringify({ theme: 'glass', glassMaterial: 'acrylic', hideOnBlur: false }) })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.theme).toBe('glass')
    expect(store.settings.hideOnBlur).toBe(false)
    expect('glassMaterial' in store.settings).toBe(false)
  })

  it('update launchAtLogin：内存立即生效，flush 后落盘 JSON 为 true', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({ launchAtLogin: true })
    expect(store.settings.launchAtLogin).toBe(true)
    await store.flush()
    expect(JSON.parse(fs.files.get(`${dir}/settings.json`)!).launchAtLogin).toBe(true)
  })

  it('手改文件 launchAtLogin 非布尔（"yes"）：load 后回退 false，合法字段不受牵连', async () => {
    const fs = fakeFs({
      [`${dir}/settings.json`]: JSON.stringify({ theme: 'glass', launchAtLogin: 'yes' })
    })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.launchAtLogin).toBe(false)
    expect(store.settings.theme).toBe('glass') // 合法主题不受坏字段牵连
  })

  it('旧格式文件无 launchAtLogin 字段：load 后深合并为默认 false', async () => {
    const fs = fakeFs({
      [`${dir}/settings.json`]: JSON.stringify({ theme: 'dark', disabledPlugins: ['x'] })
    })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.launchAtLogin).toBe(false)
    expect(store.settings.theme).toBe('dark')
    expect(store.settings.disabledPlugins).toEqual(['x'])
  })

  it('update clipboardSuggest=false：内存立即生效，flush 后落盘 JSON 为 false', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({ clipboardSuggest: false })
    expect(store.settings.clipboardSuggest).toBe(false)
    await store.flush()
    expect(JSON.parse(fs.files.get(`${dir}/settings.json`)!).clipboardSuggest).toBe(false)
  })

  it('手改文件 clipboardSuggest 非布尔（"yes"）：load 后回退默认 true，合法字段不受牵连', async () => {
    const fs = fakeFs({
      [`${dir}/settings.json`]: JSON.stringify({ theme: 'glass', clipboardSuggest: 'yes' })
    })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.clipboardSuggest).toBe(true)
    expect(store.settings.theme).toBe('glass')
  })

  it('旧格式文件无 clipboardSuggest 字段：load 后深合并为默认 true', async () => {
    const fs = fakeFs({
      [`${dir}/settings.json`]: JSON.stringify({ theme: 'dark', disabledPlugins: ['x'] })
    })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.clipboardSuggest).toBe(true)
    expect(store.settings.theme).toBe('dark')
    expect(store.settings.disabledPlugins).toEqual(['x'])
  })

  it('update hideOnBlur=false：内存立即生效，flush 后落盘 JSON 为 false', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({ hideOnBlur: false })
    expect(store.settings.hideOnBlur).toBe(false)
    await store.flush()
    expect(JSON.parse(fs.files.get(`${dir}/settings.json`)!).hideOnBlur).toBe(false)
  })

  it('手改文件 hideOnBlur 非布尔（"yes"）：load 后回退默认 true，合法字段不受牵连', async () => {
    const fs = fakeFs({
      [`${dir}/settings.json`]: JSON.stringify({ theme: 'glass', hideOnBlur: 'yes' })
    })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.hideOnBlur).toBe(true)
    expect(store.settings.theme).toBe('glass')
  })

  it('旧格式文件无 hideOnBlur 字段：load 后深合并为默认 true', async () => {
    const fs = fakeFs({
      [`${dir}/settings.json`]: JSON.stringify({ theme: 'dark', disabledPlugins: ['x'] })
    })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.hideOnBlur).toBe(true)
    expect(store.settings.theme).toBe('dark')
    expect(store.settings.disabledPlugins).toEqual(['x'])
  })

  it('手改文件两开关为合法 false：load 后原样保留不回退默认', async () => {
    const fs = fakeFs({
      [`${dir}/settings.json`]: JSON.stringify({ clipboardSuggest: false, hideOnBlur: false })
    })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.clipboardSuggest).toBe(false)
    expect(store.settings.hideOnBlur).toBe(false)
  })

  it('原子写：先写 .tmp 再 rename 到目标（防抖窗口内只落一次盘）', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({ theme: 'dark' })
    await store.update({ transparency: { opacity: 70 } })
    await store.update({ disabledPlugins: ['x'] })
    expect(fs.writes.length).toBe(0) // 防抖期内未写盘
    await vi.advanceTimersByTimeAsync(400)
    expect(fs.writes.length).toBe(1)
    expect(fs.writes[0].path).toBe(`${dir}/settings.json.tmp`)
    expect(fs.renames).toEqual([{ from: `${dir}/settings.json.tmp`, to: `${dir}/settings.json` }])
    const saved = JSON.parse(fs.writes[0].data)
    expect(saved.theme).toBe('dark')
    expect(saved.transparency).toEqual({ enabled: true, opacity: 70, blur: true, glassFrost: 45 })
  })

  it('flush 在防抖窗口内被调用时立即落盘', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({ theme: 'dark' })
    await store.flush()
    expect(fs.renames).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(400)
    expect(fs.writes.length).toBe(1) // 定时器触发时不再重复写
  })

  it('损坏文件不抛异常，回退默认值', async () => {
    const fs = fakeFs({ [`${dir}/settings.json`]: '{broken' })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings).toEqual(platformDefaults())
  })

  it('损坏文件先 rename 留证（.corrupt-<时间戳>），残余内容不丢', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fs = fakeFs({ [`${dir}/settings.json`]: '{broken' })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings).toEqual(platformDefaults())
    expect(fs.renames).toHaveLength(1)
    expect(fs.renames[0].from).toBe(`${dir}/settings.json`)
    expect(fs.renames[0].to).toMatch(/[/\\]settings\.json\.corrupt-\d{8}-\d{6}$/)
    expect(fs.files.get(fs.renames[0].to)).toBe('{broken') // 原残余保留在留证文件
    errSpy.mockRestore()
  })

  it('非 ENOENT 读错（EBUSY 瞬时锁）：load 上抛不置 loaded，update 重试失败不落盘，盘上设置原样', async () => {
    const onDisk = JSON.stringify({ theme: 'dark', windowPos: { x: 11, y: 22 } })
    const fs = fakeFs({ [`${dir}/settings.json`]: onDisk })
    fs.readFailCode = 'EBUSY'
    const store = new SettingsStore(dir, fs)
    await expect(store.load()).rejects.toMatchObject({ code: 'EBUSY' })
    expect(store.settings).toEqual(platformDefaults()) // 未加载：内存停在初始默认态，未被盘上内容污染
    await expect(store.update({ theme: 'light' })).rejects.toMatchObject({ code: 'EBUSY' }) // 懒加载重试同败
    await store.flush()
    expect(fs.writes).toHaveLength(0) // dirty 未置，flush 不写盘
    expect(fs.renames).toHaveLength(0)
    expect(fs.files.get(`${dir}/settings.json`)).toBe(onDisk) // 盘上设置原样
  })

  it('EBUSY 解除后 update 懒加载读回盘上设置：不以默认底整包覆盖', async () => {
    const onDisk = JSON.stringify({ theme: 'dark', windowPos: { x: 11, y: 22 } })
    const fs = fakeFs({ [`${dir}/settings.json`]: onDisk })
    fs.readFailCode = 'EBUSY'
    const store = new SettingsStore(dir, fs)
    await expect(store.load()).rejects.toMatchObject({ code: 'EBUSY' })
    fs.readFailCode = null // 锁解除
    await store.update({ theme: 'light' })
    expect(store.settings.theme).toBe('light')
    expect(store.settings.windowPos).toEqual({ x: 11, y: 22 }) // 盘上原值经重试 load 读回
    await store.flush()
    const saved = JSON.parse(fs.files.get(`${dir}/settings.json`)!)
    expect(saved.theme).toBe('light')
    expect(saved.windowPos).toEqual({ x: 11, y: 22 })
  })

  it('合法 JSON 但字段类型非法：坏值回退默认，不再向快捷键层传非字符串', async () => {
    const fs = fakeFs({
      [`${dir}/settings.json`]: JSON.stringify({
        hotkey: { darwin: 123, win32: null },
        theme: 'banana',
        disabledPlugins: 'nope'
      })
    })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings).toEqual(platformDefaults())
  })

  it('合法 JSON 但快捷键语义非法（不可注册）：该平台回退默认，另一平台保留', async () => {
    const fs = fakeFs({
      [`${dir}/settings.json`]: JSON.stringify({ hotkey: { darwin: 'abc', win32: 'Ctrl+Alt+P' } })
    })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.hotkey.darwin).toBe(DEFAULT_SETTINGS.hotkey.darwin)
    expect(store.settings.hotkey.win32).toBe('Ctrl+Alt+P')
  })

  it('update 通道同样过滤非法字段（IPC 入参防御）', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({ theme: 'banana', hotkey: { darwin: 5 }, disabledPlugins: [1] } as unknown as Parameters<
      SettingsStore['update']
    >[0])
    expect(store.settings).toEqual(platformDefaults())
  })

  it('update commandHotkeys：合法项保留', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({
      commandHotkeys: [
        { pluginId: 'json-editor', commandId: 'format', darwin: 'Alt+T', win32: 'Ctrl+Alt+T' }
      ]
    })
    expect(store.settings.commandHotkeys).toEqual([
      { pluginId: 'json-editor', commandId: 'format', darwin: 'Alt+T', win32: 'Ctrl+Alt+T' }
    ])
  })

  it('指令绑定持久化往返：update→flush 落盘 JSON，新 store load 后回显', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({
      commandHotkeys: [{ pluginId: 'json-editor', commandId: 'format', darwin: 'Alt+T', win32: 'Alt+T' }]
    })
    await store.flush()
    const onDisk = JSON.parse(fs.files.get(`${dir}/settings.json`)!)
    expect(onDisk.commandHotkeys).toEqual([
      { pluginId: 'json-editor', commandId: 'format', darwin: 'Alt+T', win32: 'Alt+T' }
    ])
    const reopened = new SettingsStore(dir, fs)
    await reopened.load()
    expect(reopened.settings.commandHotkeys).toEqual([
      { pluginId: 'json-editor', commandId: 'format', darwin: 'Alt+T', win32: 'Alt+T' }
    ])
  })

  it('update commandHotkeys：坏项剔除（空 id、非对象项、非法加速键），合法项保留', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({
      commandHotkeys: [
        'nope',
        { pluginId: '', commandId: 'a', darwin: 'Alt+T', win32: 'Alt+T' },
        { pluginId: 'p', commandId: '', darwin: 'Alt+T', win32: 'Alt+T' },
        { pluginId: 'p', commandId: 'a', darwin: 'Cmd+Space', win32: 'Ctrl+Space' }, // 两平台分别撞 Spotlight/输入法切换
        { pluginId: 'p', commandId: 'a', darwin: 'abc', win32: 'Alt+T' },
        { pluginId: 'p', commandId: 'a', darwin: 'Alt+T', win32: 42 },
        { pluginId: 'json-editor', commandId: 'format', darwin: 'Alt+T', win32: 'Ctrl+Alt+T' }
      ] as unknown as Parameters<SettingsStore['update']>[0]['commandHotkeys']
    })
    expect(store.settings.commandHotkeys).toEqual([
      { pluginId: 'json-editor', commandId: 'format', darwin: 'Alt+T', win32: 'Ctrl+Alt+T' }
    ])
  })

  it('update commandHotkeys：Alt+Space 两平台均合法保留（win32 曾被误判系统保留）', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({
      commandHotkeys: [{ pluginId: 'p', commandId: 'a', darwin: 'Alt+Space', win32: 'Alt+Space' }]
    })
    expect(store.settings.commandHotkeys).toEqual([
      { pluginId: 'p', commandId: 'a', darwin: 'Alt+Space', win32: 'Alt+Space' }
    ])
  })

  it('update commandHotkeys：同平台同加速键去重保留首个', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({
      commandHotkeys: [
        { pluginId: 'a', commandId: 'x', darwin: 'Alt+T', win32: 'Ctrl+J' },
        { pluginId: 'b', commandId: 'y', darwin: 'Alt+T', win32: 'Ctrl+J' }, // 两平台都撞第一项
        { pluginId: 'c', commandId: 'z', darwin: 'Ctrl+K', win32: 'Ctrl+J' } // 仅 win32 撞，整项仍剔除
      ]
    })
    expect(store.settings.commandHotkeys).toEqual([
      { pluginId: 'a', commandId: 'x', darwin: 'Alt+T', win32: 'Ctrl+J' }
    ])
  })

  it('update commandHotkeys：整组替换，未传字段不丢，空数组清空', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({
      commandHotkeys: [{ pluginId: 'a', commandId: 'x', darwin: 'Alt+T', win32: 'Alt+T' }]
    })
    await store.update({
      commandHotkeys: [{ pluginId: 'b', commandId: 'y', darwin: 'Ctrl+K', win32: 'Ctrl+K' }]
    })
    expect(store.settings.commandHotkeys).toEqual([
      { pluginId: 'b', commandId: 'y', darwin: 'Ctrl+K', win32: 'Ctrl+K' }
    ])
    await store.update({ theme: 'dark' }) // 不携带 commandHotkeys 的 patch 不清空
    expect(store.settings.commandHotkeys).toHaveLength(1)
    await store.update({ commandHotkeys: [] })
    expect(store.settings.commandHotkeys).toEqual([])
  })

  it('手改文件 commandHotkeys 含坏项：load 后剔除，且与主 hotkey 撞键不拦截', async () => {
    const fs = fakeFs({
      [`${dir}/settings.json`]: JSON.stringify({
        hotkey: { darwin: 'Alt+Space', win32: 'Ctrl+Alt+Space' },
        commandHotkeys: [
          { pluginId: 'a', commandId: 'x', darwin: 'Alt+Space', win32: 'Ctrl+Alt+Space' }, // 与主热键同键：sanitize 放行
          { pluginId: 'b', commandId: 'y', darwin: 'F11', win32: 'bad' }
        ]
      })
    })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.commandHotkeys).toEqual([
      { pluginId: 'a', commandId: 'x', darwin: 'Alt+Space', win32: 'Ctrl+Alt+Space' }
    ])
  })

  it('旧格式文件无 commandHotkeys 字段：load 后深合并为默认空数组', async () => {
    const fs = fakeFs({ [`${dir}/settings.json`]: JSON.stringify({ theme: 'dark' }) })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.commandHotkeys).toEqual([])
    expect(store.settings.theme).toBe('dark')
  })

  it('update commandHotkeys 传非数组：整体丢弃回退现值', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    const bound = [{ pluginId: 'a', commandId: 'x', darwin: 'Alt+T', win32: 'Alt+T' }]
    await store.update({ commandHotkeys: bound })
    await store.update({ commandHotkeys: 'nope' } as unknown as Parameters<SettingsStore['update']>[0])
    expect(store.settings.commandHotkeys).toEqual(bound)
  })

  it('windowPos：合法坐标取整入库，null 清除记忆，坏值丢弃回退现值', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({ windowPos: { x: 100.6, y: 50.4 } })
    expect(store.settings.windowPos).toEqual({ x: 101, y: 50 })
    await store.update({ windowPos: null })
    expect(store.settings.windowPos).toBeNull()
    await store.update({ windowPos: { x: 1, y: 2 } })
    await store.update({ windowPos: { x: Number.NaN, y: 2 } as { x: number; y: number } })
    expect(store.settings.windowPos).toEqual({ x: 1, y: 2 })
  })

  it('windowPos 随文件持久化与重载恢复', async () => {
    const fs = fakeFs()
    const a = new SettingsStore(dir, fs)
    await a.load()
    await a.update({ windowPos: { x: 300, y: 200 } })
    await a.flush()
    const b = new SettingsStore(dir, fs)
    await b.load()
    expect(b.settings.windowPos).toEqual({ x: 300, y: 200 })
  })

  it('文件里存了坏 windowPos（字符串/缺 y/非有限数/非对象）：load 回退默认 null，其余字段不受牵连', async () => {
    const loadWith = async (windowPos: unknown): Promise<SettingsStore> => {
      const fs = fakeFs({ [`${dir}/settings.json`]: JSON.stringify({ theme: 'dark', windowPos }) })
      const store = new SettingsStore(dir, fs)
      await store.load()
      return store
    }
    for (const bad of ['left-top', { x: 100 }, { x: 1, y: Number.POSITIVE_INFINITY }, 42]) {
      const store = await loadWith(bad)
      expect(store.settings.windowPos).toBeNull()
      expect(store.settings.theme).toBe('dark') // 坏 windowPos 不拖垮整个文件合并
    }
    const good = await loadWith({ x: 50.7, y: -30.2 })
    expect(good.settings.windowPos).toEqual({ x: 51, y: -30 })
  })

  // ===== 本地 win 线合流补测（磨砂度/剪贴板面板/自定义背景，随 v0.0.29-0.0.42 线合入）=====
  it('update transparency.glassFrost：0-100 夹取，坏类型丢弃保留现值，字段级合并不牵连', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({ transparency: { glassFrost: 70 } })
    expect(store.settings.transparency.glassFrost).toBe(70)
    await store.update({ transparency: { glassFrost: 150 } })
    expect(store.settings.transparency.glassFrost).toBe(100)
    await store.update({ transparency: { glassFrost: -3 } })
    expect(store.settings.transparency.glassFrost).toBe(0)
    await store.update({ transparency: { glassFrost: 'x' as unknown as number } })
    expect(store.settings.transparency.glassFrost).toBe(0) // 坏类型丢弃，保留现值
    await store.update({ transparency: { opacity: 80 } })
    expect(store.settings.transparency.glassFrost).toBe(0) // 只传 opacity 不丢 glassFrost
  })

  it('迁移：旧档缺 glassFrost 按 opacity 派生（55→45、30→70、0→100），已带字段不派生', async () => {
    const loadTx = async (tx: unknown): Promise<TransparencySettings> => {
      const fs = fakeFs({ [`${dir}/settings.json`]: JSON.stringify({ theme: 'glass', transparency: tx }) })
      const store = new SettingsStore(dir, fs)
      await store.load()
      return store.settings.transparency
    }
    expect(await loadTx({ enabled: true, opacity: 55, blur: true, glassFrost: 45 })).toEqual({
      enabled: true,
      opacity: 55,
      blur: true,
      glassFrost: 45
    })
    expect((await loadTx({ opacity: 30 })).glassFrost).toBe(70)
    expect((await loadTx({ opacity: 0 })).glassFrost).toBe(100)
    expect((await loadTx({ opacity: 20, glassFrost: 80 })).glassFrost).toBe(80) // 已带字段不派生
    expect((await loadTx({ opacity: 20, glassFrost: 'x' })).glassFrost).toBe(45) // 字段在但坏类型：不派生，回默认
    expect((await loadTx({ enabled: false, blur: true })).glassFrost).toBe(45) // 无 opacity：默认 45
  })

  it('update clipboardPanel position=off：内存立即生效，flush 落盘往返（新 store load 后回显）', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({ clipboardPanel: { position: 'off' } })
    expect(store.settings.clipboardPanel).toEqual({ position: 'off' })
    await store.flush()
    expect(JSON.parse(fs.files.get(`${dir}/settings.json`)!).clipboardPanel).toEqual({ position: 'off' })
    const reopened = new SettingsStore(dir, fs)
    await reopened.load()
    expect(reopened.settings.clipboardPanel).toEqual({ position: 'off' })
  })

  it('迁移：旧文件 clipboardSuggest=false → 新开关 false 且面板 off（显式拒绝读取不被换形态放大采集）', async () => {
    const fs = fakeFs({ [`${dir}/settings.json`]: JSON.stringify({ theme: 'dark', clipboardSuggest: false }) })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.clipboardPanel).toEqual({ position: 'off' })
    expect(store.settings.clipboardSuggest).toBe(false)
    expect(store.settings.theme).toBe('dark')
  })

  it('迁移：旧文件 clipboardSuggest=true 或缺省 → 开关默认 true、面板默认 right（true 现为在册字段直接保留）', async () => {
    const on = fakeFs({ [`${dir}/settings.json`]: JSON.stringify({ clipboardSuggest: true }) })
    const storeOn = new SettingsStore(dir, on)
    await storeOn.load()
    expect(storeOn.settings.clipboardPanel).toEqual({ position: 'right' })
    expect(storeOn.settings.clipboardSuggest).toBe(true)

    const absent = fakeFs({ [`${dir}/settings.json`]: JSON.stringify({ theme: 'dark', disabledPlugins: ['x'] }) })
    const storeAbsent = new SettingsStore(dir, absent)
    await storeAbsent.load()
    expect(storeAbsent.settings.clipboardPanel).toEqual({ position: 'right' })
    expect(storeAbsent.settings.clipboardSuggest).toBe(true)
    expect(storeAbsent.settings.disabledPlugins).toEqual(['x'])
  })

  it('迁移：同文件已带合法 clipboardPanel 时旧 clipboardSuggest 残留不反杀新值（开关本身仍保留 false）', async () => {
    const fs = fakeFs({
      [`${dir}/settings.json`]: JSON.stringify({ clipboardPanel: { position: 'below' }, clipboardSuggest: false })
    })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.clipboardPanel).toEqual({ position: 'below' })
    expect(store.settings.clipboardSuggest).toBe(false)
  })

  it('clipboardSuggest 往返：update 落盘为 false，重开加载仍 false（推荐读取开关持久化）', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({ clipboardSuggest: false })
    expect(store.settings.clipboardSuggest).toBe(false)
    await store.flush()
    expect(JSON.parse(fs.files.get(`${dir}/settings.json`)!).clipboardSuggest).toBe(false)
    const reopened = new SettingsStore(dir, fs)
    await reopened.load()
    expect(reopened.settings.clipboardSuggest).toBe(false)
  })

  it('手改文件 clipboardSuggest 非布尔（"yes"）：load 后回退默认 true', async () => {
    const fs = fakeFs({ [`${dir}/settings.json`]: JSON.stringify({ clipboardSuggest: 'yes' }) })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.clipboardSuggest).toBe(true)
  })

  it('position 坏值丢弃回默认：手改文件与 update 通道同闸', async () => {
    const fs = fakeFs({ [`${dir}/settings.json`]: JSON.stringify({ clipboardPanel: { position: 'middle' } }) })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.clipboardPanel).toEqual({ position: 'right' })
    await store.update({ clipboardPanel: { position: 42 as unknown as 'left' } })
    expect(store.settings.clipboardPanel).toEqual({ position: 'right' })
    await store.update({ clipboardPanel: { position: 'left' } })
    expect(store.settings.clipboardPanel).toEqual({ position: 'left' })
    await store.update({ theme: 'dark' }) // 不携带 clipboardPanel 的 patch 不清空
    expect(store.settings.clipboardPanel).toEqual({ position: 'left' })
  })

  it('手改文件行为偏好为合法值：迁移与相邻字段互不牵连（clipboardSuggest=false 迁 off，hideOnBlur 原样）', async () => {
    const fs = fakeFs({
      [`${dir}/settings.json`]: JSON.stringify({ clipboardSuggest: false, hideOnBlur: false })
    })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.clipboardPanel).toEqual({ position: 'off' })
    expect(store.settings.clipboardSuggest).toBe(false)
    expect(store.settings.hideOnBlur).toBe(false)
  })

  it('update background：三字段收录，file 白名单（空串走清除路径），dim 夹取，字段级合并不牵连', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({ background: { enabled: true, file: 'current.jpg', dim: 40 } })
    expect(store.settings.background).toEqual({ enabled: true, file: 'current.jpg', dim: 40 })
    await store.update({ background: { dim: 150 } })
    expect(store.settings.background.dim).toBe(100)
    expect(store.settings.background.enabled).toBe(true) // 不携带字段不丢
    await store.update({ background: { file: '' } })
    expect(store.settings.background.file).toBe('') // '' = 清除路径合法
    await store.update({ background: { file: '../evil.jpg' } })
    expect(store.settings.background.file).toBe('') // 白名单外丢弃保留现值
    await store.update({ background: { dim: 'x' as unknown as number, enabled: 'yes' as unknown as boolean } })
    expect(store.settings.background).toEqual({ enabled: true, file: '', dim: 100 }) // 坏类型丢弃保留现值
    await store.update({ theme: 'dark' }) // 不携带 background 的 patch 不清空
    expect(store.settings.background).toEqual({ enabled: true, file: '', dim: 100 })
  })

  it('手改文件 background 含坏值：坏项回退默认，相邻字段不受牵连', async () => {
    const fs = fakeFs({
      [`${dir}/settings.json`]: JSON.stringify({
        theme: 'dark',
        background: { enabled: 'yes', file: 'a/b.jpg', dim: 'x' },
        hideOnBlur: false
      })
    })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.background).toEqual({ enabled: false, file: '', dim: 40 })
    expect(store.settings.theme).toBe('dark')
    expect(store.settings.hideOnBlur).toBe(false)
  })

  it('background 持久化往返：update→flush 落盘，新 store load 后回显', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({ background: { enabled: true, file: 'current.jpg', dim: 60 } })
    await store.flush()
    expect(JSON.parse(fs.files.get(`${dir}/settings.json`)!).background).toEqual({
      enabled: true,
      file: 'current.jpg',
      dim: 60
    })
    const reopened = new SettingsStore(dir, fs)
    await reopened.load()
    expect(reopened.settings.background).toEqual({ enabled: true, file: 'current.jpg', dim: 60 })
  })
})
