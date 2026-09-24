import { homedir } from 'node:os'
import type { BackendContext, PluginBackend } from '@sdk/api'
import { computeEnvInfo, ENV_STORAGE_KEY } from '../logic/datadir'

export interface EnvDeps {
  homeDir(): string
  env: Record<string, string | undefined>
}

/**
 * 渲染层拿不到 homedir/APPDATA，backend 启动时算好平台环境信息写进自身 storage，
 * 渲染层同 key 直读（与 launcher 的 cache 约定一致）。
 */
export function createBackupBackend(deps?: EnvDeps): PluginBackend {
  return {
    async init(ctx: BackendContext): Promise<void> {
      const d: EnvDeps = deps ?? { homeDir: () => homedir(), env: process.env }
      const info = computeEnvInfo(ctx.app.platform, d.homeDir(), d.env)
      await ctx.storage.set(ENV_STORAGE_KEY, info)
    },
    async start(): Promise<void> {},
    async stop(): Promise<void> {}
  }
}

export default createBackupBackend()
