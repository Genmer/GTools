// 六家厂商 executor 单测：请求黄金值（固定凭证/时间戳/salt，按官方规则独立算出后硬编码）
// + 测试内用与 executor 不同的组装路径复算交叉验证；错误码表逐条 kind 断言；空凭证 fail-fast。
// fetch 一律注入 fake，不发真实网络。黄金值由一次性脚本 scripts/gen-golden-providers.mjs 生成（自生成双路径交叉，脚本已删）。
import { describe, expect, it } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import type { HostFetchInit, HostFetchResult } from '@sdk/api'
import type { ApiProviderConfig } from '../src/main/services/api-center/types'
import {
  buildBaiduForm,
  baiduLang,
  baiduSign,
  executeBaidu,
  parseBaiduBody
} from '../src/main/services/api-center/executors/baidu'
import {
  buildDeeplRequest,
  deeplEndpoint,
  deeplHttpError,
  deeplLang,
  executeDeepl,
  parseDeeplBody
} from '../src/main/services/api-center/executors/deepl'
import {
  buildHunyuanRequest,
  executeHunyuan,
  hunyuanHttpError,
  parseHunyuanBody,
  stripHunyuanChatter
} from '../src/main/services/api-center/executors/hunyuan'
import {
  buildIflytekBody,
  buildIflytekUrl,
  executeIflytek,
  iflytekAuthorization,
  iflytekLang,
  iflytekSignature,
  parseIflytekBody
} from '../src/main/services/api-center/executors/iflytek'
import {
  buildVolcanoRequest,
  executeVolcano,
  parseVolcanoBody,
  volcanoCanonicalRequest,
  volcanoLang,
  volcanoSigningKey,
  volcanoXDate,
  buildVolcanoBody
} from '../src/main/services/api-center/executors/volcano'
import {
  buildYoudaoForm,
  executeYoudao,
  parseYoudaoBody,
  youdaoLang,
  youdaoSign,
  youdaoSignInput
} from '../src/main/services/api-center/executors/youdao'
import { TranslateExecutorError, type FetchFn } from '../src/main/services/api-center/executors/types'

const okBody = (body: string): HostFetchResult => ({ ok: true, status: 200, body })
const httpErr = (status: number, body = ''): HostFetchResult => ({ ok: false, status, body })

function recordingFetch(
  respond: (url: string, init?: HostFetchInit) => HostFetchResult
): { fn: FetchFn; calls: { url: string; init?: HostFetchInit }[] } {
  const calls: { url: string; init?: HostFetchInit }[] = []
  const fn = async (url: string, init?: HostFetchInit): Promise<HostFetchResult> => {
    calls.push({ url, init })
    return respond(url, init)
  }
  return { fn, calls }
}

async function rejectKind(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return '(resolved)'
  } catch (e) {
    expect(e).toBeInstanceOf(TranslateExecutorError)
    return (e as TranslateExecutorError).kind
  }
}

function rejectKindFn(f: () => unknown): string {
  try {
    f()
    return '(no-throw)'
  } catch (e) {
    expect(e).toBeInstanceOf(TranslateExecutorError)
    return (e as TranslateExecutorError).kind
  }
}

const rt = (fn: FetchFn, timeoutMs?: number) => ({ fetch: fn, timeoutMs })
const TEXT = 'Hello, 世界！'
const LONG_TEXT = '这是一段用于测试签名规则的较长文本，超过二十个字符'
const en2zh = { text: TEXT, from: 'en', to: 'zh-CN' }

function provider(type: ApiProviderConfig['type'], secrets?: Record<string, string>): ApiProviderConfig {
  return { id: `u-${type}`, type, name: type, enabled: true, secrets }
}

// ---------- DeepL ----------

