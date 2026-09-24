import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@sdk/settings'
import { computeEnvInfo, type BackupEnvInfo } from '../../../../src/plugins/backup/logic/datadir'
import { parseBackup, serializeBackup, USER_DATA_TOKEN } from '../../../../src/plugins/backup/logic/format'
import {
  collectCurrentState,
  executeImport,
  exportToFile,
  NotDataDirError,
  type BackupPort
} from '../../../../src/plugins/backup/logic/service'

/** 内存版 BackupPort：路径按 sep 原样存取，list 只做一层展开（对齐宿主 fs.list 非递归语义） */
class MemPort implements BackupPort {
  readonly files = new Map<string, string>()
  readonly dirs = new Set<string>()
  readonly writes: string[] = []
  nextDirPick: string | null = null
  nextSavePick: string | null = null

  constructor(readonly sep: string) {}

  async pickDirectory(): Promise<string | null> {
    return this.nextDirPick
  }
  async pickBackupFile(): Promise<string | null> {
    return this.nextDirPick
  }
  async pickSavePath(): Promise<string | null> {
    return this.nextSavePick
  }
  async stat(path: string) {
    if (this.files.has(path)) return { exists: true, isDirectory: false }
    if (this.dirs.has(path)) return { exists: true, isDirectory: true }
    return { exists: false, isDirectory: false }
  }
  async list(dir: string) {
    const prefix = dir.endsWith(this.sep) ? dir : dir + this.sep
    const names = new Set<string>()
    for (const p of [...this.files.keys(), ...this.dirs]) {
      if (!p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length)
      if (rest === '') continue
      const name = rest.split(this.sep)[0]
      if (name !== '') names.add(name)
    }
    return [...names].sort().map((name) => ({
      name,
      path: prefix + name,
      isDirectory: this.dirs.has(prefix + name)
    }))
  }
  async read(path: string) {
    const c = this.files.get(path)
    if (c === undefined) throw new Error(`ENOENT: ${path}`)
    return c
  }
  async write(path: string, data: string) {
    this.writes.push(path)
    this.files.set(path, data)
    const parts = path.split(this.sep)
    for (let i = 1; i < parts.length; i++) this.dirs.add(parts.slice(0, i).join(this.sep))
  }
  async mkdir(path: string) {
    this.dirs.add(path)
  }
  async remove(path: string) {
    for (const p of [...this.files.keys()]) if (p === path || p.startsWith(path + this.sep)) this.files.delete(p)
    this.dirs.delete(path)
  }
}

const MAC_DIR = '/Users/tom/Library/Application Support/GTools'
const WIN_DIR = 'C:\\Users\\tom\\AppData\\Roaming\\GTools'

const macEnv: BackupEnvInfo = computeEnvInfo('darwin', '/Users/tom', {})
const winEnv: BackupEnvInfo = computeEnvInfo('win32', 'C:\\Users\\tom', { APPDATA: 'C:\\Users\\tom\\AppData\\Roaming' })

async function seedMacHome(port: MemPort): Promise<void> {
  await port.write(`${MAC_DIR}/settings.json`, JSON.stringify({ ...DEFAULT_SETTINGS, theme: 'dark', disabledPlugins: ['hello'] }))
  await port.write(`${MAC_DIR}/storage/clipboard/kv.json`, JSON.stringify({ state: { last: MAC_DIR + '/notes/a.md' } }))
  await port.write(`${MAC_DIR}/storage/translate/kv.json`, JSON.stringify({ provider: 'mock' }))
  for (let i = 1; i <= 5; i++) await port.write(`${MAC_DIR}/backups/pre-import-2026010${i}-000000.gtools`, '{}')
}

