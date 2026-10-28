// 浮窗页面 HTML 构建：dataUrl/主题变量双重净化；无边框纯图，控制条首贴可见后空闲淡出
import { clampOpacity, MAX_WINDOW, MIN_WINDOW } from './state'

/** 从宿主 themes.css 解析出的主题变量名（浮窗是独立 data: 文档，无法直接引用 themes.css） */
export const FLOAT_THEME_VARS = ['--bg-raised', '--fg', '--fg-dim', '--border', '--accent', '--danger'] as const
export type ThemeVarName = (typeof FLOAT_THEME_VARS)[number]

const DATA_URL_RE = /^data:image\/(png|jpeg|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/
/** 主题变量值只许颜色记法字符（含 calc 算术 + *），杜绝经变量注入 CSS */
const COLOR_VALUE_RE = /^[-+#a-zA-Z0-9 ,.%()*]{1,120}$/
const DEFAULT_MAX_DATA_URL = 1_900_000
/** 控制条首贴强制可见时长，之后切 .idle 淡出（终态与旧隐藏态一致） */
const BAR_INTRO_MS = 3000

export function sanitizeDataUrl(u: unknown, maxLen = DEFAULT_MAX_DATA_URL): string | null {
  if (typeof u !== 'string' || u.length === 0 || u.length > maxLen) return null
  return DATA_URL_RE.test(u) ? u : null
}

export function extractThemeVars(readVar: (name: ThemeVarName) => string): Record<ThemeVarName, string> {
  const out = {} as Record<ThemeVarName, string>
  for (const name of FLOAT_THEME_VARS) {
    const v = readVar(name).trim()
    if (v !== '') out[name] = v
  }
  return out
}

export interface FloatHtmlOptions {
  themeVars: Record<string, string>
  /** 页面内初始不透明度（0.15–1），之后由浮窗内滑杆自治 */
  opacity: number
}

export function buildFloatHtml(dataUrl: string, opts: FloatHtmlOptions): string {
  const safeUrl = sanitizeDataUrl(dataUrl)
  if (!safeUrl) throw new Error('图片数据不合法（须为 image/* 的 base64 dataUrl）')

  const varLines: string[] = []
  for (const name of FLOAT_THEME_VARS) {
    const v = opts.themeVars[name]
    if (typeof v !== 'string' || !COLOR_VALUE_RE.test(v)) {
      throw new Error(`主题变量缺失或非法：${name}`)
    }
    varLines.push(`${name}:${v}`)
  }

  const opacityInit = Math.round(clampOpacity(opts.opacity) * 100)

  const style = [
    ':root{' + varLines.join(';') + '}',
    '.pin{position:fixed;inset:0;border-radius:10px;overflow:hidden}',
    '.stage{position:absolute;inset:0}',
    '.stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}',
    // 控制条首贴 3s 强制可见，之后 JS 切 .idle 淡出；恢复只能靠 .pin:hover 类规则——
    // 淡出若用内联 style.opacity=0 收尾会压过类规则，hover 就救不回来了
    '.bar{position:absolute;left:50%;bottom:8px;transform:translate(-50%,0);display:flex;align-items:center;',
    'gap:2px;height:34px;padding:0 6px;border-radius:10px;',
    'background:color-mix(in srgb,var(--bg-raised) 88%,transparent);border:1px solid var(--border);',
    'color:var(--fg);user-select:none;opacity:1;pointer-events:auto;',
    'backdrop-filter:blur(12px);transition:opacity .16s ease,transform .16s ease}',
    '.bar.idle{opacity:0;pointer-events:none;transform:translate(-50%,10px)}',
    '.pin:hover .bar{opacity:1;transform:translate(-50%,0);pointer-events:auto}',
    '.grip{color:var(--fg-dim);font-size:11px;letter-spacing:-1px;cursor:move;padding:0 4px}',
    '.sep{flex:none;width:1px;height:16px;margin:0 3px;background:var(--border)}',
    'input[type=range]{width:80px;accent-color:var(--accent)}',
    '.opv{flex:none;width:32px;text-align:right;color:var(--fg-dim);font-size:11px;',
    'font-variant-numeric:tabular-nums}',
    '.b{flex:none;background:transparent;border:none;color:var(--fg);font-size:13px;line-height:1;',
    'min-width:24px;height:24px;padding:0 4px;border-radius:6px;cursor:pointer;font-family:inherit}',
    '.b:hover{color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,transparent)}',
    '.b.close:hover{color:var(--danger);background:color-mix(in srgb,var(--danger) 14%,transparent)}'
  ].join('')

  // 页面 JS 只用单引号字符串，避免与外层模板串冲突；几何交互（拖动/缩放）本地累计后经
  // gtoolsFloat.setBounds 直落主进程，不依赖插件视图存活；zoom/reset/state 事件仅作持久化回传
  const script = [
    "(function(){'use strict';",
    "var img=document.getElementById('img'),op=document.getElementById('opacity'),opv=document.getElementById('opv'),",
    "stage=document.getElementById('stage'),bar=document.getElementById('bar');",
    `var MINW=${MIN_WINDOW},MAXW=${MAX_WINDOW};`,
    'var cur={w:window.innerWidth,h:window.innerHeight};',
    'function clampSize(n){n=Math.round(n);if(!isFinite(n))return MINW;return Math.min(MAXW,Math.max(MINW,n))}',
    'function emit(n,p){try{window.gtoolsFloat.emit(n,p)}catch(e){}}',
    "function setImgOpacity(){img.style.opacity=String(op.value/100);opv.textContent=op.value+'%'}",
    "var lastSent='';",
    'function report(force){var s={x:window.screenX,y:window.screenY,width:cur.w,height:cur.h,opacity:op.value/100};',
    "var k=JSON.stringify(s);if(force!==true&&k===lastSent)return;lastSent=k;emit('state',s)}",
    'var pending={},inFlight=false;',
    'function flushBounds(){',
    'if(inFlight)return;',
    'if(Object.keys(pending).length===0)return;',
    'var b=pending;pending={};inFlight=true;',
    'try{window.gtoolsFloat.setBounds(b).then(function(){inFlight=false;flushBounds()},function(){inFlight=false})}',
    'catch(e){inFlight=false}}',
    'function pushBounds(b){for(var k in b)pending[k]=b[k];flushBounds()}',
    'function sendSize(){pushBounds({width:cur.w,height:cur.h})}',
    'function zoom(f){',
    "emit('zoom',{factor:f,width:cur.w,height:cur.h});",
    'cur.w=clampSize(cur.w*f);cur.h=clampSize(cur.h*f);',
    'sendSize();report(true)}',
    'function reset(){',
    'var nw=img.naturalWidth,nh=img.naturalHeight;',
    "emit('reset',{naturalWidth:nw,naturalHeight:nh});",
    'if(nw>0&&nh>0){cur.w=clampSize(nw);cur.h=clampSize(nh);sendSize()}',
    'report(true)}',
    "window.addEventListener('wheel',function(e){e.preventDefault();zoom(e.deltaY<0?1.1:1/1.1)},{passive:false});",
    // dblclick/dragstart 挂 stage 而非 img：拖拽捕获把后续鼠标事件重定向到 stage，img 级监听收不到
    "stage.addEventListener('dblclick',reset);",
    "stage.addEventListener('dragstart',function(e){e.preventDefault()});",
    'var drag=null;',
    // 拖拽跟手：按屏幕坐标增量累计（真实鼠标的 screenX 是光标屏幕位置，与窗口自身位移无关；
    // CDP 合成事件按视口坐标折算会带窗口走，探针须按目标屏幕位反解视口坐标）
    // pointerdown 只做捕获兜底（快速拖出窗仍持续收 move）
    "stage.addEventListener('pointerdown',function(e){try{stage.setPointerCapture(e.pointerId)}catch(err){}});",
    "stage.addEventListener('mousedown',function(e){",
    'if(e.button!==0)return;',
    'drag={lx:e.screenX,ly:e.screenY,px:window.screenX,py:window.screenY};',
    "e.preventDefault()});",
    // grip 与图区共用一套增量拖拽：浮窗 resizable:false 下 app-region 命中行为不可依赖，统一走 JS 路径
    "var grip=document.getElementById('grip');",
    "grip.addEventListener('pointerdown',function(e){try{grip.setPointerCapture(e.pointerId)}catch(err){}});",
    "grip.addEventListener('mousedown',function(e){",
    'if(e.button!==0)return;',
    'drag={lx:e.screenX,ly:e.screenY,px:window.screenX,py:window.screenY};',
    "e.preventDefault()});",
    "window.addEventListener('mousemove',function(e){",
    'if(drag===null)return;',
    "drag.px+=e.screenX-drag.lx;drag.py+=e.screenY-drag.ly;drag.lx=e.screenX;drag.ly=e.screenY;",
    "pushBounds({x:Math.round(drag.px),y:Math.round(drag.py)})});",
    "window.addEventListener('mouseup',function(){if(drag===null)return;drag=null;report(true)});",
    "window.addEventListener('pointercancel',function(){if(drag===null)return;drag=null;report(true)});",
    "window.addEventListener('resize',function(){cur.w=window.innerWidth;cur.h=window.innerHeight});",
    "document.getElementById('bar').addEventListener('click',function(e){",
    "var b=e.target.closest('button[data-act]');if(!b)return;var a=b.getAttribute('data-act');",
    "if(a==='close'){emit('closing',null);try{window.gtoolsFloat.close()}catch(err){}return}",
    "if(a==='reset'){reset();return}",
    "zoom(a==='in'?1.25:0.8)});",
    "op.addEventListener('input',function(){setImgOpacity();report(true)});",
    "document.addEventListener('keydown',function(e){if(e.key==='Escape'){try{window.gtoolsFloat.close()}catch(err){}}});",
    "img.addEventListener('load',function(){report(true)});",
    "window.addEventListener('pagehide',function(){report(true)});",
    `setTimeout(function(){bar.classList.add('idle')},${BAR_INTRO_MS});`,
    'setInterval(function(){report(false)},2000);',
    'setImgOpacity()})()'
  ].join('')

  return (
    `<style>${style}</style>` +
    `<div id="pin" class="pin">` +
    `<div id="stage" class="stage" title="拖动移动 · 滚轮缩放 · 双击 1:1">` +
    `<img id="img" alt="" draggable="false" src="${safeUrl}"/></div>` +
    `<div id="bar" class="bar">` +
    `<span id="grip" class="grip" title="拖动移动">⋮⋮</span>` +
    `<button type="button" class="b no-drag" data-act="out" title="缩小">−</button>` +
    `<button type="button" class="b no-drag" data-act="in" title="放大">＋</button>` +
    `<button type="button" class="b no-drag" data-act="reset" title="原始比例（双击图片同效）">1:1</button>` +
    `<span class="sep"></span>` +
    `<input id="opacity" class="no-drag" type="range" min="15" max="100" step="5" value="${opacityInit}" title="不透明度"/>` +
    `<span id="opv" class="opv">${opacityInit}%</span>` +
    `<span class="sep"></span>` +
    `<button type="button" class="b close no-drag" data-act="close" title="关闭（Esc）">✕</button>` +
    `</div>` +
    `</div>` +
    `<script>${script}<\/script>`
  )
}
