/* ==========================================================
   Pageturn – app.js
   Controls how the reader behaves. Sections, top to bottom:
   1. Setup & state       4. Rendering a page
   2. Storage (IndexedDB) 5. Highlighting selected text
   3. Library & opening   6. Bookmarks & panel, 7. Wiring up buttons
   ========================================================== */

// ---- 1. SETUP & STATE ----
// pdf.js (pdf.min.js) is the library that reads PDFs; it does the heavy work in a background "worker" file.
pdfjsLib.GlobalWorkerOptions.workerSrc='pdf.worker.min.js';
const $=id=>document.getElementById(id);
const COLORS=['#ffe14d','#6ee7a0','#7cc4ff','#ff9ec7'];
let db,doc,meta,page=1,zoom=1,color=COLORS[0],eraser=false,rendering=false,pending=null,renderTask=null;

// ---- 2. STORAGE: small helpers put/get/all/del that hide IndexedDB details ----
const mem={files:{},meta:{}};
// Opens the browser database, creating two stores: 'files' (the PDF itself) and 'meta' (page, bookmarks, highlights).
// If IndexedDB is blocked, everything silently falls back to the in-memory object 'mem' (works, but not saved after closing).
function openDB(){return new Promise(res=>{try{const r=indexedDB.open('pageturn',1);
 r.onupgradeneeded=()=>{r.result.createObjectStore('files');r.result.createObjectStore('meta')};
 r.onsuccess=()=>{db=r.result;res()};r.onerror=()=>res()}catch(e){res()}})}
function put(s,k,v){return new Promise(res=>{if(!db){mem[s][k]=v;return res()}try{const t=db.transaction(s,'readwrite');t.objectStore(s).put(v,k);t.oncomplete=res;t.onerror=res}catch(e){mem[s][k]=v;res()}})}
function get(s,k){return new Promise(res=>{if(!db)return res(mem[s][k]);try{const q=db.transaction(s).objectStore(s).get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>res()}catch(e){res()}})}
function all(s){return new Promise(res=>{if(!db)return res(Object.values(mem[s]));try{const q=db.transaction(s).objectStore(s).getAll();q.onsuccess=()=>res(q.result||[]);q.onerror=()=>res([])}catch(e){res([])}})}
function del(s,k){return new Promise(res=>{if(!db){delete mem[s][k];return res()}try{const t=db.transaction(s,'readwrite');t.objectStore(s).delete(k);t.oncomplete=res;t.onerror=res}catch(e){res()}})}
// Saves the reading position + marks for the open book. Called after every change, so closing the app never loses your place.
const save=()=>{meta.opened=Date.now();meta.page=page;return put('meta',meta.id,meta)};
function toast(t){const m=$('msg');m.textContent=t;m.style.opacity=1;clearTimeout(toast.t);toast.t=setTimeout(()=>m.style.opacity=0,1600)}

// ---- 3. LIBRARY: list saved books with progress; open a book ----
async function showLib(){
 $('bar').classList.add('hide');$('main').classList.add('hide');$('lib').classList.remove('hide');
 const list=(await all('meta')).sort((a,b)=>b.opened-a.opened),box=$('books');box.innerHTML='';
 list.forEach(m=>{const d=document.createElement('div');d.className='book';
  const pct=m.total?Math.round(m.page/m.total*100):0;
  d.innerHTML=`<div class="t"><b></b><small>Page ${m.page} of ${m.total||'?'} · ${(m.bm||[]).length} bookmarks</small><div class="prog"><i style="width:${pct}%"></i></div></div><button>Continue</button><button title="Remove">✕</button>`;
  d.querySelector('b').textContent=m.name.replace(/\.pdf$/i,'');
  const [c,x]=d.querySelectorAll('button');
  c.onclick=async()=>{const b=await get('files',m.id);b?openBlob(b,m):toast('File missing – please upload again')};
  x.onclick=async()=>{if(confirm('Remove this book and its marks from this device?')){await del('files',m.id);await del('meta',m.id);showLib()}};
  box.appendChild(d)});
}
// A new PDF was chosen. Its id is name+size, so re-uploading the same book finds the same saved bookmarks.
async function openFile(file){
 if(!file||file.type!=='application/pdf'&&!/\.pdf$/i.test(file.name))return toast('Please choose a PDF file');
 const id=file.name+'|'+file.size;let m=await get('meta',id);
 if(!m){m={id,name:file.name,page:1,total:0,bm:[],hl:{},opened:Date.now()};await put('files',id,file)}
 else if(!(await get('files',id)))await put('files',id,file);
 openBlob(file,m);
}
// Loads the PDF into pdf.js, restores the last page, switches from the library to the reader screen.
async function openBlob(blob,m){
 try{const buf=await blob.arrayBuffer();doc=await pdfjsLib.getDocument({data:buf}).promise}
 catch(e){return toast('Couldn’t open that PDF')}
 meta=m;meta.hl=meta.hl||{};meta.bm=meta.bm||[];meta.total=doc.numPages;page=Math.min(Math.max(1,meta.page||1),doc.numPages);
 $('lib').classList.add('hide');$('bar').classList.remove('hide');$('main').classList.remove('hide');
 $('tot').textContent='/ '+doc.numPages;document.title=meta.name.replace(/\.pdf$/i,'');
 await save();render();panel();
 if(page>1)toast('Resumed on page '+page);
}