describe('service：collectCurrentState', () => {
  it('读出 settings 与各插件 kv，路径用本机分隔符拼接', async () => {
    const port = new MemPort('/')
    await seedMacHome(port)
    const state = await collectCurrentState(port, macEnv, MAC_DIR)
    expect(state.settings.theme).toBe('dark')
    expect(state.settings.disabledPlugins).toEqual(['hello'])
    expect(Object.keys(state.pluginStorage).sort()).toEqual(['clipboard', 'translate'])
    expect(state.isEmpty).toBe(false)
  })

  it('api-services.json 存在时读入（原样搬运不解析），坏 JSON 记 warning；导出随备份携带', async () => {
    const port = new MemPort('/')
    await seedMacHome(port)
    const api = { services: { translate: { activeProviderId: 'u-1', providers: [{ id: 'u-1', apiKey: 'sk' }] } } }
    await port.write(`${MAC_DIR}/api-services.json`, JSON.stringify(api))
    const state = await collectCurrentState(port, macEnv, MAC_DIR)
    expect(state.apiServices).toEqual(api)

    port.nextSavePick = '/Users/tom/Desktop/out.gtools'
    const r = await exportToFile(port, macEnv, MAC_DIR, state, '0.2.0')
    expect(r.status).toBe('done')
    const written = port.files.get('/Users/tom/Desktop/out.gtools') ?? ''
    expect(written).toContain('"u-1"')

    const bad = new MemPort('/')
    await seedMacHome(bad)
    await bad.write(`${MAC_DIR}/api-services.json`, '{bad')
    const state2 = await collectCurrentState(bad, macEnv, MAC_DIR)
    expect(state2.apiServices).toBeUndefined()
    expect(state2.warnings.some((w) => w.includes('api-services.json'))).toBe(true)
  })

  it('坏 JSON 的 settings/kv 各记 warning 并降级（settings 回默认、kv 跳过）', async () => {
    const port = new MemPort('/')
    await port.write(`${MAC_DIR}/settings.json`, '{bad')
    await port.write(`${MAC_DIR}/storage/clipboard/kv.json`, '{bad')
    await port.write(`${MAC_DIR}/storage/empty/kv.json`, JSON.stringify({}))
    const state = await collectCurrentState(port, macEnv, MAC_DIR)
    expect(state.settings).toEqual(DEFAULT_SETTINGS)
    expect(state.pluginStorage).toEqual({})
    expect(state.warnings.some((w) => w.includes('settings.json'))).toBe(true)
    expect(state.warnings.some((w) => w.includes('clipboard'))).toBe(true)
  })

  it('两件数据都没有时导出方向报「不是数据目录」，导入方向允许且标记全新环境', async () => {
    const port = new MemPort('/')
    port.dirs.add(MAC_DIR)
    await expect(collectCurrentState(port, macEnv, MAC_DIR)).rejects.toBeInstanceOf(NotDataDirError)
    const state = await collectCurrentState(port, macEnv, MAC_DIR, { allowEmpty: true })
    expect(state.isEmpty).toBe(true)
    expect(state.warnings.some((w) => w.includes('全新环境'))).toBe(true)
  })
})

describe('service：exportToFile', () => {
  it('导出为单个文件：绝对路径 token 化、结构可再解析、用户取消返回 canceled', async () => {
    const port = new MemPort('/')
    await seedMacHome(port)
    port.nextSavePick = '/Users/tom/Desktop/out.gtools'

    const state = await collectCurrentState(port, macEnv, MAC_DIR)
    const r = await exportToFile(port, macEnv, MAC_DIR, state, '0.2.0')

    expect(r.status).toBe('done')
    if (r.status !== 'done') return
    expect(r.path).toBe('/Users/tom/Desktop/out.gtools')
    const written = port.files.get('/Users/tom/Desktop/out.gtools') ?? ''
    expect(written).toContain(USER_DATA_TOKEN)
    const parsed = parseBackup(written)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.backup.sourcePlatform).toBe('darwin')
      expect(parsed.backup.appVersion).toBe('0.2.0')
      expect(parsed.backup.pluginStorage.translate).toEqual({ provider: 'mock' })
    }

    port.nextSavePick = null
    const canceled = await exportToFile(port, macEnv, MAC_DIR, state, '0.2.0')
    expect(canceled.status).toBe('canceled')
  })
})

