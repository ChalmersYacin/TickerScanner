(function(){
const $=s=>document.querySelector(s);
const store={
  get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
};
let tickets=store.get('ts_tickets',null);   // {id: company} or null
let scans=store.get('ts_scans',[]);         // [{t,id,name}]
const seen=new Set(scans.map(s=>s.id));
const norm=s=>{s=String(s).trim();return /^\d+$/.test(s)?s.padStart(3,'0'):s};
const pad=n=>String(n).padStart(2,'0');
const stamp=()=>{const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())};

/* ---------- ticket list ---------- */
function parseList(text){
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(l=>l.trim());
  if(!lines.length)return {};
  const dl=lines[0].includes(';')?';':(lines[0].includes('\t')?'\t':',');
  const clean=x=>x.trim().replace(/^"|"$/g,'').trim();
  const head=lines[0].split(dl).map(x=>clean(x).toLowerCase());
  let ii=head.indexOf('id'),ni=head.indexOf('name');
  if(ii<0)ii=0; if(ni<0)ni=1;
  const out={};
  for(const l of lines.slice(1)){
    const p=l.split(dl);
    const id=norm(clean(p[ii]||''));
    if(id)out[id]=clean(p[ni]||'');
  }
  return out;
}
$('#file').addEventListener('change',async e=>{
  const f=e.target.files[0]; if(!f)return;
  try{tickets=parseList(await f.text());store.set('ts_tickets',tickets);toast('Loaded '+Object.keys(tickets).length+' tickets.')}
  catch(err){toast('Could not read that file.')}
  e.target.value='';render();
});
$('#noList').addEventListener('click',()=>{tickets=null;store.set('ts_tickets',null);render()});

/* ---------- feedback ---------- */
let ac=null,bannerTimer=null,running=false;
function beep(freq,dur){
  try{if(ac){const o=ac.createOscillator(),g=ac.createGain();o.frequency.value=freq;g.gain.value=.08;o.connect(g);g.connect(ac.destination);o.start();o.stop(ac.currentTime+dur)}}catch(e){}
  try{navigator.vibrate&&navigator.vibrate(Math.round(dur*1000))}catch(e){}
}
function banner(state,text,hold){
  const b=$('#banner'); b.className='banner '+state; b.textContent=text;
  clearTimeout(bannerTimer);
  if(hold)bannerTimer=setTimeout(()=>{b.className='banner';b.textContent=running?'Ready. Show a ticket.':'Ready'},2500);
}
let toastTimer=null;
function toast(t){const el=$('#toast');el.textContent=t;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.textContent='',4000)}

/* ---------- handling a scanned ID ---------- */
let lastId=null,lastT=0;
function handle(raw,manual){
  const id=norm(raw); if(!id)return;
  const now=Date.now();
  if(!manual){ if(id===lastId&&now-lastT<2500){lastT=now;return} }
  lastId=id;lastT=now;
  if(seen.has(id)){banner('dup',id+' already scanned',true);beep(220,.35);return}
  if(tickets&&!(id in tickets)){banner('nf',id+' not in ticket list',true);beep(300,.35);return}
  const name=tickets?tickets[id]:'';
  scans.push({t:stamp(),id,name});seen.add(id);store.set('ts_scans',scans);
  banner('ok',id+(name?'  '+name:'')+'  OK',true);beep(880,.12);render();
}
$('#addBtn').addEventListener('click',()=>{const m=$('#manual');handle(m.value,true);m.value='';m.focus()});
$('#manual').addEventListener('keydown',e=>{if(e.key==='Enter')$('#addBtn').click()});

/* ---------- camera ---------- */
const v=$('#v'),cv=document.createElement('canvas'),ctx=cv.getContext('2d',{willReadFrequently:true});
let stream=null,detector=null,busy=false,lastRun=0;
async function start(){
  try{ac=ac||new (window.AudioContext||window.webkitAudioContext)();ac.resume&&ac.resume()}catch(e){}
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
  }catch(e){
    banner('nf','Camera not available. Allow camera access, or type the ID below.',false);return;
  }
  v.srcObject=stream;await v.play().catch(()=>{});
  running=true;$('#empty').hidden=true;$('#startBtn').hidden=true;$('#stopBtn').hidden=false;
  banner('','Ready. Show a ticket.',false);
  detector=null;
  if('BarcodeDetector' in window){try{detector=new BarcodeDetector({formats:['qr_code','code_128']})}catch(e){detector=null}}
  $('#engine').textContent=detector?'Reads QR codes and Code 128 barcodes.':'Reads QR codes. Barcodes need a browser with built-in barcode detection (Chrome on Android).';
  requestAnimationFrame(loop);
}
function stop(){
  running=false;
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
  v.srcObject=null;$('#empty').hidden=false;$('#startBtn').hidden=false;$('#stopBtn').hidden=true;
  banner('','Ready',false);
}
async function scanFrame(){
  if(detector){
    try{const r=await detector.detect(v);return r.length?r[0].rawValue:null}
    catch(e){detector=null}
  }
  const w=v.videoWidth,h=v.videoHeight; if(!w||typeof jsQR==='undefined')return null;
  const sc=Math.min(1,640/w);cv.width=Math.round(w*sc);cv.height=Math.round(h*sc);
  ctx.drawImage(v,0,0,cv.width,cv.height);
  const img=ctx.getImageData(0,0,cv.width,cv.height);
  const r=jsQR(img.data,img.width,img.height,{inversionAttempts:'dontInvert'});
  return r?r.data:null;
}
async function loop(ts){
  if(!running)return;
  if(!busy&&v.readyState>=2&&ts-lastRun>120){
    busy=true;lastRun=ts;
    try{const code=await scanFrame();if(code)handle(code,false)}catch(e){}
    busy=false;
  }
  requestAnimationFrame(loop);
}
$('#startBtn').addEventListener('click',start);
$('#stopBtn').addEventListener('click',stop);

