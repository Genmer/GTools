import { describe, expect, it } from 'vitest'
import {
  buildEmptyTargets,
  emptySegmentOffsets,
  type EmptyTarget,
  type EmptyTargetsInput
} from '../src/renderer/src/core/empty-targets'
import type { RecItem } from '../src/renderer/src/core/recommend'

type PluginTarget = Extract<EmptyTarget, { kind: 'plugin' }>

const rec = (pluginId: string, source: RecItem['source'], commandId?: string, payload?: string): RecItem => ({
  key: `${pluginId}:${commandId ?? '_main'}`,
  pluginId,
  commandId,
  payload,
  title: pluginId,
  subtitle: '',
  label: pluginId,
  icon: 'x',
  source
})

const dropFiles = [{ name: 'a.png', path: '/tmp/a.png', isFile: true, isDirectory: false }]

const appsModeInput: EmptyTargetsInput = {
  appsMode: true,
  clipRecs: [rec('jsoner', 'json', undefined, '{}, payload 透传'), rec('filer', 'files'), rec('pusher', 'push')],
  dropFiles,
  history: ['jsq', 'vue'],
  recentTiles: [
    { key: 'a:wx', kind: 'app', title: '微信', appId: 'wx' },
    { key: 'p:cb', kind: 'plugin', title: '剪贴板', pluginId: 'cb', commandId: 'search' }
  ],
  appIds: ['app1', 'app2', 'app3'],
  hasAppsToggle: true
}

const fallbackInput: EmptyTargetsInput = {
  appsMode: false,
  clipRecs: [rec('jsoner', 'json')],
  dropFiles,
  history: ['jsq'],
  pluginIds: ['cb', 'fy'],
  recentRows: [
    { pluginId: 'cb', commandId: 'cmd-a' },
    { pluginId: 'fy' }
  ]
}

describe('buildEmptyTargets appsMode 段序锁定（推荐→历史→最近 tiles→应用→抽屉开关）', () => {
  const targets = buildEmptyTargets(appsModeInput)

  it('五段依序展开，tiles 段 app/plugin 混排按输入序', () => {
    expect(targets.map((t) => t.kind)).toEqual([
      'plugin',
      'plugin',
      'plugin',
      'history',
      'history',
      'app',
      'plugin',
      'app',
      'app',
      'app',
      'apps-toggle'
    ])
  })

  it('tiles 段目标携带成对 id/commandId', () => {
    expect(targets[5]).toEqual({ kind: 'app', appId: 'wx' })
    expect(targets[6]).toEqual({ kind: 'plugin', pluginId: 'cb', commandId: 'search' })
  })

  it('files/img 源推荐行携带拖入集同一引用，json/push 源不带', () => {
    const pluginTargets = targets.filter((t): t is PluginTarget => t.kind === 'plugin')
    expect(pluginTargets[0]).toMatchObject({ pluginId: 'jsoner', payload: '{}, payload 透传' })
    expect(pluginTargets[0].files).toBeUndefined()
    expect(pluginTargets[1].files).toBe(dropFiles)
    expect(pluginTargets[2].files).toBeUndefined()
  })

  it('历史段目标逐词对应', () => {
    expect(targets[3]).toEqual({ kind: 'history', query: 'jsq' })
    expect(targets[4]).toEqual({ kind: 'history', query: 'vue' })
  })
})

describe('buildEmptyTargets 兜底分支段序锁定（推荐→历史→启用插件→最近行）', () => {
  const targets = buildEmptyTargets(fallbackInput)

  it('四段依序展开', () => {
    expect(targets.map((t) => t.kind)).toEqual(['plugin', 'history', 'plugin', 'plugin', 'plugin', 'plugin'])
  })

  it('插件格无 commandId，最近行带 commandId', () => {
    expect(targets[2]).toEqual({ kind: 'plugin', pluginId: 'cb' })
    expect(targets[4]).toEqual({ kind: 'plugin', pluginId: 'cb', commandId: 'cmd-a' })
    expect(targets[5]).toEqual({ kind: 'plugin', pluginId: 'fy', commandId: undefined })
  })
})

describe('emptySegmentOffsets 与 buildEmptyTargets 同输入同段长', () => {
  it('appsMode 段界与目标序列逐段对齐', () => {
    const targets = buildEmptyTargets(appsModeInput)
    const off = emptySegmentOffsets(appsModeInput)
    expect(off).toEqual({ clipEnd: 3, histEnd: 5, middleEnd: 7, appsEnd: 10, total: 11 })
    expect(targets.length).toBe(off.total)
    // 中段起点=最近 tiles 首、段4起点=应用网格首、appsEnd=开关格
    expect(targets[off.histEnd]).toEqual({ kind: 'app', appId: 'wx' })
    expect(targets[off.middleEnd]).toEqual({ kind: 'app', appId: 'app1' })
    expect(targets[off.appsEnd]).toEqual({ kind: 'apps-toggle' })
  })

  it('无抽屉开关时 total 即 appsEnd', () => {
    const off = emptySegmentOffsets({ ...appsModeInput, hasAppsToggle: false })
    expect(off.appsEnd).toBe(10)
    expect(off.total).toBe(10)
  })

  it('兜底分支无应用段，appsEnd 收敛到 middleEnd', () => {
    const off = emptySegmentOffsets(fallbackInput)
    expect(off).toEqual({ clipEnd: 1, histEnd: 2, middleEnd: 4, appsEnd: 4, total: 6 })
    expect(buildEmptyTargets(fallbackInput).length).toBe(off.total)
  })

  it('空输入全段界为 0', () => {
    const emptyApps: EmptyTargetsInput = {
      appsMode: true,
      clipRecs: [],
      dropFiles: [],
      history: [],
      recentTiles: [],
      appIds: [],
      hasAppsToggle: false
    }
    expect(emptySegmentOffsets(emptyApps)).toEqual({ clipEnd: 0, histEnd: 0, middleEnd: 0, appsEnd: 0, total: 0 })
    expect(emptySegmentOffsets({ ...fallbackInput, clipRecs: [], history: [], pluginIds: [], recentRows: [] })).toEqual({
      clipEnd: 0,
      histEnd: 0,
      middleEnd: 0,
      appsEnd: 0,
      total: 0
    })
  })
})
