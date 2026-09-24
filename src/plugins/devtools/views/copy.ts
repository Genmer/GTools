// 复制走页面内 navigator.clipboard，不经宿主 API（devtools 无剪贴板写权限）。
// 该文件会被 node 环境单测编译，类型上不能依赖 DOM lib，故用结构断言取 clipboard。
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
