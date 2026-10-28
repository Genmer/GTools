import { describe, expect, it } from 'vitest'
import { ALL_WINDOWS_BROADCAST_CHANNELS, isAllWindowsBroadcast } from '../src/main/services/broadcast-channels'

describe('广播通道注册表（P0-14）', () => {
  it('注册内容恰好为 plugin-state-changed + api-services-changed 两通道（多一项少一项都红）', () => {
    expect([...ALL_WINDOWS_BROADCAST_CHANNELS].sort()).toEqual(['api-services-changed', 'plugin-state-changed'])
  })

  it('fail-closed：settings-changed/command-hotkey/clipboard-history-changed/update-download-progress/未登记通道均不进全窗投递', () => {
    for (const ch of [
      'settings-changed',
      'command-hotkey',
      'clipboard-history-changed',
      'update-download-progress',
      'detached:theme',
      'some-future-channel'
    ]) {
      expect(isAllWindowsBroadcast(ch), ch).toBe(false)
    }
  })

  it('登记通道判 true', () => {
    expect(isAllWindowsBroadcast('plugin-state-changed')).toBe(true)
    expect(isAllWindowsBroadcast('api-services-changed')).toBe(true)
  })
})
