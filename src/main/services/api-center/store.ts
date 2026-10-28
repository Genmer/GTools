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
    let raw: string
    try {
      raw = await this.fs.readFile(this.file, { encoding: 'utf-8' })
    } catch (err) {
      // 仅 ENOENT 用默认值；其余（杀软/备份瞬时锁）上抛——吞掉会让内存停在默认空态，
      // 之后 flush 把盘上全部 API 凭证清掉
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      this.loaded = true
      return
    }
    try {
      // 文件可能被手改：strictActive 把指向已禁用 provider 的 active 重置回默认
      this.current = sanitizeApiServices(JSON.parse(raw), { strictActive: true })
    } catch {
      // 文件损坏：默认值（= 0.1.0 行为：回退 MyMemory 免 key），首次写入即落地
    }
    this.loaded = true
  }

  /** 幂等加载：已成功加载立即返回，否则重试 load。降级会话（load 失败停在默认空态）里
   *  mutator 取快照前必须先过这道门，否则旧空快照会在 replace 的 load 重试成功后覆盖刚读入的盘上配置 */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    await this.load()
  }

  /** 结构 sanitize 后替换内存态；持久化按防抖合并，退出前 flush 兜底 */
  async replace(next: unknown): Promise<ApiServicesConfig> {
    await this.ensureLoaded()
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
