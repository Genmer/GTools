import { describe, expect, it } from 'vitest'
import { applyDeepLink, parseDeepLink } from '../src/renderer/src/shell/deep-link'
import { router } from '../src/renderer/src/shell/router-core'
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

describe('parseDeepLink', () => {
  it('解析 plugin/q/demo 三键', () => {
    expect(parseDeepLink('#plugin=calc&q=1%2B2&demo=1')).toEqual({
      pluginId: 'calc',
      query: '1+2',
      demo: true,
      isDetached: false
    })
  })

  it('无 # 前缀与非 plugin 开头的 hash 返回 null', () => {
    expect(parseDeepLink('plugin=calc')).toEqual({ pluginId: 'calc', query: '', demo: false, isDetached: false })
    expect(parseDeepLink('#foo=bar')).toBeNull()
    expect(parseDeepLink('#')).toBeNull()
  })

  it('q 缺省为空串，+ 不当空格（计算式里的真实加号）', () => {
    expect(parseDeepLink('#plugin=md&q=a%2Bb')).toEqual({ pluginId: 'md', query: 'a+b', demo: false, isDetached: false })
    expect(parseDeepLink('#plugin=calc&demo=true')).toEqual({ pluginId: 'calc', query: '', demo: true, isDetached: false })
  })

  it('中文与空格经 encode 后可还原', () => {
    expect(parseDeepLink('#plugin=translate&q=%E4%BD%A0%E5%A5%BD%20%E4%B8%96%E7%95%8C&demo=1')).toEqual({
      pluginId: 'translate',
      query: '你好 世界',
      demo: true,
      isDetached: false
    })
  })

  it('demo 仅 1/true 生效', () => {
    expect(parseDeepLink('#plugin=calc&demo=0')?.demo).toBe(false)
    expect(parseDeepLink('#plugin=calc&demo=TRUE')?.demo).toBe(true)
  })

  it('detached 独立窗口形态：detached/plugin/query 三键，isDetached=true', () => {
    expect(parseDeepLink('#detached=true&plugin=calc&query=1%2B1')).toEqual({
      pluginId: 'calc',
      query: '1+1',
      demo: false,
      isDetached: true
    })
    expect(parseDeepLink('detached=1&plugin=md')).toEqual({ pluginId: 'md', query: '', demo: false, isDetached: true })
  })

  it('detached=true 但缺 plugin 返回 null，detached=false 不算独立窗口', () => {
    expect(parseDeepLink('#detached=true')).toBeNull()
    expect(parseDeepLink('#detached=true&query=x')).toBeNull()
    expect(parseDeepLink('#detached=false&plugin=calc')?.isDetached).toBe(false)
  })

  it('detached 形态下缺省 query 与 q 键均可回退', () => {
    expect(parseDeepLink('#detached=true&plugin=calc&q=%E4%BD%A0%E5%A5%BD')?.query).toBe('你好')
  })
})

describe('applyDeepLink', () => {
  it('命中插件：进入 plugin 模式，query 带 keyword 前缀，demo=1 → initialCommand=demo', () => {
    resetRouter()
    const ok = applyDeepLink({ pluginId: 'calc', query: '1+2', demo: true, isDetached: false }, manifests)
    expect(ok).toBe(true)
    expect(router.mode).toBe('plugin')
    expect(router.activePluginId).toBe('calc')
    expect(router.query).toBe('calc 1+2')
    expect(router.initialCommand).toBe('demo')
  })

  it('无 q 时 query 以 keyword+空格 收尾，保持插件模式成立', () => {
    resetRouter()
    expect(applyDeepLink({ pluginId: 'markdown-notes', query: '', demo: false, isDetached: false }, manifests)).toBe(true)
    expect(router.query).toBe('md ')
    expect(router.initialCommand).toBeNull()
  })

  it('未启用/不存在的插件返回 false 且不改动路由', () => {
    resetRouter()
    expect(applyDeepLink({ pluginId: 'nope', query: 'x', demo: false, isDetached: false }, manifests)).toBe(false)
    expect(router.mode).toBe('global')
    expect(router.activePluginId).toBeNull()
  })

  it('detached 链接同样进入插件模式（独立窗口渲染层据此分流）', () => {
    resetRouter()
    expect(applyDeepLink({ pluginId: 'calc', query: '2*3', demo: false, isDetached: true }, manifests)).toBe(true)
    expect(router.mode).toBe('plugin')
    expect(router.query).toBe('calc 2*3')
  })
})
