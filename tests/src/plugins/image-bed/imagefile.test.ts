import { describe, expect, it } from 'vitest'
import {
  clipboardImageName,
  extOf,
  formatBytes,
  isImageFilename,
  mimeOf,
  nameWithoutExt,
  splitPath
} from '../../../../src/plugins/image-bed/logic/imagefile'

describe('image-bed imagefile', () => {
  it('splitPath 同时接受 mac 与 Windows 分隔符', () => {
    expect(splitPath('/Users/a/截图.png')).toEqual(['Users', 'a', '截图.png'])
    expect(splitPath('C:\\Users\\a\\pic.PNG')).toEqual(['C:', 'Users', 'a', 'pic.PNG'])
    expect(splitPath('a.png')).toEqual(['a.png'])
  })

  it('扩展名大小写归一与 MIME 映射', () => {
    expect(extOf('a.PNG')).toBe('png')
    expect(extOf('无扩展名')).toBe('')
    expect(mimeOf('a.jpg')).toBe('image/jpeg')
    expect(mimeOf('a.jpeg')).toBe('image/jpeg')
    expect(mimeOf('a.svg')).toBe('image/svg+xml')
    expect(mimeOf('a.txt')).toBe('application/octet-stream')
  })

  it('图片扩展名判定（拖入过滤依据）', () => {
    expect(isImageFilename('屏幕截图 2026-09-24.png')).toBe(true)
    expect(isImageFilename('C:\\pic\\a.webp')).toBe(true)
    expect(isImageFilename('note.md')).toBe(false)
    expect(isImageFilename('archive.tar.gif.exe')).toBe(false)
  })

  it('nameWithoutExt 与 formatBytes', () => {
    expect(nameWithoutExt('a.b.png')).toBe('a.b')
    expect(nameWithoutExt('png')).toBe('png')
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB')
    expect(formatBytes(-1)).toBe('-')
  })

  it('粘贴默认文件名（本地时区零填充）', () => {
    const name = clipboardImageName(new Date(2026, 8, 24, 9, 5, 3))
    expect(name).toBe('pasted-20260924-090503.png')
  })
})
