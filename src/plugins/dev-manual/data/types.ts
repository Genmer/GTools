/** 手册词条（数据文件里的原始形态，slug 由 data/index.ts 组装成全局 id） */
export interface RawEntry {
  slug: string
  name: string
  summary: string
  keywords?: string[]
  /** 「复制」按钮的目标文本，缺省用 name；VSCode 快捷键用 meta 按平台取组合键 */
  copyText?: string
  meta?: { mac?: string; win?: string }
  md: string
}

/** 组装后的手册词条；id 全局唯一（`${manualId}:${slug}`），收藏按 id 记账 */
export interface ManualEntry {
  id: string
  manualId: string
  name: string
  summary: string
  keywords: string[]
  copyText?: string
  meta?: { mac?: string; win?: string }
  md: string
}

export interface ManualDoc {
  id: string
  label: string
  icon: string
  entries: ManualEntry[]
}
