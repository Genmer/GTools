import { describe, expect, it } from 'vitest'
import {
  ImageBedError,
  autoDetectUrl,
  getPath,
  parseLsky,
  parseSmms,
  resolveUploadTarget,
  uploadImage
} from '../../../../src/plugins/image-bed/logic/providers'
import type { FetchFn } from '../../../../src/plugins/image-bed/logic/providers'
import { base64ToBytes } from '../../../../src/plugins/image-bed/logic/base64'
import { normalizeImageBedSettings } from '../../../../src/plugins/image-bed/logic/settings'
import type { ImageBedSettings } from '../../../../src/plugins/image-bed/logic/settings'
import type { HostFetchInit, HostFetchResult } from '@sdk/api'

function settings(patch: Record<string, unknown> = {}): ImageBedSettings {
  return normalizeImageBedSettings(patch)
}

interface CapturedCall {
  url: string
  init: HostFetchInit | undefined
}

function fakeFetch(result: HostFetchResult | Error, box: CapturedCall[]): FetchFn {
  return async (url, init): Promise<HostFetchResult> => {
    box.push({ url, init })
    if (result instanceof Error) throw result
    return result
  }
}

function ok(body: unknown): HostFetchResult {
  return { ok: true, status: 200, body: JSON.stringify(body) }
}

function multipartText(init: HostFetchInit | undefined): string {
  const b64 = typeof init?.body === 'object' ? init.body.base64 : ''
  let s = ''
  for (const b of base64ToBytes(b64)) s += String.fromCharCode(b)
  return s
}

describe('resolveUploadTarget', () => {
  it('sm.ms：固定端点 + smfile 字段，匿名无鉴权头、有 token 用 Basic', () => {
    const anon = resolveUploadTarget(settings())
    expect(anon).toMatchObject({ url: 'https://sm.ms/api/v2/upload', fileField: 'smfile' })
    expect(anon.headers).toEqual({})
    const authed = resolveUploadTarget(settings({ smmsToken: 'tok' }))
    expect(authed.headers).toEqual({ Authorization: 'Basic tok' })
  })

  it('lsky：校验地址与 token，端点拼接 + Bearer + data.links.url', () => {
    expect(() => resolveUploadTarget(settings({ providerId: 'lsky' }))).toThrow(ImageBedError)
    expect(() => resolveUploadTarget(settings({ providerId: 'lsky', lskyApiUrl: 'https://a.com' }))).toThrow(/Token/)
    const t = resolveUploadTarget(settings({ providerId: 'lsky', lskyApiUrl: 'https://a.com/', lskyToken: 'tk' }))
    expect(t).toMatchObject({ url: 'https://a.com/api/v1/upload', fileField: 'file', urlPath: 'data.links.url' })
    expect(t.headers).toEqual({ Authorization: 'Bearer tk' })
  })

  it('custom：非法地址抛 config，鉴权四态', () => {
    expect(() => resolveUploadTarget(settings({ providerId: 'custom' }))).toThrow(ImageBedError)
    expect(() => resolveUploadTarget(settings({ providerId: 'custom', custom: { apiUrl: 'javascript:alert(1)' } }))).toThrow(/http/)
    const raw = resolveUploadTarget(settings({ providerId: 'custom', custom: { apiUrl: 'https://b.com/up', authScheme: 'raw', token: 'T' } }))
    expect(raw.headers).toEqual({ Authorization: 'T' })
    const none = resolveUploadTarget(settings({ providerId: 'custom', custom: { apiUrl: 'https://b.com/up', authScheme: 'none', token: 'T' } }))
    expect(none.headers).toEqual({})
    expect(none.fileField).toBe('file')
  })
})

describe('响应解析', () => {
  it('parseSmms：成功取 data.url/delete，重复图取 images 字符串', () => {
    expect(parseSmms({ success: true, code: 'success', data: { url: 'https://s2.loli.net/a.png', delete: 'https://sm.ms/api/v2/del/x' } })).toEqual({
      url: 'https://s2.loli.net/a.png',
      deleteUrl: 'https://sm.ms/api/v2/del/x'
    })
    expect(parseSmms({ success: false, code: 'image_repeated', images: 'https://s2.loli.net/b.png' })).toEqual({ url: 'https://s2.loli.net/b.png' })
    expect(parseSmms({ success: false, code: 'image_repeated', images: 'not-url' })).toBeNull()
    expect(parseSmms({ success: true, data: { url: 42 } })).toBeNull()
  })

  it('parseLsky：status true 取 data.links.url（或 data.url 兜底）', () => {
    expect(parseLsky({ status: true, data: { links: { url: 'https://c.com/i.png' } } })).toEqual({ url: 'https://c.com/i.png' })
    expect(parseLsky({ status: true, data: { url: 'https://c.com/i2.png' } })).toEqual({ url: 'https://c.com/i2.png' })
    expect(parseLsky({ status: false, message: 'Unauthorized' })).toBeNull()
  })

  it('getPath 点分路径（数组下标），autoDetectUrl 常见结构优先', () => {
    expect(getPath({ data: { list: [{ url: 'https://x/1' }] } }, 'data.list.0.url')).toBe('https://x/1')
    expect(getPath({ a: 1 }, 'b.c')).toBeUndefined()
    expect(autoDetectUrl({ data: { links: { url: 'https://x/2' } } })).toBe('https://x/2')
    expect(autoDetectUrl({ nested: { deep: { arr: [{ name: 'n', link: 'https://x/3' }] } } })).toBe('https://x/3')
    expect(autoDetectUrl({ nothing: 'here' })).toBeNull()
  })
})

