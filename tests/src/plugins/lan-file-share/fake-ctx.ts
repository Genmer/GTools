/** 测试共用的 BackendContext fake：storage 走内存 Map，fs 走内存文件树（'/' 分隔的绝对路径） */
import type { BackendContext } from '@sdk/api'
import { STATE_KEY, type ShareState } from '../../../../src/plugins/lan-file-share/shared'

export function createFakeCtx(initial: Record<string, string | Buffer> = {}): {
  ctx: BackendContext
  files: Map<string, Buffer>
  storageMap: Map<string, unknown>
  emits: { event: string; payload: unknown }[]
  notifications: { title: string; body: string }[]
  state: () => ShareState | null
} {
  const files = new Map<string, Buffer>()
  for (const [p, v] of Object.entries(initial)) files.set(p, Buffer.isBuffer(v) ? v : Buffer.from(v, 'utf8'))
  const storageMap = new Map<string, unknown>()
  const emits: { event: string; payload: unknown }[] = []
  const notifications: { title: string; body: string }[] = []

  const isDir = (p: string): boolean => {
    if (files.has(p)) return false
    for (const f of files.keys()) if (f.startsWith(p + '/')) return true
    return false
  }

  const ctx = {
    storage: {
      get: async (key: string): Promise<unknown> => storageMap.get(key) ?? null,
      set: async (key: string, value: unknown): Promise<void> => {
        storageMap.set(key, value)
      }
    },
    fs: {
      list: async (dir: string) => {
        const names = new Map<string, { isDirectory: boolean; size: number }>()
        for (const [f, buf] of files) {
          if (!f.startsWith(dir + '/')) continue
          const rest = f.slice(dir.length + 1)
          const seg = rest.split('/')[0]
          if (seg === '') continue
          if (rest.includes('/')) names.set(seg, { isDirectory: true, size: 0 })
          else names.set(seg, { isDirectory: false, size: buf.length })
        }
        return [...names.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([name, meta]) => ({ name, path: `${dir}/${name}`, isDirectory: meta.isDirectory, size: meta.size }))
      },
      stat: async (path: string) => {
        const buf = files.get(path)
        if (buf !== undefined) return { exists: true, isFile: true, isDirectory: false, size: buf.length, mtimeMs: 0 }
        if (isDir(path)) return { exists: true, isFile: false, isDirectory: true, size: 0, mtimeMs: 0 }
        return null
      },
      read: async (path: string, opts?: { encoding?: 'utf-8' | 'base64' }) => {
        const buf = files.get(path)
        if (buf === undefined) throw new Error(`文件不存在：${path}`)
        return opts?.encoding === 'base64' ? buf.toString('base64') : buf.toString('utf8')
      },
      write: async (path: string, data: string, opts?: { encoding?: 'utf-8' | 'base64'; append?: boolean; createDir?: boolean }) => {
        const buf = opts?.encoding === 'base64' ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf8')
        files.set(path, opts?.append ? Buffer.concat([files.get(path) ?? Buffer.alloc(0), buf]) : buf)
      },
      mkdir: async () => {}
    },
    notification: {
      show: async (title: string, body: string): Promise<void> => {
        notifications.push({ title, body })
      }
    },
    emit: (event: string, payload: unknown): void => {
      emits.push({ event, payload })
    }
  }

  return {
    ctx: ctx as unknown as BackendContext,
    files,
    storageMap,
    emits,
    notifications,
    state: () => (storageMap.get(STATE_KEY) as ShareState | undefined) ?? null
  }
}
