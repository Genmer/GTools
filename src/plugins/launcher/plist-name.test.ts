// Info.plist 应用名提取单测（纯 XML 字符串解析，无 fs）。
import { describe, expect, it } from 'vitest'
import { appNameFromPlist } from './plist-name'

const plist = (entries: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries}
</dict>
</plist>`

describe('appNameFromPlist', () => {
  it('CFBundleDisplayName 优先于 CFBundleName', () => {
    const xml = plist(`
  <key>CFBundleName</key><string>InnerName</string>
  <key>CFBundleDisplayName</key><string>DisplayName</string>`)
    expect(appNameFromPlist(xml)).toBe('DisplayName')
  })

  it('只有 CFBundleName 时用之；key 与 value 允许跨行空白', () => {
    const xml = plist(`
  <key>CFBundleName</key>
    <string>
      多行
      应用名
    </string>`)
    expect(appNameFromPlist(xml)).toBe('多行\n      应用名')
  })

  it('值两端的空白被 trim，实体（命名/十进制/十六进制）被还原', () => {
    const xml = plist(`<key>CFBundleDisplayName</key><string> A&amp;B &#x4f60;&#22909; &quot;q&quot; </string>`)
    expect(appNameFromPlist(xml)).toBe('A&B 你好 "q"')
  })

  it('DisplayName 为空串时回落 CFBundleName', () => {
    const xml = plist(`
  <key>CFBundleDisplayName</key><string>   </string>
  <key>CFBundleName</key><string>Fallback</string>`)
    expect(appNameFromPlist(xml)).toBe('Fallback')
  })

  it('两个 key 都缺失 / 都为空返回 null（由调用方回退目录名）', () => {
    expect(appNameFromPlist(plist('<key>LSMinimumSystemVersion</key><string>10.0</string>'))).toBeNull()
    expect(appNameFromPlist('<plist><dict></dict></plist>')).toBeNull()
  })

  it('二进制 plist（bplist00）不解析直接返回 null', () => {
    expect(appNameFromPlist('bplist00\x00\xd1...binary...')).toBeNull()
  })

  it('未知实体原样保留', () => {
    const xml = plist('<key>CFBundleName</key><string>&nosuch;app</string>')
    expect(appNameFromPlist(xml)).toBe('&nosuch;app')
  })
})
