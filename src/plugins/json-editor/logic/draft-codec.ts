// 草稿压缩存取：256KB 上限是本插件自己的防抖落盘守卫（防每击键把大字符串发 IPC），超限先压缩，
// 压缩后体积回限内即可安全落盘；'gz:' 前缀标记压缩形态，解压失败回退原文（见 decodeDraft）。
export const DRAFT_MAX_SAVE = 262144

const GZ_PREFIX = 'gz:'

// 分块转二进制串防一次性 spread 大数组爆栈
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

// 返回类型钉 ArrayBuffer 背书：DOM lib 的 BufferSource（write 入参）不认 ArrayBufferLike
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export async function encodeDraft(text: string): Promise<{ stored: string; truncated: boolean }> {
  if (text.length <= DRAFT_MAX_SAVE) return { stored: text, truncated: false }
  // 老环境无压缩流：截断保底（直接不存会静默丢整份草稿）
  if (typeof CompressionStream === 'undefined') {
    return { stored: text.slice(0, DRAFT_MAX_SAVE), truncated: true }
  }
  const cs = new CompressionStream('deflate-raw')
  const writer = cs.writable.getWriter()
  // 失败经 readable 侧（arrayBuffer/text）抛出统一处理；write/close 侧级联拒绝就地吞掉防未处理拒绝
  writer.write(new TextEncoder().encode(text)).catch(() => {})
  writer.close().catch(() => {})
  const bytes = new Uint8Array(await new Response(cs.readable).arrayBuffer())
  const stored = GZ_PREFIX + bytesToBase64(bytes)
  // 压缩后仍超限（近乎不可压缩的极端内容）：截到可存大小，截断标记由调用方提示
  if (stored.length <= DRAFT_MAX_SAVE) return { stored, truncated: false }
  return { stored: stored.slice(0, DRAFT_MAX_SAVE), truncated: true }
}

export async function decodeDraft(stored: unknown): Promise<string> {
  if (typeof stored !== 'string' || stored === '') return ''
  if (!stored.startsWith(GZ_PREFIX)) return stored
  try {
    const ds = new DecompressionStream('deflate-raw')
    const writer = ds.writable.getWriter()
    writer.write(base64ToBytes(stored.slice(GZ_PREFIX.length))).catch(() => {})
    writer.close().catch(() => {})
    return await new Response(ds.readable).text()
  } catch {
    // 回退原文而非清空：明文草稿恰以 'gz:' 开头时不被静默毁掉；真损坏的压缩串以 base64 原样可见、可手工抢救
    return stored
  }
}
