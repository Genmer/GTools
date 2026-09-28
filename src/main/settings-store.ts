export type { ThemeName, AppSettings, CommandHotkey, TransparencySettings } from '@sdk/settings'
import { DEFAULT_SETTINGS, type AppSettings, type CommandHotkey, type ThemeName, type TransparencySettings } from '@sdk/settings'
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
  transparency?: Partial<TransparencySettings>
  disabledPlugins?: string[]
  launchAtLogin?: boolean
  clipboardSuggest?: boolean
  hideOnBlur?: boolean
  commandHotkeys?: CommandHotkey[]
}

function clampOpacity(v: number): number {
  return Math.min(100, Math.max(0, Math.round(v)))
}

function merge(base: AppSettings, patch: SettingsPatch): AppSettings {
  return {
    hotkey: { ...base.hotkey, ...(patch.hotkey ?? {}) },
    theme: patch.theme ?? base.theme,
    transparency: { ...base.transparency, ...(patch.transparency ?? {}) },
    disabledPlugins: patch.disabledPlugins ?? base.disabledPlugins,
    launchAtLogin: patch.launchAtLogin ?? base.launchAtLogin,
    clipboardSuggest: patch.clipboardSuggest ?? base.clipboardSuggest,
    hideOnBlur: patch.hideOnBlur ?? base.hideOnBlur,
    commandHotkeys: patch.commandHotkeys ?? base.commandHotkeys
  }
}

/** 逐项校验剔除坏项；同平台同加速键去重保留首个。与主 hotkey 撞键不在此拦（注册期报错，归 P7） */
function sanitizeCommandHotkeys(raw: unknown): CommandHotkey[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: CommandHotkey[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const h = item as Record<string, unknown>
    if (typeof h.pluginId !== 'string' || h.pluginId === '') continue
    if (typeof h.commandId !== 'string' || h.commandId === '') continue
    if (typeof h.darwin !== 'string' || !validateAccelerator(h.darwin, 'darwin').ok) continue
    if (typeof h.win32 !== 'string' || !validateAccelerator(h.win32, 'win32').ok) continue
    const keys = [`darwin:${h.darwin}`, `win32:${h.win32}`]
    if (keys.some((k) => seen.has(k))) continue
    keys.forEach((k) => seen.add(k))
    out.push({ pluginId: h.pluginId, commandId: h.commandId, darwin: h.darwin, win32: h.win32 })
  }
  return out
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
  if (typeof p.transparency === 'object' && p.transparency !== null) {
    const t = p.transparency as Record<string, unknown>
    const tx: Partial<TransparencySettings> = {}
    if (typeof t.enabled === 'boolean') tx.enabled = t.enabled
    if (typeof t.opacity === 'number' && Number.isFinite(t.opacity)) tx.opacity = clampOpacity(t.opacity)
    if (typeof t.blur === 'boolean') tx.blur = t.blur
    patch.transparency = { ...patch.transparency, ...tx }
  }
  if (Array.isArray(p.disabledPlugins) && p.disabledPlugins.every((x) => typeof x === 'string')) {
    patch.disabledPlugins = p.disabledPlugins
  }
  if (typeof p.launchAtLogin === 'boolean') patch.launchAtLogin = p.launchAtLogin
  if (typeof p.clipboardSuggest === 'boolean') patch.clipboardSuggest = p.clipboardSuggest
  if (typeof p.hideOnBlur === 'boolean') patch.hideOnBlur = p.hideOnBlur
  // 数组即收（含空数组 = 清空全部指令绑定）；非数组整体丢弃由 merge 回退现值
  if (Array.isArray(p.commandHotkeys)) patch.commandHotkeys = sanitizeCommandHotkeys(p.commandHotkeys)
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
      this.current = merge(this.current, sanitizePatch(parsed))
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
