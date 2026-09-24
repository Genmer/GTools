/** ShareServer 直连边界用例：体积上限（413）、参数非法（400）、404/204 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer as createNodeServer, type Server as NodeServer } from 'node:http'
import { createCtxShareFs } from '../../../../src/plugins/lan-file-share/backend/index'
import { ShareServer, type ServerRequest, type ServerResponse } from '../../../../src/plugins/lan-file-share/backend/server'
import type { LogKind } from '../../../../src/plugins/lan-file-share/shared'
import { createFakeCtx } from './fake-ctx'

const fake = createFakeCtx({
  '/share/big.txt': 'x'.repeat(30), // 超过 maxServeBytes=10
  '/share/s1.bin': 'a'.repeat(30),
  '/share/s2.bin': 'b'.repeat(30),
  '/share/small.txt': 'hi'
})

const logs: Array<{ kind: LogKind; device: string }> = []
const server = new ShareServer({
  fs: createCtxShareFs(fake.ctx),
  rootDir: '/share',
  now: () => Date.parse('2026-09-24T08:00:00Z'),
  maxBodyBytes: 60,
  maxServeBytes: 10,
  maxZipBytes: 40,
  deflate: (b) => b,
  device: () => ({ label: '测试设备', isNew: false }),
  onLog: (e) => logs.push({ kind: e.kind, device: e.device })
})

let nodeServer: NodeServer
let base = ''

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      nodeServer = createNodeServer((req, res) => server.handle(req as unknown as ServerRequest, res as unknown as ServerResponse))
      nodeServer.listen(0, '127.0.0.1', () => {
        const addr = nodeServer.address()
        base = `http://127.0.0.1:${typeof addr === 'object' && addr !== null ? addr.port : 0}`
        resolve()
      })
    })
)

afterAll(
  () =>
    new Promise<void>((resolve) => {
      nodeServer.closeAllConnections?.()
      nodeServer.close(() => resolve())
    })
)

function multipart(boundary: string, filename: string, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n\r\n`,
      'utf8'
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ])
}

describe('ShareServer 边界', () => {
  it('单文件超 maxServeBytes → 413', async () => {
    const r = await fetch(base + '/api/raw?path=big.txt')
    expect(r.status).toBe(413)
    expect(await r.text()).toContain('单文件上限')
  })

  it('打包总量超 maxZipBytes → 413', async () => {
    const r = await fetch(base + '/api/zip?paths=' + encodeURIComponent(JSON.stringify(['s1.bin', 's2.bin'])))
    expect(r.status).toBe(413)
  })

  it('上传体积超 maxBodyBytes → 413（JSON 错误）', async () => {
    const r = await fetch(base + '/api/upload?dir=', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=BB' },
      body: multipart('BB', 'big.bin', Buffer.alloc(100, 7))
    })
    expect(r.status).toBe(413)
    const j = (await r.json()) as { ok: boolean; error: string }
    expect(j.ok).toBe(false)
    expect(j.error).toContain('上限')
  })

  it('非 multipart 上传 → 400；zip 参数非法 → 400', async () => {
    const r = await fetch(base + '/api/upload?dir=', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })
    expect(r.status).toBe(400)
    const bad1 = await fetch(base + '/api/zip?paths=not-json')
    expect(bad1.status).toBe(400)
    const bad2 = await fetch(base + '/api/zip?paths=' + encodeURIComponent('[]'))
    expect(bad2.status).toBe(400)
    const bad3 = await fetch(base + '/api/zip?paths=' + encodeURIComponent('[123]'))
    expect(bad3.status).toBe(400)
  })

  it('未知接口 404；favicon 204；正常小文件可下', async () => {
    expect((await fetch(base + '/api/unknown')).status).toBe(404)
    expect((await fetch(base + '/favicon.ico')).status).toBe(204)
    const ok = await fetch(base + '/api/raw?path=small.txt')
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('hi')
  })
})
