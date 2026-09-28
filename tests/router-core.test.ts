import { describe, expect, it } from 'vitest'
import { enterPlugin, enterSettings, keywordMatch, resetForShow, router, syncMode } from '../src/renderer/src/shell/router-core'
import type { MatchFile } from '../src/renderer/src/core/recommend'
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

function expectState(mode: string, query: string, pluginId: string | null, initialCommand: string | null): void {
  expect(router.mode).toBe(mode)
  expect(router.query).toBe(query)
  expect(router.activePluginId).toBe(pluginId)
  expect(router.initialCommand).toBe(initialCommand)
}

describe('keywordMatch / syncMode 状态流转', () => {
  it('keyword+空格命中插件，无空格不劫持', () => {
    expect(keywordMatch('calc ', manifests)?.id).toBe('calc')
    expect(keywordMatch('calc 1+1', manifests)?.id).toBe('calc')
    expect(keywordMatch('jsq ', manifests)?.id).toBe('calc')
    expect(keywordMatch('calc', manifests)).toBeNull()
    expect(keywordMatch('1+1', manifests)).toBeNull()
  })

  it('global 输入 keyword → plugin；清空回 global', () => {
    router.mode = 'global'
    router.query = 'calc '
    syncMode(manifests)
    expectState('plugin', 'calc ', 'calc', null)
    router.query = ''
    syncMode(manifests)
    expectState('global', '', null, null)
  })

  it('enterPlugin 设置 initialCommand 与 rest；settings 只由 Esc 退出不被 syncMode 打断', () => {
    resetForShow(true)
    enterPlugin('markdown-notes', manifests, 'demo', 'todo')
    expectState('plugin', 'md todo', 'markdown-notes', 'demo')
    enterSettings()
    expectState('settings', 'md todo', null, null)
    router.query = '随便输入'
    syncMode(manifests)
    expectState('settings', '随便输入', null, null)
    resetForShow(true)
    expectState('global', '', null, null)
  })
})

describe('resetForShow 现场保留', () => {
  it('global 态默认重置：清空输入回 global', () => {
    resetForShow(true)
    router.query = 'ca'
    resetForShow()
    expectState('global', '', null, null)
  })

  it('插件态默认不重置，保留全部现场', () => {
    resetForShow(true)
    enterPlugin('calc', manifests, undefined, '1+1')
    resetForShow()
    expectState('plugin', 'calc 1+1', 'calc', null)
  })

  it('插件态带 initialCommand 的现场同样保留', () => {
    resetForShow(true)
    enterPlugin('markdown-notes', manifests, 'demo', '')
    resetForShow()
    expectState('plugin', 'md ', 'markdown-notes', 'demo')
  })

  it('settings 态默认不重置', () => {
    resetForShow(true)
    enterSettings()
    router.query = 'settings'
    resetForShow()
    expectState('settings', 'settings', null, null)
  })

  it('force=true 强制重置插件态与设置态', () => {
    resetForShow(true)
    enterPlugin('calc', manifests, 'demo', 'x')
    resetForShow(true)
    expectState('global', '', null, null)
    enterSettings()
    resetForShow(true)
    expectState('global', '', null, null)
  })
})

describe('initialPayload 生命周期（拖拽携参通道）', () => {
  const files: MatchFile[] = [{ name: 'a.pdf', path: 'C:/tmp/a.pdf', isFile: true, isDirectory: false }]

  it('enterPlugin 携参写入；不带参时无条件覆盖为 null（覆盖 exitLevel 直改字段留下的残留）', () => {
    resetForShow(true)
    enterPlugin('calc', manifests, undefined, '1+1', files)
    // router 为 reactive，读出的是数组的响应式代理，比对内容而非引用
    expect(router.initialPayload).toEqual(files)
    // 不带 payload 的进入（deep-link 4 参调用同型）清掉残留
    enterPlugin('markdown-notes', manifests)
    expect(router.initialPayload).toBeNull()
  })

  it('syncMode 退插件（plugin→global）清 initialPayload', () => {
    resetForShow(true)
    enterPlugin('calc', manifests, undefined, '1+1', files)
    router.query = ''
    syncMode(manifests)
    expect(router.mode).toBe('global')
    expect(router.initialPayload).toBeNull()
  })

  it('resetForShow 清 initialPayload', () => {
    resetForShow(true)
    enterPlugin('calc', manifests, undefined, 'x', files)
    resetForShow(true)
    expect(router.initialPayload).toBeNull()
    // global 态手动残留同样被清
    router.initialPayload = files
    resetForShow()
    expect(router.initialPayload).toBeNull()
  })

  it('syncMode 命中分支：手输关键字进入（global→plugin）清残留', () => {
    resetForShow(true)
    router.initialPayload = files
    router.mode = 'global'
    router.query = 'calc 1'
    syncMode(manifests)
    expect(router.mode).toBe('plugin')
    expect(router.initialPayload).toBeNull()
  })

  it('syncMode 命中分支：enterPlugin 携参后 query watcher 再跑不清（mode 已是 plugin）', () => {
    resetForShow(true)
    enterPlugin('calc', manifests, undefined, '1', files)
    expect(router.initialPayload).toEqual(files)
    // enterPlugin 已置 mode='plugin'，query 变化触发的 syncMode 命中且不满足清理条件
    syncMode(manifests)
    expect(router.mode).toBe('plugin')
    expect(router.initialPayload).toEqual(files)
  })
})
