import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from '../../../../src/plugins/devtools/views/copy'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('devtools copyText（页面内 navigator.clipboard，mock 验证）', () => {
  it('空串直接失败且不触碰剪贴板', async () => {
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(copyText('')).resolves.toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('写入成功返回 true 并传原文', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(copyText('hello')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('剪贴板拒绝（无焦点/无权限）返回 false', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(copyText('hello')).resolves.toBe(false)
  })
})
