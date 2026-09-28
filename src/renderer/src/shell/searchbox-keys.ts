import type { Mode } from './router-core'

export type ArrowAction = { kind: 'nav'; dir: 1 | -1; axis: 'x' | 'y' } | 'cursor'

/**
 * 方向键裁决：global 态四方向键一律结果导航（含带查询词时的左右键——有意收紧光标编辑，
 * 微调交给 Home/End/Backspace 等编辑键）；settings 态维持旧行为（上下导航、左右移光标）。
 * 返回 null 表示非方向键，调用方完全不拦。抽纯函数以便 vitest node 环境单测。
 */
export function arrowAction(key: string, mode: Mode, query: string): ArrowAction | null {
  let dir: 1 | -1
  let axis: 'x' | 'y'
  if (key === 'ArrowUp') {
    dir = -1
    axis = 'y'
  } else if (key === 'ArrowDown') {
    dir = 1
    axis = 'y'
  } else if (key === 'ArrowLeft') {
    dir = -1
    axis = 'x'
  } else if (key === 'ArrowRight') {
    dir = 1
    axis = 'x'
  } else {
    return null
  }
  if (query === '' || mode === 'global') return { kind: 'nav', dir, axis }
  // plugin 态不会到达（组件提前 return），按 settings 同款收敛避免扩大行为面
  return axis === 'y' ? { kind: 'nav', dir, axis } : 'cursor'
}
