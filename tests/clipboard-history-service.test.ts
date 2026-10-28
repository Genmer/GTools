import { describe, expect, it } from 'vitest'
import {
  CAP,
  IMAGE_MAX_CHARS,
  POLL_INTERVAL_MS,
  PREVIEW_CHARS,
  TEXT_MAX_CHARS,
  ClipboardHistoryService,
  formatPreview,
  type ClipboardHistoryScheduler
} from '../src/main/services/clipboard-history'

type Timer = { id: number; fn: () => void; ms: number; cleared: boolean }

class ManualScheduler implements ClipboardHistoryScheduler {
  readonly timers: Timer[] = []
  private seq = 0

  setInterval(fn: () => void, ms: number): unknown {
    const t: Timer = { id: ++this.seq, fn, ms, cleared: false }
    this.timers.push(t)
    return t
  }

  clearInterval(id: unknown): void {
    const t = this.timers.find((x) => x === id)
    if (t !== undefined) t.cleared = true
  }

  live(): Timer[] {
    return this.timers.filter((t) => !t.cleared)
  }
}

interface Harness {
  service: ClipboardHistoryService
  scheduler: ManualScheduler
  sensitiveCalls: { count: number }
  exemptCalls: { count: number }
  /** 豁免集合：加入其中的文本 pollOnce 视为宿主写入的敏感内容（清空即模拟 TTL 过期） */
  exempted: Set<string>
  clip: {
    text: string
    writes: string[]
    img: { width: number; height: number; dataUrl: string } | null
    imgWrites: string[]
  }
}

function makeHarness(
  over: {
    cap?: number
    imageCap?: number
    isSensitive?: (t: string) => boolean
    isExempted?: (t: string) => boolean | Promise<boolean>
  } = {}
): Harness {
  const scheduler = new ManualScheduler()
  const clip = {
    text: '',
    writes: [] as string[],
    img: null as { width: number; height: number; dataUrl: string } | null,
    imgWrites: [] as string[]
  }
  const sensitiveCalls = { count: 0 }
  const exemptCalls = { count: 0 }
  const exempted = new Set<string>()
  const service = new ClipboardHistoryService({
    scheduler,
    readText: async () => clip.text,
    writeText: async (t) => {
      clip.writes.push(t)
      clip.text = t
    },
    readImage: async () => clip.img,
    writeImage: async (d) => {
      clip.imgWrites.push(d)
      clip.img = { width: clip.img?.width ?? 1, height: clip.img?.height ?? 1, dataUrl: d }
    },
    // 默认计数 fake 全放行（短路专项靠它断言调用次数）；敏感命中专项自带实现
    isSensitive:
      over.isSensitive ??
      (() => {
        sensitiveCalls.count++
        return false
      }),
    // 豁免默认 fake 同款：计数 + 集合控制（专项可整体覆写）
    isExempted:
      over.isExempted ??
      ((t) => {
        exemptCalls.count++
        return exempted.has(t)
      }),
    cap: over.cap,
    imageCap: over.imageCap
  })
  return { service, scheduler, clip, sensitiveCalls, exemptCalls, exempted }
}

const img = (n: number, w = 8, h = 6): { width: number; height: number; dataUrl: string } => ({
  width: w,
  height: h,
  dataUrl: `data:image/png;base64,IMG${n}`
})

