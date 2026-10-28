import { createApp } from 'vue'
import App from './shell/App.vue'
import { parseDeepLink } from './shell/deep-link'
import './assets/base.css'
import './assets/themes.css'

// 独立窗/飞窗标记要赶在首帧前：base.css 据此豁免主窗透明外圈 padding（data-wintx 规则误伤会让 .detached 底/右溢出）
const launchLink = parseDeepLink(location.hash)
if (launchLink?.isDetached || launchLink?.isFlyout) document.documentElement.dataset.detached = '1'
// 飞窗专属标记：边距环区 pointer-events:none 的作用域键（防吞主窗点击），独立窗/主窗不命中
if (launchLink?.isFlyout) document.documentElement.dataset.flyout = '1'

// 滚动条滚动时才显现（§1.7 overlay 气质）：scroll 不冒泡，用捕获监听给滚动容器挂临时 class，静止后摘除
const SCROLL_CLASS = 'is-scrolling'
let fadeTimer = 0
let lastTarget: Element | null = null

function setupScrollbarReveal(): void {
  document.addEventListener(
    'scroll',
    (e) => {
      const node = e.target instanceof Element ? e.target : document.documentElement
      if (lastTarget && lastTarget !== node) lastTarget.classList.remove(SCROLL_CLASS)
      lastTarget = node
      node.classList.add(SCROLL_CLASS)
      window.clearTimeout(fadeTimer)
      fadeTimer = window.setTimeout(() => {
        node.classList.remove(SCROLL_CLASS)
        if (lastTarget === node) lastTarget = null
      }, 800)
    },
    { capture: true, passive: true }
  )
}

// Electron 官方建议的全局拖放兜底：drop 未取消时 Chromium 默认导航到拖入文件，整个应用被替换。
// preventDefault 不阻断传播，App.vue 与插件自己的 drop 处理不受影响；挂在入口层同时覆盖独立窗口
for (const type of ['dragover', 'drop']) {
  document.addEventListener(type, (e) => e.preventDefault())
}

setupScrollbarReveal()
createApp(App).mount('#app')
