import { describe, expect, it } from 'vitest'
import {
  computeEnvInfo,
  fallbackEnvInfo,
  platformLabel,
  sepForPlatform
} from '../../../../src/plugins/backup/logic/datadir'

describe('datadir：平台环境信息', () => {
  it('macOS 候选目录在 ~/Library/Application Support 下（打包名与开发名都给出）', () => {
    const info = computeEnvInfo('darwin', '/Users/tom', {})
    expect(info.sep).toBe('/')
    expect(info.caseInsensitive).toBe(true)
    expect(info.candidates).toEqual([
      '/Users/tom/Library/Application Support/GTools',
      '/Users/tom/Library/Application Support/gtools'
    ])
  })

  // Windows 分支按 Electron userData 约定编写，本机无法实测
  it('Windows 候选目录取 %APPDATA% 下（分隔符为反斜杠）', () => {
    const info = computeEnvInfo('win32', 'C:\\Users\\tom', { APPDATA: 'C:\\Users\\tom\\AppData\\Roaming' })
    expect(info.sep).toBe('\\')
    expect(info.candidates).toEqual(['C:\\Users\\tom\\AppData\\Roaming\\GTools', 'C:\\Users\\tom\\AppData\\Roaming\\gtools'])
  })

  it('Windows 缺 APPDATA 时无候选（不猜路径）', () => {
    expect(computeEnvInfo('win32', 'C:\\Users\\tom', {}).candidates).toEqual([])
  })

  it('linux 走 ~/.config 且大小写敏感', () => {
    const info = computeEnvInfo('linux', '/home/tom', {})
    expect(info.candidates).toEqual(['/home/tom/.config/GTools', '/home/tom/.config/gtools'])
    expect(info.caseInsensitive).toBe(false)
  })

  it('sepForPlatform / fallbackEnvInfo / platformLabel', () => {
    expect(sepForPlatform('win32')).toBe('\\')
    expect(sepForPlatform('darwin')).toBe('/')
    const fb = fallbackEnvInfo('win32')
    expect(fb.candidates).toEqual([])
    expect(fb.home).toBe('')
    expect(fb.sep).toBe('\\')
    expect(platformLabel('darwin')).toBe('macOS')
    expect(platformLabel('win32')).toBe('Windows')
    expect(platformLabel('')).toBe('未知')
  })
})