describe('clipboard-history-service 图片采集', () => {
  it('纯图片剪贴板入列为 image 条目（dataUrl+尺寸+preview 兜底文案）', async () => {
    const h = makeHarness()
    h.clip.img = img(1, 800, 600)
    await h.service.pollOnce()
    const items = h.service.items()
    expect(items).toHaveLength(1)
    const first = items[0]
    if (first?.kind !== 'image') throw new Error('应为 image 条目')
    expect(first.dataUrl).toBe('data:image/png;base64,IMG1')
    expect(first.width).toBe(800)
    expect(first.height).toBe(600)
    expect(first.preview).toBe('图片 800×600')
  })

  it('文本优先：文本与图片同存时只采文本，图片分支不触发', async () => {
    const h = makeHarness()
    h.clip.text = 'hello'
    h.clip.img = img(1)
    await h.service.pollOnce()
    const items = h.service.items()
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('text')
  })

  it('图片指纹短路：同 dataUrl 重复轮询不重复入列不重复通知', async () => {
    const h = makeHarness()
    let changes = 0
    h.service.onChanged(() => {
      changes++
    })
    h.clip.img = img(1)
    await h.service.pollOnce()
    await h.service.pollOnce()
    expect(h.service.items()).toHaveLength(1)
    expect(changes).toBe(1)
  })

  it('图片 A→B→A 再现：查重置顶复用 id', async () => {
    const h = makeHarness()
    h.clip.img = img(1)
    await h.service.pollOnce()
    const idA = h.service.items()[0]?.id
    h.clip.img = img(2)
    await h.service.pollOnce()
    h.clip.img = img(1)
    await h.service.pollOnce()
    const items = h.service.items()
    expect(items).toHaveLength(2)
    expect(items[0]?.id).toBe(idA)
    expect(items[0]?.kind).toBe('image')
  })

  it('imageCap 独立封顶：只淘汰图片条目，文本容量不受挤占', async () => {
    const h = makeHarness({ imageCap: 2 })
    h.clip.text = 't0'
    await h.service.pollOnce()
    for (const n of [1, 2, 3]) {
      h.clip.text = ''
      h.clip.img = img(n)
      await h.service.pollOnce()
    }
    const items = h.service.items()
    const images = items.filter((x) => x.kind === 'image')
    expect(images).toHaveLength(2)
    expect(images[0]?.dataUrl).toBe('data:image/png;base64,IMG3')
    expect(items.some((x) => x.kind === 'text')).toBe(true)
  })

  it('超限与显微图片整条跳过（IMAGE_MAX_CHARS / 宽高<2）', async () => {
    const h = makeHarness()
    h.clip.img = img(1, 1, 1)
    await h.service.pollOnce()
    h.clip.img = {
      width: 100,
      height: 100,
      dataUrl: 'data:image/png;base64,' + 'a'.repeat(IMAGE_MAX_CHARS + 1)
    }
    await h.service.pollOnce()
    expect(h.service.items()).toHaveLength(0)
  })

  it('copy 图片：writeImage 回写 + 置顶复用 id + 指纹防重采；未注入 writeImage 时返回 false', async () => {
    const h = makeHarness()
    h.clip.img = img(1)
    await h.service.pollOnce()
    h.clip.text = 'later'
    await h.service.pollOnce()
    const imageId = h.service.items().find((x) => x.kind === 'image')?.id
    if (imageId === undefined) throw new Error('image entry missing')
    expect(await h.service.copy(imageId)).toBe(true)
    expect(h.clip.imgWrites).toEqual(['data:image/png;base64,IMG1'])
    expect(h.service.items()[0]?.id).toBe(imageId)
    // 回写已记指纹：下一轮纯图片轮询不再重采
    h.clip.text = ''
    await h.service.pollOnce()
    expect(h.service.items().filter((x) => x.kind === 'image')).toHaveLength(1)

    const bare = new ClipboardHistoryService({
      readText: async () => '',
      writeText: async () => {}
    })
    expect(await bare.copy('any')).toBe(false)
  })
})

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('clipboard-history-service 采集与去重', () => {
  it('轮询采集非空文本；空串/纯空白跳过；items 只发 preview 不发全文', async () => {
    const h = makeHarness()
    h.clip.text = 'first line\nsecond line secret tail'
    await h.service.pollOnce()
    h.clip.text = ''
    await h.service.pollOnce()
    h.clip.text = '   \n\t  '
    await h.service.pollOnce()
    const items = h.service.items()
    expect(items).toHaveLength(1)
    expect(items[0]?.preview).toBe('first line')
    expect(JSON.stringify(items)).not.toContain('secret') // 全文只存主进程，不随 items 出门
  })

  it('同内容重复轮询指纹短路：不重复入列、不重复通知、不重跑敏感判定', async () => {
    const h = makeHarness()
    let changes = 0
    h.service.onChanged(() => {
      changes++
    })
    h.clip.text = 'a'
    await h.service.pollOnce()
    await h.service.pollOnce()
    await h.service.pollOnce()
    expect(h.service.items()).toHaveLength(1)
    expect(changes).toBe(1)
    expect(h.sensitiveCalls.count).toBe(1)
  })

  it('A→B→A 再现：全列表查重命中则移置顶+刷新 ts+复用 id（非仅队头）', async () => {
    const h = makeHarness()
    h.clip.text = 'a'
    await h.service.pollOnce()
    const idA0 = h.service.items()[0]?.id
    for (const t of ['b', 'c']) {
      h.clip.text = t
      await h.service.pollOnce()
    }
    const tsA0 = h.service.items().find((x) => x.preview === 'a')?.ts
    h.clip.text = 'a' // 已在列表尾部，应置顶复用 id
    await h.service.pollOnce()
    const items = h.service.items()
    expect(items).toHaveLength(3)
    expect(items.map((x) => x.preview)).toEqual(['a', 'c', 'b'])
    const promoted = items[0]
    expect(promoted?.id).toBe(idA0)
    expect(promoted?.ts).toBeGreaterThanOrEqual(tsA0 ?? 0)
    expect(items.filter((x) => x.preview === 'a')).toHaveLength(1)
  })

  it('cap 截断：超出容量淘汰最旧', async () => {
    const h = makeHarness({ cap: 3 })
    for (const t of ['t0', 't1', 't2', 't3', 't4']) {
      h.clip.text = t
      await h.service.pollOnce()
    }
    expect(h.service.items().map((x) => x.preview)).toEqual(['t4', 't3', 't2'])
  })
})

