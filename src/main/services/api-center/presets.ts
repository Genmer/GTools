import type { ProviderType } from './types'

/** 凭证字段元数据：设置页据此渲染密码框（label/占位），键集合即该 type 合法 secrets 键 */
export interface CredentialFieldDef {
  key: string
  label: string
  placeholder: string
}

export interface ProviderPresetMeta {
  type: ProviderType
  label: string
  description: string
  /** 免费额度短句，类型下拉名词后括号展示；缺省不显示 */
  quotaNote?: string
  /** null = 不显示「获取 API Key ↗」按钮（mymemory 免 key、http-template 无固定控制台） */
  consoleUrl: string | null
  credentials: CredentialFieldDef[]
  hints?: string[]
}

export const PROVIDER_PRESETS: readonly ProviderPresetMeta[] = [
  {
    type: 'mymemory',
    label: 'MyMemory（免 Key）',
    description: '公共接口，无需凭证；匿名调用有每日配额',
    consoleUrl: null,
    credentials: []
  },
  {
    type: 'http-template',
    label: '自定义 HTTP 接口',
    description: '任意 REST 翻译接口：URL/请求体模板 + 点分结果路径',
    consoleUrl: null,
    credentials: [{ key: 'apiKey', label: 'API 密钥', placeholder: '模板含 {key} 时必填' }]
  },
  {
    type: 'deepl',
    label: 'DeepL',
    description: '高质量神经机器翻译，免费/付费版按密钥后缀自动区分',
    quotaNote: '免费 50 万字/月',
    consoleUrl: 'https://www.deepl.com/pro-api/your-api-keys',
    credentials: [{ key: 'authKey', label: 'Auth Key', placeholder: '在 DeepL 控制台创建' }],
    hints: ['免费版密钥以 :fx 结尾，将自动使用免费端点']
  },
  {
    type: 'baidu',
    label: '百度翻译',
    description: '通用文本翻译，标准版免费',
    quotaNote: '标准版 5 万字/月',
    consoleUrl: 'https://api.fanyi.baidu.com/api/trans/product/desktop?req=developer',
    credentials: [
      { key: 'appId', label: 'APP ID', placeholder: '百度翻译开放平台获取' },
      { key: 'secretKey', label: '密钥', placeholder: '与 APP ID 配对的管理员密钥' }
    ],
    hints: [
      'APP ID 是一串纯数字，密钥是另一串字母数字，两者别填反；请整段复制勿手输',
      '免费标准版 QPS=1，频繁输入时建议把百度放非首选或配其他引擎容灾'
    ]
  },
  {
    type: 'youdao',
    label: '有道智云',
    description: '自然语言翻译服务，需创建「文本翻译」应用',
    quotaNote: '按量赠送额度',
    consoleUrl: 'https://ai.youdao.com/console/',
    credentials: [
      { key: 'appKey', label: '应用 ID', placeholder: '有道智云控制台的应用 ID' },
      { key: 'appSecret', label: '应用密钥', placeholder: '与应用 ID 配对的密钥' }
    ]
  },
  {
    type: 'iflytek',
    label: '讯飞机器翻译',
    description: '讯飞开放平台机器翻译（itrans），按字数计费有免费额度',
    quotaNote: '有免费额度',
    consoleUrl: 'https://console.xfyun.cn/services/itrans',
    credentials: [
      { key: 'appId', label: 'APPID', placeholder: '讯飞控制台的应用 ID' },
      { key: 'apiKey', label: 'API Key', placeholder: '讯飞控制台的 API Key' },
      { key: 'apiSecret', label: 'API Secret', placeholder: '与 API Key 配对的 Secret' }
    ]
  },
  {
    type: 'hunyuan',
    label: '腾讯混元',
    description: '大模型翻译引擎，语义理解更好，输出非逐字确定',
    quotaNote: '大模型接口计费',
    consoleUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    credentials: [{ key: 'apiKey', label: 'API Key', placeholder: '混元 API Key 管理 页创建' }],
    hints: ['大模型引擎：输出非逐字确定、延迟略高']
  },
  {
    type: 'volcano',
    label: '火山翻译',
    description: '字节跳动翻译服务，支持源语种自动检测',
    quotaNote: '有免费额度',
    consoleUrl: 'https://console.volcengine.com/iam/keymanage/',
    credentials: [
      { key: 'accessKeyId', label: 'Access Key ID', placeholder: '火山引擎 IAM 访问密钥' },
      { key: 'secretAccessKey', label: 'Secret Access Key', placeholder: '与 Access Key ID 配对' }
    ]
  },
  {
    type: 'ai-chat',
    label: 'AI 翻译（OpenAI 兼容）',
    description: 'OpenAI 兼容 /chat/completions 端点，密钥只存本机',
    quotaNote: '按所用服务商计费',
    consoleUrl: null,
    credentials: [{ key: 'apiKey', label: 'API Key', placeholder: 'sk-…（OpenAI 兼容服务的密钥）' }],
    hints: ['大模型引擎：输出非逐字确定、延迟略高']
  }
]

export function getPreset(type: ProviderType): ProviderPresetMeta | undefined {
  return PROVIDER_PRESETS.find((p) => p.type === type)
}
