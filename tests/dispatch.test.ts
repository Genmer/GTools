import { describe, expect, it } from 'vitest'
import type { PluginManifest } from '@sdk/manifest'
import type { ShowMainOptions } from '@sdk/api'
import { PluginRegistry } from '../src/main/plugin-registry'
import { dispatchApi } from '../src/main/services/dispatch'
import type { ServiceBag } from '../src/main/services/dispatch'
import { ApiServiceError } from '../src/main/services/api-center'

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
  reg.register(manifest('full', ['window:float', 'window:main', 'dialog', 'fs', 'net', 'shell:open', 'storage', 'apis:translate', 'apis:ai', 'screenshot']), true)
  reg.register(manifest('bare', ['storage']), true)
  reg.register(manifest('off', ['fs', 'apis:translate']), false)
  return reg
}

function makeServices(): ServiceBag & {
  calls: Array<{ api: string; pluginId: string; args: unknown[] }>
} {
  const calls: Array<{ api: string; pluginId: string; args: unknown[] }> = []
  const rec = (api: string) => (pluginId: string, ...args: unknown[]) => {
    calls.push({ api, pluginId, args })
    return undefined as never
  }
  const services: ServiceBag = {
    clipboard: {
      readText: async () => '',
      writeText: async () => {},
      writeTextEphemeral: async () => {},
      isTextExempted: async () => false,
      readImage: async () => null,
      readImageThumb: async () => null,
      writeImage: async () => {}
    },
    storage: {
      get: async () => null,
      set: async () => {},
      remove: async () => {},
      keys: async () => [],
      dumpAll: async () => ({}),
      replaceAll: async () => {}
    },
    net: {
      fetch: async () => ({ ok: true, status: 200, body: '' }),
      fetchStream: async () => {
        throw new Error('fetchStream 主进程专用，测试不触')
      },
      lanAddresses: async () => [{ name: 'en0', address: '192.168.1.5' }]
    },
    notification: { show: async () => {} },
    shell: {
      openApp: async () => {},
      openPath: async () => {},
      openExternal: async () => {}
    },
    window: {
      hide: async () => {},
      showMain: async (opts?: ShowMainOptions) => {
        calls.push({ api: 'window.showMain', pluginId: '', args: [opts] })
      },
      float: {
        create: rec('float.create'),
        update: rec('float.update'),
        close: rec('float.close'),
        closeAllForPlugin: rec('float.closeAllForPlugin'),
        closeAll: () => {},
        closeByWebContents: () => false,
        emitFromWebContents: () => false,
        infoByWebContents: () => null
      }
    },
    screenshot: { capture: async () => ({ action: 'cancel' as const }), handleOverlayEvent: () => {}, overlayWebContentsId: () => null },
    dialog: {
      openFile: rec('dialog.openFile'),
      saveFile: rec('dialog.saveFile')
    },
    fs: {
      grant: rec('fs.grant'),
      read: rec('fs.read'),
      write: rec('fs.write'),
      rename: rec('fs.rename'),
      remove: rec('fs.remove'),
      stat: rec('fs.stat'),
      list: rec('fs.list'),
      mkdir: rec('fs.mkdir')
    },
    app: { platform: 'darwin', version: '0.2.0', arch: 'x64' },
    apis: {
      translate: async () => ({ resultText: '你好', providerId: 'builtin:mymemory' }),
      chat: async () => ({ resultText: 'hello', providerId: 'u-ai' }),
      status: () => ({
        service: 'translate' as const,
        configured: false,
        activeProviderId: '',
        activeProviderName: 'MyMemory（默认免 Key）',
        providers: []
      })
    },
    events: { emitToRenderer: () => {}, emit: () => {}, onPluginEvent: () => () => {} }
  }
  return Object.assign(services, { calls })
}

