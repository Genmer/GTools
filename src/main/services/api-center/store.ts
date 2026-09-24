import type { FsLike } from '../../settings-store'
import { sanitizeApiServices, type ApiServicesConfig } from './types'

/** userData/api-services.json 的读写：冷数据独立于 settings.json，机制同 SettingsStore（原子写 + 防抖 + flush 兜底） */
export class ApiCenterStore {
  private current: ApiServicesConfig = structuredClone(DEFAULT)
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private loaded = false

  constructor(
    private readonly dir: string,
    private readonly fs: FsLike,
    private readonly debounceMs = 300
  ) {}

  private get file(): string {
    return `${this.dir}/api-services.json`
  }
  private get tmpFile(): string {
    return `${this.dir}/api-services.json.tmp`
  }

  get config(): ApiServicesConfig {
    return this.current
  }

  async load(): Promise<void> {
    try {
      const raw = await this.fs.readFile(this.file, { encoding: 'utf-8' })
      // 文件可能被手改：strictActive 把指向已禁用 provider 的 active 重置回默认
      this.current = sanitizeApiServices(JSON.parse(raw), { strictActive: true })
    } catch {
      // 文件不存在或损坏：默认值（= 0.1.0 行为：回退 MyMemory 免 key），首次写入即落地
    }
    this.loaded = true
  }

  /** 结构 sanitize 后替换内存态；持久化按防抖合并，退出前 flush 兜底 */
  async replace(next: unknown): Promise<ApiServicesConfig> {
    if (!this.loaded) await this.load()
    this.current = sanitizeApiServices(next)
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

const DEFAULT = sanitizeApiServices(null)
