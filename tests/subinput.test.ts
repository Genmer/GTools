import { describe, expect, it } from 'vitest'
import {
  resetSubInput,
  setSubInputValue,
  subInput,
  subInputBlur,
  subInputFocus,
  subInputSelect
} from '../src/renderer/src/core/subinput'

describe('subInput 桥状态', () => {
  it('初始态全零', () => {
    resetSubInput()
    expect(subInput.value).toBe('')
    expect(subInput.focusNonce).toBe(0)
    expect(subInput.blurNonce).toBe(0)
    expect(subInput.selectNonce).toBe(0)
  })

  it('setSubInputValue 写 value（可含空串清空）', () => {
    resetSubInput()
    setSubInputValue('abc')
    expect(subInput.value).toBe('abc')
    setSubInputValue('')
    expect(subInput.value).toBe('')
  })

  it('focus/blur/select 各自自增 nonce，互不影响', () => {
    resetSubInput()
    subInputFocus()
    subInputFocus()
    subInputBlur()
    subInputSelect()
    expect(subInput.focusNonce).toBe(2)
    expect(subInput.blurNonce).toBe(1)
    expect(subInput.selectNonce).toBe(1)
    expect(subInput.value).toBe('')
  })

  it('nonce 连续自增（SearchBox 以变化沿驱动焦点动作，重复调用也各自成沿）', () => {
    resetSubInput()
    for (let i = 1; i <= 5; i++) {
      subInputFocus()
      expect(subInput.focusNonce).toBe(i)
    }
  })

  it('resetSubInput 清零 value 与全部 nonce', () => {
    setSubInputValue('xyz')
    subInputFocus()
    subInputBlur()
    subInputSelect()
    resetSubInput()
    expect(subInput.value).toBe('')
    expect(subInput.focusNonce).toBe(0)
    expect(subInput.blurNonce).toBe(0)
    expect(subInput.selectNonce).toBe(0)
  })
})
