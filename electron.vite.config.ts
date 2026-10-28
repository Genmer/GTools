import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url))

// main 输出 ESM（Electron 44 支持，插件 backend 动态加载的前提）；
// preload 必须 CJS：sandbox 渲染器的 preload 不能用 ESM（与 DESIGN §2.1 的 sandbox:true 组合）
export default defineConfig({
  main: {
    // 防御性 exclude：pinyin-pro 当前仅渲染层消费（Vite 已 bundle），main/backend 若将来引用，
    // 无此参数会留裸导入——打包 files 已排除 node_modules，裸导入在 asar 内启动即崩
    plugins: [externalizeDepsPlugin({ exclude: ['pinyin-pro'] })],
    resolve: {
      alias: { '@sdk': r('./sdk') }
    },
    build: {
      rollupOptions: {
        input: { index: r('./src/main/index.ts') },
        output: { format: 'es', entryFileNames: '[name].mjs' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: r('./src/preload/index.ts'), float: r('./src/preload/float.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: r('./src/renderer'),
    plugins: [vue()],
    resolve: {
      alias: { '@sdk': r('./sdk'), '@shell': r('./src/renderer/src') }
    },
    build: {
      rollupOptions: { input: r('./src/renderer/index.html') }
    }
  }
})