describe('DeepL executor', () => {
  it('黄金值：免费密钥(:fx)走免费端点，Pro 密钥走 Pro 端点；headers/body 逐字段断言', () => {
    const free = buildDeeplRequest(en2zh, 'test-key:fx')
    expect(free.url).toBe('https://api-free.deepl.com/v2/translate')
    expect(free.init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'DeepL-Auth-Key test-key:fx'
    })
    expect(free.init.body).toBe('{"text":["Hello, 世界！"],"target_lang":"ZH","source_lang":"EN"}')
    const pro = buildDeeplRequest(en2zh, 'test-key-pro-123')
    expect(pro.url).toBe('https://api.deepl.com/v2/translate')
    expect(pro.init.body).toBe('{"text":["Hello, 世界！"],"target_lang":"ZH","source_lang":"EN"}')
    // 交叉：黄金值端点规则与语言映射独立复算
    expect(deeplEndpoint('test-key:fx')).toBe('https://api-free.deepl.com/v2/translate')
    expect(deeplEndpoint('abc')).toBe('https://api.deepl.com/v2/translate')
    expect(deeplLang('zh-CN')).toBe('ZH')
    expect(deeplLang('zh-TW')).toBe('ZH-Hant')
    expect(deeplLang('en')).toBe('EN')
    expect(deeplLang('xx')).toBe('XX')
  })

  it('from=auto 时省略 source_lang；语种映射 ZH/ZH-Hant', () => {
    const r = buildDeeplRequest({ text: TEXT, from: 'auto', to: 'zh-TW' }, 'k:fx')
    expect(JSON.parse(r.init.body as string)).toEqual({ text: [TEXT], target_lang: 'ZH-Hant' })
  })

  it('parse：translations[0].text；缺字段/坏 JSON 归 parse', () => {
    expect(parseDeeplBody('{"translations":[{"text":"你好"}]}')).toBe('你好')
    expect(rejectKindFn(() => parseDeeplBody('{"translations":[]}'))).toBe('parse')
    expect(rejectKindFn(() => parseDeeplBody('oops'))).toBe('parse')
  })

  it('HTTP 错误分类：401/403→auth、429/456→quota、500→http、400→config，body message 附进文案', () => {
    expect(deeplHttpError(401, '{"message":"Wrong auth key"}').kind).toBe('auth')
    expect(deeplHttpError(401, '{"message":"Wrong auth key"}').message).toContain('Wrong auth key')
    expect(deeplHttpError(403, '{}').kind).toBe('auth')
    expect(deeplHttpError(429, '{}').kind).toBe('quota')
    expect(deeplHttpError(456, '{}').kind).toBe('quota')
    expect(deeplHttpError(500, '{}').kind).toBe('http')
    expect(deeplHttpError(400, 'not-json').kind).toBe('config')
  })

  it('execute：黄金请求透传 + 200 解析；空凭证 fail-fast（零网络）', async () => {
    const { fn, calls } = recordingFetch(() => okBody('{"translations":[{"text":"你好，世界！"}]}'))
    const out = await executeDeepl(en2zh, rt(fn), provider('deepl', { authKey: 'test-key:fx' }))
    expect(out).toEqual({ resultText: '你好，世界！', providerId: 'u-deepl' })
    expect(calls[0]?.url).toBe('https://api-free.deepl.com/v2/translate')
    expect(calls[0]?.init?.headers?.Authorization).toBe('DeepL-Auth-Key test-key:fx')

    const none = recordingFetch(() => okBody('{}'))
    expect(await rejectKind(executeDeepl(en2zh, rt(none.fn), provider('deepl')))).toBe('config')
    expect(none.calls).toHaveLength(0)
  })
})

// ---------- 百度 ----------