describe('dispatchApi 新增能力面的权限校验', () => {
  it('未声明权限 → PERMISSION_DENIED（浮窗/对话框/fs/openExternal/lanAddresses/apis）', async () => {
    const services = makeServices()
    for (const api of [
      'window.float.create',
      'window.float.closeAll',
      'dialog.openFile',
      'dialog.saveFile',
      'fs.grant',
      'fs.read',
      'fs.write',
      'fs.rename',
      'fs.remove',
      'fs.stat',
      'fs.list',
      'fs.mkdir',
      'shell.openExternal',
      'net.lanAddresses',
      'apis.translate',
      'apis.translate.status',
      'apis.ai',
      'apis.ai.status',
      'screenshot.capture',
      'window.showMain'
    ]) {
      const r = await dispatchApi(makeRegistry(), services, 'bare', api, [])
      expect(r, api).toMatchObject({ ok: false, error: 'PERMISSION_DENIED' })
    }
    expect(services.calls).toHaveLength(0)
  })

  it('声明权限 → 放行并携带 pluginId 与参数', async () => {
    const services = makeServices()
    await dispatchApi(makeRegistry(), services, 'full', 'window.float.create', [{ html: '<b>x</b>' }])
    await dispatchApi(makeRegistry(), services, 'full', 'dialog.openFile', [{ directory: true }])
    await dispatchApi(makeRegistry(), services, 'full', 'fs.grant', [['/tmp/a.txt']])
    await dispatchApi(makeRegistry(), services, 'full', 'fs.write', ['/tmp/a.txt', 'data', { encoding: 'base64' }])
    const shot = await dispatchApi(makeRegistry(), services, 'full', 'screenshot.capture', [])
    const ext = await dispatchApi(makeRegistry(), services, 'full', 'shell.openExternal', ['https://example.com'])
    const lan = await dispatchApi(makeRegistry(), services, 'full', 'net.lanAddresses', [])
    expect(services.calls).toEqual([
      { api: 'float.create', pluginId: 'full', args: [{ html: '<b>x</b>' }] },
      { api: 'dialog.openFile', pluginId: 'full', args: [{ directory: true }] },
      { api: 'fs.grant', pluginId: 'full', args: [['/tmp/a.txt']] },
      { api: 'fs.write', pluginId: 'full', args: ['/tmp/a.txt', 'data', { encoding: 'base64' }] }
    ])
    expect(shot).toMatchObject({ ok: true, data: { action: 'cancel' } })
    expect(ext).toMatchObject({ ok: true })
    expect(lan).toMatchObject({ ok: true, data: [{ name: 'en0', address: '192.168.1.5' }] })
  })

  it('禁用插件一律拒绝（含新能力）', async () => {
    const services = makeServices()
    const r = await dispatchApi(makeRegistry(), services, 'off', 'fs.read', ['/tmp/x'])
    expect(r).toMatchObject({ ok: false, error: 'PLUGIN_DISABLED' })
  })

  it('禁用 entry 默认调用（不传 opts）拒 PLUGIN_DISABLED（既有行为锁定）', async () => {
    const services = makeServices()
    const reg = makeRegistry()
    reg.register(manifest('off-store', ['storage']), false)
    const writes: unknown[][] = []
    services.storage.set = async (pluginId, key, value) => {
      writes.push([pluginId, key, value])
    }
    expect(await dispatchApi(reg, services, 'off-store', 'storage.set', ['k', 'v'])).toMatchObject({
      ok: false,
      error: 'PLUGIN_DISABLED'
    })
    expect(writes).toEqual([])
  })

  it('禁用 entry 传 opts.allowDisabled → storage.set 成功落 fake（backend 收尾 flush 通道）', async () => {
    const services = makeServices()
    const reg = makeRegistry()
    reg.register(manifest('off-store', ['storage']), false)
    const writes: unknown[][] = []
    services.storage.set = async (pluginId, key, value) => {
      writes.push([pluginId, key, value])
    }
    expect(await dispatchApi(reg, services, 'off-store', 'storage.set', ['k', 'v'], { allowDisabled: true })).toMatchObject({
      ok: true
    })
    expect(writes).toEqual([['off-store', 'k', 'v']])
  })

  it('未知 api 拒绝；参数类型错误 → BAD_REQUEST 而非崩溃', async () => {
    const services = makeServices()
    expect(await dispatchApi(makeRegistry(), services, 'full', 'fs.teleport', [])).toMatchObject({ ok: false, error: 'UNKNOWN_API' })
    expect(await dispatchApi(makeRegistry(), services, 'full', 'fs.grant', ['not-array'])).toMatchObject({ ok: false, error: 'BAD_REQUEST' })
    expect(await dispatchApi(makeRegistry(), services, 'full', 'fs.read', [123])).toMatchObject({ ok: false, error: 'BAD_REQUEST' })
  })

  it('window.showMain：声明权限放行且参数透传；字段非字符串 → BAD_REQUEST', async () => {
    const services = makeServices()
    const r = await dispatchApi(makeRegistry(), services, 'full', 'window.showMain', [
      { pluginId: 'timer', commandId: 'pomodoro', query: '' }
    ])
    expect(r).toEqual({ ok: true, data: undefined })
    expect(services.calls).toEqual([
      { api: 'window.showMain', pluginId: '', args: [{ pluginId: 'timer', commandId: 'pomodoro', query: '' }] }
    ])
    const bare = await dispatchApi(makeRegistry(), makeServices(), 'full', 'window.showMain', [{ pluginId: 9 }])
    expect(bare).toMatchObject({ ok: false, error: 'BAD_REQUEST' })
    const noArg = await dispatchApi(makeRegistry(), makeServices(), 'full', 'window.showMain', [])
    expect(noArg).toEqual({ ok: true, data: undefined })
  })

  it('window.showMain 字段校验补全：commandId / query 非字符串 → BAD_REQUEST 且不触达服务', async () => {
    const services = makeServices()
    expect(await dispatchApi(makeRegistry(), services, 'full', 'window.showMain', [{ pluginId: 'timer', commandId: 9 }])).toMatchObject({
      ok: false,
      error: 'BAD_REQUEST'
    })
    expect(await dispatchApi(makeRegistry(), services, 'full', 'window.showMain', [{ query: null }])).toMatchObject({
      ok: false,
      error: 'BAD_REQUEST'
    })
    expect(await dispatchApi(makeRegistry(), services, 'full', 'window.showMain', [{ query: 25 }])).toMatchObject({
      ok: false,
      error: 'BAD_REQUEST'
    })
    expect(services.calls).toHaveLength(0)

    const ok = await dispatchApi(makeRegistry(), services, 'full', 'window.showMain', [
      { pluginId: 'timer', commandId: 'countdown', query: '90s' }
    ])
    expect(ok).toEqual({ ok: true, data: undefined })
    expect(services.calls).toEqual([
      { api: 'window.showMain', pluginId: '', args: [{ pluginId: 'timer', commandId: 'countdown', query: '90s' }] }
    ])
  })
})

