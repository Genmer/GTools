import { describe, expect, it } from 'vitest'
import { PluginLoader } from '../src/main/plugin-loader'
import type { PluginBackend, BackendContext } from '../sdk/api'
import type { PluginManifest } from '../sdk/manifest'
import { createBackendContext, type ServiceBag } from '../src/main/services/dispatch'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const manifest = (over: Partial<PluginManifest> = {}): PluginManifest => ({
  id: 'demo',
  name: '演示',
  version: '0.1.0',
  protocolVersion: 1,
  icon: '🔧',
  keywords: ['demo'],
  activation: 'trigger',
  permissions: [],
  source: 'builtin',
  entry: './index.vue',
  ...over
})

function fakeBackend(log: string[]): PluginBackend & { __started(): boolean } {
  const state = { started: false }
  return {
    async init() {
      log.push('init')
    },
    async start() {
      state.started = true
      log.push('start')
    },
    async stop() {
      state.started = false
      log.push('stop')
    },
    __started: () => state.started
  }
}

const ctxFactory = (): BackendContext =>
  ({
    apiVersion: 1,
    clipboard: {} as never,
    storage: {} as never,
    net: {} as never,
    notification: {} as never,
    shell: {} as never,
    window: {} as never,
    screenshot: { capture: async () => ({ action: 'cancel' as const }), handleOverlayEvent: () => {}, overlayWebContentsId: () => null },
    dialog: {} as never,
    fs: {} as never,
    app: { platform: 'test', version: '0' },
    apis: {} as never,
    events: { on: () => () => {} },
    emit: () => {}
  }) as BackendContext

function makeLoader(opts: {
  manifests: PluginManifest[]
  backends?: Record<string, PluginBackend>
  externalDir?: string | null
}): PluginLoader {
  return new PluginLoader({
    builtinManifests: opts.manifests,
    loadBackend: async (id) => opts.backends?.[id] ?? null,
    externalDir: opts.externalDir ?? null,
    createBackendContext: ctxFactory
  })
}

describe('plugin-loader 装配', () => {
  it('合法插件全部注册，词条可查询', async () => {
    const loader = makeLoader({ manifests: [manifest(), manifest({ id: 'other', keywords: ['other'] })] })
    await loader.load([])
    expect(loader.getEnabledManifests().map((m) => m.id).sort()).toEqual(['demo', 'other'])
    expect(loader.issues).toEqual([])
  })

  it('协议版本不符的插件被跳过且错误可读，不影响其他插件', async () => {
    const loader = makeLoader({
      manifests: [manifest({ protocolVersion: 2, id: 'bad' }), manifest({ id: 'good' })]
    })
    await loader.load([])
    expect(loader.getEnabledManifests().map((m) => m.id)).toEqual(['good'])
    expect(loader.issues.some((i) => i.pluginId === 'bad' && i.message.includes('协议版本'))).toBe(true)
  })

  it('id 冲突：后到者被拒绝', async () => {
    const loader = makeLoader({ manifests: [manifest(), manifest()] })
    await loader.load([])
    expect(loader.getEnabledManifests()).toHaveLength(1)
    expect(loader.issues.some((i) => i.message.includes('冲突'))).toBe(true)
  })

  it('keyword 冲突：后到者被拒绝（启用中的 keyword）', async () => {
    const loader = makeLoader({ manifests: [manifest(), manifest({ id: 'b', keywords: ['demo'] })] })
    await loader.load([])
    expect(loader.getEnabledManifests().map((m) => m.id)).toEqual(['demo'])
  })

  it('运行期启用复检 keyword：与已启用插件撞词则拒绝且状态不变', async () => {
    const loader = makeLoader({ manifests: [manifest(), manifest({ id: 'b', keywords: ['demo'] })] })
    await loader.load(['demo']) // demo 装载即禁用 → b 占用 demo 通过校验启用
    expect(loader.getEnabledManifests().map((m) => m.id)).toEqual(['b'])

    const r = await loader.setEnabled('demo', true) // 此刻 demo 与已启用的 b 撞 keyword
    expect(r.ok).toBe(false)
    expect(r.error).toContain('demo')
    expect(loader.registry.get('demo')?.enabled).toBe(false) // 启用被拒，状态未变

    await loader.setEnabled('b', false) // 腾出 keyword 后可启用
    const r2 = await loader.setEnabled('demo', true)
    expect(r2.ok).toBe(true)
    expect(loader.registry.get('demo')?.enabled).toBe(true)
  })

  it('disabledPlugins 中的插件注册但禁用，keyword 不占位', async () => {
    const loader = makeLoader({ manifests: [manifest(), manifest({ id: 'b', keywords: ['demo2'] })] })
    await loader.load(['demo'])
    expect(loader.getEnabledManifests().map((m) => m.id)).toEqual(['b'])
    // 被禁用者的 keyword 空出后，同 keyword 的新插件也不应在本批被拒（校验按启用集）
    const loader2 = makeLoader({ manifests: [manifest(), manifest({ id: 'b', keywords: ['demo'] })] })
    await loader2.load(['demo'])
    expect(loader2.getEnabledManifests().map((m) => m.id)).toEqual(['b'])
  })
})