describe('service：executeImport（跨 win/mac 迁移）', () => {
  function macBackupContent() {
    return serializeBackup({
      settings: { ...DEFAULT_SETTINGS, theme: 'glass', hotkey: { darwin: 'Cmd+Shift+P', win32: 'Ctrl+Alt+J' } },
      pluginStorage: {
        clipboard: { state: { last: USER_DATA_TOKEN + '/notes/a.md' } },
        translate: { provider: 'new-provider' },
        markdown: { notes: 'hello' }
      },
      platform: 'darwin',
      appVersion: '0.2.0',
      now: new Date('2026-02-03T04:05:06Z'),
      apiServices: { services: { translate: { activeProviderId: 'u-1', providers: [{ id: 'u-1', apiKey: 'sk' }] } } }
    })
  }

  async function importMacBackupToWin() {
    const port = new MemPort('\\')
    await port.write(`${WIN_DIR}\\settings.json`, JSON.stringify(DEFAULT_SETTINGS))
    await port.write(`${WIN_DIR}\\storage\\translate\\kv.json`, JSON.stringify({ provider: 'new-provider' }))
    await port.write(`${WIN_DIR}\\storage\\clipboard\\kv.json`, JSON.stringify({ state: { last: 'old' } }))
    for (let i = 1; i <= 5; i++) await port.write(`${WIN_DIR}\\backups\\pre-import-2025010${i}-000000.gtools`, '{}')

    const backup = parseBackup(JSON.stringify(macBackupContent()))
    if (!backup.ok) throw new Error('测试夹具解析失败')

    const state = await collectCurrentState(port, winEnv, WIN_DIR)
    port.writes.length = 0 // 只观察导入阶段的写盘
    const result = await executeImport(port, winEnv, WIN_DIR, backup.backup, state, { now: new Date(2026, 5, 1, 12, 0, 0) })
    return { port, result }
  }

  it('设置与 kv 写回 win 路径，token 展开为反斜杠本机路径', async () => {
    const { port, result } = await importMacBackupToWin()
    expect(result.wroteSettings).toBe(true)
    expect(result.restartRecommended).toBe(true)

    const api = JSON.parse(port.files.get(`${WIN_DIR}\\api-services.json`) ?? '') as { services?: unknown }
    expect((api.services as { translate?: { activeProviderId?: string } }).translate?.activeProviderId).toBe('u-1')

    const settings = JSON.parse(port.files.get(`${WIN_DIR}\\settings.json`) ?? '') as typeof DEFAULT_SETTINGS
    expect(settings.theme).toBe('glass')
    expect(settings.hotkey.win32).toBe('Ctrl+Alt+J')

    const clipboard = JSON.parse(port.files.get(`${WIN_DIR}\\storage\\clipboard\\kv.json`) ?? '') as {
      state: { last: string }
    }
    expect(clipboard.state.last).toBe(WIN_DIR + '\\notes\\a.md')

    expect(port.files.get(`${WIN_DIR}\\storage\\markdown\\kv.json`)).toBe(JSON.stringify({ notes: 'hello' }))
  })

  it('内容一致的插件不重复写盘', async () => {
    const { port } = await importMacBackupToWin()
    expect(port.writes.includes(`${WIN_DIR}\\storage\\translate\\kv.json`)).toBe(false)
    expect(port.writes.includes(`${WIN_DIR}\\storage\\clipboard\\kv.json`)).toBe(true)
  })

  it('导入前先落当前数据快照，且快照目录只保留最近 5 份', async () => {
    const { port, result } = await importMacBackupToWin()
    expect(result.safetyBackupPath).toBe(`${WIN_DIR}\\backups\\pre-import-20260601-120000.gtools`)
    const snapshot = parseBackup(port.files.get(result.safetyBackupPath ?? '') ?? '')
    expect(snapshot.ok).toBe(true)
    if (snapshot.ok) expect(snapshot.backup.pluginStorage.translate).toEqual({ provider: 'new-provider' })

    expect(port.files.has(`${WIN_DIR}\\backups\\pre-import-20250101-000000.gtools`)).toBe(false) // 最旧的被清
    const kept = [...port.files.keys()].filter((p) => p.includes('pre-import-')).sort()
    expect(kept).toHaveLength(5)
    expect(kept[kept.length - 1]).toBe(`${WIN_DIR}\\backups\\pre-import-20260601-120000.gtools`)
  })

  it('目标为空（全新环境）时跳过快照直接导入', async () => {
    const port = new MemPort('\\')
    port.dirs.add(WIN_DIR)
    const backup = parseBackup(JSON.stringify(macBackupContent()))
    if (!backup.ok) throw new Error('测试夹具解析失败')
    const state = await collectCurrentState(port, winEnv, WIN_DIR, { allowEmpty: true })
    const result = await executeImport(port, winEnv, WIN_DIR, backup.backup, state)
    expect(result.safetyBackupPath).toBeNull()
    expect(port.files.has(`${WIN_DIR}\\settings.json`)).toBe(true)
  })
})