describe('百度 executor', () => {
  const secrets = { appId: '2026010100112233', secretKey: 'test_secret_0123456789' }
  const SALT = 'deadbeefdeadbeef'

  it('黄金值：sign=md5hex(appId+原文+salt+secretKey)，表单字段齐全（URLSearchParams 序列化）', () => {
    // 交叉：测试内用独立拼接路径复算（不经 baiduSign）
    const expectSign = createHash('md5').update(`${secrets.appId}${TEXT}${SALT}${secrets.secretKey}`, 'utf8').digest('hex')
    expect(expectSign).toBe('c1d74ebeffe6d64156e1ac7f5d0f6362')
    expect(baiduSign(secrets.appId, TEXT, SALT, secrets.secretKey)).toBe(expectSign)
    const form = buildBaiduForm(en2zh, secrets, SALT)
    expect(form.get('q')).toBe(TEXT)
    expect(form.get('from')).toBe('en')
    expect(form.get('to')).toBe('zh')
    expect(form.get('appid')).toBe(secrets.appId)
    expect(form.get('salt')).toBe(SALT)
    expect(form.get('sign')).toBe(expectSign)
    expect(form.toString()).toBe(
      'q=Hello%2C+%E4%B8%96%E7%95%8C%EF%BC%81&from=en&to=zh&appid=2026010100112233&salt=deadbeefdeadbeef&sign=' + expectSign
    )
  })

  it('语种映射：zh-CN→zh、zh-TW→cht、ja→jp、ko→kor、fr→fra、es→spa、vi→vie、pt/it/ar 同码', () => {
    expect(baiduLang('zh-CN')).toBe('zh')
    expect(baiduLang('zh-TW')).toBe('cht')
    expect(baiduLang('ja')).toBe('jp')
    expect(baiduLang('ko')).toBe('kor')
    expect(baiduLang('fr')).toBe('fra')
    expect(baiduLang('es')).toBe('spa')
    expect(baiduLang('th')).toBe('th')
    expect(baiduLang('vi')).toBe('vie')
    expect(baiduLang('pt')).toBe('pt')
    expect(baiduLang('it')).toBe('it')
    expect(baiduLang('ar')).toBe('ar')
  })

  it('parse：trans_result 多行 join；错误码表逐条 kind 断言', () => {
    expect(parseBaiduBody('{"trans_result":[{"dst":"你"},{"dst":"好"}]}')).toBe('你\n好')
    // 多行含空行：空 dst 段过滤后只拼非空段，不再整体落「未知错误」；全空段走错误分支
    expect(parseBaiduBody('{"trans_result":[{"dst":"第一行"},{"dst":""},{"dst":"第三行"}]}')).toBe('第一行\n第三行')
    expect(rejectKindFn(() => parseBaiduBody('{"trans_result":[{"dst":""}]}'))).not.toBe('(no-throw)')
    const codes: [string, string][] = [
      ['52001', 'http'],
      ['52002', 'http'],
      ['52003', 'auth'],
      ['54000', 'config'],
      ['54001', 'auth'],
      ['54003', 'quota'],
      ['54004', 'quota'],
      ['54005', 'quota'],
      ['58000', 'config'],
      ['58001', 'config'],
      ['58002', 'auth'],
      ['90107', 'auth'],
      ['59999', 'http'] // 未知码兜底
    ]
    for (const [code, kind] of codes) {
      expect(rejectKindFn(() => parseBaiduBody(`{"error_code":"${code}","error_msg":"x"}`))).toBe(kind)
    }
    try {
      parseBaiduBody('{"error_code":"54001","error_msg":"Invalid Sign"}')
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).toContain('Invalid Sign')
      // 54001 专属排查提示（密钥复制不完整/与 APP ID 填反）
      expect((e as Error).message).toContain('整段重新复制')
    }
  })

  it('execute：POST form-urlencoded、sign 与 salt 同值；缺任一凭证 fail-fast（零网络）', async () => {
    const { fn, calls } = recordingFetch(() => okBody('{"trans_result":[{"dst":"你好，世界！"}]}'))
    const out = await executeBaidu(en2zh, rt(fn), provider('baidu', secrets))
    expect(out).toEqual({ resultText: '你好，世界！', providerId: 'u-baidu' })
    expect(calls[0]?.url).toBe('https://fanyi-api.baidu.com/api/trans/vip/translate')
    expect(calls[0]?.init?.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' })
    const body = calls[0]?.init?.body as string
    expect(body).toContain('salt=')
    const salt = new URLSearchParams(body).get('salt') ?? ''
    expect(salt).toMatch(/^[0-9a-f]{16}$/)
    expect(new URLSearchParams(body).get('sign')).toBe(baiduSign(secrets.appId, TEXT, salt, secrets.secretKey))

    for (const bad of [{ appId: 'x' } as Record<string, string>, { secretKey: 'x' } as Record<string, string>, undefined]) {
      const none = recordingFetch(() => okBody('{}'))
      expect(await rejectKind(executeBaidu(en2zh, rt(none.fn), provider('baidu', bad)))).toBe('config')
      expect(none.calls).toHaveLength(0)
    }
  })
})

// ---------- 有道 ----------

