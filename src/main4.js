import './style.css'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import JSZip from 'jszip'
const $=s=>document.querySelector(s), LOCAL='geofoto_offline_v2', CFG='geofoto_cfg_v1', IDENTITY='gf_identity', APP_VERSION='1.2.3'
let token=sessionStorage.getItem('gf_token')||localStorage.getItem('gf_token')||'',role=sessionStorage.getItem('gf_role')||localStorage.getItem('gf_role')||'user',identity=sessionStorage.getItem(IDENTITY)||localStorage.getItem(IDENTITY)||'',points=[],map,markers,stream=null,raw='',photo='',geo=null,cfg=loadCfg(),saving=false,savedPhotoKey='',swRegistration=null,updateReloading=false,installPrompt=null,offlineSyncing=false
const TEMPLATES={
essential:{name:'Essencial',description:'Dados principais com mapa e identificação.',top:true,panel:.27,map:true,mapWidth:.34,mapHeight:.23,titleScale:.034,textScale:.019},
compact:{name:'Compacto',description:'Faixa menor, com mini mapa e mais espaço para a imagem.',top:true,panel:.12,map:true,textScale:.013},
location:{name:'Localização',description:'Prioriza coordenadas, endereço e mapa maior.',top:true,panel:.30,map:true,mapWidth:.38,mapHeight:.25,titleScale:.034,textScale:.0185},
corporate:{name:'Corporativo',description:'Visual limpo com identidade da organização e mini mapa.',top:true,panel:.16,map:true,light:true},
technical:{name:'Técnico',description:'Coordenadas, precisão, cidade, endereço e observação.',top:false,panel:.28,map:true,mapWidth:.34,mapHeight:.23,titleScale:.032,textScale:.0185},
evidence:{name:'Evidência',description:'Registro objetivo para comprovação de serviço com mini mapa.',top:true,panel:.14,map:true,note:true},
minimal:{name:'Minimalista',description:'Identificação, data, coordenadas e mini mapa.',top:false,panel:.10,map:true,minimal:true,note:false}
}
function templateRows(t){if(t.minimal)return[`Data/Hora: ${fmt(new Date())}`,`GPS: ${geo?.latitude?.toFixed(6)||'-'}, ${geo?.longitude?.toFixed(6)||'-'}`];const rows=[`Data/Hora: ${fmt(new Date())}`,`Latitude: ${geo?.latitude?.toFixed(6)||'-'}  Longitude: ${geo?.longitude?.toFixed(6)||'-'}`,`Precisão: ${Math.round(geo?.accuracy||0)} m`,`Cidade: ${geo?.city||'Não identificada'}`,`Endereço: ${(geo?.address||'Não identificado').slice(0,80)}`];return rows}
L.Icon.Default.mergeOptions({iconRetinaUrl:'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',iconUrl:'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',shadowUrl:'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png'})
function loadCfg(){const d={appName:'GEOFOTO KMZ',company:'',banner:'',primaryColor:'#0f766e',defaultTemplate:'essential',enabledTemplates:['essential','compact','location','corporate','technical','evidence','minimal'],showLogo:true,showMap:true};try{return {...d,...JSON.parse(localStorage.getItem(CFG)||'{}')}}catch{return d}}
function saveCfg(){localStorage.setItem(CFG,JSON.stringify(cfg))}
function offlineDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('geofoto-offline-v1',1);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('pending'))db.createObjectStore('pending',{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function pendingAll(){const db=await offlineDb();return new Promise((resolve,reject)=>{const r=db.transaction('pending').objectStore('pending').getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)})}
async function pendingPut(p){const db=await offlineDb();return new Promise((resolve,reject)=>{const tx=db.transaction('pending','readwrite');tx.objectStore('pending').put({...p,_pending:true});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function pendingDelete(id){const db=await offlineDb();return new Promise((resolve,reject)=>{const tx=db.transaction('pending','readwrite');tx.objectStore('pending').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function requestPersistentStorage(){try{if(navigator.storage?.persist)await navigator.storage.persist()}catch{}}
function mergePoints(cloud,pending){const m=new Map();for(const p of cloud||[])m.set(p.id,p);for(const p of pending||[])if(!m.has(p.id))m.set(p.id,{...p,_pending:true});return [...m.values()].sort((a,b)=>String(a.time).localeCompare(String(b.time)))}
async function updatePendingStatus(mode=''){
 const n=(await pendingAll().catch(()=>[])).length,el=$('#netStatus');if(!el)return n;
 if(mode==='sync')el.textContent='● Sincronizando '+n+' pendente'+(n===1?'':'s');
 else if(!navigator.onLine)el.textContent='● Offline'+(n?' · '+n+' pendente'+(n===1?'':'s'):'');
 else el.textContent=n?'● Nuvem · '+n+' pendente'+(n===1?'':'s'):'● Nuvem conectada';
 return n
}
async function api(path,opt={}){const h={'Content-Type':'application/json',...(opt.headers||{})};if(token)h.Authorization=`Bearer ${token}`;const r=await fetch('/api'+path,{...opt,headers:h});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Falha na comunicação');return d}
async function apiBlob(path){const h={};if(token)h.Authorization=`Bearer ${token}`;const url=path.startsWith('/api/')?path:'/api'+path;const r=await fetch(url,{headers:h});if(!r.ok)throw Error('Falha ao carregar foto');return r.blob()}
function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}}
function ensureIdentity(){
 if(identity.trim())return Promise.resolve(identity);
 return new Promise(resolve=>{
  const gate=document.createElement('div');gate.className='identity-gate';
  gate.innerHTML='<form class="identity-card"><div class="logo">⌖</div><span class="identity-kicker">IDENTIFICAÇÃO OBRIGATÓRIA</span><h2>Quem está registrando?</h2><p>Informe seu nome ou identificação. Este nome será gravado na foto do registro.</p><label class="field"><b>Nome do técnico/usuário *</b><input id="identityRequired" maxlength="60" autocomplete="name" placeholder="Ex.: João Silva / Equipe 01" required></label><div id="identityMsg" class="identity-msg"></div><button class="btn primary full" type="submit">Continuar para a câmera</button></form>';
  document.body.appendChild(gate);
  const form=gate.querySelector('form'),input=gate.querySelector('#identityRequired');
  setTimeout(()=>input.focus(),80);
  form.onsubmit=e=>{e.preventDefault();const v=input.value.trim();if(v.length<2){gate.querySelector('#identityMsg').textContent='Informe uma identificação válida.';input.focus();return}identity=v;sessionStorage.setItem(IDENTITY,identity);localStorage.setItem(IDENTITY,identity);gate.remove();resolve(identity)}
 })
}
function loginView(){stopCamera();$('#app').innerHTML=`<main class="login"><div class="login-card"><div class="brand"><div class="logo">⌖</div><div><h1>GEOFOTO KMZ</h1><div class="muted">Registro georreferenciado de campo</div></div></div><form id="loginForm"><label class="field">Usuário<input id="user" autocomplete="username" required></label><label class="field">Senha<input id="pass" type="password" autocomplete="current-password" required></label><button class="btn primary full">Entrar</button><p id="loginMsg" class="muted"></p></form></div></main>`;$('#loginForm').onsubmit=async e=>{e.preventDefault();try{const d=await api('/login',{method:'POST',body:JSON.stringify({user:$('#user').value,pass:$('#pass').value})});token=d.token;role=d.role||'user';identity='';sessionStorage.setItem('gf_token',token);sessionStorage.setItem('gf_role',role);localStorage.setItem('gf_token',token);localStorage.setItem('gf_role',role);sessionStorage.removeItem(IDENTITY);localStorage.removeItem(IDENTITY);await appView()}catch(x){$('#loginMsg').textContent=x.message}}}
async function appView(){$('#app').innerHTML=`<div class="shell"><aside class="side"><div class="brand"><div class="logo">⌖</div><b>GEOFOTO KMZ</b></div><nav class="nav"><button data-page="dashboard">▦ Painel</button><button class="active" data-page="capture">◎ Câmera</button><button data-page="mapa">⌖ Mapa</button><button data-page="records">☷ Registros</button><button data-page="export">⇩ Exportar</button><button data-page="settings">⚙ Configurações</button></nav></aside><main class="main"><header class="top"><div><h2 id="title">Câmera</h2><span class="muted">Tirou a foto = salvou o ponto automaticamente</span></div><span id="netStatus" class="status">● Conectando</span></header><section id="dashboard" class="section"></section><section id="capture" class="section active"></section><section id="mapa" class="section"><div class="card"><div id="map"></div></div></section><section id="records" class="section"></section><section id="export" class="section"></section><section id="settings" class="section"></section></main></div>`;document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>show(b.dataset.page,b));await requestPersistentStorage();await syncDown();await ensureIdentity();renderAll();setTimeout(syncPendingQueue,900)}
function show(id,b){if(id!=='capture')stopCamera();document.querySelectorAll('.section').forEach(x=>x.classList.remove('active'));$('#'+id).classList.add('active');document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#title').textContent={dashboard:'Painel',capture:'Câmera',mapa:'Mapa geral',records:'Registros',export:'Exportar KML/KMZ',settings:'Configurações'}[id];if(id==='mapa')setTimeout(()=>{initMap();map.invalidateSize()},180)}
async function syncDown(){
 const pending=await pendingAll().catch(()=>[]);
 try{
  const cloud=await api('/points');points=mergePoints(cloud,pending);
  try{cfg={...cfg,...await api('/config')};saveCfg()}catch{}
  await updatePendingStatus()
 }catch{
  const legacy=JSON.parse(localStorage.getItem(LOCAL)||'[]');
  points=mergePoints(legacy,pending);
  await updatePendingStatus()
 }
}
async function syncPendingQueue(){
 if(offlineSyncing)return; if(!navigator.onLine)return updatePendingStatus();
 const pending=await pendingAll().catch(()=>[]);if(!pending.length)return updatePendingStatus();
 offlineSyncing=true;await updatePendingStatus('sync');let sent=0;
 for(const p of pending){
  try{const clean={...p};delete clean._pending;await api('/points',{method:'POST',body:JSON.stringify(clean)});await pendingDelete(p.id);sent++}
  catch{break}
 }
 await syncDown();
 if(sent){renderDashboard();renderRecords();renderExport();if(map){initMap();setTimeout(()=>map.invalidateSize(),50)}}
 offlineSyncing=false;return sent
}
function renderAll(){renderDashboard();renderCapture();renderRecords();renderExport();renderSettings()}
function renderDashboard(){const hoje=new Date().toLocaleDateString('pt-BR'),n=points.filter(p=>new Date(p.time).toLocaleDateString('pt-BR')===hoje).length;$('#dashboard').innerHTML=`<div class="cards"><div class="card"><span class="muted">Total de pontos</span><div class="metric">${points.length}</div></div><div class="card"><span class="muted">Fotos hoje</span><div class="metric">${n}</div></div><div class="card"><span class="muted">Com endereço</span><div class="metric">${points.filter(p=>p.address).length}</div></div><div class="card"><span class="muted">KMZ central</span><div class="metric">OK</div></div></div><div class="grid2"><div class="card"><h3>Fluxo automático</h3><p class="muted">Primeiro informe a identificação do ponto. Depois libere câmera e GPS; ao tirar a foto, o registro é salvo automaticamente no mapa e no KMZ.</p><button class="btn primary" id="quick">Abrir câmera</button></div><div class="card"><h3>Últimos registros</h3>${points.slice(-4).reverse().map(p=>`<p><b>${esc(p.name)}</b><br><span class="muted">${fmt(p.time)} · ${esc(p.city||'')}</span></p>`).join('')||'<p class="muted">Nenhum registro.</p>'}</div></div>`;$('#quick').onclick=()=>document.querySelector('[data-page="capture"]').click()}
function renderCapture(){
 raw='';photo='';geo=null;saving=false;savedPhotoKey='';
 const enabled=(cfg.enabledTemplates||Object.keys(TEMPLATES)).filter(id=>TEMPLATES[id]);
 const current=enabled.includes(cfg.defaultTemplate)?cfg.defaultTemplate:(enabled[0]||'essential');
 $('#capture').innerHTML=`<div class="grid2 mobile-main"><div class="card capture"><h3>Câmera de campo</h3><div class="capture-guide"><b>Como registrar uma foto</b><span>1. Preencha a identificação do ponto.</span><span>2. Toque em “Liberar câmera e GPS”.</span><span>3. Aguarde câmera e GPS ficarem prontos e tire a foto.</span><small>A câmera só é liberada depois que a identificação do ponto for preenchida.</small></div>
 <label class="field">Modelo da foto<select id="templateSelect">${enabled.map(id=>`<option value="${id}" ${id===current?'selected':''}>${TEMPLATES[id].name}</option>`).join('')}</select></label>
 <div id="templateHint" class="muted small">${TEMPLATES[current]?.description||''}</div>
 <label class="field"><b>Identificação do ponto *</b><input id="pointName" placeholder="Ex.: CEO 80551 / POSTE 023" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label>
 <div id="pointNameHint" class="muted small">Primeiro informe a identificação do ponto.</div>
 <div class="sensor-panel"><div id="camState" class="sensor-state waiting"><b>📷 Câmera</b><span>Aguardando identificação</span></div><div id="gpsState" class="sensor-state waiting"><b>⌖ GPS</b><span>Aguardando identificação</span></div></div>
 <button class="btn primary sensor-retry" id="retrySensors" type="button" disabled>Liberar câmera e GPS</button>
 <video id="camera" class="camera-large" autoplay playsinline muted></video><canvas id="canvas" class="hidden"></canvas><img id="preview" class="camera-large hidden">
 <div class="actions"><button class="btn primary" id="take" disabled>📷 Tirar foto</button><button class="btn secondary hidden" id="retake">↻ Tirar novamente</button></div>
 <label class="field">Observação<textarea id="note" rows="3" placeholder="Descrição opcional"></textarea></label>
 <div class="actions"><button class="btn secondary" id="gps" disabled>Atualizar GPS</button></div><div class="actions hidden" id="shareActions"><button class="btn primary" id="shareBtn">📤 Enviar</button><button class="btn secondary" id="downloadBtn">⬇ Salvar foto</button></div>
 <div id="saveStatus" class="statusline">Preencha a identificação do ponto para liberar câmera e GPS.</div><div id="camInfo" class="muted small"></div><div id="gpsInfo" class="muted small"></div>
 </div><div class="card"><h3>Modelo ativo</h3><div id="templatePreview" class="template-preview"><b>${TEMPLATES[current]?.name||'Essencial'}</b><p class="muted">${TEMPLATES[current]?.description||''}</p></div><p class="muted">A identidade do técnico é obrigatória e fica vinculada visualmente à foto registrada.</p></div></div>`;
 const pn=$('#pointName'),hint=$('#pointNameHint');
 pn.addEventListener('input',()=>{const start=pn.selectionStart,end=pn.selectionEnd;pn.value=pn.value.toLocaleUpperCase('pt-BR');try{pn.setSelectionRange(start,end)}catch{}hint.textContent=pn.value.trim()?'Identificação informada.':'Informe a identificação antes da foto.';updateCaptureReady()});
 $('#take').onclick=takePhoto;$('#retake').onclick=retake;$('#gps').onclick=getGps;$('#retrySensors').onclick=startCameraAndGps;
 $('#templateSelect').onchange=e=>{const t=TEMPLATES[e.target.value];$('#templateHint').textContent=t?.description||'';$('#templatePreview').innerHTML=`<b>${t?.name||''}</b><p class="muted">${t?.description||''}</p>`}
 updateCaptureReady();
}
async function startCameraAndGps(){const point=$('#pointName')?.value.trim();if(!point){const hint=$('#pointNameHint');if(hint)hint.textContent='⚠ Preencha a identificação antes de liberar a câmera.';updateCaptureReady();return}await Promise.allSettled([startCamera(),getGps()]);updateCaptureReady()}
function updateCaptureReady(){
 const take=$('#take'),retry=$('#retrySensors'),gpsBtn=$('#gps'),v=$('#camera'),cam=!!(stream&&v&&v.videoWidth>0),gps=!!geo,point=!!$('#pointName')?.value.trim();
 if(retry){retry.disabled=!point;retry.textContent=cam&&gps?'Câmera e GPS prontos':(cam||gps?'Concluir liberação':'Liberar câmera e GPS')}
 if(gpsBtn)gpsBtn.disabled=!point;
 if(take){take.disabled=!(cam&&gps&&point);take.title=take.disabled?'Aguarde câmera, GPS e identificação do ponto.':''}
 const camState=$('#camState'),gpsState=$('#gpsState');
 if(point&&!cam&&camState&&camState.classList.contains('waiting'))camState.querySelector('span').textContent='Pronto para liberar';
 if(point&&!gps&&gpsState&&gpsState.classList.contains('waiting'))gpsState.querySelector('span').textContent='Pronto para liberar';
 const st=$('#saveStatus');if(st&&!raw){if(!point)st.textContent='Preencha a identificação do ponto para liberar câmera e GPS.';else if(cam&&gps)st.textContent='Pronto para registrar.';else st.textContent='Identificação informada. Toque em “Liberar câmera e GPS”.';}
}
async function startCamera(){
 const v=$('#camera'),state=$('#camState'),info=$('#camInfo');if(!v)return false;
 const set=(kind,msg)=>{if(state){state.className='sensor-state '+kind;state.querySelector('span').textContent=msg}if(info)info.textContent=msg};
 if(!window.isSecureContext){set('error','Abra o app em conexão segura (HTTPS).');return false}
 if(!navigator.mediaDevices?.getUserMedia){set('error','Câmera não disponível neste navegador.');return false}
 try{
  set('waiting','Solicitando permissão…');stopCamera();
  try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false})}
  catch(first){stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false})}
  v.srcObject=stream;
  await new Promise((resolve,reject)=>{const done=()=>{cleanup();resolve()};const fail=()=>{cleanup();reject(new Error('A câmera não iniciou.'))};const cleanup=()=>{v.removeEventListener('loadedmetadata',done);v.removeEventListener('error',fail)};v.addEventListener('loadedmetadata',done,{once:true});v.addEventListener('error',fail,{once:true});setTimeout(done,1800)});
  await v.play();await new Promise(r=>setTimeout(r,120));
  if(!v.videoWidth)throw new Error('Prévia da câmera não disponível.');
  set('ok','Câmera pronta');updateCaptureReady();return true
 }catch(e){
  const denied=e?.name==='NotAllowedError'||e?.name==='SecurityError';
  set('error',denied?'Permissão da câmera bloqueada. Toque em “Reativar câmera e GPS”.':'Falha ao abrir câmera: '+(e?.message||'erro'));
  updateCaptureReady();return false
 }
}
async function takePhoto(){if(!geo){await getGps();if(!geo){alert('É necessário obter o GPS antes de tirar a foto.');return}}const v0=$('#camera');if(!stream||!v0?.videoWidth){await startCamera();if(!stream||!$('#camera')?.videoWidth){alert('A câmera ainda não está pronta. Toque em Reativar câmera e GPS.');return}}const pn=$('#pointName');let pointName=(pn?.value.trim()||'').toLocaleUpperCase('pt-BR');if(!pointName){pointName=(window.prompt('Identificação do ponto\nEx.: CEO 80551 / POSTE 023','')||'').trim().toLocaleUpperCase('pt-BR');if(!pointName){const hint=$('#pointNameHint');if(hint)hint.textContent='⚠ É necessário informar a identificação antes da foto.';return}if(pn)pn.value=pointName;const hint=$('#pointNameHint');if(hint)hint.textContent='Identificação informada.'}const v=$('#camera'),c=$('#canvas');if(!v||!v.videoWidth)return;const portrait=innerHeight>innerWidth;const outW=portrait?1080:1920,outH=portrait?1440:1080;c.width=outW;c.height=outH;const sx=v.videoWidth,sy=v.videoHeight,src= sx/sy, dst=outW/outH;let sw=sx,sh=sy,ox=0,oy=0;if(src>dst){sw=Math.round(sy*dst);ox=Math.round((sx-sw)/2)}else{sh=Math.round(sx/dst);oy=Math.round((sy-sh)/2)}c.getContext('2d').drawImage(v,ox,oy,sw,sh,0,0,outW,outH);raw=c.toDataURL('image/jpeg',.9);savedPhotoKey=raw.slice(0,80)+Date.now();stopCamera();$('#saveStatus').textContent='Foto tirada. Preparando dados e salvamento automático...';await annotate();captureUi();await maybeAutoSave()}
async function annotate(){
 if(!raw)return;
 const img=await loadImg(raw),c=document.createElement('canvas'),x=c.getContext('2d'),id=$('#templateSelect')?.value||cfg.defaultTemplate||'essential',t=TEMPLATES[id]||TEMPLATES.essential;
 c.width=img.width;c.height=img.height;x.drawImage(img,0,0);
 const pad=Math.round(c.width*.028),hasMap=t.map&&cfg.showMap!==false,panelRatio=Math.max(.12,Math.min(.34,Number(t.panel||(hasMap?.27:.22)))),panelH=Math.round(c.height*panelRatio),panelY=c.height-panelH-Math.round(pad*.55),cardX=pad,cardW=c.width-pad*2,r=Math.round(pad*.75);
 if(t.top&&cfg.showLogo!==false){
   const headerName=(cfg.appName||'GEOFOTO KMZ').trim().toLocaleUpperCase('pt-BR'),pillW=Math.round(c.width*.31),pillH=Math.round(c.height*.062);
   x.fillStyle='rgba(7,18,31,.78)';if(x.roundRect){x.beginPath();x.roundRect(pad,pad,pillW,pillH,r*.55);x.fill()}else x.fillRect(pad,pad,pillW,pillH);
   x.fillStyle='#fff';x.font='800 '+Math.max(24,Math.round(c.width*.028))+'px Arial';x.fillText(headerName,pad+Math.round(pad*.55),pad+Math.round(pillH*.66),pillW-pad);
   if(cfg.banner){try{const bi=await loadImg(cfg.banner),boxW=Math.round(c.width*.24),boxH=Math.round(c.height*.105),bx=c.width-pad-boxW,by=pad,ratio=Math.min((boxW-pad)/bi.width,(boxH-pad*.6)/bi.height),dw=bi.width*ratio,dh=bi.height*ratio;
    x.fillStyle='rgba(255,255,255,.86)';if(x.roundRect){x.beginPath();x.roundRect(bx,by,boxW,boxH,r*.55);x.fill()}else x.fillRect(bx,by,boxW,boxH);
    x.drawImage(bi,bx+(boxW-dw)/2,by+(boxH-dh)/2,dw,dh)}catch{}}
 }
 x.save();x.fillStyle=t.light?'rgba(255,255,255,.94)':'rgba(7,18,31,.78)';
 if(x.roundRect){x.beginPath();x.roundRect(cardX,panelY,cardW,panelH,r);x.fill()}else x.fillRect(cardX,panelY,cardW,panelH);
 x.restore();
 const fg=t.light?'#102235':'#fff',muted=t.light?'#4d6070':'#d9e3ec',title=($('#pointName')?.value.trim()||('Ponto '+(points.length+1))).toLocaleUpperCase('pt-BR'),displayName=(identity||'').trim(),titleScale=Number(t.titleScale||.034),textScale=Number(t.textScale||.019);
 const textX=cardX+pad,textW=hasMap?Math.round(cardW*.52):cardW-pad*2;
 const now=new Date(),timeText=now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),dateText=now.toLocaleDateString('pt-BR');
 const lat=geo?.latitude?.toFixed(6)||'-',lng=geo?.longitude?.toFixed(6)||'-',acc=Math.round(geo?.accuracy||0),city=geo?.city||'Nao identificada',address=(geo?.address||'Nao identificado').replace(/,\s*Regi[aã]o\s+Sul,?/i,'').replace(/,\s*Brasil$/i,'').replace(/,\s*$/,'').slice(0,92);
 x.fillStyle=fg;x.font='800 '+Math.max(30,Math.round(c.width*titleScale))+'px Arial';x.fillText(title,textX,panelY+Math.round(panelH*.12),textW);if(displayName){x.fillStyle=muted;x.font='700 '+Math.max(20,Math.round(c.width*textScale))+'px Arial';x.fillText('Nome: '+displayName,textX,panelY+Math.round(panelH*.23),textW);}
 x.fillStyle=fg;x.font='850 '+Math.max(44,Math.round(c.width*Math.max(.044,textScale*2.2)))+'px Arial';x.fillText(timeText,textX,panelY+Math.round(panelH*.40),textW);
 x.fillStyle=muted;x.font='700 '+Math.max(21,Math.round(c.width*textScale))+'px Arial';x.fillText(dateText,textX,panelY+Math.round(panelH*.51),textW);
 x.font='650 '+Math.max(19,Math.round(c.width*Math.max(.0175,textScale*.94)))+'px Arial';
 let yy=panelY+Math.round(panelH*.62),line=Math.round(panelH*.095);
 yy=drawWrappedText(x,'GPS: '+lat+', '+lng,textX,yy,textW,line,1);
 yy=drawWrappedText(x,'Precisao: '+acc+' m  •  '+city,textX,yy,textW,line,1);
 yy=drawWrappedText(x,'Endereco: '+address,textX,yy,textW,line,2);
 const note=$('#note')?.value.trim();if(note&&t.note!==false){x.fillStyle=fg;yy=drawWrappedText(x,'Obs.: '+note.slice(0,60),textX,yy,textW,line,1)}
 const footerY=panelY+panelH-Math.round(pad*.82);x.fillStyle='#22c55e';x.beginPath();x.arc(textX,footerY,Math.max(7,Math.round(c.width*.006)),0,Math.PI*2);x.fill();
 x.fillStyle=muted;x.font='600 '+Math.max(14,Math.round(c.width*.013))+'px Arial';x.fillText('GPS OK • Foto registrada',textX+Math.round(pad*.5),footerY+Math.round(pad*.16),textW);
 if(hasMap){
   const mw=Math.round(cardW*(Number(t.mapWidth)||.34)),mh=Math.min(Math.round(c.height*(Number(t.mapHeight)||.20)),Math.round(panelH*.70)),mx=cardX+cardW-pad-mw,my=panelY+Math.round((panelH-mh)/2);
   await miniMap(x,mx,my,mw,mh);
 }
 photo=c.toDataURL('image/jpeg',.92)
}
function drawWrappedText(x,text,a,b,maxW,lineH,maxLines=2){const words=String(text).split(' ');let line='',lines=0;for(const w of words){const test=line?line+' '+w:w;if(x.measureText(test).width>maxW&&line){x.fillText(line,a,b);b+=lineH;lines++;line=w;if(lines>=maxLines-1)break}else line=test}if(line&&lines<maxLines){x.fillText(line,a,b);b+=lineH}return b}
function topBar(x,w,h){x.fillStyle=cfg.primaryColor||'#0f766e';x.fillRect(0,0,w,h);x.fillStyle='#fff';x.font=`bold ${Math.max(24,Math.round(w*.028))}px Arial`;x.fillText(cfg.company||cfg.appName||'GeoFoto KMZ',Math.round(w*.03),Math.round(h*.62))}
async function miniMap(x,a,b,w,h){
 if(geo){
   try{
     const img=await loadOsmSnapshot(geo.latitude,geo.longitude,Math.max(420,Math.round(w*1.08)),Math.max(300,Math.round(h*1.08)),17);
     x.save();
     if(x.roundRect){x.beginPath();x.roundRect(a,b,w,h,Math.round(w*.035));x.clip()}
     x.drawImage(img,a,b,w,h);
     x.fillStyle='rgba(7,18,31,.68)';x.fillRect(a,b+h-Math.max(18,h*.075),Math.min(w*.48,165),Math.max(18,h*.075));
     x.fillStyle='#fff';x.font='600 '+Math.max(10,w*.027)+'px Arial';x.fillText('© OpenStreetMap',a+8,b+h-6);
     const cx=a+w/2,cy=b+h/2;
     x.fillStyle='rgba(37,99,235,.22)';x.beginPath();x.arc(cx,cy,Math.max(24,w*.07),0,Math.PI*2);x.fill();
     x.fillStyle='#2563eb';x.beginPath();x.arc(cx,cy,Math.max(10,w*.026),0,Math.PI*2);x.fill();
     x.strokeStyle='#fff';x.lineWidth=Math.max(3,w*.006);x.stroke();
     x.restore();
     x.strokeStyle='rgba(255,255,255,.95)';x.lineWidth=Math.max(2,w*.004);
     if(x.roundRect){x.beginPath();x.roundRect(a,b,w,h,Math.round(w*.035));x.stroke()}else x.strokeRect(a,b,w,h);
     return
   }catch{}
 }
 x.fillStyle='rgba(255,255,255,.10)';x.fillRect(a,b,w,h);x.strokeStyle='rgba(255,255,255,.8)';x.strokeRect(a,b,w,h);
 x.fillStyle='#fff';x.font='700 '+Math.max(18,w*.05)+'px Arial';x.fillText('MAPA / GPS',a+16,b+30);
}
async function loadOsmSnapshot(lat,lng,w=700,h=420,z=18){
 const n=2**z,tile=256,rad=lat*Math.PI/180;
 const worldX=(lng+180)/360*n*tile,worldY=(1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2*n*tile;
 const left=worldX-w/2,top=worldY-h/2,c=document.createElement('canvas'),g=c.getContext('2d');c.width=w;c.height=h;
 g.fillStyle='#e7edf2';g.fillRect(0,0,w,h);
 const x0=Math.floor(left/tile),x1=Math.floor((left+w)/tile),y0=Math.floor(top/tile),y1=Math.floor((top+h)/tile),jobs=[];
 for(let ty=y0;ty<=y1;ty++)for(let tx=x0;tx<=x1;tx++){
  const wrapped=((tx%n)+n)%n,dx=Math.round(tx*tile-left),dy=Math.round(ty*tile-top);
  jobs.push(loadImg('/api/tile/'+z+'/'+wrapped+'/'+ty+'.png').then(img=>g.drawImage(img,dx,dy,tile,tile)).catch(()=>{}));
 }
 await Promise.all(jobs);
 return c
}
function loadImg(src){return new Promise((r,j)=>{const i=new Image();i.onload=()=>r(i);i.onerror=j;i.src=src})}
function captureUi(){const v=$('#camera'),p=$('#preview');p.src=photo||raw;p.classList.remove('hidden');v.classList.add('hidden');$('#take').classList.add('hidden');$('#retake').classList.remove('hidden');$('#shareActions').classList.remove('hidden');$('#shareBtn').onclick=shareCurrent;$('#downloadBtn').onclick=downloadCurrentPhoto}
function retake(){raw='';photo='';savedPhotoKey='';saving=false;$('#preview').classList.add('hidden');$('#camera').classList.remove('hidden');$('#take').classList.remove('hidden');$('#retake').classList.add('hidden');$('#shareActions').classList.add('hidden');$('#saveStatus').textContent='Aguardando nova foto...';startCamera();getGps()}
async function getGps(){
 const el=$('#gpsInfo'),state=$('#gpsState');const set=(kind,msg)=>{if(state){state.className='sensor-state '+kind;state.querySelector('span').textContent=msg}if(el)el.textContent=msg};
 geo=null;updateCaptureReady();
 if(!navigator.geolocation){set('error','GPS indisponível neste aparelho.');return false}
 set('waiting','Obtendo localização…');
 return new Promise(resolve=>navigator.geolocation.getCurrentPosition(async p=>{
  geo={latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy};
  set('ok','GPS OK · ±'+Math.round(geo.accuracy)+' m');
  const r=await reverse(geo.latitude,geo.longitude);geo.city=r.city;geo.address=r.address;
  if(el)el.innerHTML=`Latitude: <b>${geo.latitude.toFixed(6)}</b> · Longitude: <b>${geo.longitude.toFixed(6)}</b> · Precisão: <b>${Math.round(geo.accuracy)} m</b><br><b>${esc(geo.city)}</b> · ${esc(geo.address)}`;
  updateCaptureReady();if(raw){await annotate();captureUi();await maybeAutoSave()}resolve(true)
 },e=>{const denied=e.code===1;set('error',denied?'Permissão de localização bloqueada. Ative a localização para o GeoFoto KMZ.':'Falha no GPS: '+e.message);updateCaptureReady();resolve(false)},{enableHighAccuracy:true,timeout:20000,maximumAge:0}))
}
async function reverse(lat,lng){try{const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`),d=await r.json(),a=d.address||{};return{address:d.display_name||'',city:a.city||a.town||a.village||a.municipality||a.county||''}}catch{return{address:'',city:''}}}
async function maybeAutoSave(){if(!photo||!geo||saving||!savedPhotoKey)return;const key=savedPhotoKey;saving=true;const st=$('#saveStatus');if(st)st.textContent='Salvando automaticamente e adicionando o pino ao mapa/KMZ...';const p={id:crypto.randomUUID(),name:($('#pointName').value.trim()||`Ponto ${points.length+1}`).toLocaleUpperCase('pt-BR'),note:$('#note').value.trim(),lat:geo.latitude,lng:geo.longitude,accuracy:geo.accuracy,time:new Date().toISOString(),city:geo.city||'',address:geo.address||'',photo};try{if(!navigator.onLine)throw Error('offline');await api('/points',{method:'POST',body:JSON.stringify(p)});await syncDown();if(st)st.textContent='✓ Salvo na nuvem. Pino adicionado ao mapa e ao KMZ.';renderDashboard();renderRecords();renderExport();if(map){initMap();setTimeout(()=>map.invalidateSize(),50)}}catch{await pendingPut(p);await syncDown();if(st)st.textContent='✓ Salvo offline neste aparelho. Envio automático quando a internet voltar.';renderDashboard();renderRecords();renderExport();if(map){initMap();setTimeout(()=>map.invalidateSize(),50)}}finally{await updatePendingStatus();if(savedPhotoKey===key)saving=false}}
async function downloadCurrentPhoto(){const src=photo||raw;if(!src)return;const blob=dataToBlob(src),point=safeName($('#pointName')?.value||'geofoto'),name=`${point}-${Date.now()}.jpg`,st=$('#saveStatus');try{saveBlob(blob,name);if(st)st.textContent='✓ Foto salva no celular. Verifique a pasta Downloads.'}catch(e){if(st)st.textContent='Não foi possível salvar a foto neste aparelho.'}}
async function shareCurrent(){return shareBlob(dataToBlob(photo||raw),`geofoto-${Date.now()}.jpg`)}
async function shareRecord(id){const p=points.find(x=>x.id===id);if(!p)return;if(p.photo)return shareBlob(dataToBlob(p.photo),`${safeName(p.name)}.jpg`);if(p.photoUrl){const b=await apiBlob(p.photoUrl);return shareBlob(b,`${safeName(p.name)}.jpg`)}}
async function shareBlob(blob,name){const f=new File([blob],name,{type:'image/jpeg'});if(navigator.canShare&&navigator.canShare({files:[f]})){try{return await navigator.share({title:'GeoFoto KMZ',text:'Registro georreferenciado',files:[f]})}catch{}}saveBlob(blob,name)}
async function openRecordPhoto(id){const p=points.find(x=>x.id===id);if(!p)return;let src=p.photo||'',revoke='';try{if(!src&&p.photoUrl){const b=await apiBlob(p.photoUrl);src=URL.createObjectURL(b);revoke=src}if(!src)return;const box=document.createElement('div');box.className='photo-lightbox';const img=document.createElement('img');img.src=src;img.alt='Foto '+p.name;const meta=document.createElement('div');meta.className='photo-lightbox-meta';meta.innerHTML='<b>'+esc(p.name)+'</b><span>'+esc(fmt(p.time))+' · '+Number(p.lat).toFixed(6)+', '+Number(p.lng).toFixed(6)+'</span>';const close=document.createElement('button');close.className='photo-lightbox-close';close.textContent='×';const done=()=>{box.remove();if(revoke)URL.revokeObjectURL(revoke)};close.onclick=done;box.onclick=e=>{if(e.target===box)done()};box.append(close,img,meta);document.body.appendChild(box)}catch(e){alert('Não foi possível abrir a foto: '+e.message)}}
function renderRecords(){$('#records').innerHTML=`<div class="records-list">${points.slice().reverse().map(p=>`<div class="card record-card"><div class="record-head"><div><b>${esc(p.name)}</b><div class="muted small">${fmt(p.time)} · ${esc(p.city||'')}</div></div><div class="record-badges"><span class="badge">${Math.round(p.accuracy||0)} m</span>${p._pending?'<span class="badge pending">Pendente</span>':''}</div></div>${(p.photo||p.photoUrl)?`<img class="record-photo" data-photo-id="${p.id}" alt="Foto de ${attr(p.name)}">`:''}<div class="record-note"><b>Descrição:</b><span>${esc(p.note||'Sem descrição informada.')}</span></div><div class="muted small">${esc(p.address||'Sem endereço')}</div><div class="muted small">${Number(p.lat).toFixed(6)}, ${Number(p.lng).toFixed(6)}</div><div class="actions"><button class="btn secondary" data-map="${p.lat},${p.lng}">Abrir Maps</button>${(p.photo||p.photoUrl)?`<button class="btn primary" data-share="${p.id}">Enviar</button>`:''}${role==='admin'?`<button class="btn secondary" data-delete="${p.id}">Excluir</button>`:''}</div></div>`).join('')||'<div class="card">Nenhum registro.</div>'}</div>`;document.querySelectorAll('[data-photo-id]').forEach(async img=>{const p=points.find(x=>x.id===img.dataset.photoId);try{if(p?.photo)img.src=p.photo;else if(p?.photoUrl){const b=await apiBlob(p.photoUrl),u=URL.createObjectURL(b);img.src=u;img.onload=()=>setTimeout(()=>URL.revokeObjectURL(u),30000)}}catch{img.alt='Foto indisponível'}});document.querySelectorAll('[data-map]').forEach(b=>b.onclick=()=>window.open(`https://www.google.com/maps?q=${b.dataset.map}`,'_blank'));document.querySelectorAll('[data-share]').forEach(b=>b.onclick=()=>shareRecord(b.dataset.share));document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Excluir este registro e a foto?'))return;try{await api('/points/'+b.dataset.delete,{method:'DELETE'});await syncDown();renderDashboard();renderRecords();renderExport();if(map)initMap()}catch(e){alert(e.message)}})}
function initMap(){if(!map){map=L.map('map',{zoomControl:true}).setView([-25.43,-49.27],11);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:19}).addTo(map);markers=L.layerGroup().addTo(map)}markers.clearLayers();const valid=points.filter(p=>Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lng)));valid.forEach(p=>L.marker([Number(p.lat),Number(p.lng)]).bindPopup(`<b>${esc(p.name)}</b><br><b>Descrição:</b> ${esc(p.note||'Sem descrição informada.')}<br>${fmt(p.time)}<br>${esc(p.city||'')}<br>${Number(p.lat).toFixed(6)}, ${Number(p.lng).toFixed(6)}`).addTo(markers));if(valid.length===1)map.setView([Number(valid[0].lat),Number(valid[0].lng)],17);else if(valid.length>1){const g=L.featureGroup(valid.map(p=>L.marker([Number(p.lat),Number(p.lng)])));map.fitBounds(g.getBounds().pad(.2))}setTimeout(()=>map.invalidateSize(),200)}
function renderExport(){$("#export").innerHTML=`<div class="card"><h3>Central de registros</h3><p class="muted">Cada foto salva automaticamente já cria um Placemark no KML/KMZ.</p><div class="actions"><button class="btn secondary" id="refreshCloud">Atualizar da nuvem</button><button class="btn secondary" id="kml">Baixar KML</button><button class="btn primary" id="kmz">Baixar KMZ completo</button></div><div id="exportStatus" class="muted small"></div></div>`;$("#refreshCloud").onclick=async()=>{await syncDown();renderAll();alert("Pontos atualizados.")};$("#kml").onclick=()=>download("geofoto-kmz.kml",makeKml(),"application/vnd.google-earth.kml+xml");$("#kmz").onclick=async()=>{const btn=$("#kmz"),st=$("#exportStatus");btn.disabled=true;btn.textContent="Gerando KMZ...";if(st)st.textContent="Preparando pontos e fotos...";try{const z=new JSZip();z.file("doc.kml",makeKml());let fotos=0;for(const p of points){try{let b=null;if(p.photo)b=dataToBlob(p.photo);else if(p.photoUrl)b=await apiBlob(p.photoUrl);if(b){z.file("fotos/"+safeName(p.name)+"-"+String(p.id).slice(0,8)+".jpg",b);fotos++}}catch{}}if(st)st.textContent=`Compactando ${points.length} pontos e ${fotos} fotos...`;const blob=await z.generateAsync({type:"blob",compression:"DEFLATE"});saveBlob(blob,"geofoto-kmz.kmz");if(st)st.textContent=`✓ KMZ gerado com ${points.length} pontos e ${fotos} fotos.`}catch(e){if(st)st.textContent="Falha ao gerar KMZ.";alert("Falha ao gerar KMZ: "+e.message)}finally{btn.disabled=false;btn.textContent="Baixar KMZ completo"}}}
function renderSettings(){const enabled=cfg.enabledTemplates||Object.keys(TEMPLATES);$('#settings').innerHTML=`<div class="grid2"><div class="card"><h3>Identidade do usuário</h3><label class="field">Nome exibido (obrigatório) *<input id="identityName" value="${attr(identity||'')}" placeholder="Ex.: João Silva / Equipe 01" required></label><label class="field">Cor principal<input id="primaryColor" type="color" value="${attr(cfg.primaryColor||'#0f766e')}"></label><label class="field">Logo / banner (opcional)<input id="bannerFile" type="file" accept="image/*"></label>${cfg.banner?`<img class="banner-preview" src="${cfg.banner}">`:''}<div class="actions"><button class="btn primary" id="saveCfg">Salvar identidade</button><button class="btn secondary" id="clearCfg">Remover logo</button></div></div><div class="card"><h3>Modelos de foto</h3><label class="field">Modelo padrão<select id="defaultTemplate">${Object.entries(TEMPLATES).map(([id,t])=>`<option value="${id}" ${id===cfg.defaultTemplate?'selected':''}>${t.name}</option>`).join('')}</select></label><div class="template-list">${Object.entries(TEMPLATES).map(([id,t])=>`<label class="template-option"><input type="checkbox" data-template="${id}" ${enabled.includes(id)?'checked':''}><span><b>${t.name}</b><small>${t.description}</small></span></label>`).join('')}</div><div class="actions"><button class="btn primary" id="saveTemplates">Salvar modelos</button></div></div><div class="card"><h3>Aplicativo</h3><div class="version-box"><span>Versão instalada</span><b>v${APP_VERSION}</b></div><p class="muted">As atualizações são recebidas sem reinstalar o aplicativo e não apagam fotos ou registros.</p><div class="actions"><span class="update-state">✓ Atualizações automáticas ativas</span><button class="btn secondary" id="syncPending">Sincronizar pendentes</button><button class="btn secondary" id="refresh">Atualizar dados</button><button class="btn secondary" id="logout">Sair</button></div></div></div>`;$('#logout').onclick=()=>{sessionStorage.removeItem('gf_token');sessionStorage.removeItem('gf_role');sessionStorage.removeItem(IDENTITY);localStorage.removeItem('gf_token');localStorage.removeItem('gf_role');localStorage.removeItem(IDENTITY);token='';role='user';identity='';loginView()};$('#refresh').onclick=async()=>{await syncDown();renderAll()};const installBtn=$('#installApp');if(installBtn)installBtn.onclick=installApp;$('#syncPending').onclick=async()=>{if(!navigator.onLine){alert('Sem internet. Os registros continuam salvos no aparelho.');return}const n=(await pendingAll().catch(()=>[])).length;if(!n){alert('Não há registros pendentes.');return}const sent=await syncPendingQueue();alert(sent?'Sincronização concluída: '+sent+' registro'+(sent===1?'':'s')+' enviado'+(sent===1?'':'s')+'.':'Não foi possível sincronizar agora.')} ;const persist=async()=>{saveCfg();try{await api('/config',{method:'POST',body:JSON.stringify(cfg)})}catch(e){if(role==='admin')alert(e.message)}};$('#saveCfg').onclick=async()=>{const id=$('#identityName').value.trim();if(id.length<2){alert('Informe o nome do técnico/usuário.');$('#identityName').focus();return}identity=id;sessionStorage.setItem(IDENTITY,identity);localStorage.setItem(IDENTITY,identity);cfg.primaryColor=$('#primaryColor').value;const f=$('#bannerFile').files[0];if(f)cfg.banner=await fileData(f);await persist();alert('Identidade salva.')};$('#clearCfg').onclick=async()=>{cfg.banner='';await persist();renderSettings()};$('#saveTemplates').onclick=async()=>{const ids=[...document.querySelectorAll('[data-template]:checked')].map(x=>x.dataset.template);cfg.enabledTemplates=ids.length?ids:['essential'];cfg.defaultTemplate=cfg.enabledTemplates.includes($('#defaultTemplate').value)?$('#defaultTemplate').value:cfg.enabledTemplates[0];await persist();alert('Modelos atualizados.')}}
function makeKml(){return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>GeoFoto KMZ</name>${points.map(p=>`<Placemark><name>${xml(p.name)}</name><description>${xml(`${p.note||''} | ${fmt(p.time)} | ${p.city||''} | ${p.address||''} | Precisão ${Math.round(p.accuracy||0)}m`)}</description><Point><coordinates>${p.lng},${p.lat},0</coordinates></Point></Placemark>`).join('')}</Document></kml>`}
function fileData(f){return new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(f)})}
function dataToBlob(u){const p=u.split(','),m=(p[0].match(/:(.*?);/)||[])[1]||'image/jpeg',b=atob(p[1]),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return new Blob([a],{type:m})}
function download(n,t,type){saveBlob(new Blob([t],{type}),n)}
function saveBlob(b,n){const u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=n;a.rel='noopener';a.style.display='none';document.body.appendChild(a);a.click();setTimeout(()=>{a.remove();URL.revokeObjectURL(u)},15000)}
function fmt(v){return new Date(v).toLocaleString('pt-BR')}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function attr(s=''){return String(s).replace(/"/g,'&quot;')}
function xml(s=''){return esc(s)}
function safeName(s='registro'){return String(s).replace(/[^a-z0-9_-]+/gi,'-')}



function photoPath(p){return 'fotos/'+safeName(p.name)+'-'+String(p.id).slice(0,8)+'.jpg'}
document.addEventListener('click',e=>{const img=e.target.closest&&e.target.closest('[data-photo-id]');if(img)openRecordPhoto(img.dataset.photoId)});
makeKml=function(withPhotos=false){
 const items=points.map(p=>{const desc='<b>Descrição:</b> '+esc(p.note||'Sem descrição informada.')+'<br><b>Data/Hora:</b> '+esc(fmt(p.time))+'<br><b>Cidade:</b> '+esc(p.city||'Não identificada')+'<br><b>Endereço:</b> '+esc(p.address||'Não identificado')+'<br><b>Precisão GPS:</b> '+Math.round(p.accuracy||0)+' m<br><b>Coordenadas:</b> '+Number(p.lat).toFixed(6)+', '+Number(p.lng).toFixed(6);
  const image=withPhotos&&(p.photo||p.photoUrl)?'<br><br><img src="'+photoPath(p)+'" width="640">':'';
  return '<Placemark><name>'+xml(p.name)+'</name><description><![CDATA['+desc+image+']]></description><Point><coordinates>'+p.lng+','+p.lat+',0</coordinates></Point></Placemark>'});
 return '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>GeoFoto KMZ</name>'+items.join('')+'</Document></kml>'
};

renderExport=function(){
 $('#export').innerHTML='<div class="card export-center"><div class="export-badge">KMZ</div><h3>Exportar para Google Earth</h3><p class="muted">O KMZ inclui os pontos, metadados e as fotos vinculadas aos respectivos registros.</p><div class="export-metrics"><div><b>'+points.length+'</b><span>Pontos</span></div><div><b>'+points.filter(p=>p.photo||p.photoUrl).length+'</b><span>Fotos</span></div></div><div class="actions"><button class="btn secondary" id="refreshCloud">Atualizar nuvem</button><button class="btn secondary" id="kml">Baixar KML</button><button class="btn primary" id="kmz">Baixar KMZ completo</button></div><div id="exportStatus" class="muted small"></div></div>';
 $('#refreshCloud').onclick=async()=>{await syncDown();renderAll();alert('Pontos atualizados.')};
 $('#kml').onclick=()=>download('geofoto-kmz.kml',makeKml(false),'application/vnd.google-earth.kml+xml');
 $('#kmz').onclick=async()=>{const btn=$('#kmz'),st=$('#exportStatus');btn.disabled=true;btn.textContent='Gerando KMZ...';if(st)st.textContent='Preparando pontos e fotos...';
  try{const z=new JSZip();z.file('doc.kml',makeKml(true));let fotos=0;
   for(const p of points){try{let b=null;if(p.photo)b=dataToBlob(p.photo);else if(p.photoUrl)b=await apiBlob(p.photoUrl);if(b){z.file(photoPath(p),b);fotos++}}catch{}}
   if(st)st.textContent='Compactando '+points.length+' pontos e '+fotos+' fotos...';
   const blob=await z.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});saveBlob(blob,'geofoto-kmz.kmz');
   if(st)st.textContent='✓ KMZ gerado com '+points.length+' pontos e '+fotos+' fotos vinculadas.'
  }catch(e){if(st)st.textContent='Falha ao gerar KMZ.';alert('Falha ao gerar KMZ: '+e.message)}
  finally{btn.disabled=false;btn.textContent='Baixar KMZ completo'}
 };
};

function isStandalone(){return window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true}
async function installApp(){
 if(isStandalone()){alert('O GeoFoto KMZ já está instalado neste aparelho.');return}
 if(installPrompt){
  const p=installPrompt;installPrompt=null;p.prompt();
  try{const r=await p.userChoice;if(r.outcome!=='accepted')installPrompt=p}catch{}
  return
 }
 alert('No Chrome, toque no menu ⋮ e escolha “Instalar app” ou “Adicionar à tela inicial”. Se a opção não aparecer, feche e abra o site novamente.')
}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e});
window.addEventListener('appinstalled',()=>{installPrompt=null;alert('GeoFoto KMZ instalado. O ícone foi adicionado à tela de aplicativos/tela inicial.')});
function showUpdatePrompt(version='nova versão'){
 if(document.querySelector('.update-gate'))return;
 const gate=document.createElement('div');gate.className='update-gate';
 gate.innerHTML='<div class="update-card"><div class="update-icon">↻</div><span class="update-kicker">ATUALIZAÇÃO DISPONÍVEL</span><h2>Nova versão do GeoFoto KMZ</h2><p>A versão <b>'+esc(version)+'</b> está pronta. Seus registros e fotos não serão apagados.</p><div class="update-actions"><button class="btn secondary" id="updateLater" type="button">Depois</button><button class="btn primary" id="updateNow" type="button">Atualizar agora</button></div><div id="updateStatus" class="muted small"></div></div>';
 document.body.appendChild(gate);
 gate.querySelector('#updateLater').onclick=()=>gate.remove();
 gate.querySelector('#updateNow').onclick=async()=>{const btn=gate.querySelector('#updateNow'),st=gate.querySelector('#updateStatus');btn.disabled=true;st.textContent='Baixando e aplicando a atualização…';try{const reg=swRegistration||await navigator.serviceWorker.getRegistration();if(reg){await reg.update();if(reg.waiting){reg.waiting.postMessage({type:'SKIP_WAITING'});return}if(reg.installing){reg.installing.addEventListener('statechange',()=>{if(reg.installing?.state==='installed'&&reg.waiting)reg.waiting.postMessage({type:'SKIP_WAITING'})})}}setTimeout(()=>location.reload(),1800)}catch{location.reload()}}
}
function compareVersions(a,b){
 const pa=String(a||'0').split('.').map(n=>Number(n)||0),pb=String(b||'0').split('.').map(n=>Number(n)||0),len=Math.max(pa.length,pb.length);
 for(let i=0;i<len;i++){const x=pa[i]||0,y=pb[i]||0;if(x>y)return 1;if(x<y)return -1}
 return 0
}
async function checkForUpdate(manual=false){
 try{
  const r=await fetch('/version.json?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('version');
  const v=await r.json();
  if(v.version&&compareVersions(v.version,APP_VERSION)>0){
   if(swRegistration)await swRegistration.update().catch(()=>{});
   showUpdatePrompt(v.version);return true
  }
  if(manual)alert('Você já está usando a versão mais recente: '+APP_VERSION+'.');
  return false
 }catch{if(manual)alert('Não foi possível verificar atualizações agora.');return false}
}
async function initUpdater(){
 if(!('serviceWorker' in navigator))return;
 try{
  swRegistration=await navigator.serviceWorker.register('/sw.js');
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updateReloading)return;updateReloading=true;location.reload()});
  await checkForUpdate(false);
  setInterval(()=>checkForUpdate(false),60*60*1000)
 }catch{}
}
window.addEventListener('load',initUpdater);
window.addEventListener('online',()=>syncPendingQueue().catch(()=>{}));
window.addEventListener('offline',()=>updatePendingStatus());
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&navigator.onLine)syncPendingQueue().catch(()=>{})});
setInterval(()=>{if(navigator.onLine)syncPendingQueue().catch(()=>{})},60000);
token?appView().catch(loginView):loginView()
