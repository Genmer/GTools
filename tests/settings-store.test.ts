import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsStore, DEFAULT_SETTINGS } from '../src/main/settings-store'
import type { FsLike } from '../src/main/settings-store'

const platformDefaults = (): typeof DEFAULT_SETTINGS => structuredClone(DEFAULT_SETTINGS)

function fakeFs(initial?: Record<string, string>): FsLike & {
  writes: { path: string; data: string }[]
  renames: { from: string; to: string }[]
  files: Map<string, string>
} {
  const files = new Map<string, string>(Object.entries(initial ?? {}))
  const writes: { path: string; data: string }[] = []
  const renames: { from: string; to: string }[] = []
  return {
    writes,
    renames,
    files,
    async readFile(path) {
      const v = files.get(path)
      if (v === undefined) throw new Error('ENOENT')
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

  it('glass 主题：load 原样保留（合法三态之一），transparency 取默认', async () => {
    const fs = fakeFs({ [`${dir}/settings.json`]: JSON.stringify({ theme: 'glass' }) })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.theme).toBe('glass')
    expect(store.settings.transparency).toEqual({ enabled: true, opacity: 55, blur: true })
  })

  it('transparency 校验：合法字段收录，opacity 越界夹取 0-100，坏类型丢弃', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({ transparency: { enabled: true, opacity: 150, blur: false } })
    expect(store.settings.transparency).toEqual({ enabled: true, opacity: 100, blur: false })
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
    expect(store.settings.transparency).toEqual({ enabled: false, opacity: 30, blur: true })
  })

  it('glassMaterial：默认 wallpaper，合法三态收录（wallpaper/acrylic/clear），坏值丢弃保留现值，旧档缺字段走默认', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.glassMaterial).toBe('wallpaper')
    await store.update({ glassMaterial: 'acrylic' })
    expect(store.settings.glassMaterial).toBe('acrylic')
    await store.update({ glassMaterial: 'clear' })
    expect(store.settings.glassMaterial).toBe('clear')
    await store.update({ glassMaterial: 'frosted' as unknown as 'acrylic' })
    expect(store.settings.glassMaterial).toBe('clear') // 坏值丢弃
    // 旧档缺 glassMaterial 字段：merge 回退默认，其余字段不受牵连
    const fs2 = fakeFs({ [`${dir}/settings.json`]: JSON.stringify({ theme: 'glass', hideOnBlur: false }) })
    const store2 = new SettingsStore(dir, fs2)
    await store2.load()
    expect(store2.settings.glassMaterial).toBe('wallpaper')
    expect(store2.settings.hideOnBlur).toBe(false)
  })

  it('glassMaterial 校正：0.0.18 误写的 acrylic（无 user 标记）load 即回滚 wallpaper，显式选择不动', async () => {
    // 0.0.18 曾把 win32 平台默认误设 acrylic 并自动落进老档：无 glassMaterialSource 的 acrylic 是误写，一次性校正
    const fs = fakeFs({ [`${dir}/settings.json`]: JSON.stringify({ theme: 'glass', glassMaterial: 'acrylic' }) })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.glassMaterial).toBe('wallpaper')
    // 用户显式选的 acrylic 带 user 标记：校正不碰
    const fs2 = fakeFs({
      [`${dir}/settings.json`]: JSON.stringify({ theme: 'glass', glassMaterial: 'acrylic', glassMaterialSource: 'user' })
    })
    const store2 = new SettingsStore(dir, fs2)
    await store2.load()
    expect(store2.settings.glassMaterial).toBe('acrylic')
    expect(store2.settings.glassMaterialSource).toBe('user')
    // 显式 wallpaper 原样尊重
    const fs3 = fakeFs({ [`${dir}/settings.json`]: JSON.stringify({ theme: 'glass', glassMaterial: 'wallpaper' }) })
    const store3 = new SettingsStore(dir, fs3)
    await store3.load()
    expect(store3.settings.glassMaterial).toBe('wallpaper')
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
    expect(saved.transparency).toEqual({ enabled: true, opacity: 70, blur: true })
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
})