/* ---------- render ---------- */
function cell(tag,text,cls){const c=document.createElement(tag);c.textContent=text;if(cls)c.className=cls;return c}
function table(heads,rows,emptyMsg){
  if(!rows.length){const d=document.createElement('div');d.className='none';d.textContent=emptyMsg;return d}
  const t=document.createElement('table'),th=document.createElement('thead'),hr=document.createElement('tr');
  heads.forEach(h=>hr.appendChild(cell('th',h)));th.appendChild(hr);t.appendChild(th);
  const tb=document.createElement('tbody');
  rows.forEach(r=>{const tr=document.createElement('tr');r.forEach((x,i)=>tr.appendChild(cell('td',x,i===1?'id':'')));tb.appendChild(tr)});
  t.appendChild(tb);return t;
}
function summary(){
  const m={};scans.forEach(s=>{const k=s.name||'(no company)';m[k]=(m[k]||0)+1});
  return Object.entries(m).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
}
function render(){
  const sum=summary();
  $('#nScans').textContent=scans.length;
  $('#nComp').textContent=sum.filter(x=>x[0]!=='(no company)').length;
  const lw=$('#logWrap');lw.replaceChildren(table(['Time','Ticket','Company'],scans.slice().reverse().map(s=>[s.t,s.id,s.name]),'No scans yet.'));
  const sw=$('#sumWrap');sw.replaceChildren(table(['Company','People'],sum.map(x=>[x[0],String(x[1])]),'Nothing to count yet.'));
  const has=tickets&&Object.keys(tickets).length;
  $('#noList').hidden=!tickets;
  $('#listNote').textContent=tickets
    ?Object.keys(tickets).length+' tickets loaded. A ticket that is not on the list is rejected.'
    :'No list loaded. Every scan is accepted and the company column stays empty. Load a CSV with the columns id and name (comma or semicolon) to fill it in.';
}

/* ---------- export ---------- */
const clearBtn=$('#clear');let clearTimer=null,armed=false;
clearBtn.addEventListener('click',()=>{
  if(!armed){armed=true;clearBtn.textContent='Tap again to clear';clearTimer=setTimeout(()=>{armed=false;clearBtn.textContent='Clear all scans'},3000);return}
  clearTimeout(clearTimer);armed=false;clearBtn.textContent='Clear all scans';
  scans=[];seen.clear();store.set('ts_scans',scans);lastId=null;render();toast('Scans cleared.');
});
function workbook(){
  const wb=XLSX.utils.book_new();
  const a=[['Time','Ticket ID','Company / student']].concat(scans.map(s=>[s.t,s.id,s.name]));
  const ws=XLSX.utils.aoa_to_sheet(a);ws['!cols']=[{wch:20},{wch:12},{wch:32}];
  XLSX.utils.book_append_sheet(wb,ws,'Scans');
  const b=[['Company / student','People who came']].concat(summary());
  const ws2=XLSX.utils.aoa_to_sheet(b);ws2['!cols']=[{wch:32},{wch:16}];
  XLSX.utils.book_append_sheet(wb,ws2,'People per company');
  return wb;
}
let downloads=null;
(async()=>{
  try{downloads=window.claude?await window.claude.use('downloads'):null}catch(e){downloads=null}
})();
$('#dl').addEventListener('click',async()=>{
  if(!scans.length){toast('Nothing to export yet.');return}
  try{
    const buf=XLSX.write(workbook(),{bookType:'xlsx',type:'array'});
    const d=new Date();
    const filename='tickets-'+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'.xlsx';
    if(downloads){await downloads.save({filename,data:buf})}
    else{
      const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;
      document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    }
    toast('Excel file saved.');
  }catch(e){
    toast(e&&e.code==='declined'?'Download cancelled.':'Download is not available here. Use Copy for Excel instead.');
  }
});
$('#copy').addEventListener('click',async()=>{
  if(!scans.length){toast('Nothing to copy yet.');return}
  const text=['Time\tTicket ID\tCompany / student'].concat(scans.map(s=>[s.t,"'"+s.id,s.name].join('\t'))).join('\n');
  let ok=false;
  try{await navigator.clipboard.writeText(text);ok=true}catch(e){
    try{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();ok=document.execCommand('copy');ta.remove()}catch(e2){}
  }
  toast(ok?'Copied. Paste into Excel with Ctrl+V.':'Copy was blocked by the browser.');
});

render();
})();