describe('dispatchApi apis.translate（全局 API 中心代理面）', () => {
  it('声明权限 → 放行并把 payload 透传给服务层', async () => {
    const seen: unknown[] = []
    const services = makeServices()
    services.apis.translate = async (req) => {
      seen.push(req)
      return { resultText: '你好', providerId: 'builtin:mymemory' }
    }
    const r = await dispatchApi(makeRegistry(), services, 'full', 'apis.translate', [{ text: 'hello', from: 'en', to: 'zh-CN' }])
    expect(r).toEqual({ ok: true, data: { resultText: '你好', providerId: 'builtin:mymemory' } })
    expect(seen).toEqual([{ text: 'hello', from: 'en', to: 'zh-CN' }])
  })

  it('status 面同样受 apis:translate 权限约束并返回主进程状态', async () => {
    const services = makeServices()
    const r = await dispatchApi(makeRegistry(), services, 'full', 'apis.translate.status', [])
    expect(r).toMatchObject({ ok: true, data: { service: 'translate', configured: false } })
  })

  it('SERVICE_* 错误码透传（不被通用 catch 归并成 BAD_REQUEST）', async () => {
    const services = makeServices()
    services.apis.translate = async () => {
      throw new ApiServiceError('SERVICE_UNCONFIGURED', null, '翻译服务当前不可用')
    }
    const r = await dispatchApi(makeRegistry(), services, 'full', 'apis.translate', [{ text: 'hi', from: 'en', to: 'zh-CN' }])
    expect(r).toEqual({ ok: false, error: 'SERVICE_UNCONFIGURED', message: '翻译服务当前不可用' })
  })

  it('非法 payload（缺字段/非对象）→ BAD_REQUEST', async () => {
    const services = makeServices()
    expect(await dispatchApi(makeRegistry(), services, 'full', 'apis.translate', ['plain'])).toMatchObject({ ok: false, error: 'BAD_REQUEST' })
    expect(await dispatchApi(makeRegistry(), services, 'full', 'apis.translate', [{ text: 1, from: 'en', to: 'zh-CN' }])).toMatchObject({
      ok: false,
      error: 'BAD_REQUEST'
    })
  })

  it('providerId 可选字段：字符串放行透传，非字符串 → BAD_REQUEST', async () => {
    const seen: unknown[] = []
    const services = makeServices()
    services.apis.translate = async (req) => {
      seen.push(req)
      return { resultText: '你好', providerId: 'builtin:mymemory' }
    }
    const ok = await dispatchApi(makeRegistry(), services, 'full', 'apis.translate', [
      { text: 'hello', from: 'en', to: 'zh-CN', providerId: 'u-1234' }
    ])
    expect(ok.ok).toBe(true)
    expect(seen).toEqual([{ text: 'hello', from: 'en', to: 'zh-CN', providerId: 'u-1234' }])
    expect(
      await dispatchApi(makeRegistry(), services, 'full', 'apis.translate', [{ text: 'hi', from: 'en', to: 'zh-CN', providerId: 9 }])
    ).toMatchObject({ ok: false, error: 'BAD_REQUEST' })
  })
})

