// 富文本复制与导出文件名的纯工具（DOM/剪贴板交互留在组件里）

/** 富文本剪贴板 payload：完整 HTML 文档。meta charset 是关键——Windows 粘贴端按它解码中文 */
export function buildClipboardHtml(bodyHtml: string): string {
  return `<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"></head>\n<body>\n${bodyHtml}\n</body>\n</html>\n`
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const ILLEGAL_CHARS = /[/\\:*?"<>|\u0000-\u001f]/g

/**
 * 跨平台安全文件名：剥 Windows 非法字符与结尾点/空格，规避保留名（CON/PRN 等）。
 * Windows 真机行为未实测，按已知规则保守处理。
 */
export function sanitizeFilename(name: string, fallback = 'note'): string {
  let s = name.replace(ILLEGAL_CHARS, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').trim()
  if (s === '') s = fallback
  if (s.length > 80) s = s.slice(0, 80).trim()
  if (WINDOWS_RESERVED.test(s.replace(/\.[^.]*$/, '')) || WINDOWS_RESERVED.test(s)) {
    s = `_${s}`
  }
  return s
}

/** 确保以 .md 结尾（已有则不重复追加） */
export function withMdExtension(name: string): string {
  return /\.md$/i.test(name) ? name : `${name}.md`
}
