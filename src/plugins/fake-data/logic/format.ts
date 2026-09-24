import type { FieldDef } from './fields'

export type OutputFormat = 'json' | 'table' | 'text'

export const FORMAT_OPTIONS: readonly { value: OutputFormat; label: string }[] = [
  { value: 'json', label: 'JSON' },
  { value: 'table', label: '表格' },
  { value: 'text', label: '纯文本' }
]

/** 三种输出：JSON 数组（中文键）/ Markdown 表格 / TSV（表头 + 值，可直贴 Excel） */
export function formatOutput(
  records: readonly Record<string, string>[],
  fields: readonly FieldDef[],
  format: OutputFormat,
  eol = '\n'
): string {
  if (records.length === 0 || fields.length === 0) return ''

  if (format === 'json') {
    const arr = records.map((r) => {
      const o: Record<string, string> = {}
      for (const f of fields) o[f.label] = r[f.id]
      return o
    })
    return JSON.stringify(arr, null, 2)
  }

  const val = (r: Record<string, string>, f: FieldDef): string => r[f.id] ?? ''

  if (format === 'table') {
    const esc = (v: string): string => v.replaceAll('|', '\\|')
    const lines = [
      `| ${fields.map((f) => f.label).join(' | ')} |`,
      `| ${fields.map(() => '---').join(' | ')} |`
    ]
    for (const r of records) lines.push(`| ${fields.map((f) => esc(val(r, f))).join(' | ')} |`)
    return lines.join(eol)
  }

  const lines = [fields.map((f) => f.label).join('\t')]
  for (const r of records) lines.push(fields.map((f) => val(r, f)).join('\t'))
  return lines.join(eol)
}
