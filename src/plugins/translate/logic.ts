export type TranslateDirection = 'auto' | 'zh2en' | 'en2zh'

/** 插件内仅存的非 API 类设置：语言方向偏好（provider/密钥在全局 API 中心，见 DESIGN 附录 B.5） */
export interface TranslatePrefs {
  direction: TranslateDirection
}

export const PREFS_STORAGE_KEY = 'settings'
export const DEFAULT_PREFS: TranslatePrefs = { direction: 'auto' }

/** 存储读出的未知结构 → 合法偏好，坏数据兜底不抛错（旧版该键存过 provider 配置，多余字段直接忽略） */
export function normalizePrefs(raw: unknown): TranslatePrefs {
  const d = (raw ?? {}) as { direction?: unknown }
  const v = d.direction
  return { direction: v === 'zh2en' || v === 'en2zh' || v === 'auto' ? v : DEFAULT_PREFS.direction }
}

/** 中文占非空白字符比 > 0.3 判为中文输入（DESIGN §4.2 的 auto 启发式），只统计汉字不含标点 */
export function isMostlyChinese(text: string): boolean {
  const chars = text.replace(/\s+/g, '')
  if (chars.length === 0) return false
  const cjk = chars.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g)
  return (cjk?.length ?? 0) / chars.length > 0.3
}

/** 方向 → 源/目标语言对（MVP 中英双向；auto 按启发式判定） */
export function resolveLangPair(direction: TranslateDirection, text: string): { from: string; to: string } {
  const zh2en = direction === 'zh2en' || (direction === 'auto' && isMostlyChinese(text))
  return zh2en ? { from: 'zh-CN', to: 'en' } : { from: 'en', to: 'zh-CN' }
}

export const DIRECTION_OPTIONS: { value: TranslateDirection; label: string }[] = [
  { value: 'auto', label: '自动检测' },
  { value: 'zh2en', label: '中文 → 英语' },
  { value: 'en2zh', label: '英语 → 中文' }
]

/** 交换：auto 先按当前文本落成具体方向再翻转（交换后语义必须是确定方向） */
export function swapDirection(direction: TranslateDirection, text: string): TranslateDirection {
  if (direction === 'zh2en') return 'en2zh'
  if (direction === 'en2zh') return 'zh2en'
  return isMostlyChinese(text) ? 'en2zh' : 'zh2en'
}

const LANG_LABELS: Record<string, string> = { 'zh-CN': '中文', en: '英语' }
export function langLabel(code: string): string {
  return LANG_LABELS[code] ?? code
}

/** demo 态稳定示例（initialCommand === 'demo'，不发任何网络请求） */
export const DEMO_INPUT = 'hello world'
export const DEMO_RESULT = '你好，世界'
