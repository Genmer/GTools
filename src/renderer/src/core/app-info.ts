import { reactive } from 'vue'

// app.platform/version 真值单一源：app:init 到达前以 UA 占位（插件首帧即有值），到达后经 fillAppInfo 回填
function guessFromUa(ua: string): string {
  return ua.includes('Windows') ? 'win32' : ua.includes('Mac') ? 'darwin' : 'linux'
}

export const appInfo = reactive({ platform: guessFromUa(navigator.userAgent), version: '' })

/** 只采纳非空值（幂等回填）：占位可被真值覆盖，真值不会被空串/undefined 冲掉 */
export function fillAppInfo(patch: { platform?: string; version?: string }): void {
  if (patch.platform) appInfo.platform = patch.platform
  if (patch.version) appInfo.version = patch.version
}

/** 仅供测试的内部导出：UA → 平台三值映射 */
export function _guessFromUa(ua: string): string {
  return guessFromUa(ua)
}