describe('plugin-loader backend 生命周期', () => {
  it('resident 插件 load 时即 init + start', async () => {
    const log: string[] = []
    const be = fakeBackend(log)
    const loader = makeLoader({
      manifests: [manifest({ id: 'res', activation: 'resident', backend: './backend/index.ts', keywords: ['res'] })],
      backends: { res: be }
    })
    await loader.load([])
    expect(log).toEqual(['init', 'start'])
  })

  it('load 传 startResidentBackends:false 只装配不起 backend，startResidentBackends 再起', async () => {
    const log: string[] = []
    const be = fakeBackend(log)
    const loader = makeLoader({
      manifests: [manifest({ id: 'res4', activation: 'resident', backend: './backend/index.ts', keywords: ['res4'] })],
      backends: { res4: be }
    })
    await loader.load([], { startResidentBackends: false })
    expect(log).toEqual([])
    await loader.startResidentBackends()
    expect(log).toEqual(['init', 'start'])
  })

  it('并发 ensureBackendStarted 共享同一次启动（load+init+start 各一次，防双 interval）', async () => {
    const calls: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const be: PluginBackend = {
      async init() {
        calls.push('init')
      },
      async start() {
        calls.push('start')
        await gate
      },
      async stop() {}
    }
    const loader = makeLoader({
      manifests: [manifest({ id: 'trig2', backend: './backend/index.ts', keywords: ['trig2'] })],
      backends: { trig2: be }
    })
    await loader.load([])
    const all = Promise.all([loader.ensureBackendStarted('trig2'), loader.ensureBackendStarted('trig2'), loader.ensureBackendStarted('trig2')])
    release()
    await all
    expect(calls).toEqual(['init', 'start'])
  })

  it('startResidentBackends 单插件 init 失败不阻断其余（错误进 issues）', async () => {
    const log: string[] = []
    const bad: PluginBackend = {
      async init() {
        throw new Error('boom')
      },
      async start() {},
      async stop() {}
    }
    const loader = makeLoader({
      manifests: [
        manifest({ id: 'bad-res', activation: 'resident', backend: './b', keywords: ['badres'] }),
        manifest({ id: 'good-res', activation: 'resident', backend: './b', keywords: ['goodres'] })
      ],
      backends: { 'bad-res': bad, 'good-res': fakeBackend(log) }
    })
    await loader.load([], { startResidentBackends: false })
    await expect(loader.startResidentBackends()).resolves.toBeUndefined()
    expect(log).toEqual(['init', 'start'])
    expect(loader.issues.some((i) => i.pluginId === 'bad-res' && i.message.includes('boom'))).toBe(true)
  })

  it('禁用 resident 插件立即 stop，重新启用恢复 start（B3）', async () => {
    const log: string[] = []
    const be = fakeBackend(log)
    const loader = makeLoader({
      manifests: [manifest({ id: 'res', activation: 'resident', backend: './backend/index.ts', keywords: ['res'] })],
      backends: { res: be }
    })
    await loader.load([])
    log.length = 0
    await loader.setEnabled('res', false)
    expect(log).toEqual(['stop'])
    log.length = 0
    await loader.setEnabled('res', true)
    expect(log).toEqual(['start'])
  })

  it('trigger 插件的 backend 在首次进入时才 start（app-launcher 模式）', async () => {
    const log: string[] = []
    const be = fakeBackend(log)
    const loader = makeLoader({
      manifests: [manifest({ id: 'trig', backend: './backend/index.ts', keywords: ['trig'] })],
      backends: { trig: be }
    })
    await loader.load([])
    expect(log).toEqual([]) // 装配阶段不加载
    await loader.ensureBackendStarted('trig')
    expect(log).toEqual(['init', 'start'])
    await loader.ensureBackendStarted('trig')
    expect(log).toEqual(['init', 'start']) // 幂等
  })

  it('backend 抛错不崩宿主，错误进 issues', async () => {
    const bad: PluginBackend = {
      async init() {
        throw new Error('boom')
      },
      async start() {},
      async stop() {}
    }
    const loader = makeLoader({
      manifests: [manifest({ id: 'res2', activation: 'resident', backend: './b', keywords: ['r2'] })],
      backends: { res2: bad }
    })
    await loader.load([])
    expect(loader.issues.some((i) => i.message.includes('boom'))).toBe(true)
  })

  it('disposeAll 对已启动 backend 调 stop/dispose', async () => {
    const calls: string[] = []
    const be: PluginBackend = {
      init: async () => {},
      start: async () => {
        calls.push('start')
      },
      stop: async () => {
        calls.push('stop')
      },
      dispose: async () => {
        calls.push('dispose')
      }
    }
    const loader = makeLoader({
      manifests: [manifest({ id: 'res3', activation: 'resident', backend: './b', keywords: ['r3'] })],
      backends: { res3: be }
    })
    await loader.load([])
    await loader.disposeAll()
    expect(calls).toEqual(['start', 'stop', 'dispose'])
  })

  // 禁用链先 registry.setEnabled(false) 再 backend.stop()：本用真 createBackendContext + 记录型 storage 搭全链，验证收尾 flush 不被 PLUGIN_DISABLED 拒
  it('禁用/退出收尾：stop() 与 dispose() 内的落盘 flush 全链不丢', async () => {
    const writes: Array<{ pluginId: string; key: string; value: unknown }> = []
    // 未触能力面按本文件 ctxFactory 惯例置 {} as never
    const services: ServiceBag = {
      clipboard: {} as never,
      storage: {
        get: async () => null,
        set: async (pluginId: string, key: string, value: unknown) => {
          writes.push({ pluginId, key, value })
        },
        remove: async () => {},
        keys: async () => [],
        dumpAll: async () => ({}),
        replaceAll: async () => {}
      },
      net: {} as never,
      notification: {} as never,
      shell: {} as never,
      window: {} as never,
      screenshot: {} as never,
      dialog: {} as never,
      fs: {} as never,
      app: { platform: 'test', version: '0', arch: 'x64' },
      apis: {} as never,
      events: { emitToRenderer: () => {}, emit: () => {}, onPluginEvent: () => () => {} }
    }
    let ctx!: BackendContext
    const be: PluginBackend = {
      init: async (c) => {
        ctx = c
      },
      start: async () => {},
      stop: async () => {
        await ctx.storage.set('stopFlush', 'last-batch')
      },
      dispose: async () => {
        await ctx.storage.set('disposeFlush', 'final')
      }
    }
    const loader: PluginLoader = new PluginLoader({
      builtinManifests: [manifest({ id: 'flushy', activation: 'resident', backend: './b', keywords: ['flushy'], permissions: ['storage'] })],
      loadBackend: async () => be,
      externalDir: null,
      createBackendContext: (pid) => createBackendContext(loader.registry, services, pid)
    })
    await loader.load([])
    const r = await loader.setEnabled('flushy', false)
    expect(r.ok).toBe(true)
    expect(writes).toContainEqual({ pluginId: 'flushy', key: 'stopFlush', value: 'last-batch' })
    await loader.disposeAll()
    expect(writes).toContainEqual({ pluginId: 'flushy', key: 'disposeFlush', value: 'final' })
  })
})

