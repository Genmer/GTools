import { createApp } from 'vue'
import App from './shell/App.vue'
import './assets/base.css'
import './assets/themes.css'

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

setupScrollbarReveal()
createApp(App).mount('#app')
