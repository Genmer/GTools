/** 端到端集成：backend（真实 node:http + 默认 deps）+ 内存 fake ctx + 真实 fetch 客户端 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLanFileShareBackend, LanFileShareBackend } from '../../../../src/plugins/lan-file-share/backend/index'
import { CONTROL_KEY, STATE_KEY, type ShareState } from '../../../../src/plugins/lan-file-share/shared'
import { createFakeCtx } from './fake-ctx'
import { readZip } from './zip-reader'

vi.setConfig({ testTimeout: 20_000 })

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8])

async function until(pred: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('等待超时')
    await new Promise((r) => setTimeout(r, 25))
  }
}

function multipartBody(boundary: string, files: Array<{ name: string; data: Buffer }>): Buffer {
  const parts = files.map((f) =>
    Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        'utf8'
      ),
      f.data,
      Buffer.from('\r\n')
    ])
  )
  return Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)])
}

describe('lan-file-share 集成（真实 HTTP）', () => {
  const fake = createFakeCtx({
    '/share/hello.txt': '你好世界',
    '/share/photo.png': PNG_HEAD,
    '/share/sub/deep.bin': 'BINARYDATA-deep'
  })
  let backend: LanFileShareBackend
  let base = ''
  let controlId = 0

  function send(op: 'start' | 'stop', extra?: Record<string, unknown>): void {
    controlId += 1
    void fake.ctx.storage.set(CONTROL_KEY, { id: controlId, op, ...extra })
  }

  beforeAll(async () => {
    backend = createLanFileShareBackend({ pollMs: 20 }) as LanFileShareBackend
    await backend.init(fake.ctx)
    await backend.start()
    send('start', { dir: '/share', port: 37760 })
    await until(() => {
      const s = fake.state()
      return s !== null && s.running
    })
    base = `http://127.0.0.1:${fake.state()?.port}`
  })

  afterAll(async () => {
    await backend.stop()
  })

  it('GET / 返回手机页', async () => {
    const r = await fetch(base + '/')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/html')
    const html = await r.text()
    expect(html).toContain('局域网文件共享')
    expect(html).toContain('/api/list')
    expect(html).toContain('/api/upload')
  })

  it('GET /api/list：目录优先、相对路径、预览分类', async () => {
    const r = await fetch(base + '/api/list?path=')
    expect(r.status).toBe(200)
    const j = (await r.json()) as { ok: boolean; entries: Array<{ name: string; path: string; isDir: boolean; kind: string | null }> }
    expect(j.ok).toBe(true)
    expect(j.entries.map((e) => e.path)).toEqual(['sub', 'hello.txt', 'photo.png'])
    expect(j.entries[0].isDir).toBe(true)
    expect(j.entries.find((e) => e.name === 'photo.png')?.kind).toBe('image')
    expect(j.entries.find((e) => e.name === 'hello.txt')?.kind).toBe('text')

    const r2 = await fetch(base + '/api/list?path=sub')
    const j2 = (await r2.json()) as { entries: Array<{ path: string }> }
    expect(j2.entries.map((e) => e.path)).toEqual(['sub/deep.bin'])
  })

  it('GET /api/raw：全文与 Range 分片', async () => {
    const r = await fetch(base + '/api/raw?path=hello.txt')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/plain')
    expect(r.headers.get('content-disposition')).toContain('inline')
    expect(await r.text()).toBe('你好世界')

    const r2 = await fetch(base + '/api/raw?path=hello.txt', { headers: { Range: 'bytes=0-5' } })
    expect(r2.status).toBe(206)
    expect(r2.headers.get('content-range')).toBe('bytes 0-5/12') // '你好世界' UTF-8 共 12 字节
    expect((await r2.arrayBuffer()).byteLength).toBe(6)

    const r3 = await fetch(base + '/api/raw?path=photo.png')
    expect(r3.status).toBe(200)
    expect(Buffer.from(await r3.arrayBuffer()).equals(PNG_HEAD)).toBe(true)
  })

  it('路径穿越与不存在均被拦截', async () => {
    const evil = await fetch(base + '/api/raw?path=' + encodeURIComponent('../secret.txt'))
    expect(evil.status).toBe(400)
    const backslash = await fetch(base + '/api/raw?path=' + encodeURIComponent('a\\b'))
    expect(backslash.status).toBe(400)
    const missing = await fetch(base + '/api/raw?path=nope.txt')
    expect(missing.status).toBe(404)
  })

  it('GET /api/download：附件下载（RFC 5987 文件名）', async () => {
    const r = await fetch(base + '/api/download?path=hello.txt')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-disposition')).toContain(`attachment; filename="hello.txt"; filename*=UTF-8''hello.txt`)
    expect(await r.text()).toBe('你好世界')
  })

  it('GET /api/zip：多文件+目录打包可解压还原', async () => {
    const paths = encodeURIComponent(JSON.stringify(['hello.txt', 'sub']))
    const r = await fetch(base + '/api/zip?paths=' + paths)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/zip')
    const zip = readZip(Buffer.from(await r.arrayBuffer()))
    expect(zip.get('hello.txt')?.data.toString('utf8')).toBe('你好世界')
    expect(zip.get('sub/')?.isDir).toBe(true)
    expect(zip.get('sub/deep.bin')?.data.toString('utf8')).toBe('BINARYDATA-deep')
  })

  it('POST /api/upload：中文文件名落盘、重名自动加序号、上传到指定子目录', async () => {
    const boundary = '----gtoolstest'
    const data1 = Buffer.from([0xff, 0xfe, 0x01, 0x02, 0x0d, 0x0a, 0x33])
    const r1 = await fetch(base + '/api/upload?dir=sub', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: multipartBody(boundary, [{ name: '手机照片.jpg', data: data1 }])
    })
    expect(r1.status).toBe(200)
    const j1 = (await r1.json()) as { ok: boolean; saved: Array<{ name: string; size: number }> }
    expect(j1.saved).toEqual([{ name: '手机照片.jpg', size: data1.length }])
    expect(fake.files.get('/share/sub/手机照片.jpg')?.equals(data1)).toBe(true)

    const r2 = await fetch(base + '/api/upload?dir=sub', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: multipartBody(boundary, [
        { name: '手机照片.jpg', data: Buffer.from('same-name') },
        { name: 'note.txt', data: Buffer.from('上传到子目录') }
      ])
    })
    const j2 = (await r2.json()) as { saved: Array<{ name: string }> }
    expect(j2.saved.map((s) => s.name)).toEqual(['手机照片 (1).jpg', 'note.txt'])
    expect(fake.files.get('/share/sub/手机照片 (1).jpg')?.toString()).toBe('same-name')
    expect(fake.files.get('/share/sub/note.txt')?.toString()).toBe('上传到子目录')

    const r3 = await fetch(base + '/api/upload?dir=', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: multipartBody(boundary, [{ name: 'root.txt', data: Buffer.from('上传到根目录') }])
    })
    expect(r3.status).toBe(200)
    expect(fake.files.get('/share/root.txt')?.toString()).toBe('上传到根目录')

    // 上传后列表可见
    const ls = await fetch(base + '/api/list?path=sub')
    const jl = (await ls.json()) as { ok: boolean; entries: Array<{ path: string }> }
    expect(jl.entries.map((e) => e.path)).toContain('sub/手机照片.jpg')
  })

  it('设备登记与传输日志推送', async () => {
    const last = [...fake.emits].reverse().find((e) => e.event === 'state')
    expect(last).toBeDefined()
    const s = last!.payload as ShareState
    expect(s.devices.some((d) => d.ip === '127.0.0.1' && d.requests > 0)).toBe(true)
    const kinds = s.log.map((e) => e.kind)
    expect(kinds).toContain('connect')
    expect(kinds).toContain('download')
    expect(kinds).toContain('upload')
    expect(kinds).toContain('zip')
    // 上传触发系统通知（节流窗口内至少一次）
    expect(fake.notifications.length).toBeGreaterThanOrEqual(1)
    expect(fake.notifications[0].title).toBe('局域网文件共享')
  })

  it('stop 控制后端口关闭（退出插件即停止服务）', async () => {
    expect(fake.state()?.running).toBe(true)
    send('stop')
    await until(() => fake.state()?.running === false)
    await expect(fetch(base + '/')).rejects.toThrow()
    expect((fake.storageMap.get(STATE_KEY) as ShareState).running).toBe(false)
  })
})
