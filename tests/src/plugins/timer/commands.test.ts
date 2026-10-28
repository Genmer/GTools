import { describe, expect, it } from 'vitest'
import { CMD_KEY, takeCommand } from '../../../../src/plugins/timer/logic/commands'

describe('takeCommand', () => {
  it('合法 cd-start：时长钳制、label 截断清洗', () => {
    const env = takeCommand({ seq: 10, cmd: { type: 'cd-start', ms: 60_000, label: '  泡面  ' } }, 9)
    expect(env).toEqual({ seq: 10, cmd: { type: 'cd-start', ms: 60_000, label: '泡面' } })
    const long = takeCommand({ seq: 11, cmd: { type: 'cd-start', ms: 1, label: 'a'.repeat(200) } }, 10)
    expect((long!.cmd as { label: string }).label).toBe('a'.repeat(120))
  })

  it('cd-start 非法时长（0/负/超 7 天/非数值）整条丢弃', () => {
    for (const ms of [0, -1, 7 * 24 * 3_600_000 + 1, 'x', null]) {
      expect(takeCommand({ seq: 12, cmd: { type: 'cd-start', ms } }, 0)).toBeNull()
    }
  })

  it('合法 pm-start：分钟钳制、autoStartBreak 仅 false 关闭', () => {
    const env = takeCommand({ seq: 10, cmd: { type: 'pm-start', focusMin: 0, breakMin: 999, autoStartBreak: false } }, 9)
    expect(env).toEqual({ seq: 10, cmd: { type: 'pm-start', focusMin: 1, breakMin: 120, autoStartBreak: false } })
    expect(takeCommand({ seq: 11, cmd: { type: 'pm-start' } }, 0)!.cmd).toEqual({
      type: 'pm-start',
      focusMin: 25,
      breakMin: 5,
      autoStartBreak: true
    })
  })

  it('简单命令原样通过；ball-toggle 只认 visible===true', () => {
    for (const type of ['pause', 'resume', 'stop', 'skip'] as const) {
      expect(takeCommand({ seq: 5, cmd: { type } }, 0)).toEqual({ seq: 5, cmd: { type } })
    }
    expect(takeCommand({ seq: 1, cmd: { type: 'ball-toggle', visible: true } }, 0)!.cmd).toEqual({
      type: 'ball-toggle',
      visible: true
    })
    expect(takeCommand({ seq: 1, cmd: { type: 'ball-toggle', visible: 'yes' } }, 0)!.cmd).toEqual({
      type: 'ball-toggle',
      visible: false
    })
  })

  it('seq 门卫：不大于 lastSeq / 非数值 / 回放一律忽略（防重启重放）', () => {
    expect(takeCommand({ seq: 9, cmd: { type: 'stop' } }, 9)).toBeNull()
    expect(takeCommand({ seq: 3, cmd: { type: 'stop' } }, 9)).toBeNull()
    expect(takeCommand({ seq: NaN, cmd: { type: 'stop' } }, 0)).toBeNull()
    expect(takeCommand({ cmd: { type: 'stop' } }, 0)).toBeNull()
  })

  it('结构非法返回 null', () => {
    expect(takeCommand(null, 0)).toBeNull()
    expect(takeCommand({ seq: 2 }, 0)).toBeNull()
    expect(takeCommand({ seq: 2, cmd: { type: 'explode' } }, 0)).toBeNull()
    expect(takeCommand({ seq: 2, cmd: null }, 0)).toBeNull()
  })

  it('CMD_KEY 与渲染层写入键一致', () => {
    expect(CMD_KEY).toBe('cmd')
  })
})
