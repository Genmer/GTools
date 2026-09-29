import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { request } from 'node:http'
import { parseUtoolsManifest, scanUtoolsPlugins, createPluginServer, shimScript } from '../src/main/services/utools-compat'
import * as nodeFs from 'node:fs/promises'

const VALID_JSON = JSON.stringify({
  pluginName: '示例翻译',
  description: 'demo',
  version: '1.2.3',
  main: 'index.html',
  logo: 'logo.png',
  preload: 'preload.js',
  features: [
    { code: 'translate', explain: '翻译', cmds: ['翻译', 'fanyi'] },
    { code: 'regex-word', explain: '划词', cmds: [{ type: 'regex', label: '划词翻译' }, { type: 'over', label: '文本翻译' }] }
  ]
})

describe('parseUtoolsManifest', () => {
  it('合法清单归一化：对象型 cmds 取 label 并附注 type', () => {
    const r = parseUtoolsManifest(VALID_JSON)
    expect(r.ok).toBe(true)
    expect(r.manifest).toEqual({
      name: '示例翻译',
      description: 'demo',
      version: '1.2.3',
      main: 'index.html',
      logo: 'logo.png',
      preload: 'preload.js',
      features: [
        { code: 'translate', explain: '翻译', cmds: ['翻译', 'fanyi'] },
        { code: 'regex-word', explain: '划词', cmds: ['划词翻译', '文本翻译'], cmdTypes: ['regex', 'over'] }
      ]
    })
    expect(r.errors).toEqual([])
  })

  it('preload 字段透传（徽标依据）；缺省/空串时输出不含该键', () => {
    expect(parseUtoolsManifest(VALID_JSON).manifest?.preload).toBe('preload.js')
    for (const raw of [JSON.stringify({ pluginName: 'x', main: 'index.html' }), JSON.stringify({ pluginName: 'x', main: 'index.html', preload: '  ' })]) {
      const r = parseUtoolsManifest(raw)
      expect(r.ok).toBe(true)
      expect('preload' in (r.manifest ?? {})).toBe(false)
    }
  })

  it('缺 main 判废并报错', () => {
    const r = parseUtoolsManifest(JSON.stringify({ pluginName: 'x', main: '' }))
    expect(r.ok).toBe(false)
    expect(r.manifest).toBeUndefined()
    expect(r.errors.join()).toContain('main')
  })

  it('缺 pluginName 判废', () => {
    const r = parseUtoolsManifest(JSON.stringify({ main: 'index.html' }))
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('pluginName')
  })

  it('非法 JSON 判废', () => {
    const r = parseUtoolsManifest('{oops')
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('JSON')
  })

  it('缺 code 的 feature 剔除不整体判废；features 非数组仅报错', () => {
    const r = parseUtoolsManifest(
      JSON.stringify({
        pluginName: 'x',
        main: 'index.html',
        features: [{ explain: '无 code' }, 'bad', { code: 'ok', cmds: 'not-array' }, { code: 'ok2', cmds: ['good', 42] }]
      })
    )
    expect(r.ok).toBe(true)
    expect(r.manifest?.features).toEqual([
      { code: 'ok', explain: '', cmds: [] },
      { code: 'ok2', explain: '', cmds: ['good'] }
    ])
    expect(r.errors.length).toBe(4)
    expect(r.errors.join()).toContain('features[1]')
  })

  it('顶层非对象判废', () => {
    expect(parseUtoolsManifest('[1,2]').ok).toBe(false)
    expect(parseUtoolsManifest('null').ok).toBe(false)
  })
})

describe('parseUtoolsManifest 真实世界样例（doutu-uToolsPlugin）', () => {
  // 样例目录存在就读真实 plugin.json，否则退回等价内联样例（features.cmds 混合字符串与 {type:'over'} 对象）
  const REAL_PLUGIN_JSON = join('/tmp/uprobe/doutu-uToolsPlugin', 'plugin.json')
  const FALLBACK_JSON = JSON.stringify({
    pluginName: '斗图',
    description: '斗图表情搜索',
    homepage: 'https://github.com/vst93/doutu-uToolsPlugin',
    author: 'vst',
    main: 'index.html',
    logo: 'logo.jpg',
    version: '0.2.72',
    preload: 'preload.js',
    features: [{ code: 'dt', explain: '斗图', cmds: ['doutu', '斗图', { type: 'over', label: '斗图' }] }]
  })

  it('混合字符串与 over 对象的 cmds：归一化后 cmds 与 cmdTypes 按下标对齐，未知字段不干扰', async () => {
    let text: string
    try {
      text = await readFile(REAL_PLUGIN_JSON, 'utf-8')
    } catch {
      text = FALLBACK_JSON
    }
    const r = parseUtoolsManifest(text)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.manifest?.name).toBe('斗图')
    expect(r.manifest?.description).toBe('斗图表情搜索')
    expect(r.manifest?.main).toBe('index.html')
    expect(r.manifest?.logo).toBe('logo.jpg')
    expect(r.manifest?.version).toBe('0.2.72')
    const f = r.manifest?.features[0]
    expect(f?.code).toBe('dt')
    expect(f?.explain).toBe('斗图')
    expect(f?.cmds).toEqual(['doutu', '斗图', '斗图'])
    // cmdTypes 与 cmds 同长且按下标对齐：字符串型为 undefined，对象型取原始 type
    expect(f?.cmdTypes).toHaveLength(f!.cmds.length)
    expect(f?.cmdTypes?.[0]).toBeUndefined()
    expect(f?.cmdTypes?.[1]).toBeUndefined()
    expect(f?.cmdTypes?.[2]).toBe('over')
  })
})

