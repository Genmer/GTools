import { afterEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { _guessFromUa, appInfo, fillAppInfo } from '../src/renderer/src/core/app-info'
import { createHostClient } from '../src/renderer/src/core/host-client'

// 单例模块共享文件内状态，用例按声明顺序消费/推进，不做 resetModules
describe('app-info 真值单一源', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('UA 三值映射：Windows→win32 / Mac→darwin / 其他→linux', () => {
    expect(_guessFromUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('win32')
    expect(_guessFromUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('darwin')
    expect(_guessFromUa('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux')
    // 占位口径：认不出的 UA 也给三值之一，不出现空串/unknown
    expect(_guessFromUa('Node.js/24')).toBe('linux')
  })

  it('初始占位非空（回归：插件首帧不再是空串 platform）', () => {
    expect(['win32', 'darwin', 'linux']).toContain(appInfo.platform)
  })

  it('fillAppInfo 幂等：空串/undefined 不覆盖已填真值', () => {
    fillAppInfo({ platform: 'win32' })
    expect(appInfo.platform).toBe('win32')
    fillAppInfo({ platform: '' })
    fillAppInfo({})
    fillAppInfo({ platform: undefined })
    expect(appInfo.platform).toBe('win32')
    fillAppInfo({ platform: 'win32' })
    expect(appInfo.platform).toBe('win32')
  })

  it('fillAppInfo version 同理：占位空串可被真值回填，空值不覆盖', () => {
    fillAppInfo({ version: '1.2.3' })
    expect(appInfo.version).toBe('1.2.3')
    fillAppInfo({ version: '' })
    fillAppInfo({ version: undefined })
    expect(appInfo.version).toBe('1.2.3')
  })

  it('host-client 实例共享同一 app 单例，且创建期零 IPC', () => {
    const invoke = vi.fn(async () => ({ ok: true, data: '' }))
    vi.stubGlobal('window', { gtools: { invoke } })
    const a = createHostClient('plugin-a')
    const b = createHostClient('plugin-b')
    expect(a.app).toBe(b.app)
    // 下发的是单例的 readonly 包装：跨实例同一代理（Vue 代理按目标缓存），读值与单例同步且写入被拦
    expect(a.app.platform).toBe(appInfo.platform)
    expect(() => ((a.app as { platform: string }).platform = 'x')).not.toThrow()
    expect(appInfo.platform).not.toBe('x')
    // 回归：旧实现每实例创建即发 app.platform/app.version 两个 IPC
    expect(invoke).not.toHaveBeenCalled()
  })

  it('reactive 回填：watch 在 fillAppInfo 后触发', () => {
    const seen: string[] = []
    const stop = watch(() => appInfo.platform, (v) => seen.push(v), { flush: 'sync' })
    const next = appInfo.platform === 'win32' ? 'darwin' : 'win32'
    fillAppInfo({ platform: next })
    expect(appInfo.platform).toBe(next)
    expect(seen).toEqual([next])
    stop()
  })
})
