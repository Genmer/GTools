// 浮窗页面 HTML 构建：dataUrl/主题变量双重净化；无边框纯图，控制条 hover 时底部浮出
import { clampOpacity } from './state'

/** 从宿主 themes.css 解析出的主题变量名（浮窗是独立 data: 文档，无法直接引用 themes.css） */
export const FLOAT_THEME_VARS = ['--bg-raised', '--fg', '--fg-dim', '--border', '--accent', '--danger'] as const
export type ThemeVarName = (typeof FLOAT_THEME_VARS)[number]

const DATA_URL_RE = /^data:image\/(png|jpeg|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/
/** 主题变量值只许颜色记法字符，杜绝经变量注入 CSS */
const COLOR_VALUE_RE = /^[-#a-zA-Z0-9 ,.%()/]{1,80}$/
const DEFAULT_MAX_DATA_URL = 1_900_000

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
    // 控制条平时完全隐形（pointer-events:none 才不挡图片双击），hover 窗口任意处从底部浮出
    '.bar{position:absolute;left:50%;bottom:8px;transform:translate(-50%,10px);display:flex;align-items:center;',
    'gap:2px;height:34px;padding:0 6px;border-radius:10px;',
    'background:color-mix(in srgb,var(--bg-raised) 88%,transparent);border:1px solid var(--border);',
    'color:var(--fg);user-select:none;opacity:0;pointer-events:none;',
    'backdrop-filter:blur(12px);transition:opacity .16s ease,transform .16s ease}',
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

  // 页面 JS 只用单引号字符串，避免与外层模板串冲突；尺寸/位置类交互全部经 gtoolsFloat.emit 回创建方处理
  const script = [
    "(function(){'use strict';",
    "var img=document.getElementById('img'),op=document.getElementById('opacity'),opv=document.getElementById('opv');",
    'function emit(n,p){try{window.gtoolsFloat.emit(n,p)}catch(e){}}',
    "function setImgOpacity(){img.style.opacity=String(op.value/100);opv.textContent=op.value+'%'}",
    "var lastSent='';",
    'function report(force){var s={x:window.screenX,y:window.screenY,width:window.innerWidth,height:window.innerHeight,opacity:op.value/100};',
    "var k=JSON.stringify(s);if(force!==true&&k===lastSent)return;lastSent=k;emit('state',s)}",
    "function zoom(f){emit('zoom',{factor:f,width:window.innerWidth,height:window.innerHeight})}",
    "function reset(){emit('reset',{naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight})}",
    "window.addEventListener('wheel',function(e){e.preventDefault();zoom(e.deltaY<0?1.1:1/1.1)},{passive:false});",
    "img.addEventListener('dblclick',reset);",
    "document.getElementById('bar').addEventListener('click',function(e){",
    "var b=e.target.closest('button[data-act]');if(!b)return;var a=b.getAttribute('data-act');",
    "if(a==='close'){emit('closing',null);try{window.gtoolsFloat.close()}catch(err){}return}",
    "if(a==='reset'){reset();return}",
    "zoom(a==='in'?1.25:0.8)});",
    "op.addEventListener('input',function(){setImgOpacity();report(true)});",
    "document.addEventListener('keydown',function(e){if(e.key==='Escape'){try{window.gtoolsFloat.close()}catch(err){}}});",
    "img.addEventListener('load',function(){report(true)});",
    "window.addEventListener('pagehide',function(){report(true)});",
    'setInterval(function(){report(false)},2000);',
    'setImgOpacity()})()'
  ].join('')

  return (
    `<style>${style}</style>` +
    `<div id="pin" class="pin">` +
    `<div class="stage"><img id="img" alt="" src="${safeUrl}"/></div>` +
    `<div id="bar" class="bar drag">` +
    `<span class="grip" title="拖动移动">⋮⋮</span>` +
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
