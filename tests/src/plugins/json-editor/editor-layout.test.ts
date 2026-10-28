// CSS 布局回归在 node 纯逻辑环境唯一可测形式：直接守卫源码规则块（v0.0.29 曾删掉叠层编辑器尺寸声明致 textarea 塌陷 2 行高）
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const vueSrc = readFileSync(
  fileURLToPath(new URL('../../../../src/plugins/json-editor/index.vue', import.meta.url)),
  'utf-8'
)

describe('json-editor 叠层编辑器布局', () => {
  it('.editor-hl/.editor-input 共享规则必须声明满尺寸（缺失即 textarea 塌陷成默认 2 行高）', () => {
    const m = vueSrc.match(/\.editor-hl,\s*\.editor-input\s*\{([^}]*)\}/)
    expect(m).not.toBeNull()
    expect(m?.[1]).toMatch(/width:\s*100%/)
    expect(m?.[1]).toMatch(/height:\s*100%/)
  })
})
