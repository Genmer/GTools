import { describe, expect, it } from 'vitest'
import { parseLog, pushLog } from '../../../../src/plugins/lan-file-share/logic/log'
import { CONTROL_KEY, DEFAULT_PORT, normalizePort, parseConfig, parseControl, shareUrl } from '../../../../src/plugins/lan-file-share/shared'

describe('shared 协议纯函数', () => {
  it('normalizePort 边界', () => {
    expect(normalizePort(3776)).toBe(3776)
    expect(normalizePort('8080')).toBe(8080)
    expect(normalizePort(1023)).toBeNull()
    expect(normalizePort(65536)).toBeNull()
    expect(normalizePort('abc')).toBeNull()
    expect(normalizePort(null)).toBeNull()
  })
  it('parseConfig 容错：坏值回默认', () => {
    expect(parseConfig(null)).toEqual({ dir: null, port: DEFAULT_PORT })
    expect(parseConfig({ dir: '/tmp/x', port: 9000 })).toEqual({ dir: '/tmp/x', port: 9000 })
    expect(parseConfig({ dir: '', port: 99 })).toEqual({ dir: null, port: DEFAULT_PORT })
  })
  it('parseControl 只接受合法结构', () => {
    expect(parseControl({ id: 3, op: 'start', dir: '/a', port: 8000 })).toEqual({ id: 3, op: 'start', dir: '/a', port: 8000 })
    expect(parseControl({ id: 3, op: 'stop' })).toEqual({ id: 3, op: 'stop' })
    expect(parseControl(null)).toBeNull()
    expect(parseControl({ id: 'x', op: 'stop' })).toBeNull()
    expect(parseControl({ id: 1, op: 'restart' })).toBeNull()
    expect(parseControl({ id: 1, op: 'start', dir: 42 })).toEqual({ id: 1, op: 'start' })
  })
  it('控制键常量与 URL 拼装', () => {
    expect(CONTROL_KEY).toBe('control')
    expect(shareUrl('192.168.1.5', 3776)).toBe('http://192.168.1.5:3776/')
  })
})

describe('pushLog / parseLog', () => {
  const e = (t: number, name: string): { t: number; kind: 'upload'; device: string; name: string } => ({
    t,
    kind: 'upload',
    device: 'iPhone',
    name
  })

  it('追加并封顶丢最旧', () => {
    let logs = pushLog([], e(1, 'a'), 3)
    logs = pushLog(logs, e(2, 'b'), 3)
    logs = pushLog(logs, e(3, 'c'), 3)
    logs = pushLog(logs, e(4, 'd'), 3)
    expect(logs.map((x) => x.name)).toEqual(['b', 'c', 'd'])
  })

  it('parseLog 剔除坏条目并截尾保留最新', () => {
    const raw = [
      { t: 1, kind: 'upload', device: 'iPhone', name: 'ok.txt' },
      { t: 2, kind: 'upload' }, // 缺 device
      { t: 3, kind: 'hacked', device: 'x' }, // 未知 kind
      'garbage',
      null,
      { t: 4, kind: 'download', device: 'Mac', name: 'a.png', size: 10, detail: '在线预览' },
      { t: 5, kind: 'upload', device: 'iPhone', name: 'x', size: Number.NaN }
    ]
    const out = parseLog(raw, 10)
    expect(out.map((x) => x.t)).toEqual([1, 4, 5])
    expect(out[1]).toEqual({ t: 4, kind: 'download', device: 'Mac', name: 'a.png', size: 10, detail: '在线预览' })
    expect(out[2].size).toBeUndefined()
  })

  it('非数组输入返回空', () => {
    expect(parseLog(undefined, 5)).toEqual([])
    expect(parseLog({}, 5)).toEqual([])
  })
})