describe('dispatchApi apis.ai（AI 对话品类代理面）', () => {
  it('声明 apis:ai → 放行并把 payload 规整后透传给服务层', async () => {
    const seen: unknown[] = []
    const services = makeServices()
    services.apis.chat = async (req) => {
      seen.push(req)
      return { resultText: 'Hello', providerId: 'u-ai' }
    }
    const r = await dispatchApi(makeRegistry(), services, 'full', 'apis.ai', [{ text: '你好' }])
    expect(r).toEqual({ ok: true, data: { resultText: 'Hello', providerId: 'u-ai' } })
    expect(seen).toEqual([{ text: '你好', providerId: undefined }])
  })

  it('providerId 空串归一成 undefined；字符串透传；非字符串 → BAD_REQUEST', async () => {
    const seen: unknown[] = []
    const services = makeServices()
    services.apis.chat = async (req) => {
      seen.push(req)
      return { resultText: 'x', providerId: req.providerId ?? '' }
    }
    await dispatchApi(makeRegistry(), services, 'full', 'apis.ai', [{ text: 'a', providerId: '' }])
    expect(seen[0]).toEqual({ text: 'a', providerId: undefined })
    await dispatchApi(makeRegistry(), services, 'full', 'apis.ai', [{ text: 'a', providerId: 'u-9' }])
    expect(seen[1]).toEqual({ text: 'a', providerId: 'u-9' })
    expect(
      await dispatchApi(makeRegistry(), services, 'full', 'apis.ai', [{ text: 'a', providerId: 9 }])
    ).toMatchObject({ ok: false, error: 'BAD_REQUEST' })
    expect(await dispatchApi(makeRegistry(), services, 'full', 'apis.ai', ['plain'])).toMatchObject({ ok: false, error: 'BAD_REQUEST' })
    expect(await dispatchApi(makeRegistry(), services, 'full', 'apis.ai', [{ text: 1 }])).toMatchObject({ ok: false, error: 'BAD_REQUEST' })
  })

  it('status 面受 apis:ai 权限约束并返回 service=ai 状态', async () => {
    const services = makeServices()
    services.apis.status = (service) => ({
      service,
      configured: false,
      activeProviderId: '',
      activeProviderName: '',
      providers: []
    })
    const r = await dispatchApi(makeRegistry(), services, 'full', 'apis.ai.status', [])
    expect(r).toMatchObject({ ok: true, data: { service: 'ai', configured: false } })
  })

  it('SERVICE_* 错误码透传（不被通用 catch 归并成 BAD_REQUEST）', async () => {
    const services = makeServices()
    services.apis.chat = async () => {
      throw new ApiServiceError('SERVICE_UNCONFIGURED', null, 'AI 服务当前不可用')
    }
    expect(
      await dispatchApi(makeRegistry(), services, 'full', 'apis.ai', [{ text: 'hi' }])
    ).toEqual({ ok: false, error: 'SERVICE_UNCONFIGURED', message: 'AI 服务当前不可用' })
    services.apis.chat = async () => {
      throw new ApiServiceError('SERVICE_ERROR', 'timeout', 'timeout: AI 服务请求超时')
    }
    expect(
      await dispatchApi(makeRegistry(), services, 'full', 'apis.ai', [{ text: 'hi' }])
    ).toEqual({ ok: false, error: 'SERVICE_ERROR', message: 'timeout: AI 服务请求超时' })
  })
})
