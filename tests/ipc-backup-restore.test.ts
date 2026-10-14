import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 备份文件与导入前快照写真实临时目录（restore 链路真读真写），只 mock electron 与 window 模块
const state = vi.hoisted(() => ({
  userDataDir: '/nonexistent-gtools-ipc-restore',
  backupFile: '',
  confirmResponse: 0
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [state.backupFile] })),
    showMessageBox: vi.fn(async () => ({ response: state.confirmResponse }))
  },
  app: {
    getPath: vi.fn(() => state.userDataDir),
    isPackaged: true,
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    setLoginItemSettings: vi.fn()
  },
  globalShortcut: { register: vi.fn(() => true), unregister: vi.fn(), unregisterAll: vi.fn() },
  screen: { on: vi.fn() },
  powerMonitor: { on: vi.fn() }
}))

vi.mock('../src/main/window', () => ({
  applyHideOnBlur: vi.fn(),
  applyThemeToWindow: vi.fn(),
  getSearchWindow: vi.fn(() => null),
  hideSearchWindow: vi.fn(),
  restoreSearchWindowSize: vi.fn(),
  setSearchWindowHeight: vi.fn(),
  setSearchWindowResizable: vi.fn(),
  showSearchWindow: vi.fn(),
  suspendBlurHide: vi.fn((fn: () => unknown) => fn())
}))
vi.mock('../src/main/logo-skin', () => ({ applyAppLogoSkin: vi.fn(), logoIconPath: vi.fn(() => null) }))
vi.mock('../src/main/tray', () => ({ createTray: vi.fn(), applyTraySkin: vi.fn(), destroyTray: vi.fn() }))

import { ipcMain } from 'electron'
import { setupIpc } from '../src/main/services/ipc'
import { AppLog } from '../src/main/services/app-log'
import { applyThemeToWindow } from '../src/main/window'
import { SettingsStore, type FsLike } from '../src/main/settings-store'
import { parseBackup, serializeBackup } from '../src/main/services/backup'
import { DEFAULT_SETTINGS, OUTLINE_CUSTOM_COLOR_DEFAULT, type AppSettings } from '@sdk/settings'

type HostReply = { ok: boolean; data?: unknown; error?: string; warnings?: string[] }
type Host = (e: { sender: { id: number } }, req: { api: string; payload?: unknown }) => Promise<HostReply>

const sender = (): { sender: { id: number } } => ({ sender: { id: 1 } })

const noopFs: FsLike = {
  readFile: vi.fn(async () => {
    throw new Error('no file')
  }),
  writeFile: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {})
}

function makeLoader() {
  const entries = new Map<string, { manifest: { id: string }; enabled: boolean }>()
  return {
    entries,
    loader: {
      registry: {
        all: () => [...entries.values()],
        get: (id: string) => entries.get(id)
      },
      issues: [] as { pluginId: string; field: string; message: string }[],
      externalDetected: [] as { manifest: { id: string; name: string } }[],
      ensureBackendStarted: vi.fn(async () => undefined),
      setEnabled: vi.fn(async (id: string, enabled: boolean) => {
        const e = entries.get(id)
        if (e) e.enabled = enabled
        return { ok: true }
      })
    }
  }
}

async function boot(seed: Partial<AppSettings> = {}): Promise<{ store: SettingsStore; host: Host; detached: { applyThemeToAll: Mock } }> {
  const store = new SettingsStore(state.userDataDir, noopFs, 1)
  if (Object.keys(seed).length > 0) await store.update(seed)
  const { loader } = makeLoader()
  const detached = { applyThemeToAll: vi.fn(), closeForPlugin: vi.fn(), open: vi.fn(), closeByWebContents: vi.fn(), setAlwaysOnTopFor: vi.fn() }
  setupIpc({
    loader,
    settings: store,
    appLog: new AppLog(),
    services: {
      window: { float: { closeAllForPlugin: vi.fn() } },
      storage: { dumpAll: vi.fn(async () => ({})), replaceAll: vi.fn(async () => {}) },
      app: { version: '0.0.0' },
      clipboard: { readText: vi.fn(async () => '') },
      net: { fetch: vi.fn() }
    },
    apiCenter: { config: {}, sanitized: () => ({}), replaceAll: vi.fn(async () => {}) },
    nativeApps: {},
    detached,
    onHotkeyToggle: vi.fn()
  } as unknown as Parameters<typeof setupIpc>[0])
  const call = (ipcMain.handle as unknown as Mock).mock.calls.find(([ch]) => ch === 'gtools:host')
  if (!call) throw new Error('gtools:host 未注册')
  return { store, host: call[1] as Host, detached }
}

async function writeBackup(name: string, overrides: Record<string, unknown>): Promise<void> {
  state.backupFile = join(state.userDataDir, name)
  await writeFile(
    state.backupFile,
    JSON.stringify(
      serializeBackup({ settings: { ...DEFAULT_SETTINGS, ...overrides } as AppSettings, pluginStorage: {}, platform: 'darwin', appVersion: '0.0.0' })
    ),
    'utf-8'
  )
}

beforeAll(async () => {
  state.userDataDir = await mkdtemp(join(tmpdir(), 'gtools-ipc-restore-'))
})

afterAll(async () => {
  await rm(state.userDataDir, { recursive: true, force: true })
})

beforeEach(() => {
  vi.clearAllMocks()
  state.confirmResponse = 0
})

