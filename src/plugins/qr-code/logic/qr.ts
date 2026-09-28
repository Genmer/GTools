// 二维码纯逻辑：payload 归一化与 URL 判定（无 vue/node API，供单测与视图共用）

/** 二维码内容字符上限：QR 满容量约 2953 字节，2000 字符内 URL/文本场景可扫且生成不慢 */
export const QR_MAX_PAYLOAD_CHARS = 2000

/** trim、空拒、超长拒；返回可直接编码的 payload，非法返回 null */
export function normalizePayload(input: string): string | null {
  const t = input.trim()
  if (t === '') return null
  if (t.length > QR_MAX_PAYLOAD_CHARS) return null
  return t
}

/** 整段是单行 http(s) URL（无空白）——用于提示文案区分「扫码打开链接 / 扫码看文本」 */
export function isUrlLike(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim())
}