describe('clipboard-history-service 敏感与超长', () => {
  it('敏感命中不采集，且先记指纹：同内容只判一次（计数 fake 断言）', async () => {
    let hits = 0
    const h = makeHarness({
      isSensitive: (t) => {
        hits++
        return t.includes('password')
      }
    })
    h.clip.text = 'password: hunter2'
    await h.service.pollOnce()
    await h.service.pollOnce()
    await h.service.pollOnce()
    expect(h.service.items()).toHaveLength(0)
    expect(hits).toBe(1)

    h.clip.text = 'normal'
    await h.service.pollOnce()
    expect(h.service.items()).toHaveLength(1)
  })

  it('超长整条跳过不截断（TEXT_MAX_CHARS），后续正常文本不受影响', async () => {
    const h = makeHarness()
    h.clip.text = 'x'.repeat(TEXT_MAX_CHARS + 1)
    await h.service.pollOnce()
    await h.service.pollOnce() // 指纹短路
    expect(h.service.items()).toHaveLength(0)
    h.clip.text = 'small'
    await h.service.pollOnce()
    expect(h.service.items()).toHaveLength(1)
  })
})

describe('clipboard-history-service 敏感指纹豁免（writeTextEphemeral 闭环）', () => {
  it('豁免命中不采集，先记指纹：同内容不重复查询（任意形态密码，正则拦不住）', async () => {
    const h = makeHarness()
    h.clip.text = 'vault-pw-xyz'
    h.exempted.add('vault-pw-xyz')
    await h.service.pollOnce()
    await h.service.pollOnce() // lastSeen 指纹短路，第二轮不再查豁免
    expect(h.service.items()).toHaveLength(0)
    expect(h.exemptCalls.count).toBe(1)
    expect(h.sensitiveCalls.count).toBe(1) // 豁免检查在敏感正则之后，顺序不变
  })

  it('TTL 过期（豁免失效）后同内容重新采集（经内容变化重置指纹）', async () => {
    const h = makeHarness()
    h.clip.text = 'pw'
    h.exempted.add('pw')
    await h.service.pollOnce()
    expect(h.service.items()).toHaveLength(0)

    h.exempted.delete('pw')
    h.clip.text = 'other'
    await h.service.pollOnce()
    h.clip.text = 'pw'
    await h.service.pollOnce()
    expect(h.service.items().map((x) => x.preview)).toEqual(['pw', 'other'])
  })

  it('未注入 isExempted 时行为不变（旧 harness/未装配路径）', async () => {
    const h = makeHarness({ isExempted: undefined })
    h.clip.text = 'plain'
    await h.service.pollOnce()
    expect(h.service.items().map((x) => x.preview)).toEqual(['plain'])
  })

  it('isExempted 支持异步实现（装配传 services.clipboard.isTextExempted 的 Promise 形态）', async () => {
    const h = makeHarness({ isExempted: async (t) => t === 'async-pw' })
    h.clip.text = 'async-pw'
    await h.service.pollOnce()
    expect(h.service.items()).toHaveLength(0)
    h.clip.text = 'ok'
    await h.service.pollOnce()
    expect(h.service.items().map((x) => x.preview)).toEqual(['ok'])
  })
})

