import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enterPlugin, enterSettings, exitLevel, router } from '../src/renderer/src/shell/router'
import type { PluginManifest } from '@sdk/manifest'

const manifests: PluginManifest[] = [
  {
    id: 'calc',
    name: '计算器',
    version: '0.1.0',
    protocolVersion: 1,
    description: '',
    icon: '🧮',
    keywords: ['calc', 'jsq'],
    activation: 'trigger',
    permissions: [],
    source: 'builtin',
    entry: './index.vue'
  },
  {
    id: 'markdown-notes',
    name: '笔记',
    version: '0.1.0',
    protocolVersion: 1,
    description: '',
    icon: '📝',
    keywords: ['md', 'biji'],
    activation: 'trigger',
    permissions: [],
    source: 'builtin',
    entry: './index.vue'
  }
]

function resetRouter(): void {
  router.mode = 'global'
  router.query = ''
  router.activePluginId = null
  router.initialCommand = null
}

// exitLevel 的 global 分支经 window.gtools.host 隐藏窗口，node 测试里以 stub 替身观察
let hostMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  resetRouter()
  hostMock = vi.fn((_channel: string, _payload?: unknown) => Promise.resolve({ ok: true, data: null }))
  ;(globalThis as { window?: unknown }).window = { gtools: { host: hostMock } }
})
afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('exitLevel 显式退出（Esc / Tag 胶囊 × / 空参数框 Backspace 共用的出口）', () => {
  it('插件态退出：清插件态、保留参数 rest，不触发窗口隐藏', () => {
    enterPlugin('calc', manifests, 'demo', '1+1')
    expect(router.mode).toBe('plugin')
    exitLevel(manifests)
    expect(router.mode).toBe('global')
    expect(router.activePluginId).toBeNull()
    expect(router.initialCommand).toBeNull()
    expect(router.query).toBe('1+1')
    expect(hostMock).not.toHaveBeenCalled()
  })

  it('空参数（仅 keyword+空格）退出后 rest 为空串', () => {
    enterPlugin('markdown-notes', manifests)
    exitLevel(manifests)
    expect(router.mode).toBe('global')
    expect(router.query).toBe('')
  })

  it('settings 态退出：回 global 并清空输入，不触发窗口隐藏', () => {
    enterSettings()
    router.query = '主题'
    exitLevel(manifests)
    expect(router.mode).toBe('global')
    expect(router.query).toBe('')
    expect(hostMock).not.toHaveBeenCalled()
  })

  it('global 态退出：隐藏窗口（唯一触达 window:hide 的分支）', () => {
    router.mode = 'global'
    router.query = '任意输入'
    exitLevel(manifests)
    expect(hostMock).toHaveBeenCalledTimes(1)
    expect(hostMock).toHaveBeenCalledWith('window:hide')
    // global 态退出不动输入与插件态字段
    expect(router.mode).toBe('global')
    expect(router.query).toBe('任意输入')
  })
})
