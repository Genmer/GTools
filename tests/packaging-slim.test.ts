import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// asar 瘦身守门：files 排除 node_modules 后，main 产物残留裸依赖导入会启动即崩。
// 三段断言分别防：删 yml 排除行（asar 回胖）、删 vite exclude（未 build 时产物断言空转）、新依赖进 main 不 bundle。
const root = new URL('..', import.meta.url)
const yml = readFileSync(new URL('electron-builder.yml', root), 'utf-8')
const viteCfg = readFileSync(new URL('electron.vite.config.ts', root), 'utf-8')
const deps = Object.keys(
  JSON.parse(readFileSync(new URL('package.json', root), 'utf-8')).dependencies as Record<string, string>
)

describe('asar 瘦身配置', () => {
  it('electron-builder.yml files 排除 node_modules', () => {
    // 只看非注释行，防注释里出现同字样造成假绿
    const lines = yml.split(/\r?\n/).filter((l) => !l.trimStart().startsWith('#'))
    expect(lines.some((l) => l.trim() === '- "!node_modules/**"')).toBe(true)
  })

  it('electron.vite.config.ts main 段 exclude pinyin-pro', () => {
    const start = viteCfg.indexOf('main: {')
    const end = viteCfg.indexOf('preload: {')
    const mainSection = start >= 0 && end > start ? viteCfg.slice(start, end) : ''
    expect(mainSection).toContain("exclude: ['pinyin-pro']")
  })
})

const mjsUrl = new URL('out/main/index.mjs', root)
const mjsExists = existsSync(mjsUrl)

describe(
  mjsExists ? 'asar 瘦身产物' : 'asar 瘦身产物（跳过：未构建，npm run build 后本组断言才生效）',
  () => {
    ;(mjsExists ? it : it.skip)('main bundle 裸依赖导入零命中（node_modules 不进 asar）', () => {
      // backend 经动态 import 拆进 chunks，裸导入最可能落在 chunk 而非入口——index+chunks 全扫
      const files = [mjsUrl]
      const chunksUrl = new URL('out/main/chunks/', root)
      if (existsSync(chunksUrl)) {
        for (const name of readdirSync(chunksUrl)) if (name.endsWith('.mjs')) files.push(new URL(name, chunksUrl))
      }
      const patterns = [
        /from\s+(['"])([^'"]+)\1/g,
        /import\s+(['"])([^'"]+)\1/g,
        /import\(\s*(['"])([^'"]+)\1\s*\)/g,
        /require\(\s*(['"])([^'"]+)\1\s*\)/g
      ]
      const bare = new Set<string>()
      for (const file of files) {
        const code = readFileSync(file, 'utf-8')
        for (const re of patterns) {
          let m: RegExpExecArray | null
          while ((m = re.exec(code))) {
            const spec = m[2]
            if (!spec.startsWith('node:') && spec !== 'electron' && deps.includes(spec)) bare.add(`${spec} (${file.pathname.split('/').pop()})`)
          }
        }
      }
      expect([...bare]).toEqual([])
    })
  }
)