// ---- 4. RENDERING A PAGE ----
// render() is safe to call repeatedly: if a page is already drawing it cancels it and redraws once with the latest state.
function render(){if(rendering){pending=true;if(renderTask)try{renderTask.cancel()}catch(e){}return}rendering=true;draw().finally(()=>{rendering=false;if(pending){pending=false;render()}})}
// Draws the current page: sizes it to the screen width (x zoom), paints it on the canvas (sharp on high-DPI phones),
// then builds the invisible text layer, the highlights and the bookmark ribbon.
async function draw(){
 const p=await doc.getPage(page),v=$('view'),base=p.getViewport({scale:1});
 const fit=Math.min((v.clientWidth-(v.clientWidth<700?8:32))/base.width,2.5),vp=p.getViewport({scale:fit*zoom}),dpr=window.devicePixelRatio||1;
 const cv=$('cv');cv.width=vp.width*dpr;cv.height=vp.height*dpr;cv.style.width=vp.width+'px';cv.style.height=vp.height+'px';
 const w=$('wrap');w.style.width=vp.width+'px';w.style.height=vp.height+'px';
 $('pg').value=page;const tl=$('tl');tl.innerHTML='';
 renderTask=p.render({canvasContext:cv.getContext('2d'),viewport:vp,transform:dpr!==1?[dpr,0,0,dpr,0,0]:null});
 try{await renderTask.promise}catch(e){return}
 const tc=await p.getTextContent();
 try{await pdfjsLib.renderTextLayer({textContentSource:tc,container:tl,viewport:vp,textDivs:[]}).promise}catch(e){}
 drawHL();bmState();
}
// Draws saved highlights as coloured boxes. Positions are stored as fractions of the page size, so they stay correct at any zoom.
function drawHL(){const h=$('hl');h.innerHTML='';(meta.hl[page]||[]).forEach((r,i)=>{const d=document.createElement('div');
 Object.assign(d.style,{left:r.x*100+'%',top:r.y*100+'%',width:r.w*100+'%',height:r.h*100+'%',background:r.c,opacity:.55});
 d.onclick=()=>{if(!eraser)return;meta.hl[page].splice(i,1);if(!meta.hl[page].length)delete meta.hl[page];save();drawHL();panel()};h.appendChild(d)})}
// Jump to a page number (clamped to the book), remember it, and redraw.
function go(n){n=Math.max(1,Math.min(doc.numPages,n|0||page));if(n===page&&$('pg').value==n)return;page=n;save();$('view').scrollTop=0;render()}

// ---- 5. HIGHLIGHTING: after a mouse/finger selection ends, save it as highlights ----
// Turns the user's current text selection into highlight boxes in the chosen colour, then clears the selection.
function grab(){
 if(!doc||eraser)return;const s=getSelection();if(!s||s.isCollapsed||!s.rangeCount)return;
 const w=$('wrap').getBoundingClientRect(),rs=[...s.getRangeAt(0).getClientRects()];const out=[];
 rs.forEach(r=>{if(r.width<2||r.height<2)return;const x=Math.max(r.left,w.left),y=Math.max(r.top,w.top),x2=Math.min(r.right,w.right),y2=Math.min(r.bottom,w.bottom);
  if(x2<=x||y2<=y)return;out.push({x:(x-w.left)/w.width,y:(y-w.top)/w.height,w:(x2-x)/w.width,h:(y2-y)/w.height,c:color})});
 if(!out.length)return;(meta.hl[page]=meta.hl[page]||[]).push(...out);s.removeAllRanges();save();drawHL();panel();
}
document.addEventListener('mouseup',()=>setTimeout(grab,10));
document.addEventListener('touchend',()=>setTimeout(grab,350));