describe('gtools:host backup:import 轮廓环字段恢复', () => {
  it('合法备份：outline 五字段落盘恢复，detached 广播携带；launchAtLogin/clipboardSuggest 不随恢复', async () => {
    await writeBackup('ok.gtools', {
      theme: 'dark',
      transparency: { enabled: false, opacity: 30, blur: false },
      outlineEnabled: true,
      outlineWidth: 5,
      outlineColor: 'rainbow-gradient',
      outlineCustomColor: '#abcdef',
      outlineFlowSpeed: 7,
      launchAtLogin: true,
      clipboardSuggest: false
    })
    const { host, store, detached } = await boot({ outlineColor: 'custom', outlineCustomColor: '#123456', outlineWidth: 2 })
    const r = await host(sender(), { api: 'backup:import' })
    expect(r.ok).toBe(true)
    const data = r.data as { restored: boolean; warnings: string[]; safetyBackupPath: string | null }
    expect(data.restored).toBe(true)
    expect(data.warnings).toEqual([])
    expect(store.settings.outlineEnabled).toBe(true)
    expect(store.settings.outlineWidth).toBe(5)
    expect(store.settings.outlineColor).toBe('rainbow-gradient')
    expect(store.settings.outlineCustomColor).toBe('#abcdef')
    expect(store.settings.outlineFlowSpeed).toBe(7)
    // 恢复走 ipc.ts 显式字段枚举：outline 字段随备份迁移，机器/行为字段保持本机值
    expect(store.settings.launchAtLogin).toBe(false)
    expect(store.settings.clipboardSuggest).toBe(true)
    // 恢复完成即向浮窗下发洗后字段，主窗主题也同步
    expect(detached.applyThemeToAll).toHaveBeenCalledTimes(1)
    expect(detached.applyThemeToAll).toHaveBeenCalledWith('dark', { enabled: false, opacity: 30, blur: false }, {
      enabled: true,
      width: 5,
      color: 'rainbow-gradient',
      customColor: '#abcdef',
      flowSpeed: 7
    })
    expect(vi.mocked(applyThemeToWindow).mock.calls.at(-1)).toEqual(['dark', { enabled: false, opacity: 30, blur: false }])
    // 导入前快照已写盘且含导入前 outline 现值（回退依据）
    expect(data.safetyBackupPath).not.toBeNull()
    const snap = parseBackup(await readFile(data.safetyBackupPath!, 'utf-8'), { knownPluginIds: new Set<string>() })
    expect(snap.ok).toBe(true)
    if (snap.ok) {
      expect(snap.backup.settings.outlineColor).toBe('custom')
      expect(snap.backup.settings.outlineCustomColor).toBe('#123456')
      expect(snap.backup.settings.outlineWidth).toBe(2)
    }
  })

  it('备份内 outline 坏值：恢复不炸，坏值经 store 清洗回退默认 3/auto/#42a5f5/速度3', async () => {
    await writeBackup('bad.gtools', {
      outlineEnabled: 'yes',
      outlineWidth: 'fat',
      outlineColor: 'red',
      outlineCustomColor: 'nope',
      outlineFlowSpeed: 'fast'
    })
    const { host, store, detached } = await boot()
    const r = await host(sender(), { api: 'backup:import' })
    expect(r.ok).toBe(true)
    expect((r.data as { restored: boolean }).restored).toBe(true)
    expect(store.settings.outlineEnabled).toBe(true)
    expect(store.settings.outlineWidth).toBe(3)
    expect(store.settings.outlineColor).toBe('auto')
    expect(store.settings.outlineCustomColor).toBe(OUTLINE_CUSTOM_COLOR_DEFAULT)
    expect(store.settings.outlineFlowSpeed).toBe(3)
    expect(vi.mocked(detached.applyThemeToAll).mock.calls.at(-1)?.[2]).toEqual({
      enabled: true,
      width: 3,
      color: 'auto',
      customColor: OUTLINE_CUSTOM_COLOR_DEFAULT,
      flowSpeed: 3
    })
  })

  it('确认框取消：restored=false，outline 现值不动且不新增导入前快照', async () => {
    await writeBackup('cancel.gtools', { outlineColor: 'black', outlineWidth: 4 })
    const { host, store, detached } = await boot({ outlineColor: 'custom', outlineCustomColor: '#445566' })
    const preImports = async (): Promise<string[]> =>
      (await readdir(join(state.userDataDir, 'backups')).catch(() => [] as string[])).filter((n) => n.startsWith('pre-import-'))
    const before = await preImports()
    state.confirmResponse = 1
    const r = await host(sender(), { api: 'backup:import' })
    expect(r.ok).toBe(true)
    expect(r.data).toEqual({ restored: false, warnings: [], restartRecommended: false, safetyBackupPath: null })
    expect(store.settings.outlineColor).toBe('custom')
    expect(store.settings.outlineCustomColor).toBe('#445566')
    expect(detached.applyThemeToAll).not.toHaveBeenCalled()
    // 取消发生在快照之前：不新增安全快照文件
    expect(await preImports()).toEqual(before)
  })

  it('自定义环色恢复往返：备份大写 #AABBCC 归一小写落盘并随广播下发', async () => {
    await writeBackup('custom.gtools', { outlineColor: 'custom', outlineCustomColor: '#AABBCC' })
    const { host, store, detached } = await boot()
    const r = await host(sender(), { api: 'backup:import' })
    expect(r.ok).toBe(true)
    expect(store.settings.outlineColor).toBe('custom')
    expect(store.settings.outlineCustomColor).toBe('#aabbcc')
    expect(vi.mocked(detached.applyThemeToAll).mock.calls.at(-1)?.[2]).toEqual({
      enabled: true,
      width: 3,
      color: 'custom',
      customColor: '#aabbcc',
      flowSpeed: 3
    })
  })
})
