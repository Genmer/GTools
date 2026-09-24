import { describe, expect, it } from 'vitest'
import { CMD_KEY, takeCommand } from '../../../../src/plugins/todo-pomodoro/logic/commands'

describe('takeCommand', () => {
  it('合法 start：钳制分钟、归一 todoId/标题', () => {
    const env = takeCommand(
      {
        seq: 10,
        cmd: { type: 'start', todoId: '', todoTitle: '  写周报  ', focusMin: 0, breakMin: 999, autoStartBreak: false }
      },
      9
    )
    expect(env).toEqual({
      seq: 10,
      cmd: { type: 'start', todoId: null, todoTitle: '写周报', focusMin: 1, breakMin: 120, autoStartBreak: false }
    })
  })

  it('简单命令原样通过', () => {
    for (const type of ['pause', 'resume', 'stop', 'skip'] as const) {
      expect(takeCommand({ seq: 5, cmd: { type } }, 0)).toEqual({ seq: 5, cmd: { type } })
    }
  })

  it('note-toggle 只认 visible===true', () => {
    expect(takeCommand({ seq: 1, cmd: { type: 'note-toggle', visible: true } }, 0)!.cmd).toEqual({
      type: 'note-toggle',
      visible: true
    })
    expect(takeCommand({ seq: 1, cmd: { type: 'note-toggle', visible: 'yes' } }, 0)!.cmd).toEqual({
      type: 'note-toggle',
      visible: false
    })
  })

  it('seq 门卫：不大于 lastSeq / 非数值 / 回放一律忽略', () => {
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
    expect(CMD_KEY).toBe('timer-cmd')
  })
})
