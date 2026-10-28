import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText, useCopyFeedback } from '../../../../src/plugins/devtools/views/copy'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
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

describe('devtools useCopyFeedback（复制按钮反馈）', () => {
  it('成功显「已复制」、失败显「复制失败」，1.5s 后自动清空', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    const fb = useCopyFeedback()
    await fb.copy('hello')
    expect(fb.msg.value).toBe('已复制')
    vi.advanceTimersByTime(1500)
    expect(fb.msg.value).toBe('')

    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    await fb.copy('hello')
    expect(fb.msg.value).toBe('复制失败')
    vi.advanceTimersByTime(1499)
    expect(fb.msg.value).toBe('复制失败')
    vi.advanceTimersByTime(1)
    expect(fb.msg.value).toBe('')
  })

  it('反馈窗口内重入：新结果覆盖旧的，清空计时重起', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    const fb = useCopyFeedback()
    await fb.copy('a')
    vi.advanceTimersByTime(1000)
    await fb.copy('b')
    vi.advanceTimersByTime(1000)
    expect(fb.msg.value).toBe('已复制') // 第一次的计时器已被重置，尚未到 1.5s
    vi.advanceTimersByTime(500)
    expect(fb.msg.value).toBe('')
  })
})
