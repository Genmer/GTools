import type { Component } from 'vue'

// Vite glob 懒加载插件渲染入口：新增 src/plugins/<id>/index.vue 即被发现，宿主零改动
const modules = import.meta.glob<{ default: Component }>('../../../plugins/*/index.vue')

export type EntryLoader = () => Promise<{ default: Component }>

export function getPluginEntryLoader(id: string): EntryLoader | null {
  return modules[`../../../plugins/${id}/index.vue`] ?? null
}

/** 懒加载失败重试（指数退避），弱网/冷启动下模块加载偶发抖动的兜底 */
export async function loadWithRetry<T>(loader: () => Promise<T>, retries = 3, baseDelay = 300): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; ; attempt++) {
    try {
      return await loader()
    } catch (err) {
      lastErr = err
      if (attempt >= retries) throw lastErr
      await new Promise((resolve) => setTimeout(resolve, baseDelay * 2 ** attempt))
    }
  }
}
