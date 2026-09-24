// node 侧编译（tsconfig.node.json 的 lib 无 DOM）收 tests/** 进编译图；
// shell/router.ts 等 window 出口被 node 单测引用时，用与 env.d.ts 对齐的最小 shim 满足类型
declare const window: {
  gtools: {
    host(api: string, payload?: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }>
    on(channel: string, listener: (payload: unknown) => void): (() => void) | undefined
  }
}
