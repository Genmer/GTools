import { describe, expect, it } from 'vitest'
import { copyFeedbackMessage } from '../../../../src/plugins/image-bed/logic/copy-feedback'

describe('image-bed copy-feedback', () => {
  it('上传后复制成功：含格式标签与「已上传并复制」', () => {
    const msg = copyFeedbackMessage('upload', true, 'Markdown')
    expect(msg).toContain('已上传并复制')
    expect(msg).toContain('Markdown')
  })

  it('上传后复制失败：保留「已上传」事实与「历史」重试指引，无「已复制」假成功', () => {
    const msg = copyFeedbackMessage('upload', false, 'Markdown')
    expect(msg).toContain('已上传')
    expect(msg).toContain('历史')
    expect(msg).not.toContain('已复制')
  })

  it('纯复制成功：含格式标签与「已复制」', () => {
    const msg = copyFeedbackMessage('link', true, 'Markdown')
    expect(msg).toContain('已复制')
    expect(msg).toContain('Markdown')
  })

  it('纯复制失败：含「复制失败」与剪贴板占用提示，无「已复制」假成功', () => {
    const msg = copyFeedbackMessage('link', false, 'Markdown')
    expect(msg).toContain('复制失败')
    expect(msg).toContain('剪贴板')
    expect(msg).not.toContain('已复制')
  })
})