describe('有道 executor', () => {
  const secrets = { appKey: 'testAppKey123', appSecret: 'testAppSecret456' }
  const SALT = '9876543210fedcba'
  const CURTIME = '1760000000'

  it('黄金值：v3 签名 input 规则（≤20 原文 / >20 前10+长度+后10），sign=sha256hex(五段拼接)', () => {
    // 交叉：独立复算（字符串手动拼接，不经 youdaoSign/youdaoSignInput）
    const manualInput = LONG_TEXT.length <= 20 ? LONG_TEXT : LONG_TEXT.substring(0, 10) + `${LONG_TEXT.length}` + LONG_TEXT.substring(LONG_TEXT.length - 10)
    const manualSign = createHash('sha256').update([secrets.appKey, manualInput, SALT, CURTIME, secrets.appSecret].join(''), 'utf8').digest('hex')
    expect(manualSign).toBe('08cc75e59e4305825ebc21f4eda2b3eae66f73e087c432e64feb679e9560c4d4')
    expect(youdaoSignInput(LONG_TEXT)).toBe(manualInput)
    expect(youdaoSignInput('short')).toBe('short')
    expect(youdaoSign(secrets.appKey, LONG_TEXT, SALT, CURTIME, secrets.appSecret)).toBe(manualSign)
    const form = buildYoudaoForm({ text: LONG_TEXT, from: 'zh-CN', to: 'en' }, secrets, SALT, CURTIME)
    expect(form.get('signType')).toBe('v3')
    expect(form.get('curtime')).toBe(CURTIME)
    expect(form.get('sign')).toBe(manualSign)
    expect(form.get('from')).toBe('zh-CHS')
    expect(form.get('to')).toBe('en')
  })

  it('语种映射：zh-CN→zh-CHS、zh-TW→zh-CHT、其余同码小写', () => {
    expect(youdaoLang('zh-CN')).toBe('zh-CHS')
    expect(youdaoLang('zh-TW')).toBe('zh-CHT')
    expect(youdaoLang('EN')).toBe('en')
    expect(youdaoLang('ja')).toBe('ja')
  })

  it('parse：translation join；错误码表逐条 kind 断言（auth 类带官方含义）', () => {
    expect(parseYoudaoBody('{"errorCode":"0","translation":["你好","世界"]}')).toBe('你好\n世界')
    // 多行含空行：空段过滤后只拼非空段；全空段仍走缺少译文字段报错
    expect(parseYoudaoBody('{"errorCode":"0","translation":["第一行","","第三行"]}')).toBe('第一行\n第三行')
    expect(rejectKindFn(() => parseYoudaoBody('{"errorCode":"0","translation":["",""]}'))).toBe('parse')
    const codes: [string, string][] = [
      ['101', 'config'],
      ['102', 'config'],
      ['103', 'config'],
      ['104', 'config'],
      ['105', 'config'],
      ['107', 'config'],
      ['108', 'config'],
      ['109', 'config'],
      ['110', 'auth'],
      ['111', 'auth'],
      ['202', 'auth'],
      ['203', 'auth'],
      ['205', 'auth'],
      ['206', 'auth'],
      ['207', 'auth'],
      ['401', 'quota'],
      ['411', 'quota'],
      ['412', 'quota'],
      ['301', 'http'],
      ['302', 'http'],
      ['303', 'http'],
      ['310', 'http'],
      ['311', 'http'],
      ['999', 'http'] // 未知码兜底
    ]
    for (const [code, kind] of codes) {
      expect(rejectKindFn(() => parseYoudaoBody(`{"errorCode":"${code}"}`))).toBe(kind)
    }
    expect(rejectKindFn(() => parseYoudaoBody('{"errorCode":"0","translation":[]}'))).toBe('parse')
    try {
      parseYoudaoBody('{"errorCode":"202"}')
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).toContain('签名检验失败')
    }
  })

  it('execute：POST form；缺任一凭证 fail-fast（零网络）', async () => {
    const { fn, calls } = recordingFetch(() => okBody('{"errorCode":"0","translation":["你好，世界！"]}'))
    const out = await executeYoudao(en2zh, rt(fn), provider('youdao', secrets))
    expect(out).toEqual({ resultText: '你好，世界！', providerId: 'u-youdao' })
    expect(calls[0]?.url).toBe('https://openapi.youdao.com/api')
    const body = new URLSearchParams(calls[0]?.init?.body as string)
    expect(body.get('appKey')).toBe(secrets.appKey)
    // curtime 与 sign 同源：用请求里的 curtime 独立复算 sign 必须一致
    expect(body.get('sign')).toBe(youdaoSign(secrets.appKey, TEXT, body.get('salt') ?? '', body.get('curtime') ?? '', secrets.appSecret))

    for (const bad of [{ appKey: 'x' } as Record<string, string>, { appSecret: 'x' } as Record<string, string>, undefined]) {
      const none = recordingFetch(() => okBody('{}'))
      expect(await rejectKind(executeYoudao(en2zh, rt(none.fn), provider('youdao', bad)))).toBe('config')
      expect(none.calls).toHaveLength(0)
    }
  })
})

// ---------- 讯飞 ----------

