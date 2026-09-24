// mdfind 输出解析：纯函数，渲染层与 backend 共用，禁止引入 node 依赖

export interface FileHit {
  path: string
  name: string
  dir: string
  /** 小写无点；无扩展名（含 .gitignore 类点开头名）为 '' */
  ext: string
  /** 纯解析阶段恒 false，由 backend stat 补全 */
  isDirectory: boolean
}

export const MAX_HITS = 50

/** 单行路径 → 名称/目录/扩展名（容忍尾部斜杠） */
export function hitFromPath(raw: string): FileHit {
  const p = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw
  const slash = p.lastIndexOf('/')
  const name = slash >= 0 ? p.slice(slash + 1) : p
  const dir = slash > 0 ? p.slice(0, slash) : slash === 0 ? '/' : ''
  const dot = name.lastIndexOf('.')
  // dot > 0：点在首位是隐藏文件标记，整个名字不算扩展名
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  return { path: p, name, dir, ext, isDirectory: false }
}

/** mdfind stdout → 去空行去重后的命中列表，最多 limit 条 */
export function parseMdfindLines(output: string, limit = MAX_HITS): FileHit[] {
  const seen = new Set<string>()
  const hits: FileHit[] = []
  for (const raw of output.split('\n')) {
    const line = raw.trim()
    if (line === '' || seen.has(line)) continue
    seen.add(line)
    hits.push(hitFromPath(line))
    if (hits.length >= limit) break
  }
  return hits
}

/** 非空行计数（含被 limit 截掉的部分），用于「共 N 条」提示 */
export function mdfindLineCount(output: string): number {
  let n = 0
  for (const raw of output.split('\n')) {
    if (raw.trim() !== '') n++
  }
  return n
}

const EXT_LABELS: Record<string, string> = {
  pdf: 'PDF',
  doc: '文档', docx: '文档', pages: '文档', rtf: '文档',
  xls: '表格', xlsx: '表格', numbers: '表格', csv: '表格',
  ppt: '演示', pptx: '演示', key: '演示',
  md: 'Markdown', txt: '文本',
  png: '图片', jpg: '图片', jpeg: '图片', gif: '图片', webp: '图片', svg: '图片', heic: '图片', tiff: '图片',
  mp3: '音频', wav: '音频', aac: '音频', flac: '音频', m4a: '音频',
  mp4: '视频', mov: '视频', avi: '视频', mkv: '视频',
  ts: '代码', tsx: '代码', js: '代码', mjs: '代码', vue: '代码', py: '代码', go: '代码', java: '代码',
  rs: '代码', c: '代码', h: '代码', cpp: '代码', hpp: '代码', cs: '代码', rb: '代码', php: '代码',
  swift: '代码', kt: '代码', sh: '代码', html: '代码', css: '代码', scss: '代码',
  json: '代码', yml: '代码', yaml: '代码', toml: '代码', sql: '代码',
  zip: '压缩包', rar: '压缩包', '7z': '压缩包', tar: '压缩包', gz: '压缩包', bz2: '压缩包',
  dmg: '镜像', iso: '镜像', pkg: '安装包', exe: '应用', app: '应用',
  ttf: '字体', otf: '字体', woff: '字体', woff2: '字体'
}

export function fileTypeLabel(hit: Pick<FileHit, 'ext' | 'isDirectory'>): string {
  if (hit.isDirectory) return '文件夹'
  return EXT_LABELS[hit.ext.toLowerCase()] ?? '文件'
}

const LABEL_ICONS: Record<string, string> = {
  文件夹: '📁', PDF: '📕', 文档: '📄', 表格: '📊', 演示: '📽', Markdown: '📝', 文本: '📄',
  图片: '🖼', 音频: '🎵', 视频: '🎬', 代码: '🧩', 压缩包: '📦', 镜像: '💿',
  安装包: '📦', 应用: '🚀', 字体: '🔤', 文件: '📄'
}

export function fileTypeIcon(hit: Pick<FileHit, 'ext' | 'isDirectory'>): string {
  return LABEL_ICONS[fileTypeLabel(hit)] ?? '📄'
}

export interface NameHighlight {
  before: string
  match: string
  after: string
}

/** 名字里第一处命中的普通词高亮（Spotlight 运算符 kind:xxx 不参与匹配） */
export function highlightName(name: string, query: string): NameHighlight | null {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !t.includes(':'))
  const lower = name.toLowerCase()
  for (const t of tokens) {
    const idx = lower.indexOf(t.toLowerCase())
    if (idx >= 0) {
      return { before: name.slice(0, idx), match: name.slice(idx, idx + t.length), after: name.slice(idx + t.length) }
    }
  }
  return null
}
