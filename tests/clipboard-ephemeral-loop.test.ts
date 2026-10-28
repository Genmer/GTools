import { describe, expect, it, vi } from 'vitest'

// P1-9 闭环实证：electron-services 豁免表单例 → writeTextEphemeral 写入+登记 →
// 两个采集器（clipboard 插件 backend / 主进程 ClipboardHistoryService）经 isTextExempted 命中不入史。
// backend 侧走真实 createBackendContext→dispatchApi（唯一手拼面是 storage，避免 PluginStorageService 触真盘）；
// 面板侧按 src/main/index.ts 装配原样注入 services.clipboard.isTextExempted。electron 全桩化（照 electron-services-events.test.ts）。
const clipState = vi.hoisted(() => ({ text: '' }))
vi.mock('electron', () => ({
  app: { getFileIcon: vi.fn(), getVersion: vi.fn(() => '0.0.0-test') },
  clipboard: {
    readText: vi.fn(async () => clipState.text),
    writeText: vi.fn(async (t: string) => {
      clipState.text = t
    })
  },
  ClipboardItem: class {},
  desktopCapturer: { getSources: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  nativeImage: { createFromDataURL: vi.fn(), createFromBuffer: vi.fn(), createFromPath: vi.fn() },
  net: { fetch: vi.fn() },
  Notification: class {},
  screen: { getPrimaryDisplay: vi.fn(), getCursorScreenPoint: vi.fn(), getDisplayNearestPoint: vi.fn() },
  shell: {},
  BrowserWindow: class {}
}))

import type { PluginManifest } from '@sdk/manifest'
import type { BackendContext } from '@sdk/api'
import { PluginRegistry } from '../src/main/plugin-registry'
import { createElectronServices } from '../src/main/services/electron-services'
import { createBackendContext, dispatchApi } from '../src/main/services/dispatch'
import { ClipboardHistoryService } from '../src/main/services/clipboard-history'
import { ClipboardHistoryBackend } from '../src/plugins/clipboard/backend'

function manifest(id: string, permissions: PluginManifest['permissions']): PluginManifest {
  return {
    id,
    name: id,
    version: '0.1.0',
    protocolVersion: 1,
    icon: 'x',
    keywords: [id],
    activation: 'trigger',
    permissions,
    source: 'builtin',
    entry: './index.vue'
  }
}

function makeRegistry(): PluginRegistry {
  const reg = new PluginRegistry()
  reg.register(manifest('clipboard', ['clipboard:read', 'clipboard:write', 'storage']), true)
  reg.register(manifest('no-clip-perm', ['storage']), true)
  return reg
}

interface LoopHarness {
  services: ReturnType<typeof createElectronServices>
  registry: PluginRegistry
  backend: ClipboardHistoryBackend
  panel: ClipboardHistoryService
  ctx: BackendContext
}

async function makeLoop(): Promise<LoopHarness> {
  const registry = makeRegistry()
  const services = createElectronServices({
    storageRoot: '/tmp/gtools-ephemeral-loop-test',
    appVersion: '0.0.0-test',
    getWindow: () => null,
    hideWindow: () => {},
    listWindows: () => [],
    apiCenter: {} as never
  })
  const realCtx = createBackendContext(registry, services, 'clipboard')
  // storage 换内存 fake：commit→flush 不触 PluginStorageService 的真盘写（clipboard 面只测豁免闭环）
  const store = new Map<string, unknown>()
  const ctx: BackendContext = {
    ...realCtx,
    storage: {
      get: async <T>(key: string): Promise<T | null> => (store.has(key) ? (store.get(key) as T) : null),
      set: async (key: string, value: unknown): Promise<void> => {
        store.set(key, value)
      },
      remove: async (key: string): Promise<void> => {
        store.delete(key)
      },
      keys: async (): Promise<string[]> => [...store.keys()]
    }
  }
  const backend = new ClipboardHistoryBackend({ setInterval: () => 0, clearInterval: () => {} })
  await backend.init(ctx)
  const panel = new ClipboardHistoryService({
    readText: services.clipboard.readText,
    writeText: services.clipboard.writeText,
    isExempted: services.clipboard.isTextExempted
  })
  return { services, registry, backend, panel, ctx }
}

const backendTexts = (h: LoopHarness): string[] => h.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))
const panelPreviews = (h: LoopHarness): string[] => h.panel.items().map((x) => x.preview)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('writeTextEphemeral 敏感指纹豁免闭环（electron-services 豁免表单例）', () => {
  it('writeTextEphemeral 写入剪贴板并登记指纹：同表 isTextExempted 命中、其他内容不命中', async () => {
    const h = await makeLoop()
    await h.services.clipboard.writeTextEphemeral('vault-pw-987')
    expect(clipState.text).toBe('vault-pw-987') // 真走 clipboard.writeText（mock electron 落到共享变量）
    expect(await h.services.clipboard.isTextExempted('vault-pw-987')).toBe(true)
    expect(await h.services.clipboard.isTextExempted('别的文本')).toBe(false)
  })

  it('闭环：豁免内容两个采集器都跳过（backend 经真实 dispatch ctx、面板服务按 main/index.ts 装配）', async () => {
    const h = await makeLoop()
    clipState.text = 'normal-note' // 正例对照：未登记内容正常采集
    await h.backend.pollOnce()
    await h.panel.pollOnce()
    expect(backendTexts(h)).toEqual(['normal-note'])
    expect(panelPreviews(h)).toEqual(['normal-note'])

    await h.ctx.clipboard.writeTextEphemeral('vault-pw-xyz') // 走 backend ctx → dispatch → services（同一条登记路）
    expect(clipState.text).toBe('vault-pw-xyz')
    await h.backend.pollOnce()
    await h.panel.pollOnce()
    expect(backendTexts(h)).toEqual(['normal-note'])
    expect(panelPreviews(h)).toEqual(['normal-note'])
  })

  it('TTL 过期后闭环恢复采集（经内容变化重置指纹，两个采集器都记录）', async () => {
    const h = await makeLoop()
    await h.ctx.clipboard.writeTextEphemeral('pw-short', { ttlMs: 20 })
    await h.backend.pollOnce()
    await h.panel.pollOnce()
    expect(backendTexts(h)).toEqual([])
    expect(panelPreviews(h)).toEqual([])

    await sleep(60) // 越过 ttlMs（豁免失效）
    clipState.text = 'other'
    await h.backend.pollOnce()
    await h.panel.pollOnce()
    clipState.text = 'pw-short'
    await h.backend.pollOnce()
    await h.panel.pollOnce()
    expect(backendTexts(h)).toEqual(['pw-short', 'other'])
    expect(panelPreviews(h)).toEqual(['pw-short', 'other'])
  })

  it('dispatch 通道权限闸：未声明 clipboard 权限的插件拒 writeTextEphemeral/isTextExempted', async () => {
    const h = await makeLoop()
    const denied1 = await dispatchApi(h.registry, h.services, 'no-clip-perm', 'clipboard.writeTextEphemeral', ['x'])
    expect(denied1.ok).toBe(false)
    if (!denied1.ok) expect(denied1.error).toBe('PERMISSION_DENIED')
    const denied2 = await dispatchApi(h.registry, h.services, 'no-clip-perm', 'clipboard.isTextExempted', ['x'])
    expect(denied2.ok).toBe(false)
    if (!denied2.ok) expect(denied2.error).toBe('PERMISSION_DENIED')
  })
})
