import type { Permission, PluginManifest, PluginCommand } from './manifest'

export const PROTOCOL_VERSION = 1 as const
export type { Permission, PluginManifest, PluginCommand }
export * from './api'
export * from './shortcut-rules'
export * from './settings'
