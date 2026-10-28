/**
 * 悬浮球 HTML 组装。浮窗是独立文档，拿不到宿主 themes.css 变量，
 * 配色集中定义在本文件（系统深浅色自适应）。进度环与钟面由内嵌脚本自走（读 endAt/totalMs），
 * backend 只在状态切换时整页重建。不用 -webkit-app-region:drag（吞 pointer 事件），
 * 轻点/双击/拖动由页内脚本配对。
 */

import { formatRemaining, remaining, type CountdownState } from './countdown'
import { formatClock, remainingMsOf, type PomodoroState } from './pomodoro'

/** 球直径：4px 进度环 + 相位/时间/副字三层内容需要呼吸空间（宿主下限 80） */
export const BALL_SIZE = 96

export interface BallModel {
  kind: 'countdown' | 'pomodoro'
  status: 'running' | 'paused' | 'expired'
  /** true 时钟面与进度环由内嵌脚本走秒 */
  live: boolean
  endAt: number | null
  /** 进度环分母（剩余比例 = 剩余 ms / totalMs） */
  totalMs: number
  /** 非走秒时的静态钟面（已格式化） */
  clockStatic: string
  phase?: 'focus' | 'break'
  /** 仅番茄：今日完成数 */
  today?: number
  /** 仅倒计时：用户标签 */
  label?: string
  /** 构建时定格的剩余比例（live 时被页内脚本首帧覆盖） */
  frac: number
}