describe('uploadImage', () => {
  const input = { filename: '截图 01.png', contentType: 'image/png', base64: Buffer.from('PNGRAW').toString('base64') }

  it('sm.ms 成功：multipart 字段 smfile、鉴权头、中文名 ASCII 降级，返回 url', async () => {
    const box: CapturedCall[] = []
    const res = await uploadImage(
      input,
      settings({ smmsToken: 'tok' }),
      fakeFetch(ok({ success: true, code: 'success', data: { url: 'https://s2.loli.net/ok.png', delete: 'https://sm.ms/del/1' } }), box)
    )
    expect(res).toEqual({ url: 'https://s2.loli.net/ok.png', deleteUrl: 'https://sm.ms/del/1', providerId: 'smms' })
    expect(box[0].url).toBe('https://sm.ms/api/v2/upload')
    expect(box[0].init?.method).toBe('POST')
    expect(box[0].init?.headers?.Authorization).toBe('Basic tok')
    expect(box[0].init?.headers?.['Content-Type']).toMatch(/^multipart\/form-data; boundary=/)
    const body = multipartText(box[0].init)
    expect(body).toContain('name="smfile"; filename="-- 01.png"')
    expect(body).toContain('Content-Type: image/png')
    expect(body).toContain('PNGRAW')
  })

  it('sm.ms 重复图：code=image_repeated 时 images 即 URL', async () => {
    const res = await uploadImage(input, settings(), fakeFetch(ok({ success: false, code: 'image_repeated', images: 'https://s2.loli.net/dup.png' }), []))
    expect(res.url).toBe('https://s2.loli.net/dup.png')
  })

  it('lsky 成功走配置端点与 Bearer', async () => {
    const box: CapturedCall[] = []
    const res = await uploadImage(
      input,
      settings({ providerId: 'lsky', lskyApiUrl: 'https://ls.a.com', lskyToken: 'tk' }),
      fakeFetch(ok({ status: true, data: { links: { url: 'https://ls.a.com/i/x.png' } } }), box)
    )
    expect(res.url).toBe('https://ls.a.com/i/x.png')
    expect(box[0].url).toBe('https://ls.a.com/api/v1/upload')
    expect(box[0].init?.headers?.Authorization).toBe('Bearer tk')
    expect(multipartText(box[0].init)).toContain('name="file"')
  })

  it('custom：urlPath 命中与留空自动探测', async () => {
    const withPath = await uploadImage(
      input,
      settings({ providerId: 'custom', custom: { apiUrl: 'https://d.com/up', urlPath: 'result.image.0.link' } }),
      fakeFetch(ok({ result: { image: [{ link: 'https://d.com/found.png' }] } }), [])
    )
    expect(withPath.url).toBe('https://d.com/found.png')
    const auto = await uploadImage(
      input,
      settings({ providerId: 'custom', custom: { apiUrl: 'https://d.com/up' } }),
      fakeFetch(ok({ data: { whatever: { url: 'https://d.com/auto.png' } } }), [])
    )
    expect(auto.url).toBe('https://d.com/auto.png')
  })

  it('错误分类：401/403 auth、429 server、500 http、超时/断网 network、坏 JSON parse、业务失败 server', async () => {
    const cases: Array<{ res: HostFetchResult | Error; kind: string; re?: RegExp }> = [
      { res: { ok: false, status: 401, body: '{}' }, kind: 'auth' },
      { res: { ok: false, status: 403, body: '' }, kind: 'auth' },
      { res: { ok: false, status: 429, body: '' }, kind: 'server', re: /429/ },
      { res: { ok: false, status: 500, body: 'oops' }, kind: 'http', re: /500/ },
      { res: new Error('Request timed out'), kind: 'timeout' },
      { res: new Error('net down'), kind: 'network' },
      { res: { ok: true, status: 200, body: '<html>not json</html>' }, kind: 'parse' },
      { res: ok({ success: false, code: 'error', message: '文件类型不允许' }), kind: 'server', re: /文件类型不允许/ }
    ]
    for (const c of cases) {
      await expect(uploadImage(input, settings(), fakeFetch(c.res, []))).rejects.toMatchObject({ kind: c.kind })
      if (c.re !== undefined) {
        await expect(uploadImage(input, settings(), fakeFetch(c.res, []))).rejects.toThrow(c.re)
      }
    }
  })

  it('sm.ms 匿名 401 的提示包含取 Token 引导', async () => {
    await expect(uploadImage(input, settings(), fakeFetch({ ok: false, status: 401, body: '' }, []))).rejects.toThrow(/API Token/)
  })

  it('配置缺失在上传前即抛（不发网络请求）', async () => {
    const box: CapturedCall[] = []
    await expect(uploadImage(input, settings({ providerId: 'lsky' }), fakeFetch(ok({}), box))).rejects.toMatchObject({ kind: 'config' })
    expect(box).toHaveLength(0)
  })
})
