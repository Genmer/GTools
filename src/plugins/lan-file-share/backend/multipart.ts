/** multipart/form-data 解析（上传接收用；协议允许 backend 自拼/自解 multipart） */

export interface MultipartPart {
  name: string
  filename?: string
  contentType?: string
  data: Buffer
}

export function boundaryFromContentType(ct: string | undefined): string | null {
  if (typeof ct !== 'string') return null
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(ct)
  const b = m?.[1] ?? m?.[2]
  return b && b !== '' ? b : null
}

/** Content-Disposition 参数解析：name/filename 直取，filename* 按 RFC 5987 解码优先 */
function parseDisposition(line: string): { name?: string; filename?: string } {
  const out: { name?: string; filename?: string } = {}
  const star = /filename\*=utf-8'([^']*)'([^;]+)/i.exec(line)
  if (star) {
    try {
      out.filename = decodeURIComponent(star[2].trim().replace(/^"|"$/g, ''))
    } catch {
      // 非法百分号编码则回退 filename 参数
    }
  }
  const plain = /filename="([^"]*)"/i.exec(line) ?? /filename=([^;]+)/i.exec(line)
  if (plain && out.filename === undefined) out.filename = plain[1].trim()
  const nameM = /name="([^"]*)"/i.exec(line) ?? /name=([^;]+)/i.exec(line)
  if (nameM) out.name = nameM[1].trim()
  return out
}

/**
 * 解析完整 body（调用方须先做体积上限截断）。以 '--boundary' 行为界：
 * 每段头部到 CRLFCRLF，数据到下一个 '\r\n--boundary'。找不到任何边界返回 []。
 */
export function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const dash = Buffer.from(`--${boundary}`)
  const parts: MultipartPart[] = []

  let pos = body.indexOf(dash)
  if (pos === -1) return []
  pos += dash.length

  while (pos < body.length) {
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break // '--' 终止符
    // 跳过边界行后的 CRLF（容错裸 LF）
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2
    else if (body[pos] === 0x0a) pos += 1
    else return parts // 边界后既非 CRLF 也非 '--'，视为格式错误

    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), pos)
    const headerBuf = headerEnd === -1 ? body.slice(pos) : body.slice(pos, headerEnd)
    const headers: Record<string, string> = {}
    for (const line of headerBuf.toString('utf8').split('\r\n')) {
      const i = line.indexOf(':')
      if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
    }
    let dataStart = headerEnd === -1 ? body.length : headerEnd + 4

    const next = body.indexOf(Buffer.from(`\r\n--${boundary}`), dataStart)
    const dataEnd = next === -1 ? body.length : next
    const disp = parseDisposition(headers['content-disposition'] ?? '')
    if (disp.name !== undefined) {
      const part: MultipartPart = { name: disp.name, data: body.slice(dataStart, dataEnd) }
      if (disp.filename !== undefined) part.filename = disp.filename
      if (headers['content-type'] !== undefined) part.contentType = headers['content-type']
      parts.push(part)
    }
    if (next === -1) break
    pos = next + 2 + dash.length
  }
  return parts
}
