export type Rng = () => number

// mulberry32：可注种子的确定性 PRNG，测试与「同配置重放」都靠它
export function createRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 闭区间 [min, max] 整数 */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p
}

export function randomLetters(rng: Rng, minLen: number, maxLen: number): string {
  const len = randInt(rng, minLen, maxLen)
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(97 + randInt(rng, 0, 25))
  return s
}

export function randomDigits(rng: Rng, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += String(randInt(rng, 0, 9))
  return s
}
