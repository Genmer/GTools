// 从 GTools.svg 再生 build/icon.png + build/icon.icns：圆角本体（rx≈22.5%）+ 8% 透明边距，四角必透空。
// 旧资产把圆角方形压平在不透明白底上，是「圆角主体露直角边」的图标侧根因。
// 一次性脚本（也是复现链路）：node node_modules/electron/cli.js scripts/app-icons.mjs
// ico 不在此生成——electron-builder 从新 build/icon.png 自动转换（release/.icon-ico/）。
import { app, BrowserWindow, nativeImage } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MASTER = 1024
const MARGIN = 82 // 8% 透明边距（Big Sur 规范 ~10%，取 8% 兼顾 win ico 观感）
const BODY = MASTER - MARGIN * 2
// icns 条目集与旧资产一致（全 PNG 帧）；ic11..ic14 为 @2x 帧故尺寸与 ic08/ic09 重复
const FRAMES = { ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 }

let failures = 0
const fail = (msg) => {
  console.error('FAIL ' + msg)
  failures++
}

/** 像素级断言（nativeImage.toBitmap 为 BGRA，alpha 在每像素第 4 字节）；margin 为该尺寸下的透明边距 */
function checkCorners(img, label, margin) {
  const { width, height } = img.getSize()
  const bmp = img.toBitmap()
  const alpha = (x, y) => bmp[(y * width + x) * 4 + 3]
  // 四角 + 近角：必须全透明（旧资产在此为 255 纯白）
  for (const [x, y] of [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
    [2, 2]
  ]) {
    if (alpha(x, y) !== 0) fail(`${label} 角(${x},${y}) alpha=${alpha(x, y)}（应为 0）`)
  }
  // 圆角弧外对角探针（角内 7.5% > rx·(1−1/√2)≈6.6%）：弧外应透明，证明圆角真实存在
  const d = Math.round(Math.min(width, height) * 0.075)
  for (const [x, y] of [
    [d, d],
    [width - 1 - d, d],
    [d, height - 1 - d],
    [width - 1 - d, height - 1 - d]
  ]) {
    if (alpha(x, y) !== 0) fail(`${label} 弧外探针(${x},${y}) alpha=${alpha(x, y)}（圆角丢失？）`)
  }
  // 本体上缘中点（边距内 2px）+ 中心：必须非白（防再次压平底色）；≥250 容忍缩放帧边缘插值渗色
  for (const [x, y] of [
    [width >> 1, margin + 2],
    [width >> 1, height >> 1]
  ]) {
    const o = (y * width + x) * 4
    if (bmp[o + 3] < 250) fail(`${label} 本体(${x},${y}) alpha=${bmp[o + 3]}（应为不透明）`)
    if (bmp[o] === 255 && bmp[o + 1] === 255 && bmp[o + 2] === 255) fail(`${label} 本体(${x},${y}) 为纯白（压平底色？）`)
  }
}

async function main() {
  await app.whenReady()

  // 1) Chromium 矢量栅格化 SVG → 1024 透明底 PNG（零额外依赖，抗锯齿由 canvas 保证）
  const svgB64 = readFileSync(ROOT + 'GTools.svg').toString('base64')
  const w = new BrowserWindow({ show: false, width: 64, height: 64 })
  await w.loadURL('data:text/html,<body></body>')
  const dataUrl = await w.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,${svgB64}'
    await img.decode()
    const c = document.createElement('canvas')
    c.width = c.height = ${MASTER}
    const ctx = c.getContext('2d')
    ctx.drawImage(img, ${MARGIN}, ${MARGIN}, ${BODY}, ${BODY})
    return c.toDataURL('image/png')
  })()`)
  w.destroy()

  const pngBuf = Buffer.from(dataUrl.split(',')[1], 'base64')
  const master = nativeImage.createFromBuffer(pngBuf)
  if (master.isEmpty()) fail('母版 PNG 解码失败')
  checkCorners(master, `icon.png(${MASTER})`, MARGIN)
  writeFileSync(ROOT + 'build/icon.png', pngBuf)
  console.log(`build/icon.png  ${MASTER}x${MASTER}  ${pngBuf.length}B`)

  // 2) 缩帧 + 纯 node 拼 icns 容器：'icns' + BE 总长 + [type(4) len(4) png]
  const chunks = []
  let total = 8
  for (const [type, size] of Object.entries(FRAMES)) {
    const frame = size === MASTER ? master : master.resize({ width: size, height: size })
    if (frame.getSize().width !== size) fail(`icns ${type} 缩放尺寸异常 ${frame.getSize().width}`)
    checkCorners(frame, `icns ${type}(${size})`, Math.round((size * MARGIN) / MASTER))
    const fbuf = frame.toPNG()
    const head = Buffer.alloc(8)
    head.write(type, 0, 'latin1')
    head.writeUInt32BE(fbuf.length + 8, 4)
    chunks.push(head, fbuf)
    total += 8 + fbuf.length
  }
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'latin1')
  header.writeUInt32BE(total, 4)
  const icns = Buffer.concat([header, ...chunks])
  writeFileSync(ROOT + 'build/icon.icns', icns)
  console.log(`build/icon.icns  ${Object.keys(FRAMES).length} 帧  ${icns.length}B`)

  // 3) 回读产物复检（容器往返 + 各帧角透明）
  const back = readFileSync(ROOT + 'build/icon.icns')
  if (back.toString('latin1', 0, 4) !== 'icns' || back.readUInt32BE(4) !== back.length) fail('icns 容器头/长度不一致')
  let off = 8
  while (off + 8 <= back.length) {
    const type = back.toString('latin1', off, off + 4)
    const len = back.readUInt32BE(off + 4)
    const frame = nativeImage.createFromBuffer(back.subarray(off + 8, off + len))
    if (frame.isEmpty()) fail(`icns ${type} 回读解码失败`)
    else checkCorners(frame, `icns 回读 ${type}`, Math.round((frame.getSize().width * MARGIN) / MASTER))
    off += len
  }

  console.log(failures === 0 ? 'OK 全部断言通过' : `${failures} 项断言失败`)
  app.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  app.exit(1)
})