/** 双 idle 返回 null（无活动会话，球无内容可展示） */
export function ballModelOf(countdown: CountdownState, pomodoro: PomodoroState, today: number, now: number): BallModel | null {
  if (countdown.status !== 'idle') {
    const live = countdown.status === 'running'
    const left = live ? remaining(countdown.endAt, now) : countdown.status === 'paused' ? countdown.remainingMs : 0
    return {
      kind: 'countdown',
      status: countdown.status,
      live,
      endAt: live ? countdown.endAt : null,
      totalMs: countdown.totalMs,
      clockStatic:
        countdown.status === 'paused'
          ? formatRemaining(countdown.remainingMs)
          : live
            ? formatRemaining(remaining(countdown.endAt, now))
            : '00:00',
      label: countdown.label,
      frac: countdown.totalMs > 0 ? Math.min(1, Math.max(0, left / countdown.totalMs)) : 0
    }
  }
  if (pomodoro.status !== 'idle') {
    const live = pomodoro.status === 'running'
    return {
      kind: 'pomodoro',
      status: pomodoro.status,
      live,
      endAt: live ? pomodoro.endAt : null,
      totalMs: pomodoro.totalMs,
      clockStatic: live ? formatClock(remainingMsOf(pomodoro, now)) : formatClock(pomodoro.remainingMs),
      phase: pomodoro.phase,
      today,
      frac: pomodoro.totalMs > 0 ? Math.min(1, Math.max(0, remainingMsOf(pomodoro, now) / pomodoro.totalMs)) : 0
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

function phaseText(m: BallModel): string {
  if (m.status === 'expired') return '时间到'
  if (m.status === 'paused') return '已暂停'
  if (m.kind === 'pomodoro') return m.phase === 'break' ? '休息' : '专注'
  return '倒计时'
}

function subText(m: BallModel): string {
  if (m.kind === 'pomodoro') return `今日 ${m.today ?? 0}`
  return m.label ?? ''
}

function titleOf(m: BallModel): string {
  if (m.label !== undefined && m.label !== '') return m.label
  if (m.kind === 'pomodoro') return m.phase === 'break' ? '休息中' : '专注中'
  return '倒计时'
}

export function buildBallHtml(m: BallModel): string {
  const stateClass = m.status === 'running' ? '' : ` ${m.status}`
  const kindClass = m.kind === 'pomodoro' ? (m.phase === 'break' ? ' k-break' : ' k-focus') : ' k-cd'
  const frac = m.status === 'expired' ? 0 : m.frac
  const sub = subText(m)
  const subHtml = sub !== '' ? `<span class="sub">${escapeHtml(sub)}</span>` : ''
  const script = `<script>
(function(){
  var b=document.getElementById('ball'),clock=document.getElementById('clock');
  if(!b)return;
  function emit(ev,pl){try{gtoolsFloat.emit(ev,pl)}catch(e){}}
  var endAt=${JSON.stringify(m.endAt)},kind=${JSON.stringify(m.kind)},live=${m.live ? 'true' : 'false'},total=${JSON.stringify(m.totalMs)};
  function f(ms){
    var t=Math.max(0,Math.ceil(ms/1000)),h=Math.floor(t/3600),m2=Math.floor((t%3600)/60),s=t%60;
    function p(n){return (n<10?'0':'')+n}
    if(kind==='countdown'&&h>0)return h+':'+p(m2)+':'+p(s);
    return p(m2)+':'+p(s)
  }
  function ringSet(v){b.style.setProperty('--p',Math.max(0,Math.min(1,v)).toFixed(4))}
  if(live&&typeof endAt==='number'){
    function u(){
      clock.textContent=f(endAt-Date.now());
      clock.classList.toggle('long',clock.textContent.length>5);
      ringSet(total>0?(endAt-Date.now())/total:0)
    }
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
  return `<div id="ball" class="ball${stateClass}${kindClass}" style="--p:${frac.toFixed(4)}" title="${escapeHtml(titleOf(m))}">
  <div class="face">
    <span class="ph">${escapeHtml(phaseText(m))}</span>
    <span id="clock" class="${m.clockStatic.includes(':') && m.clockStatic.split(':').length > 2 ? 'long' : ''}">${escapeHtml(m.clockStatic)}</span>
    ${subHtml}
  </div>
  <button class="x" title="关闭（计时不停）" onpointerdown="event.stopPropagation()" onpointerup="event.stopPropagation()" onclick="gtoolsFloat.close()">✕</button>
</div>
${script}
<style>
.ball{box-sizing:border-box;position:relative;width:100%;height:100%;border-radius:50%;
  --p:.5;--ring:#4c8dff;--ring-track:rgba(255,255,255,.16);
  background:conic-gradient(var(--ring) calc(var(--p)*1turn),var(--ring-track) 0);
  box-shadow:0 12px 30px rgba(0,0,0,.38);
  font:12px/1.4 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
  user-select:none;-webkit-user-select:none;touch-action:none}
.ball.k-cd{--ring:#4c8dff}
.ball.k-focus{--ring:#ff5d55}
.ball.k-break{--ring:#2bbfae}
.ball.paused{--ring:#8a9099}
.ball.expired{--ring:#f5a623;--ring-track:rgba(245,166,35,.26);animation:ball-breathe 1.6s ease-in-out infinite}
.face{position:absolute;inset:4px;border-radius:50%;
  background:rgba(23,25,30,.88);backdrop-filter:blur(14px) saturate(1.5);-webkit-backdrop-filter:blur(14px) saturate(1.5);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.07),inset 0 1px 2px rgba(255,255,255,.09);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:#f2f4f8}
.ph{display:flex;align-items:center;gap:4px;font-size:9.5px;letter-spacing:2px;color:rgba(242,244,248,.72)}
.ph::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--ring)}
#clock{font-size:21px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:.5px}
#clock.long{font-size:16px}
.sub{max-width:76px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:9.5px;color:rgba(242,244,248,.6)}
.ball.paused .face{opacity:.78}
.x{position:absolute;top:8px;right:10px;border:none;background:transparent;color:rgba(242,244,248,.55);
  font-size:10px;line-height:1;cursor:pointer;padding:3px;border-radius:50%;
  opacity:0;transition:opacity .12s}
.ball:hover .x{opacity:1}
.x:hover{color:#ff7b72}
@keyframes ball-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
@media (prefers-color-scheme:light){
  .ball{--ring-track:rgba(15,23,42,.1);box-shadow:0 12px 26px rgba(15,23,42,.22)}
  .face{background:rgba(250,250,252,.9);box-shadow:inset 0 0 0 1px rgba(15,23,42,.06),inset 0 1px 2px rgba(255,255,255,.8);color:#1f2328}
  .ph{color:rgba(31,35,40,.66)}
  .sub{color:rgba(31,35,40,.55)}
  .x{color:rgba(31,35,40,.5)}.x:hover{color:#cf222e}
}
</style>`
}
