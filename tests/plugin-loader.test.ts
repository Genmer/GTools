import { describe, expect, it } from 'vitest'
import { PluginLoader } from '../src/main/plugin-loader'
import type { PluginBackend, BackendContext } from '../sdk/api'
import type { PluginManifest } from '../sdk/manifest'
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