describe('plugin-loader 外部插件（协议预留：仅解析校验，不实例化）', () => {
  it('合法外部清单记入 externalDetected，不进注册表', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gtools-ext-'))
    await mkdir(join(dir, 'ext-demo'), { recursive: true })
    await writeFile(
      join(dir, 'ext-demo', 'manifest.json'),
      JSON.stringify({
        id: 'ext-demo',
        name: '外部插件',
        version: '1.0.0',
        protocolVersion: 1,
        icon: '📦',
        keywords: ['ext'],
        activation: 'trigger',
        permissions: [],
        entry: './index.html'
      }),
      'utf-8'
    )
    const loader = makeLoader({ manifests: [manifest()], externalDir: dir })
    await loader.load([])
    expect(loader.externalDetected.map((d) => d.manifest.id)).toEqual(['ext-demo'])
    expect(loader.registry.has('ext-demo')).toBe(false) // 本期不实例化
    await rm(dir, { recursive: true, force: true })
  })

  it('非法 JSON / 协议版本不符的外部清单进入 issues 而非崩溃', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gtools-ext-'))
    await mkdir(join(dir, 'bad-json'), { recursive: true })
    await writeFile(join(dir, 'bad-json', 'manifest.json'), '{oops', 'utf-8')
    await mkdir(join(dir, 'bad-ver'), { recursive: true })
    await writeFile(
      join(dir, 'bad-ver', 'manifest.json'),
      JSON.stringify({ id: 'bad-ver', protocolVersion: 9, keywords: ['x'], activation: 'trigger' }),
      'utf-8'
    )
    const loader = makeLoader({ manifests: [], externalDir: dir })
    await loader.load([])
    expect(loader.issues.some((i) => i.message.includes('JSON'))).toBe(true)
    expect(loader.issues.some((i) => i.message.includes('协议版本'))).toBe(true)
    await rm(dir, { recursive: true, force: true })
  })
})