// ---- 6. BOOKMARKS & PANEL ----
const hasBM=()=>meta.bm.some(b=>b.page===page);
// Updates the bookmark button and corner ribbon to match whether this page is bookmarked (and in which colour).
function bmState(){$('bmk').innerHTML=(hasBM()?'★':'☆')+'<span class="lbl"> Bookmark</span>';$('bmk').classList.toggle('on',hasBM());const bk=meta.bm.find(b=>b.page===page),r=$('rib');r.style.display=bk?'block':'none';if(bk)r.style.background=bk.c||'#ffe14d'}
// Rebuilds the Marks side panel: bookmark list (tap to jump, ✕ to delete) and the pages that have highlights.
function panel(){
 const bl=$('bml');bl.innerHTML=meta.bm.length?'':'<small style="color:var(--mute)">No bookmarks yet.</small>';
 [...meta.bm].sort((a,b)=>a.page-b.page).forEach(b=>{const d=document.createElement('div');d.className='bm';
  d.innerHTML=`<i style="width:12px;height:12px;border-radius:3px;background:${b.c||'#ffe14d'};border:1px solid var(--line)"></i><b>Page ${b.page}</b><small>${new Date(b.t).toLocaleDateString()}</small><button>✕</button>`;
  d.onclick=()=>go(b.page);d.querySelector('button').onclick=e=>{e.stopPropagation();meta.bm=meta.bm.filter(x=>x!==b);save();bmState();panel()};bl.appendChild(d)});
 const hl=$('hll');hl.innerHTML=Object.keys(meta.hl).length?'':'<small style="color:var(--mute)">Select text on a page to highlight it.</small>';
 Object.keys(meta.hl).map(Number).sort((a,b)=>a-b).forEach(p=>{const d=document.createElement('div');d.className='bm';
  const cs=[...new Set(meta.hl[p].map(r=>r.c))].map(c=>`<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c}"></span>`).join(' ');
  d.innerHTML=`<b>Page ${p}</b><span>${cs}</span>`;d.onclick=()=>go(p);hl.appendChild(d)});
}

// ---- 7. WIRING: connect every button, key, swipe and drop event to the functions above; start the app ----
COLORS.forEach((c,i)=>{const b=document.createElement('button');b.className='sw'+(i?'':' on');b.style.background=c;b.title='Highlight colour';
 b.onclick=()=>{color=c;eraser=false;$('er').classList.remove('on');$('hl').classList.remove('erase');document.querySelectorAll('.sw').forEach(x=>x.classList.toggle('on',x===b))};$('sws').appendChild(b)});
$('er').onclick=()=>{eraser=!eraser;$('er').classList.toggle('on',eraser);$('hl').classList.toggle('erase',eraser);if(eraser)toast('Tap a highlight to remove it')};
$('pl').onclick=()=>go(page-1);$('nr').onclick=()=>go(page+1);
let tx=0,ty=0;const vw=$('view');
vw.addEventListener('touchstart',e=>{tx=e.touches[0].clientX;ty=e.touches[0].clientY},{passive:true});
vw.addEventListener('touchend',e=>{if(!doc||vw.scrollWidth>vw.clientWidth+2)return;const s=getSelection();if(s&&!s.isCollapsed)return;
 const dx=e.changedTouches[0].clientX-tx,dy=e.changedTouches[0].clientY-ty;if(Math.abs(dx)>70&&Math.abs(dy)<40)go(page+(dx<0?1:-1))},{passive:true});
$('pg').onchange=e=>go(parseInt(e.target.value));
$('zi').onclick=()=>{zoom=Math.min(3,zoom+.2);render()};$('zo').onclick=()=>{zoom=Math.max(.5,zoom-.2);render()};
$('bmk').onclick=()=>{if(hasBM())meta.bm=meta.bm.filter(b=>b.page!==page);else{meta.bm.push({page,t:Date.now(),c:bcolor});toast('Bookmarked page '+page)}save();bmState();panel()};
let bcolor='#ffe14d';
['#ffffff','#ffe14d','#4da3ff'].forEach(c=>{const b=document.createElement('button');b.className='sw';b.style.background=c;b.style.borderRadius='4px';b.title='Bookmark in this colour';
 b.onclick=()=>{bcolor=c;const k=meta.bm.find(x=>x.page===page);if(k)k.c=c;else meta.bm.push({page,t:Date.now(),c});toast('Bookmarked page '+page);save();bmState();panel()};$('bcs').appendChild(b)});
$('pan').onclick=()=>{$('side').classList.toggle('open');setTimeout(render,0)};
$('home').onclick=()=>{if(meta)save();showLib()};
document.addEventListener('keydown',e=>{if(!doc||e.target.tagName==='INPUT')return;
 if(e.key==='ArrowRight'||e.key==='PageDown')go(page+1);if(e.key==='ArrowLeft'||e.key==='PageUp')go(page-1)});
window.addEventListener('resize',()=>{if(doc&&!$('main').classList.contains('hide'))render()});
const drop=$('drop');drop.onclick=()=>$('f').click();$('f').onchange=e=>{openFile(e.target.files[0]);e.target.value=''};
['dragover','dragenter'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add('over')}));
['dragleave','drop'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove('over')}));
drop.addEventListener('drop',e=>openFile(e.dataTransfer.files[0]));
openDB().then(showLib);
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(e){}