describe('scanUtoolsPlugins', () => {
  let dir = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'utools-scan-'))
    await mkdir(join(dir, 'good'))
    await writeFile(join(dir, 'good', 'plugin.json'), VALID_JSON)
    await mkdir(join(dir, 'bad-json'))
    await writeFile(join(dir, 'bad-json', 'plugin.json'), '{oops')
    await mkdir(join(dir, 'no-json'))
    await writeFile(join(dir, 'a-file.txt'), 'not a dir')
    await mkdir(join(dir, '.hidden'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('扫描一级子目录：清单好的带 manifest，坏目录记原因不炸', async () => {
    const r = await scanUtoolsPlugins(dir, nodeFs)
    expect(r.map((e) => e.id)).toEqual(['bad-json', 'good', 'no-json'])
    const good = r.find((e) => e.id === 'good')
    expect(good?.manifest?.name).toBe('示例翻译')
    expect(r.find((e) => e.id === 'bad-json')?.error).toContain('JSON')
    expect(r.find((e) => e.id === 'no-json')?.error).toContain('plugin.json')
  })

  it('目录不存在返回空数组', async () => {
    expect(await scanUtoolsPlugins(join(dir, 'nonexistent'), nodeFs)).toEqual([])
  })
})

describe('createPluginServer', () => {
  let root = ''
  let handle: Awaited<ReturnType<typeof createPluginServer>> | null = null
  let base = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'utools-serve-'))
    await mkdir(join(root, 'demo'))
    await writeFile(join(root, 'demo', 'index.html'), '<html><head><title>t</title></head><body>hi</body></html>')
    await writeFile(join(root, 'demo', 'style.css'), 'body{}')
    await writeFile(join(root, 'demo', 'data.json'), '{"a":1}')
    await writeFile(join(root, 'demo', 'blob.bin'), 'x')
    await writeFile(join(root, 'demo', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]))
    // deep path / 查询串用例的夹具
    await mkdir(join(root, 'demo', 'assets'), { recursive: true })
    await writeFile(join(root, 'demo', 'assets', 'emoji.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02]))
    await mkdir(join(root, 'demo', 'views', 'sub'), { recursive: true })
    await writeFile(join(root, 'demo', 'views', 'sub', 'page.html'), '<html><head></head><body>deep</body></html>')
    // 越界目标：故意放在插件目录之外
    await writeFile(join(root, 'secret.txt'), 'TOP-SECRET')
    handle = await createPluginServer({ rootDir: root, fsLike: nodeFs })
    handle.setPlugins({ demo: 'index.html' })
    base = `http://127.0.0.1:${handle.port}`
  })
  afterAll(async () => {
    await handle?.close()
    await rm(root, { recursive: true, force: true })
  })

  it('根路径 302 到 main 文件', async () => {
    const res = await fetch(`${base}/demo/`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/demo/index.html')
  })

  it('静态文件按扩展名给 MIME，未知扩展名走 octet-stream', async () => {
    const css = await fetch(`${base}/demo/style.css`)
    expect(css.status).toBe(200)
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8')
    const json = await fetch(`${base}/demo/data.json`)
    expect(json.headers.get('content-type')).toBe('application/json; charset=utf-8')
    const bin = await fetch(`${base}/demo/blob.bin`)
    expect(bin.headers.get('content-type')).toBe('application/octet-stream')
  })

  it('HTML 响应注入 shim 脚本标签（</head> 前）', async () => {
    const res = await fetch(`${base}/demo/index.html`)
    const body = await res.text()
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(body).toBe('<html><head><title>t</title><script src="/demo/__gtools-shim.js"></script></head><body>hi</body></html>')
  })

  it('二进制文件原样返回、不被注入', async () => {
    const res = await fetch(`${base}/demo/logo.png`)
    expect(res.headers.get('content-type')).toBe('image/png')
    const buf = Buffer.from(await res.arrayBuffer())
    expect([...buf]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x01])
  })

  it('__gtools-shim.js 可取且为 JS', async () => {
    const res = await fetch(`${base}/demo/__gtools-shim.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await res.text()).toBe(shimScript())
  })

  it('路径穿越被拒：编码斜杠越界 403，点段归一化后未知插件 404，插件外文件不泄露', async () => {
    const encoded = await fetch(`${base}/demo/%2e%2e%2fsecret.txt`)
    expect(encoded.status).toBe(403)
    const dots = await fetch(`${base}/demo/../secret.txt`)
    expect(dots.status).toBe(404)
    // 原始路径直发（绕过客户端 URL 归一化）同样不许 200
    const raw = await new Promise<number>((resolve) => {
      request({ host: '127.0.0.1', port: handle!.port, path: '/demo/..%2fsecret.txt' }, (r) => {
        r.resume()
        r.on('end', () => resolve(r.statusCode ?? 0))
      }).end()
    })
    expect(raw).not.toBe(200)
  })

  it('未知插件 id 404', async () => {
    const res = await fetch(`${base}/nosuch/index.html`)
    expect(res.status).toBe(404)
  })

  it('插件目录内 symlink 指向目录外文件/目录被拒（真实路径越界判定），目录内链接不受影响', async () => {
    await mkdir(join(root, 'outside'))
    await writeFile(join(root, 'outside', 'inner.txt'), 'OUTER')
    await symlink(join(root, 'secret.txt'), join(root, 'demo', 'link.txt'))
    await symlink(join(root, 'outside'), join(root, 'demo', 'linkdir'))
    expect((await fetch(`${base}/demo/link.txt`)).status).toBe(403)
    expect((await fetch(`${base}/demo/linkdir/inner.txt`)).status).toBe(403)
    // 对照：指向插件目录内部的真实路径照常服务
    await writeFile(join(root, 'demo', 'real.txt'), 'ok')
    await symlink(join(root, 'demo', 'real.txt'), join(root, 'demo', 'alias.txt'))
    const alias = await fetch(`${base}/demo/alias.txt`)
    expect(alias.status).toBe(200)
    expect(await alias.text()).toBe('ok')
  })

  it('子目录 deep path 可服务：字节与 MIME 正确，HTML 照常注入 shim', async () => {
    const png = await fetch(`${base}/demo/assets/emoji.png`)
    expect(png.status).toBe(200)
    expect(png.headers.get('content-type')).toBe('image/png')
    expect([...Buffer.from(await png.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x02])
    const page = await fetch(`${base}/demo/views/sub/page.html`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await page.text()).toContain('__gtools-shim.js')
  })

  it('URL 查询串被忽略：按 pathname 命中文件', async () => {
    const res = await fetch(`${base}/demo/style.css?v=2&t=x%20y`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/css; charset=utf-8')
    expect(await res.text()).toBe('body{}')
  })

  it('HEAD 请求：响应头与 GET 一致、无响应体', async () => {
    const head = await fetch(`${base}/demo/index.html`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await head.text()).toBe('')
    const shimHead = await fetch(`${base}/demo/__gtools-shim.js`, { method: 'HEAD' })
    expect(shimHead.status).toBe(200)
    expect(shimHead.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await shimHead.text()).toBe('')
  })

  it('非 GET/HEAD 方法一律 405', async () => {
    expect((await fetch(`${base}/demo/index.html`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${base}/demo/index.html`, { method: 'PUT' })).status).toBe(405)
  })

  it('close 后端口释放', async () => {
    const h = await createPluginServer({ rootDir: root, fsLike: nodeFs })
    h.setPlugins({})
    const port = h.port
    await h.close()
    await expect(fetch(`http://127.0.0.1:${port}/x/`)).rejects.toThrow()
  })
})