describe('backend 生命周期超时兜底', () => {
  const hangBackend = (): PluginBackend => ({
    async init() {
      await new Promise(() => {}) // 永不 resolve
    },
    async start() {
      await new Promise(() => {})
    },
    async stop() {
      await new Promise(() => {})
    }
  })

  function makeTimedLoader(backends: Record<string, PluginBackend>): PluginLoader {
    return new PluginLoader(
      {
        builtinManifests: [
          manifest({ id: 'hang', activation: 'resident', backend: './backend/index.ts', keywords: ['hang'] })
        ],
        loadBackend: async (id) => backends[id] ?? null,
        externalDir: null,
        createBackendContext: ctxFactory
      },
      { startMs: 20, stopMs: 20 }
    )
  }

  it('init 挂起：ensureBackendStarted 按超时返回，标记已启动防重复 start，issues 留痕', async () => {
    const loader = makeTimedLoader({ hang: hangBackend() })
    await loader.load([], { startResidentBackends: false })
    const t0 = Date.now()
    await loader.ensureBackendStarted('hang')
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(loader.registry.get('hang')?.backendStarted).toBe(true)
    expect(loader.issues.some((i) => i.pluginId === 'hang' && i.message.includes('超时'))).toBe(true)
  })

  it('stop 挂起：setEnabled(false) 按超时返回不再永久阻塞', async () => {
    const backend = hangBackend()
    const loader = makeTimedLoader({ hang: backend })
    await loader.load([], { startResidentBackends: false })
    const entry = loader.registry.get('hang')
    if (entry) {
      // 直接置位避开 start 挂起，聚焦 stop 路径（backend 需就位，否则跳过 stop 分支）
      entry.backend = backend
      entry.backendStarted = true
    }
    const t0 = Date.now()
    const r = await loader.setEnabled('hang', false)
    expect(r.ok).toBe(true)
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(loader.registry.get('hang')?.backendStarted).toBe(false)
  })

  it('disposeAll 遇挂起的 stop/dispose 也能有界返回', async () => {
    const backend = { ...hangBackend(), dispose: async () => new Promise<void>(() => {}) }
    const loader = makeTimedLoader({ hang: backend })
    await loader.load([], { startResidentBackends: false })
    const entry = loader.registry.get('hang')
    if (entry) {
      entry.backend = backend
      entry.backendStarted = true
    }
    const t0 = Date.now()
    await loader.disposeAll()
    expect(Date.now() - t0).toBeLessThan(3000)
  })

  it('超时等待期间并发调用共享同一次等待（init 一次、issue 一条）；超时后再调用立即返回不再重试', async () => {
    let initCalls = 0
    const backend: PluginBackend = {
      init: async () => {
        initCalls++
        await new Promise(() => {}) // 挂起
      },
      start: async () => {},
      stop: async () => {}
    }
    // startMs 放大到 200 以便区分「立即返回」与「再等一个超时」
    const loader = new PluginLoader(
      {
        builtinManifests: [
          manifest({ id: 'hang', activation: 'resident', backend: './backend/index.ts', keywords: ['hang'] })
        ],
        loadBackend: async () => backend,
        externalDir: null,
        createBackendContext: ctxFactory
      },
      { startMs: 200 }
    )
    await loader.load([], { startResidentBackends: false })
    await Promise.all([loader.ensureBackendStarted('hang'), loader.ensureBackendStarted('hang')])
    expect(initCalls).toBe(1)
    expect(loader.issues.filter((i) => i.pluginId === 'hang' && i.message.includes('超时'))).toHaveLength(1)
    const t0 = Date.now()
    await loader.ensureBackendStarted('hang')
    expect(Date.now() - t0).toBeLessThan(100)
    expect(initCalls).toBe(1) // 已标记启动，不对挂死 backend 重复 start
  })

  it('init 抛错（非挂起）不受超时兜底影响：立即完成、记抛错 issue、可重试', async () => {
    let initCalls = 0
    const backend: PluginBackend = {
      init: async () => {
        initCalls++
        throw new Error('boom')
      },
      start: async () => {},
      stop: async () => {}
    }
    const loader = makeTimedLoader({ hang: backend })
    await loader.load([], { startResidentBackends: false })
    await loader.ensureBackendStarted('hang')
    expect(loader.issues.some((i) => i.message.includes('boom'))).toBe(true)
    expect(loader.issues.some((i) => i.message.includes('超时'))).toBe(false)
    expect(loader.registry.get('hang')?.backendStarted).toBe(false)
    await loader.ensureBackendStarted('hang') // 未标记已启动：下次进入可重试
    expect(initCalls).toBe(2)
  })
})
