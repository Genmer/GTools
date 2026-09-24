/** backend 写入自身 storage 的环境信息 key，渲染层同 key 直读（放这层是为了渲染层不 import backend） */
export const ENV_STORAGE_KEY = 'env'

/** 平台相关环境信息：由 backend 计算后经 storage 递给渲染层（渲染层拿不到 homedir/APPDATA） */
export interface BackupEnvInfo {
  platform: string
  home: string
  /** 可能的 GTools 数据目录（打包名 GTools / 开发名 gtools），对话框默认定位用 */
  candidates: string[]
  sep: string
  caseInsensitive: boolean
}

export function sepForPlatform(platform: string): string {
  return platform === 'win32' ? '\\' : '/'
}

export function caseInsensitiveForPlatform(platform: string): boolean {
  return platform !== 'linux'
}

function join(sep: string, ...parts: string[]): string {
  return parts.join(sep)
}

/**
 * 各平台 userData 的标准位置候选。目录名大小写：打包后 app 名为 GTools（productName），
 * 开发模式为 gtools（package.json name），两者都列出，存在与否由用户在对话框里确认。
 * win32 分支按 Electron userData 约定（%APPDATA%/<name>）编写，未在真实 Windows 上实测。
 */
export function computeEnvInfo(platform: string, home: string, env: Record<string, string | undefined>): BackupEnvInfo {
  const sep = sepForPlatform(platform)
  const names = ['GTools', 'gtools']
  let bases: string[]
  if (platform === 'win32') {
    bases = env.APPDATA ? [env.APPDATA] : []
  } else if (platform === 'darwin') {
    bases = [join('/', home, 'Library', 'Application Support')]
  } else {
    bases = [join('/', home, '.config')]
  }
  const candidates = bases.flatMap((base) => names.map((n) => join(sep, base, n)))
  return { platform, home, candidates, sep, caseInsensitive: caseInsensitiveForPlatform(platform) }
}

/** 未知/信息缺失时的兜底（backend 未就绪也能用，只是对话框不预定位） */
export function fallbackEnvInfo(platform: string): BackupEnvInfo {
  return {
    platform,
    home: '',
    candidates: [],
    sep: sepForPlatform(platform),
    caseInsensitive: caseInsensitiveForPlatform(platform)
  }
}

export function platformLabel(platform: string): string {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  return platform || '未知'
}