describe('shimScript', () => {
  it('包含白名单 API 与桥协议关键标记', () => {
    const s = shimScript()
    for (const key of ['onPluginEnter', 'onPluginOut', 'copyText', 'notify', 'hideMainWindow', 'gtools-utools-shim', 'gtools-utools-host', 'gtools:enter', 'gtools:out']) {
      expect(s).toContain(key)
    }
  })

  it('是合法 JS：new Function 编译不抛', () => {
    expect(() => new Function(shimScript())).not.toThrow()
  })

  it('沙箱执行后定义恰好 5 个白名单成员的 frozen window.utools', () => {
    const fakeWindow: { utools?: Record<string, unknown>; addEventListener: () => void } = { addEventListener: () => {} }
    runInContext(shimScript(), createContext({ window: fakeWindow }))
    const u = fakeWindow.utools
    expect(Object.keys(u ?? {}).sort()).toEqual(['copyText', 'hideMainWindow', 'notify', 'onPluginEnter', 'onPluginOut'])
    expect(Object.isFrozen(u)).toBe(true)
  })

  it('无 require / Node 全局残留', () => {
    const s = shimScript()
    for (const bad of [/\brequire\b/, /\bimport\b/, /\bprocess\b/, /\bBuffer\b/, /\bmodule\b/, /\bglobalThis\b/, /__dirname/, /__filename/]) {
      expect(s).not.toMatch(bad)
    }
  })
})
