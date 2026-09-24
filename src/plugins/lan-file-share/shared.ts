/** 渲染层与 backend 共享的协议类型与常量（双方唯一 import 交集，须保持纯浏览器安全） */

export const CONFIG_KEY = 'config'
export const CONTROL_KEY = 'control'
export const STATE_KEY = 'state'

export const DEFAULT_PORT = 3776
export const MIN_PORT = 1024
export const MAX_PORT = 65535
/** 端口被占时向后尝试的次数（含首次共尝试 portAttempts 个端口） */
export const PORT_ATTEMPTS = 10
export const LOG_CAP = 100
export const DEVICE_CAP = 20
export const DEVICE_TTL_MS = 30 * 60 * 1000

export type ControlOp = 'start' | 'stop'

export interface ControlMessage {
  /** 单调递增序号，backend 处理后回显到 state.lastHandledId 供渲染层确认 */
  id: number
  op: ControlOp
  dir?: string
  port?: number
}

export interface ShareConfig {
  dir: string | null
  port: number
}

export interface DeviceInfo {
  ip: string
  label: string
  firstSeen: number
  lastSeen: number
  requests: number
}

export type LogKind = 'start' | 'stop' | 'connect' | 'upload' | 'download' | 'zip' | 'error'

export interface TransferLogEntry {
  t: number
  kind: LogKind
  device: string
  name?: string
  size?: number
  detail?: string
}

export interface ShareState {
  running: boolean
  port: number | null
  dir: string | null
  startedAt: number | null
  error: string | null
  lastHandledId: number
  devices: DeviceInfo[]
  log: TransferLogEntry[]
}

export function normalizePort(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10)
  if (!Number.isInteger(n) || n < MIN_PORT || n > MAX_PORT) return null
  return n
}

export function parseConfig(raw: unknown): ShareConfig {
  const obj = (raw ?? {}) as Partial<ShareConfig>
  return {
    dir: typeof obj.dir === 'string' && obj.dir !== '' ? obj.dir : null,
    port: normalizePort(obj.port) ?? DEFAULT_PORT
  }
}

export function parseControl(raw: unknown): ControlMessage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const c = raw as Partial<ControlMessage>
  if (typeof c.id !== 'number' || !Number.isFinite(c.id)) return null
  if (c.op !== 'start' && c.op !== 'stop') return null
  const out: ControlMessage = { id: c.id, op: c.op }
  if (typeof c.dir === 'string' && c.dir !== '') out.dir = c.dir
  if (typeof c.port === 'number') out.port = c.port
  return out
}

export function shareUrl(ip: string, port: number): string {
  return `http://${ip}:${port}/`
}
