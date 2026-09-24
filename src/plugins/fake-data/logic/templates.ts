import { clampCount, fieldById } from './fields'
import type { OutputFormat } from './format'

/** 字段组合模板：同名覆盖，列表即存储格式 */
export interface FieldTemplate {
  name: string
  fields: string[]
  count: number
  format: OutputFormat
}

export const MAX_TEMPLATES = 12
export const TEMPLATES_STORAGE_KEY = 'fake-data:templates'
export const LAST_STORAGE_KEY = 'fake-data:last'

const FORMAT_VALUES: readonly OutputFormat[] = ['json', 'table', 'text']

export function sanitizeFields(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const ids = raw.filter((v): v is string => typeof v === 'string' && fieldById(v) !== undefined)
  return [...new Set(ids)]
}

export function sanitizeFormat(raw: unknown): OutputFormat {
  return FORMAT_VALUES.includes(raw as OutputFormat) ? (raw as OutputFormat) : 'json'
}

/** 存储读回的模板列表清洗：过滤非法项、去重、限量（新条目在前） */
export function normalizeTemplates(raw: unknown): FieldTemplate[] {
  if (!Array.isArray(raw)) return []
  const out: FieldTemplate[] = []
  const names = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const t = item as Record<string, unknown>
    const name = typeof t.name === 'string' ? t.name.trim().slice(0, 30) : ''
    if (name === '' || names.has(name)) continue
    const fields = sanitizeFields(t.fields)
    if (fields.length === 0) continue
    names.add(name)
    out.push({ name, fields, count: clampCount(Number(t.count)), format: sanitizeFormat(t.format) })
    if (out.length >= MAX_TEMPLATES) break
  }
  return out
}

/** 保存当前组合：同名覆盖并置顶，超量丢弃最旧的 */
export function upsertTemplate(list: readonly FieldTemplate[], draft: FieldTemplate): FieldTemplate[] {
  const name = draft.name.trim().slice(0, 30)
  if (name === '' || draft.fields.length === 0) return [...list]
  return [{ ...draft, name }, ...list.filter((t) => t.name !== name)].slice(0, MAX_TEMPLATES)
}

export function removeTemplate(list: readonly FieldTemplate[], name: string): FieldTemplate[] {
  return list.filter((t) => t.name !== name)
}
