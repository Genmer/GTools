/**
 * 手机端单文件页面（无外部依赖，内联样式/脚本——它运行在手机浏览器里，
 * 用不了 GTools 的 themes.css 变量，只能自带一套中性深色样式）。
 * 页内脚本只用字符串拼接，避免与外层 TS 模板字面量的 ${ 冲突。
 */
export function mobilePageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>局域网文件共享</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
body { margin:0; font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; background:#16181d; color:#e8eaed; padding-bottom:76px; }
header { position:sticky; top:0; z-index:5; background:#1d2026ee; backdrop-filter:blur(8px); padding:calc(10px + env(safe-area-inset-top)) 14px 10px; border-bottom:1px solid #2a2e36; }
h1 { margin:0 0 6px; font-size:15px; font-weight:600; }
h1 .dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:#34c77b; margin-right:6px; }
.crumb { font-size:13px; color:#9aa3af; line-height:1.6; word-break:break-all; }
.crumb a { color:#7ab4ff; text-decoration:none; }
main { padding:6px 10px; }
.row { display:flex; align-items:center; gap:10px; padding:11px 8px; border-bottom:1px solid #23262d; }
.row:active { background:#1f232b; }
.row .ic { font-size:22px; flex:none; width:30px; text-align:center; }
.row .nm { flex:1; min-width:0; }
.row .nm .n { font-size:15px; word-break:break-all; }
.row .nm .s { font-size:12px; color:#8b929d; margin-top:2px; }
.row .box { flex:none; width:22px; height:22px; }
.empty { text-align:center; color:#8b929d; padding:60px 0; font-size:14px; }
footer { position:fixed; left:0; right:0; bottom:0; z-index:5; display:flex; gap:10px; padding:12px 14px calc(12px + env(safe-area-inset-bottom)); background:#1d2026ee; backdrop-filter:blur(8px); border-top:1px solid #2a2e36; }
button, .btn { flex:1; border:1px solid #39404c; background:#262b33; color:#e8eaed; border-radius:10px; padding:11px 8px; font-size:14px; text-align:center; }
button.primary { background:#2f6fd8; border-color:#2f6fd8; color:#fff; }
button:disabled { opacity:.45; }
label.up { flex:1.2; position:relative; overflow:hidden; }
label.up input { position:absolute; left:-9999px; }
#mask { position:fixed; inset:0; z-index:9; background:#0d0e12; display:flex; flex-direction:column; }
#mask .top { display:flex; gap:8px; padding:calc(8px + env(safe-area-inset-top)) 12px 8px; }
#mask .body { flex:1; min-height:0; display:flex; align-items:center; justify-content:center; }
#mask img { max-width:100%; max-height:100%; object-fit:contain; }
#mask video { max-width:100%; max-height:100%; }
#mask iframe { width:100%; height:100%; border:0; }
#mask pre { margin:0; padding:14px; width:100%; height:100%; overflow:auto; font-size:13px; white-space:pre-wrap; color:#c6ccd4; }
#toast { position:fixed; left:50%; bottom:96px; transform:translateX(-50%); background:#2b3038; color:#e8eaed; border:1px solid #39404c; border-radius:8px; padding:8px 14px; font-size:13px; opacity:0; transition:opacity .25s; pointer-events:none; max-width:80%; }
#prog { position:fixed; left:14px; right:14px; bottom:88px; z-index:8; display:none; background:#1d2026; border:1px solid #2a2e36; border-radius:10px; padding:10px 12px; font-size:12px; color:#c6ccd4; }
#prog .bar { height:5px; border-radius:3px; background:#2b3038; margin-top:7px; overflow:hidden; }
#prog .bar i { display:block; height:100%; width:0; background:#2f6fd8; transition:width .2s; }
</style>
</head>
<body>
<header>
  <h1><span class="dot"></span>局域网文件共享</h1>
  <div class="crumb" id="crumb"></div>
</header>
<main><div id="list"></div><div class="empty" id="empty" hidden>空目录</div></main>
<div id="prog"><span id="progText">上传中</span><div class="bar"><i id="progBar"></i></div></div>
<footer>
  <button id="selAll">全选</button>
  <button id="dl" class="primary" disabled>下载所选</button>
  <label class="btn up"><input id="file" type="file" multiple>上传到当前目录</label>
</footer>
<div id="mask" hidden>
  <div class="top">
    <button id="closeMask">关闭</button>
    <button id="dlCurrent">下载</button>
  </div>
  <div class="body" id="maskBody"></div>
</div>
<div id="toast"></div>
<script>
var state = { path: '', entries: [], sel: {}, preview: null };
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function enc(p){ return encodeURIComponent(p); }
function sizeText(n){ if(n<1024) return n+' B'; var u=['KB','MB','GB'],v=n,i=-1; do{v/=1024;i++;}while(v>=1024&&i<u.length-1); return (v>=100?Math.round(v):v.toFixed(1))+' '+u[i]; }
function iconFor(e){ if(e.isDir) return '📁'; var k=e.kind; if(k==='image')return '🖼️'; if(k==='video')return '🎬'; if(k==='audio')return '🎵'; if(k==='pdf')return '📕'; if(k==='text')return '📄'; return '📦'; }
var toastTimer=null;
function toast(msg){ var t=$('toast'); t.textContent=msg; t.style.opacity=1; if(toastTimer)clearTimeout(toastTimer); toastTimer=setTimeout(function(){t.style.opacity=0;},2200); }

function crumb(){
  var parts=[{p:'',n:'共享文件夹'}];
  var segs=state.path===''?[]:state.path.split('/');
  var cur='';
  for(var i=0;i<segs.length;i++){ cur=cur===''?segs[i]:cur+'/'+segs[i]; parts.push({p:cur,n:segs[i]}); }
  var html=[];
  for(var j=0;j<parts.length;j++){
    if(j>0) html.push(' / ');
    if(j===parts.length-1) html.push(esc(parts[j].n));
    else html.push('<a href="javascript:void(0)" data-p="'+esc(parts[j].p)+'">'+esc(parts[j].n)+'</a>');
  }
  $('crumb').innerHTML=html.join('');
}

function render(){
  crumb();
  var html=[];
  for(var i=0;i<state.entries.length;i++){
    var e=state.entries[i];
    html.push('<div class="row" data-i="'+i+'">'
      +'<input class="box" type="checkbox" data-i="'+i+'"'+(state.sel[e.path]?' checked':'')+'>'
      +'<span class="ic">'+iconFor(e)+'</span>'
      +'<span class="nm"><div class="n">'+esc(e.name)+'</div><div class="s">'+(e.isDir?'文件夹':sizeText(e.size))+'</div></span>'
      +'</div>');
  }
  $('list').innerHTML=html.join('');
  $('empty').hidden=state.entries.length>0;
  updateDl();
}
function updateDl(){
  var n=selected().length;
  var b=$('dl'); b.disabled=n===0; b.textContent=n>1?('下载所选 '+n+' 项（打包）'):(n===1?'下载所选':'下载所选');
}
function selected(){ var out=[]; for(var k in state.sel){ if(state.sel[k]) out.push(k); } return out; }

function load(p){
  state.path=p; state.sel={};
  fetch('/api/list?path='+enc(p)).then(function(r){return r.json();}).then(function(j){
    if(!j.ok){ toast(j.error||'加载失败'); return; }
    state.entries=j.entries; render();
  }).catch(function(){ toast('网络中断'); });
}

function openEntry(e){
  if(e.isDir){ load(e.path); return; }
  if(!e.kind){ location.href='/api/download?path='+enc(e.path); return; }
  state.preview=e;
  var url='/api/raw?path='+enc(e.path);
  var body=$('maskBody');
  if(e.kind==='image') body.innerHTML='<img src="'+url+'" alt="">';
  else if(e.kind==='video') body.innerHTML='<video controls autoplay playsinline src="'+url+'"></video>';
  else if(e.kind==='audio') body.innerHTML='<audio controls autoplay style="width:90%" src="'+url+'"></audio>';
  else if(e.kind==='pdf') body.innerHTML='<iframe src="'+url+'"></iframe>';
  else { fetch(url).then(function(r){return r.text();}).then(function(t){
    body.innerHTML='<pre>'+esc(t.slice(0,200000))+'</pre>'; }).catch(function(){ toast('读取失败'); }); }
  $('mask').hidden=false;
}

function downloadSelected(){
  var sel=selected();
  if(sel.length===0) return;
  if(sel.length===1){ var e=entryByPath(sel[0]); if(e&&!e.isDir){ location.href='/api/download?path='+enc(e.path); return; } }
  location.href='/api/zip?paths='+enc(JSON.stringify(sel));
}
function entryByPath(p){ for(var i=0;i<state.entries.length;i++){ if(state.entries[i].path===p) return state.entries[i]; } return null; }

function uploadFiles(files){
  if(!files||files.length===0) return;
  var idx=0;
  $('prog').style.display='block';
  function next(){
    if(idx>=files.length){ $('prog').style.display='none'; load(state.path); toast('上传完成'); return; }
    var f=files[idx++];
    $('progText').textContent='上传 '+f.name+'（'+idx+'/'+files.length+'）';
    $('progBar').style.width='0%';
    var fd=new FormData(); fd.append('file',f,f.name);
    var xhr=new XMLHttpRequest();
    xhr.open('POST','/api/upload?dir='+enc(state.path));
    xhr.upload.onprogress=function(ev){ if(ev.lengthComputable) $('progBar').style.width=Math.round(ev.loaded/ev.total*100)+'%'; };
    xhr.onload=function(){
      if(xhr.status===200){ var j=null; try{ j=JSON.parse(xhr.responseText); }catch(e){} if(j&&!j.ok) toast(j.error||'上传失败'); next(); }
      else { toast('上传失败（HTTP '+xhr.status+'）'); next(); }
    };
    xhr.onerror=function(){ toast('网络中断'); next(); };
    xhr.send(fd);
  }
  next();
}

$('list').addEventListener('click',function(ev){
  var cb=ev.target;
  if(cb && cb.classList && cb.classList.contains('box')){
    var e=state.entries[+cb.getAttribute('data-i')];
    state.sel[e.path]=cb.checked; if(!cb.checked) delete state.sel[e.path];
    updateDl(); return;
  }
  var row=ev.target.closest ? ev.target.closest('.row') : null;
  if(row){ openEntry(state.entries[+row.getAttribute('data-i')]); }
});
$('crumb').addEventListener('click',function(ev){
  var a=ev.target.closest ? ev.target.closest('a[data-p]') : null;
  if(a) load(a.getAttribute('data-p'));
});
$('selAll').addEventListener('click',function(){
  var all=state.entries.length>0;
  for(var i=0;i<state.entries.length;i++){ var p=state.entries[i].path; if(all) state.sel[p]=true; else delete state.sel[p]; }
  render();
});
$('dl').addEventListener('click',downloadSelected);
$('file').addEventListener('change',function(){ uploadFiles(this.files); this.value=''; });
$('closeMask').addEventListener('click',function(){ $('mask').hidden=true; $('maskBody').innerHTML=''; state.preview=null; });
$('dlCurrent').addEventListener('click',function(){ if(state.preview) location.href='/api/download?path='+enc(state.preview.path); });
load('');
</script>
</body>
</html>`
}
