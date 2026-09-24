import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsStore, DEFAULT_SETTINGS } from '../src/main/settings-store'
import type { FsLike } from '../src/main/settings-store'

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
    expect(store.settings).toEqual(DEFAULT_SETTINGS)
    await store.update({ theme: 'dark' })
    expect(store.settings.theme).toBe('dark')
    expect(store.settings.hotkey).toEqual(DEFAULT_SETTINGS.hotkey) // 未传字段不丢
  })

  it('旧版本文件缺字段时深合并默认值', async () => {
    const fs = fakeFs({ [`${dir}/settings.json`]: JSON.stringify({ theme: 'glass' }) })
    const store = new SettingsStore(dir, fs)
    await store.load()
    expect(store.settings.theme).toBe('glass')
    expect(store.settings.hotkey.darwin).toBe(DEFAULT_SETTINGS.hotkey.darwin)
  })

  it('原子写：先写 .tmp 再 rename 到目标（防抖窗口内只落一次盘）', async () => {
    const fs = fakeFs()
    const store = new SettingsStore(dir, fs)
    await store.load()
    await store.update({ theme: 'dark' })
    await store.update({ theme: 'glass' })
    await store.update({ disabledPlugins: ['x'] })
    expect(fs.writes.length).toBe(0) // 防抖期内未写盘
    await vi.advanceTimersByTimeAsync(400)
    expect(fs.writes.length).toBe(1)
    expect(fs.writes[0].path).toBe(`${dir}/settings.json.tmp`)
    expect(fs.renames).toEqual([{ from: `${dir}/settings.json.tmp`, to: `${dir}/settings.json` }])
    expect(JSON.parse(fs.writes[0].data).theme).toBe('glass')
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
    expect(store.settings).toEqual(DEFAULT_SETTINGS)
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
    expect(store.settings).toEqual(DEFAULT_SETTINGS)
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
    expect(store.settings).toEqual(DEFAULT_SETTINGS)
  })
})
