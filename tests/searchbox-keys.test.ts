import { describe, expect, it } from 'vitest'
import { arrowAction } from '../src/renderer/src/shell/searchbox-keys'

describe('arrowAction 方向键裁决（B）', () => {
  it('global 空态：四方向键均导航（现空态行为逐位不变）', () => {
    expect(arrowAction('ArrowUp', 'global', '')).toEqual({ kind: 'nav', dir: -1, axis: 'y' })
    expect(arrowAction('ArrowDown', 'global', '')).toEqual({ kind: 'nav', dir: 1, axis: 'y' })
    expect(arrowAction('ArrowLeft', 'global', '')).toEqual({ kind: 'nav', dir: -1, axis: 'x' })
    expect(arrowAction('ArrowRight', 'global', '')).toEqual({ kind: 'nav', dir: 1, axis: 'x' })
  })

  it('global 带查询词：四方向键均导航（行为变更点：左右键从移动光标改为结果网格水平导航）', () => {
    expect(arrowAction('ArrowLeft', 'global', '翻译成英文')).toEqual({ kind: 'nav', dir: -1, axis: 'x' })
    expect(arrowAction('ArrowRight', 'global', '翻译成英文')).toEqual({ kind: 'nav', dir: 1, axis: 'x' })
    expect(arrowAction('ArrowUp', 'global', 'fy ')).toEqual({ kind: 'nav', dir: -1, axis: 'y' })
    expect(arrowAction('ArrowDown', 'global', 'fy ')).toEqual({ kind: 'nav', dir: 1, axis: 'y' })
  })

  it('settings 带查询词：上下导航、左右移光标（维持现状，设置态无结果列表）', () => {
    expect(arrowAction('ArrowUp', 'settings', '主题')).toEqual({ kind: 'nav', dir: -1, axis: 'y' })
    expect(arrowAction('ArrowDown', 'settings', '主题')).toEqual({ kind: 'nav', dir: 1, axis: 'y' })
    expect(arrowAction('ArrowLeft', 'settings', '主题')).toBe('cursor')
    expect(arrowAction('ArrowRight', 'settings', '主题')).toBe('cursor')
  })

  it('settings 空态：四方向键均导航（现行为不变）', () => {
    expect(arrowAction('ArrowLeft', 'settings', '')).toEqual({ kind: 'nav', dir: -1, axis: 'x' })
    expect(arrowAction('ArrowRight', 'settings', '')).toEqual({ kind: 'nav', dir: 1, axis: 'x' })
    expect(arrowAction('ArrowUp', 'settings', '')).toEqual({ kind: 'nav', dir: -1, axis: 'y' })
    expect(arrowAction('ArrowDown', 'settings', '')).toEqual({ kind: 'nav', dir: 1, axis: 'y' })
  })

  it('非方向键一律 null 不拦：Home/End/Backspace/Delete/全选等光标编辑能力不归零', () => {
    for (const key of ['Home', 'End', 'Backspace', 'Delete', 'a', 'A', 'Enter', 'Tab', 'Escape', ' ']) {
      expect(arrowAction(key, 'global', 'abc')).toBeNull()
      expect(arrowAction(key, 'settings', '')).toBeNull()
    }
  })
})
