/* ========= Cutesy Sanrio Tetris — audio + fixed clears + 180° ========= */
const COLS=10, ROWS=20, SIZE=30;
const colors=["#ffd1e8","#ff9ad5","#ffd39a","#9ad5ff","#c9ffed","#e8d1ff","#a6ffd1"];
const bagTypes=["I","J","L","O","S","T","Z"];
const SHAPES={
  I:[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  J:[[1,0,0],[1,1,1],[0,0,0]],
  L:[[0,0,1],[1,1,1],[0,0,0]],
  O:[[1,1],[1,1]],
  S:[[0,1,1],[1,1,0],[0,0,0]],
  T:[[0,1,0],[1,1,1],[0,0,0]],
  Z:[[1,1,0],[0,1,1],[0,0,0]]
};

/* DOM */
const board=document.getElementById("board"), ctx=board.getContext("2d");
const nextCanvas=document.getElementById("next"), nctx=nextCanvas.getContext("2d");
const uiRows=document.getElementById("rows"), uiPB=document.getElementById("pb");
const toast=document.getElementById("toast"), toastText=document.getElementById("toastText");
const modal=document.getElementById("modal"), modalTitle=document.getElementById("modalTitle"), playAgainBtn=document.getElementById("playAgain");

/* ========== AUDIO MANAGER ========== */
class AudioManager{
  constructor(){
    this.src={
      bgm:   ["assets/audio/bgm_cute.mp3","assets/audio/bgm_cute.ogg"],
      place: ["assets/audio/place.mp3","assets/audio/place.ogg"],
      clear: ["assets/audio/clear.mp3","assets/audio/clear.ogg"],
      win:   ["assets/audio/victory.mp3","assets/audio/victory.ogg"],
      fail:  ["assets/audio/fail.mp3","assets/audio/fail.ogg"]
    };
    this.musicVol=0.7;
    this.sfxVol=0.90;
    this.muted=false;

    this.bgm = this._mk(this.src.bgm,true,this.musicVol);
    this.sfxP= this._mk(this.src.place,false,this.sfxVol);
    this.sfxC= this._mk(this.src.clear,false,this.sfxVol);
    this.sfxW= this._mk(this.src.win,false,1.0);
    this.sfxF= this._mk(this.src.fail,false,1.0);

    this._armed=true;
    this._applyMute();
  }
  _mk(srcs,loop,vol){
    const a=new Audio(); a.preload="auto"; a.loop=loop; a.volume=vol;
    for(const s of srcs){ const el=document.createElement('source'); el.src=s; a.appendChild(el); }
    return a;
  }
  _applyMute(){
    const v=this.muted?0:1;
    this.bgm.volume=this.musicVol*v;
    this.sfxP.volume=this.sfxVol*v;
    this.sfxC.volume=this.sfxVol*v;
    this.sfxW.volume=1*v;
    this.sfxF.volume=1*v;
    if(this.muted) this.bgm.pause();
  }
  toggle(){ this.muted=!this.muted; this._applyMute(); }
  _safePlay(a){
    if(this.muted) return;
    if(a.loop){ a.play().catch(()=>{}); }
    else {
      try{ const c=a.cloneNode(true); c.volume=a.volume; c.play().catch(()=>{}); }catch{}
    }
  }
  armAndStartIfNeeded(){ if(!this._armed) return; this._armed=false; this._safePlay(this.bgm); }
  onPlace(){ this._safePlay(this.sfxP); }

  // staggered multi-line clear = smooth blend
  onClearLines(n){
    if (this.muted || !n) return;
    const gap = 90;
    for (let i = 0; i < n; i++){
      setTimeout(() => {
        try {
          const vol = Math.max(0.6, 1 - i * 0.1);
          const c = this.sfxC.cloneNode(true);
          c.volume = this.sfxC.volume * vol;
          c.play().catch(() => {});
        } catch {}
      }, i * gap);
    }
  }

  onWin(){ this._safePlay(this.sfxW); }
  onFail(){ this._safePlay(this.sfxF); }
}
const audio=new AudioManager();

// quick keyboard mute toggle keeps icon + toast synced
window.addEventListener('keydown',e=>{
  if(e.code==='KeyM'){
    audio.toggle();
    const btn=document.getElementById('muteBtn');
    if(btn) btn.textContent = audio.muted ? '🔇' : '🔊';
    if(toast){ toastText.textContent=audio.muted?'Muted 🔇':'Sound on 🔊'; toast.classList.remove('hidden'); setTimeout(()=>toast.classList.add('hidden'),900); }
    if (!audio.muted && running) audio.bgm.play().catch(()=>{});
    if (audio.muted) audio.bgm.pause();
  }
});

/* State */
const PB_KEY="cutesy_tetris_pb";
let grid=newGrid(), current, queue=[], rows=0, level=1;
let dropCounter=0, dropInterval=800, lastTime=0, running=false;
let hasStarted=false, modalOpen=false;

/* line-clear animation */
let clearingRows=[], clearTimer=0;
const CLEAR_MS=380;

/* Utils */
function matrix(w,h){return Array.from({length:h},()=>Array(w).fill(0))}
function newGrid(){return matrix(COLS,ROWS)}
function rngBag(){const a=[...bagTypes];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function enqueue(){if(queue.length<7)queue.push(...rngBag())}
function topOffset(shape){for(let y=0;y<shape.length;y++) for(let x=0;x<shape[y].length;x++) if(shape[y][x]) return y; return 0}
function rotate(m,dir){const a=m.map(r=>[...r]); for(let y=0;y<a.length;y++) for(let x=0;x<y;x++) [a[x][y],a[y][x]]=[a[y][x],a[x][y]]; if(dir>0) a.forEach(r=>r.reverse()); else a.reverse(); return a}

/* Collision & merge */
function collide(g,p,off){
  for(let y=0;y<p.shape.length;y++) for(let x=0;x<p.shape[y].length;x++){
    if(!p.shape[y][x]) continue;
    const nx=p.x+x+off.x, ny=p.y+y+off.y;
    if(nx<0||nx>=COLS) return true;
    if(ny<0) continue;
    if(ny>=ROWS) return true;
    if(g[ny][nx]) return true;
  }
  return false;
}
function merge(g,p){ for(let y=0;y<p.shape.length;y++) for(let x=0;x<p.shape[y].length;x++) if(p.shape[y][x]){ const ny=p.y+y, nx=p.x+x; if(ny>=0) g[ny][nx]=p.color; }}

/* can next type fit anywhere? */
function canPlaceType(type){
  const base=SHAPES[type];
  const rots=[base, rotate(base,1), rotate(base,2), rotate(base,-1)];
  for(const shape of rots){
    const ySpawn=-topOffset(shape);
    for(let x=-2;x<COLS;x++){
      const test={type,shape,x,y:ySpawn,color:"#000"};
      if(!collide(grid,test,{x:0,y:0})) return true;
    }
  }
  return false;
}

/* Spawn */
function makePiece(type,x=3,y=null){
  const shape=SHAPES[type].map(r=>[...r]); const yStart=(y===null)?-topOffset(shape):y;
  return {type,shape,x,y:yStart,color:colors[Math.floor(Math.random()*colors.length)]};
}
function spawn(){
  enqueue();
  const type=queue.shift();
  if(!canPlaceType(type)) return false;
  const base=SHAPES[type], rots=[base, rotate(base,1), rotate(base,2), rotate(base,-1)];
  const kicks=[0,-1,1,-2,2];
  for(const shape of rots){
    const ySpawn=-topOffset(shape);
    for(const k of kicks){
      const p={type,shape,x:3+k,y:ySpawn,color:colors[Math.floor(Math.random()*colors.length)]};
      if(!collide(grid,p,{x:0,y:0})){ current=p; drawNext(); return true; }
    }
  }
  return false;
}

/* Movement & rotation */
function move(dx,dy){ const off={x:dx,y:dy}; if(!collide(grid,current,off)){ current.x+=dx; current.y+=dy; return true } return false }
function tryRotate(dir){
  const next=rotate(current.shape,dir), px=current.x, kicks=[0,-1,1,-2,2];
  for(const k of kicks){
    if(!collide(grid,{...current,shape:next,x:px+k,y:current.y},{x:0,y:0})){ current.shape=next; current.x=px+k; return true; }
  }
  return false;
}
function tryRotate180(){
  const r1=rotate(current.shape,1), r2=rotate(r1,1);
  const px=current.x, py=current.y;
  const kicks=[0,-1,1,-2,2];
  for(const k of kicks){
    if(!collide(grid,{...current,shape:r2,x:px+k,y:py},{x:0,y:0})){ current.shape=r2; current.x=px+k; return true; }
  }
  return false;
}
let rotateCooldown=false;
function doOncePerPress(fn){ if(rotateCooldown) return; rotateCooldown=true; fn(); requestAnimationFrame(()=>rotateCooldown=false); }

function hardDrop(){ while(move(0,1)){} lockPiece(); if(!modalOpen){ if(!spawn()) gameOver(); } }
function softDrop(){ if(!move(0,1)){ lockPiece(); if(!modalOpen){ if(!spawn()) gameOver(); } } }

/* Line clear */
function sweep(){
  if(clearingRows.length) return;
  const full=[];
  for(let y=0;y<ROWS;y++){
    let filled=true; for(let x=0;x<COLS;x++){ if(!grid[y][x]){filled=false;break;} }
    if(filled) full.push(y);
  }
  if(!full.length) return;
  clearingRows=[...full]; clearTimer=0;

  // smooth multi-line: staggered chimes
  audio.onClearLines(full.length);
}
/* remove rows in DESC order, then add empties */
function finalizeClear(){
  const targets=[...clearingRows].sort((a,b)=>b-a);
  for(const y of targets) grid.splice(y,1);
  for(let i=0;i<targets.length;i++) grid.unshift(Array(COLS).fill(0));
  rows+=targets.length; uiRows.textContent=rows;
}
function lockPiece(){ merge(grid,current); audio.onPlace(); sweep(); }

/* Drawing */
function clearCanvas(c,w,h){ c.clearRect(0,0,w,h); }
function drawRoundedRect(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();c.fill()}
function drawCell(c,x,y,color,alpha=1,scale=1){
  c.save(); c.globalAlpha=alpha;
  const cx=x*SIZE+SIZE/2, cy=y*SIZE+SIZE/2; c.translate(cx,cy); c.scale(scale,scale); c.translate(-cx,-cy);
  c.fillStyle=color; drawRoundedRect(c,x*SIZE+2,y*SIZE+2,SIZE-4,SIZE-4,6);
  c.fillStyle="rgba(255,255,255,.35)"; c.beginPath(); c.arc(x*SIZE+SIZE*0.35,y*SIZE+SIZE*0.35,SIZE*0.12,0,Math.PI*2); c.fill();
  c.restore();
}
function drawPiece(){ for(let y=0;y<current.shape.length;y++) for(let x=0;x<current.shape[y].length;x++) if(current.shape[y][x]) drawCell(ctx,current.x+x,current.y+y,current.color); }

/* Next preview (centered) */
function drawNext(){
  nctx.clearRect(0,0,nextCanvas.width,nextCanvas.height);
  enqueue();
  const nextType=queue[0], shape=SHAPES[nextType];
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(let y=0;y<shape.length;y++) for(let x=0;x<shape[y].length;x++) if(shape[y][x]){
    minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y);
  }
  const w=maxX-minX+1, h=maxY-minY+1, pad=12;
  const s=Math.min(Math.floor((nextCanvas.width-pad*2)/w), Math.floor((nextCanvas.height-pad*2)/h));
  const totalW=w*s, totalH=h*s;
  const startX=Math.floor((nextCanvas.width-totalW)/2)-minX*s;
  const startY=Math.floor((nextCanvas.height-totalH)/2)-minY*s;
  for(let y=0;y<shape.length;y++) for(let x=0;x<shape[y].length;x++) if(shape[y][x]){
    nctx.fillStyle="#ffd1e8";
    const rx=startX+x*s+2, ry=startY+y*s+2, rs=s-4, r=6;
    nctx.beginPath();
    nctx.moveTo(rx+r,ry);
    nctx.arcTo(rx+rs,ry,rx+rs,ry+rs,r);
    nctx.arcTo(rx+rs,ry+rs,rx,ry+rs,r);
    nctx.arcTo(rx,ry+rs,rx,ry,r);
    nctx.arcTo(rx,ry,rx+rs,ry,r);
    nctx.closePath(); nctx.fill();
    nctx.fillStyle="rgba(255,255,255,.35)";
    nctx.beginPath(); nctx.arc(rx+rs*0.35, ry+rs*0.35, rs*0.12, 0, Math.PI*2); nctx.fill();
  }
}

/* Ghost */
function drawGhost(){
  if(!current || clearingRows.length) return;
  let gy=current.y; while(!collide(grid,current,{x:0,y:gy-current.y+1})) gy++;
  ctx.save(); ctx.globalAlpha=0.22;
  for(let y=0;y<current.shape.length;y++) for(let x=0;x<current.shape[y].length;x++) if(shapeBit(current,y,x)) drawCell(ctx,current.x+x,gy+y,current.color,0.22,1);
  ctx.restore();
}
function shapeBit(p,y,x){ return p.shape[y] && p.shape[y][x]; }

/* Loop */
function flash(t){ if(!toast) return; toastText.textContent=t; toast.classList.remove("hidden"); setTimeout(()=>toast.classList.add("hidden"),900) }
function drawBoard(){
  clearCanvas(ctx,board.width,board.height);
  for(let y=0;y<ROWS;y++){
    let scale=1, alpha=1;
    if(clearingRows.includes(y)){ const t=Math.min(1, clearTimer/ CLEAR_MS); const ease=0.5-0.5*Math.cos(Math.PI*t); scale=1-0.85*ease; alpha=1-0.9*ease; }
    for(let x=0;x<COLS;x++) if(grid[y][x]) drawCell(ctx,x,y,grid[y][x],alpha,scale);
  }
  drawGhost();
  if(current && !clearingRows.length) drawPiece();
}
function drop(time=0){
  if(modalOpen){ drawBoard(); requestAnimationFrame(drop); return; }
  const dt=time-lastTime; lastTime=time;

  if(clearingRows.length){
    clearTimer+=dt;
    if(clearTimer>=CLEAR_MS){
      finalizeClear();
      clearingRows.length=0; clearTimer=0;
      // chain clears if compaction created new full rows
      sweep();
      if(!clearingRows.length){
        if(!spawn()) gameOver();
      }
    }
  } else if (running) {
    dropCounter+=dt; if(dropCounter>dropInterval){ softDrop(); dropCounter=0; }
  }

  if(running && !current && !clearingRows.length){
    if(!spawn()) gameOver();
  }

  drawBoard(); requestAnimationFrame(drop);
}

/* Modal controls */
let personalBest=0;
function setModal(open){ modalOpen=open; if(open){ modal.classList.add('open'); running=false; } else { modal.classList.remove('open'); } }
function gameOver(){
  if(!hasStarted) return;
  const newPB=Math.max(personalBest,rows), improved=newPB>personalBest;
  personalBest=newPB; localStorage.setItem(PB_KEY,String(personalBest)); uiPB.textContent=personalBest;
  if (modalTitle) modalTitle.textContent= improved ? "New Personal Best! ✨" : "You lost 💔";
  if(improved) audio.onWin(); else audio.onFail();
  setModal(true);
}
function hideModal(){ setModal(false); }

function reset(){
  grid=newGrid(); rows=0; level=1; dropInterval=800; queue.length=0; current=null; uiRows.textContent=0;
  clearingRows.length=0; clearTimer=0; hasStarted=true;
  spawn(); drawBoard();
}

/* Buttons */
document.getElementById("start").addEventListener("click",()=>{
  if(!hasStarted){ reset(); }
  audio.armAndStartIfNeeded();
  if(!audio.muted) audio.bgm.play().catch(()=>{});
  running=!running; flash(running?"Game On yayy":"Paused ⏸");
  if(!running) audio.bgm.pause();
});
document.getElementById("reset").addEventListener("click",()=>{ reset(); flash("Reset ♻️") });
document.getElementById("drop").addEventListener("click",()=>{ if(running) hardDrop() });

/* prevent buttons stealing keys */
document.querySelectorAll('button').forEach(btn=>{
  btn.addEventListener('keydown',e=>{
    if(['Space','ArrowLeft','ArrowRight','ArrowDown','KeyA','KeyD','KeyS','KeyF','KeyM'].includes(e.code)) e.preventDefault();
  });
  btn.addEventListener('focus',()=>btn.blur());
});

/* Keyboard */
window.addEventListener("keydown",e=>{
  if(['Space','ArrowLeft','ArrowRight','ArrowDown','KeyA','KeyD','KeyS','KeyF','KeyM'].includes(e.code)) e.preventDefault();
  if(e.code==='KeyM'){ /* handled above */ return; }
  if(modalOpen) return;

  if(e.code==="Space"){
    audio.armAndStartIfNeeded();
    if(!audio.muted) audio.bgm.play().catch(()=>{});
    running=!running; hasStarted=true;
    flash(running ? "Game On yayy" : "Paused ⏸");
    if(!running) audio.bgm.pause();
    return;
  }

  if(!running) return;
  if(e.code==="ArrowLeft"){ move(-1,0); }
  else if(e.code==="ArrowRight"){ move(1,0); }
  else if(e.code==="ArrowDown"){ hardDrop(); }
  else if(e.code==="KeyF"){ softDrop(); }
  else if(e.code==="KeyA"){ doOncePerPress(()=>tryRotate(-1)); }
  else if(e.code==="KeyD"){ doOncePerPress(()=>tryRotate(1)); }
  else if(e.code==="KeyS"){ doOncePerPress(()=>tryRotate180()); }
});

playAgainBtn.addEventListener("click",()=>{ hideModal(); reset(); running=true; audio.armAndStartIfNeeded(); if(!audio.muted) audio.bgm.play().catch(()=>{}); });

/* Init */
function loadPB(){ personalBest=parseInt(localStorage.getItem(PB_KEY)||"0",10); uiPB.textContent=personalBest }
loadPB();
requestAnimationFrame(drop);

/* Trim bottom whitespace */
function trimBottomWhitespace() {
  const wrap = document.querySelector('.wrap');
  const last = document.querySelector('.controls') || document.querySelector('.game');
  if (!wrap || !last) return;
  wrap.style.marginBottom = '0px';
  const lastBottom = last.getBoundingClientRect().bottom + window.scrollY;
  const docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  const slack = Math.max(0, docHeight - lastBottom);
  if (slack > 0) wrap.style.marginBottom = `-${slack}px`;
}
window.addEventListener('load', trimBottomWhitespace);
window.addEventListener('resize', () => requestAnimationFrame(trimBottomWhitespace));
const ro = new ResizeObserver(trimBottomWhitespace);
['.controls', '.game', '.boardCard'].forEach(sel => { const el = document.querySelector(sel); if (el) ro.observe(el); });

/* helper */
function shapeBit(p,y,x){ return p.shape[y] && p.shape[y][x]; }

/* On-screen mute button */
const muteBtn = document.getElementById('muteBtn');
if (muteBtn){
  muteBtn.textContent = audio.muted ? '🔇' : '🔊';
  muteBtn.addEventListener('click', ()=>{
    audio.toggle();
    muteBtn.textContent = audio.muted ? '🔇' : '🔊';
    if (!audio.muted && running) audio.bgm.play().catch(()=>{});
    if (audio.muted) audio.bgm.pause();
    flash(audio.muted ? "Muted 🔇" : "Sound on 🔊");
  });
}

/* Theme toggle (unchanged logic) */
(function(){
  const el = document.getElementById('themeSwitch');
  const root = document.documentElement;
  const KEY = 'tetris_theme';
  const saved = localStorage.getItem(KEY) || 'light';
  root.dataset.theme = saved;
  if (el) el.checked = (saved === 'dark');
  if (el){
    el.addEventListener('change', ()=>{
      const theme = el.checked ? 'dark' : 'light';
      root.dataset.theme = theme;
      localStorage.setItem(KEY, theme);
    });
  }
})();