describe('讯飞 executor', () => {
  const apiKey = '0123456789abcdef0123456789abcdef'
  const apiSecret = 'fedcba9876543210fedcba9876543210'
  const DATE = 'Mon, 05 Oct 2026 08:00:00 GMT'

  it('黄金值：HMAC 签名 + authorization b64 + URL 整体 urlencode（独立路径交叉复算）', () => {
    // 交叉：手动拼原串复算（不经 iflytekSignature）
    const manualOrigin = ['host: itrans.xf-yun.com', `date: ${DATE}`, 'POST /v1/its HTTP/1.1'].join('\n')
    const manualSig = createHmac('sha256', apiSecret).update(manualOrigin, 'utf8').digest('base64')
    expect(manualSig).toBe('vvJEoTpWfqDFQ9W+M2FkyZobfY0fSZq22ho606UWHbY=')
    expect(iflytekSignature(apiSecret, DATE)).toBe(manualSig)
    const manualAuth = Buffer.from(
      `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${manualSig}"`,
      'utf8'
    ).toString('base64')
    expect(iflytekAuthorization(apiKey, apiSecret, DATE)).toBe(manualAuth)
    expect(buildIflytekUrl(apiKey, apiSecret, DATE)).toBe(
      `https://itrans.xf-yun.com/v1/its?authorization=${encodeURIComponent(manualAuth)}&date=${encodeURIComponent(DATE)}&host=itrans.xf-yun.com`
    )
  })

  it('body：text 为 base64(utf8)；语种 cn/同码；auto 不支持归 config；>5000 字符预检拒绝', async () => {
    const body = JSON.parse(buildIflytekBody(en2zh, 'app-1'))
    expect(body.header).toEqual({ app_id: 'app-1', status: 3 })
    expect(body.parameter.its).toEqual({ from: 'en', to: 'cn', result: {} })
    expect(body.payload.input_data.text).toBe(Buffer.from(TEXT, 'utf8').toString('base64'))
    expect(iflytekLang('zh-TW')).toBe('cn')
    expect(iflytekLang('ja')).toBe('ja')
    expect(iflytekLang('th')).toBe('th')
    expect(rejectKindFn(() => iflytekLang('auto'))).toBe('config')
    const long = recordingFetch(() => okBody('{}'))
    expect(
      await rejectKind(
        executeIflytek({ text: 'x'.repeat(5001), from: 'en', to: 'zh-CN' }, rt(long.fn), provider('iflytek', { appId: 'a', apiKey, apiSecret }))
      )
    ).toBe('config')
    expect(long.calls).toHaveLength(0)
  })

  it('parse：code=0 解 base64(JSON) 取 dst；码表逐条 kind；trans_result 缺失 http 带 sid', () => {
    const inner = Buffer.from(JSON.stringify({ trans_result: { dst: '你好，世界！' } }), 'utf8').toString('base64')
    expect(parseIflytekBody(`{"header":{"code":0},"payload":{"result":{"text":"${inner}"}}}`)).toBe('你好，世界！')
    const codes: [string, string][] = [
      ['10005', 'auth'],
      ['10105', 'auth'],
      ['11200', 'auth'],
      ['11201', 'auth'],
      ['11202', 'auth'],
      ['10163', 'config'],
      ['99999', 'http']
    ]
    for (const [code, kind] of codes) {
      expect(rejectKindFn(() => parseIflytekBody(`{"header":{"code":${Number(code)},"sid":"s1"}}`))).toBe(kind)
    }
    try {
      parseIflytekBody('{"header":{"code":0,"sid":"s2"},"payload":{"result":{}}}')
      expect.unreachable()
    } catch (e) {
      expect((e as TranslateExecutorError).kind).toBe('http')
      expect((e as Error).message).toContain('sid: s2')
    }
  })

  it('execute：POST JSON 到带鉴权 URL；缺任一凭证 fail-fast（零网络）；HTTP 401→auth、403→config', async () => {
    const { fn, calls } = recordingFetch(() => okBody(`{"header":{"code":0},"payload":{"result":{"text":"${Buffer.from('{"trans_result":{"dst":"你好"}}', 'utf8').toString('base64')}"}}}`))
    const out = await executeIflytek(en2zh, rt(fn), provider('iflytek', { appId: 'app-1', apiKey, apiSecret }))
    expect(out).toEqual({ resultText: '你好', providerId: 'u-iflytek' })
    expect(calls[0]?.url).toMatch(/^https:\/\/itrans\.xf-yun\.com\/v1\/its\?authorization=[^&]+&date=[^&]+&host=itrans\.xf-yun\.com$/)
    expect(calls[0]?.init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(calls[0]?.init?.body as string).header.app_id).toBe('app-1')

    for (const bad of [{ apiKey, apiSecret }, { appId: 'a', apiKey }, { appId: 'a', apiSecret }, undefined] as (Record<string, string> | undefined)[]) {
      const none = recordingFetch(() => okBody('{}'))
      expect(await rejectKind(executeIflytek(en2zh, rt(none.fn), provider('iflytek', bad)))).toBe('config')
      expect(none.calls).toHaveLength(0)
    }

    const e401 = recordingFetch(() => httpErr(401))
    expect(await rejectKind(executeIflytek(en2zh, rt(e401.fn), provider('iflytek', { appId: 'a', apiKey, apiSecret })))).toBe('auth')
    const e403 = recordingFetch(() => httpErr(403))
    expect(await rejectKind(executeIflytek(en2zh, rt(e403.fn), provider('iflytek', { appId: 'a', apiKey, apiSecret })))).toBe('config')
  })
})

// ---------- 混元 ----------

