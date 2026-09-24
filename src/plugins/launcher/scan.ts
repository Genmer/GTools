import { appNameFromPlist } from './plist-name'
import { joinPath, type AppEntry, type FsLike, type ScanDeps } from './types'

export function defaultDarwinRoots(homeDir: string): string[] {
  return ['/Applications', joinPath(homeDir, 'Applications'), '/System/Applications']
}

export function defaultWin32Roots(env: Record<string, string | undefined>): string[] {
  const roots: string[] = []
  if (env.APPDATA) roots.push(joinPath(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
  if (env.PROGRAMDATA) roots.push(joinPath(env.PROGRAMDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
  return roots
}

function normalize(out: Map<string, AppEntry>): AppEntry[] {
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN') || a.path.localeCompare(b.path))
}

async function addDarwinApp(dir: string, appDirName: string, fs: FsLike, out: Map<string, AppEntry>): Promise<void> {
  const appPath = joinPath(dir, appDirName)
  if (out.has(appPath)) return
  let name = appDirName.slice(0, -'.app'.length)
  try {
    const plistText = await fs.readFile(joinPath(appPath, 'Contents', 'Info.plist'))
    name = appNameFromPlist(plistText) ?? name
  } catch {
    // 无 Info.plist 或读取失败 → 目录名兜底
  }
  if (name !== '') out.set(appPath, { name, path: appPath })
}

async function collectDarwinInRoot(root: string, fs: FsLike, out: Map<string, AppEntry>): Promise<void> {
  let level1
  try {
    level1 = await fs.readdir(root)
  } catch {
    return // 根目录不存在/不可读视为空
  }
  for (const ent of level1) {
    if (!ent.isDirectory()) continue
    if (ent.name.endsWith('.app')) {
      await addDarwinApp(root, ent.name, fs, out)
      continue
    }
    // 深度 2：/Applications/Utilities/Terminal.app 这类分组目录
    const sub = joinPath(root, ent.name)
    let level2
    try {
      level2 = await fs.readdir(sub)
    } catch {
      continue
    }
    for (const ent2 of level2) {
      if (ent2.isDirectory() && ent2.name.endsWith('.app')) await addDarwinApp(sub, ent2.name, fs, out)
    }
  }
}

export async function scanDarwin(deps: ScanDeps): Promise<AppEntry[]> {
  const out = new Map<string, AppEntry>()
  const roots = deps.darwinRoots ?? defaultDarwinRoots(deps.homeDir)
  for (const root of roots) await collectDarwinInRoot(root, deps.fs, out)
  return normalize(out)
}

async function collectLnkInRoot(root: string, fs: FsLike, out: Map<string, AppEntry>, depth: number): Promise<void> {
  if (depth > 4) return
  let entries
  try {
    entries = await fs.readdir(root)
  } catch {
    return
  }
  for (const ent of entries) {
    const p = joinPath(root, ent.name)
    if (ent.isDirectory()) {
      await collectLnkInRoot(p, fs, out, depth + 1)
    } else if (ent.name.toLowerCase().endsWith('.lnk')) {
      const name = ent.name.slice(0, -'.lnk'.length)
      // 键=小写名称：用户/全局开始菜单各放一份同名 .lnk 时只留先扫到的（用户级优先）
      if (name !== '' && !out.has(name.toLowerCase())) out.set(name.toLowerCase(), { name, path: p })
    }
  }
}

/** 解析 `reg query ...\\App Paths /s` 输出；键头后第一条 SZ 值视为默认值（目标路径），取不到则跳过 */
export function parseRegAppPaths(stdout: string): AppEntry[] {
  const out: AppEntry[] = []
  const seen = new Set<string>()
  const lines = stdout.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^HKEY_[^\\\r\n]+\\.*App Paths\\(.+\.exe)\s*$/i)
    if (!m) continue
    let path = ''
    for (let j = i + 1; j < lines.length; j++) {
      if (/^HKEY_/.test(lines[j])) break
      const vm = lines[j].match(/REG_(?:EXPAND_)?SZ\s+(.+)$/i)
      if (vm) {
        path = vm[1].trim()
        break
      }
    }
    if (path === '') continue
    const key = path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: m[1].replace(/\.exe$/i, ''), path })
  }
  return out
}

// Windows 分支（开始菜单 .lnk + 注册表 App Paths）本机为 macOS，未实测。
// 统一去重：.lnk 按小写名称合并（用户/全局开始菜单互备时留先扫到的用户级）；
// 注册表条目与 .lnk 的名称或小写路径任一重合即视为同一应用，不再叠加。
export async function scanWin32(deps: ScanDeps): Promise<AppEntry[]> {
  const out = new Map<string, AppEntry>()
  const roots = deps.win32Roots ?? defaultWin32Roots(deps.env)
  for (const root of roots) await collectLnkInRoot(root, deps.fs, out, 0)
  const knownPaths = new Set([...out.values()].map((e) => e.path.toLowerCase()))
  if (deps.exec) {
    for (const hive of ['HKLM', 'HKCU']) {
      try {
        const r = await deps.exec.execFile('reg', [
          'query',
          `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths`,
          '/s'
        ])
        for (const e of parseRegAppPaths(r.stdout)) {
          const key = e.name.toLowerCase()
          if (out.has(key) || knownPaths.has(e.path.toLowerCase())) continue
          knownPaths.add(e.path.toLowerCase())
          out.set(key, e)
        }
      } catch {
        // 注册表查询失败（权限/键不存在）→ 只保留 .lnk 结果
      }
    }
  }
  return normalize(out)
}

export async function scanApps(deps: ScanDeps): Promise<AppEntry[]> {
  return deps.platform === 'win32' ? scanWin32(deps) : scanDarwin(deps)
}
