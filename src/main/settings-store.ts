export type { ThemeName, AppSettings } from '@sdk/settings'
import { DEFAULT_SETTINGS, type AppSettings, type ThemeName } from '@sdk/settings'
import { validateAccelerator } from '@sdk/shortcut-rules'
export { DEFAULT_SETTINGS }

export interface FsLike {
  readFile(path: string, opts: { encoding: 'utf-8' }): Promise<string>
  writeFile(path: string, data: string, opts: { encoding: 'utf-8' }): Promise<void>
  rename(from: string, to: string): Promise<void>
  // node fs/promises 的 mkdir 返回 Promise<string|undefined>，放宽以兼容直接注入
  mkdir(path: string, opts: { recursive: true }): Promise<unknown>
}

type SettingsPatch = {
  hotkey?: Partial<AppSettings['hotkey']>
  theme?: ThemeName
  disabledPlugins?: string[]
}

function merge(base: AppSettings, patch: SettingsPatch): AppSettings {
  return {
    hotkey: { ...base.hotkey, ...(patch.hotkey ?? {}) },
    theme: patch.theme ?? base.theme,
    disabledPlugins: patch.disabledPlugins ?? base.disabledPlugins
  }
}

/** 只放行类型与语义都合法的字段（文件可能被手改坏），坏值丢弃后由 merge 回退默认 */
function sanitizePatch(raw: unknown): SettingsPatch {
  if (typeof raw !== 'object' || raw === null) return {}
  const p = raw as Record<string, unknown>
  const patch: SettingsPatch = {}
  if (typeof p.hotkey === 'object' && p.hotkey !== null) {
    const h = p.hotkey as Record<string, unknown>
    const hotkey: Partial<AppSettings['hotkey']> = {}
    if (typeof h.darwin === 'string' && validateAccelerator(h.darwin, 'darwin').ok) hotkey.darwin = h.darwin
    if (typeof h.win32 === 'string' && validateAccelerator(h.win32, 'win32').ok) hotkey.win32 = h.win32
    patch.hotkey = hotkey
  }
  if (p.theme === 'light' || p.theme === 'dark' || p.theme === 'glass') patch.theme = p.theme
  if (Array.isArray(p.disabledPlugins) && p.disabledPlugins.every((x) => typeof x === 'string')) {
    patch.disabledPlugins = p.disabledPlugins
  }
  return patch
}

/** userData/settings.json 的读写：内存持有 + 深合并默认值 + 原子写（tmp→rename）+ 防抖 */
export class SettingsStore {
  private current: AppSettings = structuredClone(DEFAULT_SETTINGS)
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private loaded = false

  constructor(
    private readonly dir: string,
    private readonly fs: FsLike,
    private readonly debounceMs = 300
  ) {}

  private get file(): string {
    return `${this.dir}/settings.json`
  }
  private get tmpFile(): string {
    return `${this.dir}/settings.json.tmp`
  }

  get settings(): AppSettings {
    return this.current
  }

  async load(): Promise<void> {
    try {
      const raw = await this.fs.readFile(this.file, { encoding: 'utf-8' })
      const parsed: unknown = JSON.parse(raw)
      this.current = merge(DEFAULT_SETTINGS, sanitizePatch(parsed))
    } catch {
      // 文件不存在或损坏：用默认值，首次写入即落地
    }
    this.loaded = true
  }

  /** 更新内存立即生效；持久化按防抖合并，退出前 flush 兜底 */
  async update(patch: SettingsPatch): Promise<AppSettings> {
    if (!this.loaded) await this.load()
    this.current = merge(this.current, sanitizePatch(patch))
    this.dirty = true
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.debounceMs)
    return structuredClone(this.current)
  }

  async flush(): Promise<void> {
    if (!this.dirty) return
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.fs.mkdir(this.dir, { recursive: true })
    await this.fs.writeFile(this.tmpFile, JSON.stringify(this.current, null, 2), { encoding: 'utf-8' })
    await this.fs.rename(this.tmpFile, this.file)
    this.dirty = false
  }
}
