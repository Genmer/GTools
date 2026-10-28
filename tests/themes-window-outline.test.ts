// 题2 守卫（F9）：--window-outline 值域只许 rgba(0,0,0,α) 无色相（彩边红线），八块（主题×透明组合）齐备防漏档
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/renderer/src/assets/themes.css', import.meta.url)),
  'utf-8'
).replace(/\r\n/g, '\n')


describe('themes.css --window-outline（题2 黑色细线描边）', () => {
  it('黑线描边无色相守卫：--rim-black 为黑色 rgba，四站 token 齐备（--window-outline 已被轮廓环体系取代）', () => {
    const black = css.match(/--rim-black:\s*(rgba\(0, 0, 0, 0\.\d+\))\s*;/)
    expect(black).not.toBeNull()
    for (const station of ['--rim-c1', '--rim-c2', '--rim-c3', '--rim-c4']) {
      expect(css).toMatch(new RegExp(station.replace(/[-]/g, '\\-') + ':\\s*var\\(--rim-[a-z0-9]+\\)'))
    }
    // 白站同理（白线也必须无色相）
    const white = css.match(/--rim-white:\s*(rgba\(255, 255, 255, 0\.\d+\))\s*;/)
    expect(white).not.toBeNull()
  })
})
