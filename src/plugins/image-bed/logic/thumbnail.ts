// 缩略图生成（仅渲染层 DOM 环境，node 单测不覆盖）：canvas 等比缩到 max 内、jpeg 压缩。
// 历史记录只存缩略图 dataURL，避免整图 base64 撑爆 storage。

export const THUMB_MAX = 96

export function makeThumb(dataUrl: string, max = THUMB_MAX): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = (): void => {
      try {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (ctx === null) {
          resolve(undefined)
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        // svg 转 jpeg 会丢透明背景，涂白底
        ctx.globalCompositeOperation = 'destination-over'
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.75))
      } catch {
        resolve(undefined)
      }
    }
    img.onerror = (): void => resolve(undefined)
    img.src = dataUrl
  })
}
