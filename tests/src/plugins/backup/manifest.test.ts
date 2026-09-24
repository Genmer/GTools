import { describe, expect, it } from 'vitest'
import { validateManifest } from '../../../../sdk/manifest'
import backupManifest from '../../../../src/plugins/backup/manifest'
import clipboardManifest from '../../../../src/plugins/clipboard/manifest'
import devtoolsManifest from '../../../../src/plugins/devtools/manifest'
import helloManifest from '../../../../src/plugins/hello/manifest'
import launcherManifest from '../../../../src/plugins/launcher/manifest'
import translateManifest from '../../../../src/plugins/translate/manifest'
import { createBackupBackend } from '../../../../src/plugins/backup/backend/index'
import { ENV_STORAGE_KEY } from '../../../../src/plugins/backup/logic/datadir'
import type { BackendContext } from '@sdk/api'

describe('backup manifest', () => {
  it('通过协议校验（含 commands）', () => {
    expect(
      validateManifest(backupManifest, { existingIds: new Set(['clipboard', 'devtools', 'hello', 'launcher', 'translate']), activeKeywords: new Map() })
    ).toEqual([])
  })

  it('主关键词与全部现有内置插件不冲突', () => {
    const others = [clipboardManifest, devtoolsManifest, helloManifest, launcherManifest, translateManifest]
    for (const m of others) {
      for (const k of m.keywords) {
        expect(backupManifest.keywords).not.toContain(k)
      }
    }
  })

  it('commands 关键词不与现有词条池（插件主词 + 其他 commands 词 + 宿主词条）撞车', () => {
    // 宿主词条词（settings/shezhi/sz）+ 其他插件全部词条词
    const pool = new Set(['settings', 'shezhi', 'sz'])
    for (const m of [clipboardManifest, devtoolsManifest, helloManifest, launcherManifest, translateManifest]) {
      for (const k of m.keywords) pool.add(k)
      for (const c of m.commands ?? []) for (const k of c.keywords ?? []) pool.add(k)
    }
    const mine = [...backupManifest.keywords, ...(backupManifest.commands ?? []).flatMap((c) => c.keywords ?? [])]
    for (const k of mine) expect(pool.has(k)).toBe(false)
    // 自身内部也不重复
    expect(new Set(mine).size).toBe(mine.length)
  })
})

describe('backup backend', () => {
  it('init 把平台环境信息写入自身 storage（渲染层同 key 直读）', async () => {
    const store = new Map<string, unknown>()
    // BackendContext 即 HostApi 本身（storage/app 在顶层），fake 只补本测试用到的面
    const ctx = {
      app: { platform: 'darwin', version: '0.1.0' },
      storage: {
        get: async <T>(key: string) => store.get(key) as T | null,
        set: async (key: string, v: unknown) => void store.set(key, v),
        remove: async (key: string) => void store.delete(key),
        keys: async () => [...store.keys()]
      }
    } as unknown as BackendContext

    const backend = createBackupBackend({ homeDir: () => '/Users/tom', env: {} })
    await backend.init(ctx)
    await backend.start()
    await backend.stop()

    const info = store.get(ENV_STORAGE_KEY) as { platform: string; sep: string; candidates: string[] }
    expect(info.platform).toBe('darwin')
    expect(info.sep).toBe('/')
    expect(info.candidates[0]).toBe('/Users/tom/Library/Application Support/GTools')
  })
})
