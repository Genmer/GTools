/** 局域网 IPv4 地址提取（注入 networkInterfaces 结果，纯函数可测） */
export function lanIPv4Addresses(
  ifaces: Record<string, Array<{ family: string | number; address: string; internal: boolean }> | undefined>
): Array<{ name: string; address: string }> {
  const out: Array<{ name: string; address: string }> = []
  for (const [name, infos] of Object.entries(ifaces)) {
    for (const info of infos ?? []) {
      // family 在 node 新版是数字 4、旧版是字符串 'IPv4'，两种都认
      const isV4 = info.family === 4 || info.family === 'IPv4'
      if (!isV4 || info.internal) continue
      if (out.some((x) => x.address === info.address)) continue
      out.push({ name, address: info.address })
    }
  }
  return out
}
