// 复制走页面内 navigator.clipboard，不经宿主 API（devtools 无剪贴板写权限）。
// 该文件会被 node 环境单测编译，类型上不能依赖 DOM lib，故用结构断言取 clipboard。
import { ref, type Ref } from 'vue'

export async function copyText(text: string): Promise<boolean> {
  if (text === '') return false
  try {
    const clip = (navigator as unknown as { clipboard?: { writeText(t: string): Promise<void> } }).clipboard
    if (clip === undefined) return false
    await clip.writeText(text)
    return true
  } catch {
    return false
  }
}

export interface CopyFeedback {
  /** 「已复制」/「复制失败」，限时自动清空；模板直接展示 */
  msg: Ref<string>
  /** 复制并驱动 msg 反馈（对齐 calc/diff 的 1.5s 惯例），可并发重入（后到覆盖先到） */
  copy: (text: string) => Promise<void>
}

export function useCopyFeedback(ms = 1500): CopyFeedback {
  const msg = ref('')
  let timer: ReturnType<typeof setTimeout> | undefined
  async function copy(text: string): Promise<void> {
    const ok = await copyText(text)
    msg.value = ok ? '已复制' : '复制失败'
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      msg.value = ''
    }, ms)
  }
  return { msg, copy }
}
