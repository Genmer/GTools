// net.fetch 原生可打 file:// 与自定义协议（Electron 官方文档），net 权限面必须收紧到 http(s)，安全边界在主进程
export function assertHttpUrl(url: string): void {
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    // 不回显原始 URL：模板填充后可能含密钥，错误消息会经 SERVICE_ERROR 下发渲染层
    throw new Error('非法 URL')
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error(`不允许的协议：${protocol}（net.fetch 仅支持 http/https）`)
  }
}

export type FetchBodyInput = string | { base64: string } | undefined

/** {base64} 形态的 body 解成 Uint8Array（IPC 无法直接传 Buffer/TypedArray 之外的结构） */
export function resolveFetchBody(body: FetchBodyInput): { body?: string | Uint8Array } {
  if (body === undefined) return {}
  if (typeof body === 'string') return { body }
  if (typeof body === 'object' && typeof body.base64 === 'string') {
    return { body: new Uint8Array(Buffer.from(body.base64, 'base64')) }
  }
  throw new Error('body 只能是字符串或 { base64 } 对象')
}

