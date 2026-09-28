import { reactive } from 'vue'

/**
 * 插件经 host.subInput 操纵主输入框的纯状态桥（无 DOM，node vitest 可测）。
 * SearchBox 监听 nonce 执行对应焦点动作、监听 value 回写 router.query。
 */
export interface SubInputState {
  value: string
  focusNonce: number
  blurNonce: number
  selectNonce: number
}

export const subInput = reactive<SubInputState>({ value: '', focusNonce: 0, blurNonce: 0, selectNonce: 0 })

export function setSubInputValue(v: string): void {
  subInput.value = v
}

export function subInputFocus(): void {
  subInput.focusNonce++
}

export function subInputBlur(): void {
  subInput.blurNonce++
}

export function subInputSelect(): void {
  subInput.selectNonce++
}

export function resetSubInput(): void {
  subInput.value = ''
  subInput.focusNonce = 0
  subInput.blurNonce = 0
  subInput.selectNonce = 0
}

/**
 * host.subInput 能力面。sdk HostApi 的 subInput 成员声明归 P1 车道（尚未落地），
 * 宿主侧先以交集类型实现，P1 落地后与 HostApi.subInput 天然对齐。
 */
export interface SubInputApi {
  setValue(v: string): Promise<void>
  focus(): Promise<void>
  blur(): Promise<void>
  select(): Promise<void>
}
