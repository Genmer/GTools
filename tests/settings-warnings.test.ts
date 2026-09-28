import { describe, expect, it } from 'vitest'
import { warningsOf } from '../src/renderer/src/shell/settings-warnings'

// settings:set 消费侧契约（对照主进程 ipc.ts HostResult）：warnings 挂信封顶层，不在 data 内
describe('warningsOf：settings:set 结果信封的部分生效警告提取', () => {
  it('读信封顶层 warnings（主进程 hotkeyNotice 附带位），不读 data 内字段', () => {
    const envelope = {
      ok: true,
      data: { hotkey: { darwin: 'Alt+Space', win32: 'Ctrl+Alt+Space' } },
      warnings: ['部分指令热键未生效：Ctrl+Alt+K（b/c2）与主唤起键相同，已让位']
    }
    expect(warningsOf(envelope)).toEqual(envelope.warnings)
    // 回归锚点：AppSettings 形状的 data 无 warnings 字段，历史实现误读 data.warnings 恒空
    expect(envelope.data).not.toHaveProperty('warnings')
  })

  it('全绿路径信封无 warnings 字段 → 空数组', () => {
    expect(warningsOf({ ok: true, data: { theme: 'light' } })).toEqual([])
  })

  it('失败信封无 warnings → 空数组', () => {
    expect(warningsOf({ ok: false, error: '快捷键注册失败' })).toEqual([])
  })

  it('非字符串项过滤，空数组与非对象入参兜底', () => {
    expect(warningsOf({ warnings: ['a', 42, null, 'b'] })).toEqual(['a', 'b'])
    expect(warningsOf({ warnings: [] })).toEqual([])
    expect(warningsOf(null)).toEqual([])
    expect(warningsOf('x')).toEqual([])
  })
})
