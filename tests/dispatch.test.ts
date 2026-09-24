import { describe, expect, it } from 'vitest'
import type { PluginManifest } from '@sdk/manifest'
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
  reg.register(manifest('full', ['window:float', 'dialog', 'fs', 'net', 'shell:open', 'storage', 'apis:translate']), true)
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
      readImage: async () => null,
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
    app: { platform: 'darwin', version: '0.2.0' },
    apis: {
      translate: async () => ({ resultText: '你好', providerId: 'builtin:mymemory' }),
      status: () => ({
        service: 'translate' as const,
        configured: false,
        activeProviderId: '',
        activeProviderName: 'MyMemory（默认免 Key）',
        providers: []
      })
    },
    events: { emitToRenderer: () => {} }
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
      'apis.translate.status'
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
    const ext = await dispatchApi(makeRegistry(), services, 'full', 'shell.openExternal', ['https://example.com'])
    const lan = await dispatchApi(makeRegistry(), services, 'full', 'net.lanAddresses', [])
    expect(services.calls).toEqual([
      { api: 'float.create', pluginId: 'full', args: [{ html: '<b>x</b>' }] },
      { api: 'dialog.openFile', pluginId: 'full', args: [{ directory: true }] },
      { api: 'fs.grant', pluginId: 'full', args: [['/tmp/a.txt']] },
      { api: 'fs.write', pluginId: 'full', args: ['/tmp/a.txt', 'data', { encoding: 'base64' }] }
    ])
    expect(ext).toMatchObject({ ok: true })
    expect(lan).toMatchObject({ ok: true, data: [{ name: 'en0', address: '192.168.1.5' }] })
  })

  it('禁用插件一律拒绝（含新能力）', async () => {
    const services = makeServices()
    const r = await dispatchApi(makeRegistry(), services, 'off', 'fs.read', ['/tmp/x'])
    expect(r).toMatchObject({ ok: false, error: 'PLUGIN_DISABLED' })
  })

  it('未知 api 拒绝；参数类型错误 → BAD_REQUEST 而非崩溃', async () => {
    const services = makeServices()
    expect(await dispatchApi(makeRegistry(), services, 'full', 'fs.teleport', [])).toMatchObject({ ok: false, error: 'UNKNOWN_API' })
    expect(await dispatchApi(makeRegistry(), services, 'full', 'fs.grant', ['not-array'])).toMatchObject({ ok: false, error: 'BAD_REQUEST' })
    expect(await dispatchApi(makeRegistry(), services, 'full', 'fs.read', [123])).toMatchObject({ ok: false, error: 'BAD_REQUEST' })
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
