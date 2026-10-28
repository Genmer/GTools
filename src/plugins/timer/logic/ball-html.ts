/**
 * 悬浮球 HTML 组装。浮窗是独立文档，拿不到宿主 themes.css 变量，
 * 颜色集中定义在本文件（系统深浅色自适应），不要散落到别处。
 * 页面自走秒（内嵌脚本读 endAt），backend 只在状态切换时整页重建。
 * 不用 -webkit-app-region:drag（吞 pointer 事件），轻点/双击/拖动由页内脚本配对。
 */

import { formatRemaining, remaining, type CountdownState } from './countdown'
import { formatClock, remainingMsOf, type PomodoroState } from './pomodoro'

/** FloatWindowManager MIN_SIZE=80，球取最小窗尺寸 */
export const BALL_SIZE = 80

export interface BallModel {
  kind: 'countdown' | 'pomodoro'
  status: 'running' | 'paused' | 'expired'
  /** true 时钟面由内嵌脚本走秒 */
  live: boolean
  endAt: number | null
  /** 非走秒时的静态钟面（已格式化） */
  clockStatic: string
  phase?: 'focus' | 'break'
  /** 仅番茄：今日完成数（球面 ×N） */
  today?: number
  /** 仅倒计时：用户标签 */
  label?: string
}

/** 双 idle 返回 null（无活动会话，球无内容可展示） */
export function ballModelOf(countdown: CountdownState, pomodoro: PomodoroState, today: number, now: number): BallModel | null {
  if (countdown.status !== 'idle') {
    const live = countdown.status === 'running'
    return {
      kind: 'countdown',
      status: countdown.status,
      live,
      endAt: live ? countdown.endAt : null,
      clockStatic:
        countdown.status === 'paused'
          ? formatRemaining(countdown.remainingMs)
          : live
            ? formatRemaining(remaining(countdown.endAt, now))
            : '00:00',
      label: countdown.label
    }
  }
  if (pomodoro.status !== 'idle') {
    const live = pomodoro.status === 'running'
    return {
      kind: 'pomodoro',
      status: pomodoro.status,
      live,
      endAt: live ? pomodoro.endAt : null,
      clockStatic: live ? formatClock(remainingMsOf(pomodoro, now)) : formatClock(pomodoro.remainingMs),
      phase: pomodoro.phase,
      today
    }
  }
  return null
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function titleOf(m: BallModel): string {
  if (m.label !== undefined && m.label !== '') return m.label
  if (m.kind === 'pomodoro') return m.phase === 'break' ? '休息中' : '专注中'
  return '倒计时'
}

export function buildBallHtml(m: BallModel): string {
  const stateClass = m.status === 'running' ? '' : ` ${m.status}`
  const badge = m.kind === 'pomodoro' ? `<span class="badge">${m.phase === 'break' ? '☕' : '🍅'}</span>` : ''
  const sub = m.kind === 'pomodoro' ? `<span class="sub">×${m.today ?? 0}</span>` : ''
  const script = `<script>
(function(){
  var b=document.getElementById('ball'),clock=document.getElementById('clock');
  if(!b)return;
  function emit(ev,pl){try{gtoolsFloat.emit(ev,pl)}catch(e){}}
  var endAt=${JSON.stringify(m.endAt)},kind=${JSON.stringify(m.kind)},live=${m.live ? 'true' : 'false'};
  function f(ms){
    var t=Math.max(0,Math.ceil(ms/1000)),h=Math.floor(t/3600),m2=Math.floor((t%3600)/60),s=t%60;
    function p(n){return (n<10?'0':'')+n}
    if(kind==='countdown'&&h>0)return h+':'+p(m2)+':'+p(s);
    return p(m2)+':'+p(s)
  }
  if(live&&typeof endAt==='number'){
    function u(){clock.textContent=f(endAt-Date.now())}
    u();setInterval(u,500)
  }
  var pressed=false,dragging=false,sx=0,sy=0,lx=0,ly=0,tapT=null,lastTap=0;
  function clearTap(){if(tapT!==null){clearTimeout(tapT);tapT=null}}
  b.addEventListener('pointerdown',function(e){
    if(e.button!==0)return;
    pressed=true;dragging=false;sx=e.clientX;sy=e.clientY;lx=e.clientX;ly=e.clientY;
    try{b.setPointerCapture(e.pointerId)}catch(_){}
  });
  b.addEventListener('pointermove',function(e){
    if(!pressed)return;
    if(!dragging){
      if(Math.abs(e.clientX-sx)<=4&&Math.abs(e.clientY-sy)<=4)return;
      dragging=true
    }
    emit('drag-move',{dx:e.clientX-lx,dy:e.clientY-ly});
    lx=e.clientX;ly=e.clientY
  });
  b.addEventListener('pointerup',function(e){
    if(e.button!==0)return;
    pressed=false;
    try{b.releasePointerCapture(e.pointerId)}catch(_){}
    if(dragging){dragging=false;return}
    var now=Date.now();
    if(now-lastTap<300){clearTap();lastTap=0;emit('ball-action',{action:'dblclick'});return}
    lastTap=now;clearTap();
    tapT=setTimeout(function(){tapT=null;emit('ball-action',{action:'click'})},280)
  });
  b.addEventListener('pointercancel',function(){pressed=false;dragging=false;clearTap()});
  var px=null,py=null;
  function pos(force){
    var x=window.screenX,y=window.screenY;
    if(!force&&x===px&&y===py)return;
    px=x;py=y;emit('ball-pos',{x:x,y:y})
  }
  pos(true);
  setInterval(function(){pos(false)},1500);
  window.addEventListener('pagehide',function(){pos(true)})
})()
</script>`
  return `<div id="ball" class="ball${stateClass}" title="${escapeHtml(titleOf(m))}">
  ${badge}<button class="x" title="关闭（计时不停）" onpointerdown="event.stopPropagation()" onpointerup="event.stopPropagation()" onclick="gtoolsFloat.close()">✕</button>
  <div class="core"><span id="clock">${escapeHtml(m.clockStatic)}</span>${sub}</div>
</div>
${script}
<style>
.ball{box-sizing:border-box;position:relative;width:100%;height:100%;border-radius:50%;
  background:rgba(255,255,255,.93);color:#1f2328;
  box-shadow:0 4px 14px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;
  font:12px/1.4 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
  user-select:none;-webkit-user-select:none;touch-action:none}
.core{display:flex;align-items:baseline;gap:2px}
#clock{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:.5px}
.sub{font-size:10px;color:#59626d}
.badge{position:absolute;top:5px;left:7px;font-size:12px;line-height:1}
.x{position:absolute;top:3px;right:4px;border:none;background:transparent;color:#59626d;
  font-size:10px;line-height:1;cursor:pointer;padding:3px;border-radius:4px;
  opacity:0;transition:opacity .12s}
.ball:hover .x{opacity:1}
.x:hover{color:#cf222e}
.ball.paused{opacity:.72;filter:grayscale(.6)}
.ball.expired{box-shadow:0 0 0 2px #f0883e,0 4px 14px rgba(0,0,0,.2);animation:ball-breathe 1.6s ease-in-out infinite}
@keyframes ball-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@media (prefers-color-scheme:dark){
  .ball{background:rgba(30,30,32,.92);color:#f5f5f5}
  .sub{color:#9aa0a6}
  .x{color:#9aa0a6}.x:hover{color:#f85149}
  .ball.expired{box-shadow:0 0 0 2px #f0883e,0 4px 14px rgba(0,0,0,.5)}
}
</style>`
}