describe('clipboard-history-service copy/remove/clear', () => {
  it('copy：回写全文 + 置顶刷新 ts + 复用 id；未命中返回 false', async () => {
    const h = makeHarness()
    for (const t of ['a', 'b', 'c']) {
      h.clip.text = t
      await h.service.pollOnce()
    }
    const idA = h.service.items().find((x) => x.preview === 'a')?.id
    if (idA === undefined) throw new Error('record a missing')
    expect(await h.service.copy(idA)).toBe(true)
    expect(h.clip.writes).toEqual(['a'])
    const items = h.service.items()
    expect(items.map((x) => x.preview)).toEqual(['a', 'c', 'b'])
    expect(items[0]?.id).toBe(idA)
    expect(await h.service.copy('nope')).toBe(false)

    // 回写已记指纹：下一轮轮询不把面板回写内容再采一遍（通知不重复）
    let changes = 0
    h.service.onChanged(() => {
      changes++
    })
    await h.service.pollOnce()
    expect(changes).toBe(0)
  })

  it('remove 删单条（未命中 false）；clear 清空，空列表再清为 no-op', async () => {
    const h = makeHarness()
    for (const t of ['a', 'b']) {
      h.clip.text = t
      await h.service.pollOnce()
    }
    const idA = h.service.items().find((x) => x.preview === 'a')?.id
    if (idA === undefined) throw new Error('record a missing')
    expect(h.service.remove(idA)).toBe(true)
    expect(h.service.remove(idA)).toBe(false)
    expect(h.service.items().map((x) => x.preview)).toEqual(['b'])
    let changes = 0
    h.service.onChanged(() => {
      changes++
    })
    h.service.clear()
    expect(h.service.items()).toEqual([])
    expect(changes).toBe(1)
    h.service.clear() // 空列表清空不再通知
    expect(changes).toBe(1)
  })

  it('任一变更触发 onChanged（采集/置顶/copy/remove/clear），指纹短路轮不通知', async () => {
    const h = makeHarness()
    const events: string[] = []
    h.service.onChanged(() => events.push('x'))
    h.clip.text = 'a'
    await h.service.pollOnce() // 采集
    h.clip.text = 'a'
    await h.service.pollOnce() // 短路：不通知
    expect(events).toHaveLength(1)
    const id = h.service.items()[0]?.id
    if (id === undefined) throw new Error('record missing')
    await h.service.copy(id) // 置顶
    expect(events).toHaveLength(2)
    h.service.remove(id)
    expect(events).toHaveLength(3)
    h.clip.text = 'b'
    await h.service.pollOnce()
    h.service.clear()
    expect(events).toHaveLength(5)
  })
})

describe('clipboard-history-service 启停', () => {
  it('start 立即采集一轮并注册 1s 轮询；stop 清理；重复 start 幂等', async () => {
    const h = makeHarness()
    h.clip.text = 'boot'
    h.service.start()
    await settle()
    expect(h.service.items().map((x) => x.preview)).toEqual(['boot'])
    const live = h.scheduler.live()
    expect(live.map((t) => t.ms)).toEqual([POLL_INTERVAL_MS])
    expect(POLL_INTERVAL_MS).toBe(1000)

    h.clip.text = 'tick'
    live[0]?.fn()
    await settle()
    expect(h.service.items().map((x) => x.preview)).toEqual(['tick', 'boot'])

    h.service.start()
    expect(h.scheduler.live()).toHaveLength(1)
    h.service.stop()
    expect(h.scheduler.live()).toHaveLength(0)
  })

  it('setEnabled(false) 停轮询后 readText 零调用（position off 装配回归）', async () => {
    let reads = 0
    const scheduler = new ManualScheduler()
    const service = new ClipboardHistoryService({
      scheduler,
      readText: async () => {
        reads++
        return 'x'
      },
      writeText: async () => {}
    })
    service.setEnabled(false)
    expect(reads).toBe(0)
    service.start()
    await settle()
    expect(reads).toBe(1)
    service.setEnabled(false)
    expect(scheduler.live()).toHaveLength(0)
    expect(reads).toBe(1)
  })
})

describe('formatPreview', () => {
  it('取首行、折叠空白、截 120 字符加省略号', () => {
    expect(PREVIEW_CHARS).toBe(120)
    expect(formatPreview('first line\nsecond line')).toBe('first line')
    expect(formatPreview('  lots   of\t\tspaces  ')).toBe('lots of spaces')
    expect(formatPreview('\n\nleading blank\nrest')).toBe('leading blank')
    const exact = 'a'.repeat(120)
    expect(formatPreview(exact)).toBe(exact)
    expect(formatPreview('a'.repeat(121))).toBe(`${'a'.repeat(120)}…`)
  })

  it('CAP=50 常数契约', () => {
    expect(CAP).toBe(50)
  })
})