describe('混元 executor', () => {
  it('黄金值：Bearer 头 + 系统提示词与用户文本（模型/温度固定）', () => {
    const r = buildHunyuanRequest(en2zh, 'sk-hunyuan-test')
    expect(r.url).toBe('https://api.hunyuan.cloud.tencent.com/v1/chat/completions')
    expect(r.init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-hunyuan-test' })
    expect(JSON.parse(r.init.body as string)).toEqual({
      model: 'hunyuan-turbos-latest',
      temperature: 0,
      messages: [
        { role: 'system', content: '你是翻译引擎。把用户消息原文从English翻译为简体中文，只输出译文本身，不要解释、不要加引号。' },
        { role: 'user', content: TEXT }
      ]
    })
  })

  it('parse：choices[0].message.content；剥离代码围栏与成对引号；空译文归 parse', () => {
    expect(parseHunyuanBody('{"choices":[{"message":{"content":"  你好  "}}]}')).toBe('你好')
    expect(stripHunyuanChatter('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripHunyuanChatter('"引用译文"')).toBe('引用译文')
    expect(stripHunyuanChatter('“中文引号”')).toBe('中文引号')
    expect(stripHunyuanChatter("'单引号'")).toBe('单引号')
    expect(stripHunyuanChatter('普通译文')).toBe('普通译文')
    expect(rejectKindFn(() => parseHunyuanBody('{"choices":[{"message":{"content":"  "}}]}'))).toBe('parse')
    expect(rejectKindFn(() => parseHunyuanBody('{}'))).toBe('parse')
  })

  it('HTTP 错误分类：401→auth、429→quota、400→config、500→http，error.message 附加', () => {
    expect(hunyuanHttpError(401, '{"error":{"message":"invalid key"}}').kind).toBe('auth')
    expect(hunyuanHttpError(401, '{"error":{"message":"invalid key"}}').message).toContain('invalid key')
    expect(hunyuanHttpError(429, '{}').kind).toBe('quota')
    expect(hunyuanHttpError(400, '{}').kind).toBe('config')
    expect(hunyuanHttpError(500, '{}').kind).toBe('http')
  })

  it('execute：默认超时 15s；缺凭证 fail-fast（零网络）', async () => {
    const { fn, calls } = recordingFetch(() => okBody('{"choices":[{"message":{"content":"你好，世界！"}}]}'))
    const out = await executeHunyuan(en2zh, rt(fn), provider('hunyuan', { apiKey: 'sk-1' }))
    expect(out).toEqual({ resultText: '你好，世界！', providerId: 'u-hunyuan' })
    expect(calls[0]?.init?.timeoutMs).toBe(15_000)
    expect(calls[0]?.init?.timeoutMs).toBe(15_000)
    const explicit = recordingFetch(() => okBody('{"choices":[{"message":{"content":"x"}}]}'))
    await executeHunyuan(en2zh, rt(explicit.fn, 3_000), provider('hunyuan', { apiKey: 'sk-1' }))
    expect(explicit.calls[0]?.init?.timeoutMs).toBe(3_000)

    const none = recordingFetch(() => okBody('{}'))
    expect(await rejectKind(executeHunyuan(en2zh, rt(none.fn), provider('hunyuan')))).toBe('config')
    expect(none.calls).toHaveLength(0)
  })
})

// ---------- 火山 ----------

describe('火山 executor', () => {
  const secrets = { accessKeyId: 'AKTEST123456', secretAccessKey: 'SKtest987654321' }
  const XDATE = '20261005T080000Z'

  it('黄金值：V4 签名全链（canonical/stringToSign/密钥链/signature）独立路径交叉复算', () => {
    // 交叉：手动模板串复算（不经 executor 的 join/数组结构）
    const body = JSON.stringify({ TargetLanguage: 'zh', TextList: [TEXT] })
    expect(body).toBe(buildVolcanoBody(en2zh))
    const sha = createHash('sha256').update(body, 'utf8').digest('hex')
    expect(sha).toBe('d7093492ac541cd532329f5341a0e29812f97887f6ecd5dc53d8875cd4fc7c3b')
    const manualCanonical =
      `POST\n/\nAction=TranslateText&Version=2020-06-01\n` +
      `content-type:application/json\nhost:translate.volcengineapi.com\n` +
      `x-content-sha256:${sha}\nx-date:${XDATE}\n\n` +
      `content-type;host;x-content-sha256;x-date\n${sha}`
    expect(volcanoCanonicalRequest(XDATE, sha)).toBe(manualCanonical)
    const manualSts = `HMAC-SHA256\n${XDATE}\n20261005/cn-north-1/translate/request\n${createHash('sha256').update(manualCanonical, 'utf8').digest('hex')}`
    expect(manualSts).toBe('HMAC-SHA256\n20261005T080000Z\n20261005/cn-north-1/translate/request\n6f32be8cb170701b23e612ae26f89c12b8bd1e78f24e76cb7ea1644a44104b10')
    // 密钥链独立复算：逐级 HMAC
    const k1 = createHmac('sha256', secrets.secretAccessKey).update('20261005', 'utf8').digest()
    const k2 = createHmac('sha256', k1).update('cn-north-1', 'utf8').digest()
    const k3 = createHmac('sha256', k2).update('translate', 'utf8').digest()
    const k4 = createHmac('sha256', k3).update('request', 'utf8').digest()
    expect(Buffer.from(volcanoSigningKey(secrets.secretAccessKey, '20261005')).equals(k4)).toBe(true)
    const sig = createHmac('sha256', k4).update(manualSts, 'utf8').digest('hex')
    expect(sig).toBe('e8c1d7c240e23f3cdc602c2e10355b63b1bce307a21c96310d28988c71588d75')
    const r = buildVolcanoRequest(en2zh, secrets, XDATE)
    expect(r.url).toBe('https://translate.volcengineapi.com/?Action=TranslateText&Version=2020-06-01')
    expect(r.init.headers?.Authorization).toBe(
      `HMAC-SHA256 Credential=AKTEST123456/20261005/cn-north-1/translate/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=${sig}`
    )
    expect(r.init.headers?.['X-Date']).toBe(XDATE)
    expect(r.init.headers?.['X-Content-Sha256']).toBe(sha)
  })

  it('volcanoXDate：ISO 时间转 yyyyMMddTHHmmssZ；语种映射 zh/zh-Hant/小写', () => {
    expect(volcanoXDate(new Date('2026-10-05T08:00:00.123Z'))).toBe('20261005T080000Z')
    expect(volcanoLang('zh-CN')).toBe('zh')
    expect(volcanoLang('zh-TW')).toBe('zh-Hant')
    expect(volcanoLang('EN')).toBe('en')
    expect(volcanoLang('ja')).toBe('ja')
  })

  it('parse：TranslationList[0].Translation；Error.Code 分类含字断言', () => {
    expect(parseVolcanoBody('{"Response":{"TranslationList":[{"Translation":"你好，世界！"}]}}')).toBe('你好，世界！')
    const codes: [string, string][] = [
      ['SignatureDoesNotMatch', 'auth'],
      ['InvalidAccessKey', 'auth'],
      ['UnauthorizedOperation', 'auth'],
      ['InvalidParameter', 'config'],
      ['MissingParameter', 'config'],
      ['InternalError', 'http']
    ]
    for (const [code, kind] of codes) {
      expect(rejectKindFn(() => parseVolcanoBody(`{"Response":{"Error":{"Code":"${code}","Message":"m"}}}`))).toBe(kind)
    }
    expect(rejectKindFn(() => parseVolcanoBody('{"Response":{}}'))).toBe('parse')
  })

  it('execute：POST JSON + 签名头；缺任一凭证 fail-fast（零网络）', async () => {
    const { fn, calls } = recordingFetch(() => okBody('{"Response":{"TranslationList":[{"Translation":"你好，世界！"}]}}'))
    const out = await executeVolcano(en2zh, rt(fn), provider('volcano', secrets))
    expect(out).toEqual({ resultText: '你好，世界！', providerId: 'u-volcano' })
    expect(calls[0]?.url).toBe('https://translate.volcengineapi.com/?Action=TranslateText&Version=2020-06-01')
    expect(calls[0]?.init?.method).toBe('POST')
    expect((calls[0]?.init?.headers?.Authorization ?? '')).toMatch(/^HMAC-SHA256 Credential=AKTEST123456\//)

    for (const bad of [{ accessKeyId: 'x' } as Record<string, string>, { secretAccessKey: 'x' } as Record<string, string>, undefined]) {
      const none = recordingFetch(() => okBody('{}'))
      expect(await rejectKind(executeVolcano(en2zh, rt(none.fn), provider('volcano', bad)))).toBe('config')
      expect(none.calls).toHaveLength(0)
    }
  })

  it('实发请求一致性：X-Content-Sha256 = sha256(实发 body 字节)，且用实发头+实发 body 可独立验签', async () => {
    const { fn, calls } = recordingFetch(() => okBody('{"Response":{"TranslationList":[{"Translation":"好"}]}}'))
    await executeVolcano(en2zh, rt(fn), provider('volcano', secrets))
    const init = calls[0]?.init as { body: string; headers: Record<string, string> }
    // body 序列化字节 = 签名输入字节：实发 body 的哈希必须等于头里声明值
    const sentSha = createHash('sha256').update(init.body, 'utf8').digest('hex')
    expect(init.body).toBe(buildVolcanoBody(en2zh))
    expect(init.headers['X-Content-Sha256']).toBe(sentSha)
    // 独立验签：只凭实发请求的 method/头/body 重建 canonical → 密钥链 → 签名，须与 Authorization 一致
    const xDate = init.headers['X-Date']
    const date8 = xDate.slice(0, 8)
    const canonical = [
      'POST',
      '/',
      'Action=TranslateText&Version=2020-06-01',
      'content-type:application/json',
      'host:translate.volcengineapi.com',
      `x-content-sha256:${sentSha}`,
      `x-date:${xDate}`,
      '',
      'content-type;host;x-content-sha256;x-date',
      sentSha
    ].join('\n')
    const sts = [
      'HMAC-SHA256',
      xDate,
      `${date8}/cn-north-1/translate/request`,
      createHash('sha256').update(canonical, 'utf8').digest('hex')
    ].join('\n')
    let dk = createHmac('sha256', secrets.secretAccessKey).update(date8, 'utf8').digest()
    for (const part of ['cn-north-1', 'translate', 'request']) {
      dk = createHmac('sha256', dk).update(part, 'utf8').digest()
    }
    const sig = createHmac('sha256', dk).update(sts, 'utf8').digest('hex')
    expect(init.headers.Authorization).toBe(
      `HMAC-SHA256 Credential=${secrets.accessKeyId}/${date8}/cn-north-1/translate/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=${sig}`
    )
  })
})

// ---------- 补充：签名规则边界与响应净化分支 ----------

describe('有道 input 规则边界（v3 签名长度阈值）', () => {
  const secrets = { appKey: 'testAppKey123', appSecret: 'testAppSecret456' }
  const SALT = 'abcdef0123456789'
  const CURTIME = '1760000001'

  it('q.length===20：整串参与签名（阈值含 20）', () => {
    const q20 = '一二三四五六七八九十一二三四五六七八九十'
    expect(q20).toHaveLength(20)
    expect(youdaoSignInput(q20)).toBe(q20)
    const manual = createHash('sha256').update(`testAppKey123${q20}${SALT}${CURTIME}testAppSecret456`, 'utf8').digest('hex')
    expect(youdaoSign(secrets.appKey, q20, SALT, CURTIME, secrets.appSecret)).toBe(manual)
  })

  it('q.length===21：前 10 + "21" + 后 10；表单 sign 与独立复算一致', () => {
    const q21 = '一二三四五六七八九十一二三四五六七八九十甲'
    expect(q21).toHaveLength(21)
    const input21 = '一二三四五六七八九十' + '21' + '二三四五六七八九十甲'
    expect(youdaoSignInput(q21)).toBe(input21)
    const form = buildYoudaoForm({ text: q21, from: 'zh-CN', to: 'en' }, secrets, SALT, CURTIME)
    expect(form.get('q')).toBe(q21)
    expect(form.get('sign')).toBe(
      createHash('sha256').update(`testAppKey123${input21}${SALT}${CURTIME}testAppSecret456`, 'utf8').digest('hex')
    )
  })

  it('含 emoji：按 UTF-16 码元计数（😀=2，与官方 Java length() 语义一致）', () => {
    const ten = '😀'.repeat(10)
    expect(ten.length).toBe(20)
    expect(youdaoSignInput(ten)).toBe(ten) // 20 码元 → 整串，不插长度
    const eleven = '😀'.repeat(11)
    expect(eleven.length).toBe(22)
    expect(youdaoSignInput(eleven)).toBe('😀'.repeat(5) + '22' + '😀'.repeat(5))
  })
})

describe('讯飞 payload 编解码分支', () => {
  const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')

  it('body.text 为 base64(utf8 中文)：黄金值与 Buffer 复算双断言', () => {
    const body = JSON.parse(buildIflytekBody({ text: '你好世界', from: 'en', to: 'zh-CN' }, 'app-1'))
    expect(body.payload.input_data.text).toBe('5L2g5aW95LiW55WM')
    expect(body.payload.input_data.text).toBe(b64('你好世界'))
  })

  it('code=0 但译文字段各缺失形态均归 http（缺少译文）', () => {
    // inner JSON 无 trans_result
    expect(rejectKindFn(() => parseIflytekBody(`{"header":{"code":0},"payload":{"result":{"text":"${b64('{"foo":1}')}"}}}`))).toBe('http')
    // trans_result.dst 为空串
    expect(rejectKindFn(() => parseIflytekBody(`{"header":{"code":0},"payload":{"result":{"text":"${b64('{"trans_result":{"dst":""}}')}"}}}`))).toBe('http')
    // 解出的 inner 不是 JSON
    expect(rejectKindFn(() => parseIflytekBody(`{"header":{"code":0},"payload":{"result":{"text":"${b64('plain')}"}}}`))).toBe('http')
    // payload.result.text 为空串
    expect(rejectKindFn(() => parseIflytekBody('{"header":{"code":0},"payload":{"result":{"text":""}}}'))).toBe('http')
    // payload 整体缺失
    expect(rejectKindFn(() => parseIflytekBody('{"header":{"code":0}}'))).toBe('http')
  })
})

describe('混元输出净化边界', () => {
  it('无语言标注围栏、围栏+引号叠加、不对称引号不剥', () => {
    expect(stripHunyuanChatter('```\n你好\n```')).toBe('你好')
    expect(stripHunyuanChatter('```text\n"引用译文"\n```')).toBe('引用译文')
    expect(stripHunyuanChatter('"abc')).toBe('"abc')
    expect(stripHunyuanChatter('“只有开头')).toBe('“只有开头')
  })

  it('剥完为空串 → parse（空译文）', () => {
    expect(stripHunyuanChatter('""')).toBe('')
    expect(rejectKindFn(() => parseHunyuanBody('{"choices":[{"message":{"content":"\\"\\""}}]}'))).toBe('parse')
    expect(rejectKindFn(() => parseHunyuanBody('{"choices":[{"message":{"content":"```\\n```"}}]}'))).toBe('parse')
  })
})
