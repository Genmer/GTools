/**
 * 便签浮窗 HTML 组装。浮窗是独立文档，拿不到宿主 themes.css 变量，
 * 颜色只能集中定义在本文件（系统深浅色自适应），不要散落到别处。
 * 页面自走秒（内嵌脚本读 endAt），backend 只在状态切换时重建，避免每秒 loadURL 闪屏。
 */

import { formatClock, type TimerState } from './timer'

export const NOTE_WIDTH = 224
export const NOTE_HEIGHT = 96

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface NoteModel {
  /** 主题词：专注中 / 休息中 / 已暂停 / 今日 N 🍅 … */
  headline: string
  /** true 时钟面由内嵌脚本走秒 */
  live: boolean
  endAt: number | null
  /** 非走秒时的静态钟面（已格式化） */
  clockStatic: string
  title: string
  today: number
}

export function noteModelOf(state: TimerState, today: number, _now: number): NoteModel {
  const base = { today, title: state.linkedTodoTitle }
  if (state.status === 'running') {
    return {
      ...base,
      headline: state.phase === 'focus' ? '专注中' : '休息中',
      live: true,
      endAt: state.endAt,
      clockStatic: ''
    }
  }
  if (state.status === 'paused') {
    return {
      ...base,
      headline: state.phase === 'focus' ? '专注已暂停' : '休息已暂停',
      live: false,
      endAt: null,
      clockStatic: formatClock(state.remainingMs)
    }
  }
  return {
    ...base,
    headline: today > 0 ? `今日 ${today} 🍅` : '番茄钟待命',
    live: false,
    endAt: null,
    clockStatic: `× ${today}`
  }
}

export function buildNoteHtml(m: NoteModel): string {
  const titleHtml = m.title !== '' ? `<span class="tt" title="${escapeHtml(m.title)}">${escapeHtml(m.title)}</span>` : ''
  const clock = m.live
    ? `<div class="ck" id="c">${m.clockStatic || '00:00'}</div>
<script>
(function(){
  var endAt=${JSON.stringify(m.endAt)},el=document.getElementById('c');
  if(!el||typeof endAt!=='number')return;
  function f(ms){var t=Math.max(0,Math.ceil(ms/1000)),m2=Math.floor(t/60),s=t%60;
    return (m2<10?'0':'')+m2+':'+(s<10?'0':'')+s}
  function u(){el.textContent=f(endAt-Date.now())}
  u();setInterval(u,500)
})()
</script>`
    : `<div class="ck">${escapeHtml(m.clockStatic)}</div>`
  return `<div class="drag root">
  <div class="hd"><span class="ph">${escapeHtml(m.headline)}</span>${titleHtml}<button class="no-drag x" title="关闭" onclick="gtoolsFloat.close()">✕</button></div>
  ${clock}
  <div class="ft">今日 ${m.today} 🍅 · 番茄钟</div>
</div>
<style>
.root{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;gap:2px;
  padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.92);color:#1f2328;
  box-shadow:0 4px 16px rgba(0,0,0,.18);font:12px/1.4 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.hd{display:flex;align-items:center;gap:6px;min-width:0}
.ph{flex:none;font-weight:600}
.tt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#59626d}
.x{flex:none;border:none;background:transparent;color:#59626d;font-size:12px;cursor:pointer;padding:0 2px;border-radius:4px}
.x:hover{color:#cf222e}
.ck{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:1px}
.ft{color:#59626d;font-size:11px}
@media (prefers-color-scheme:dark){
  .root{background:rgba(30,30,32,.92);color:#f5f5f5}
  .tt,.ft{color:#9aa0a6}
  .x{color:#9aa0a6}.x:hover{color:#f85149}
}
</style>`
}
