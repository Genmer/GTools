// 复制成败文案：upload = 上传后自动复制（失败仍保留已上传事实并指引去历史重试），
// link = 纯复制；失败文案不得出现「已复制」假成功字样
export function copyFeedbackMessage(kind: 'upload' | 'link', copied: boolean, formatLabel: string): string {
  if (kind === 'upload') {
    return copied ? `已上传并复制${formatLabel}链接` : '已上传，复制链接失败，可在历史中重试'
  }
  return copied ? `已复制${formatLabel}链接` : '复制失败，剪贴板可能被占用'
}
