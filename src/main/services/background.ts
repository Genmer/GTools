// 自定义背景服务（题5）：选图拷贝重编码为 userData/backgrounds/ 固定名 current.jpg，file 只存相对名。
// electron image 能力构造注入（vitest node 纯逻辑纪律）；dataUrl 按名缓存，换图/清除必须失效（F4 脏缓存门禁）
export const BACKGROUND_FILE_NAME = 'current.jpg'
export const BACKGROUND_MAX_WIDTH = 1600
export const BACKGROUND_JPEG_QUALITY = 90

export interface BackgroundDecodedImage {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(opts: { width?: number; height?: number }): BackgroundDecodedImage
  toJPEG(quality?: number): Buffer
}

/** 与 electron nativeImage 静态面同构（createFromBuffer/createFromPath/resize/toJPEG） */
export interface BackgroundImageCodec {
  createFromPath(path: string): BackgroundDecodedImage
  createFromBuffer(buffer: Buffer): BackgroundDecodedImage
}

export interface BackgroundFs {
  readFile(path: string): Promise<Buffer>
  writeFile(path: string, data: Buffer): Promise<void>
  rm(path: string, opts: { force: true }): Promise<void>
  mkdir(path: string, opts: { recursive: true }): Promise<unknown>
}

/** 选图 → 重编码 → 固定名落盘（含缓存失效）；读取按名缓存 dataUrl；清除删文件 + 失效缓存 */
export class BackgroundService {
  private readonly cache = new Map<string, string>()

  constructor(
    private readonly dir: string,
    private readonly fs: BackgroundFs,
    private readonly image: BackgroundImageCodec
  ) {}

  /** 坏图 throw（调用方呈现，零副作用不落 settings）；成功后失效缓存并返回固定名 */
  async chooseAndStore(sourcePath: string): Promise<typeof BACKGROUND_FILE_NAME> {
    let img: BackgroundDecodedImage
    try {
      img = this.image.createFromPath(sourcePath)
    } catch (err) {
      throw new Error(`无法读取所选图片：${err instanceof Error ? err.message : String(err)}`)
    }
    if (img.isEmpty()) throw new Error('无法读取所选图片：文件为空或不是受支持的图片格式')
    const { width } = img.getSize()
    // 长边按宽度约束缩到 ≤1600（壁纸场景足够），再统一重编码 JPEG 控制体积
    const scaled = width > BACKGROUND_MAX_WIDTH ? img.resize({ width: BACKGROUND_MAX_WIDTH }) : img
    const jpeg = scaled.toJPEG(BACKGROUND_JPEG_QUALITY)
    await this.fs.mkdir(this.dir, { recursive: true })
    await this.fs.writeFile(this.pathOf(BACKGROUND_FILE_NAME), jpeg)
    this.cache.clear()
    return BACKGROUND_FILE_NAME
  }

  /** 缺失/损坏 → null；成功按名缓存（换图/清除路径负责失效） */
  async resolveDataUrl(name: string): Promise<string | null> {
    const cached = this.cache.get(name)
    if (cached !== undefined) return cached
    let buf: Buffer
    try {
      buf = await this.fs.readFile(this.pathOf(name))
    } catch {
      return null
    }
    if (buf.length === 0) return null
    if (this.image.createFromBuffer(buf).isEmpty()) return null
    const url = `data:image/jpeg;base64,${buf.toString('base64')}`
    this.cache.set(name, url)
    return url
  }

  async clear(): Promise<void> {
    this.cache.clear()
    await this.fs.rm(this.pathOf(BACKGROUND_FILE_NAME), { force: true })
  }

  private pathOf(name: string): string {
    return `${this.dir}/${name}`
  }
}
