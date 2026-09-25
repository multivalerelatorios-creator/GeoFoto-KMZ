import './style.css'
import './field-theme.css'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import mapMarkerIcon from 'leaflet/dist/images/marker-icon.png'
import mapMarkerRetina from 'leaflet/dist/images/marker-icon-2x.png'
import mapMarkerShadow from 'leaflet/dist/images/marker-shadow.png'
import JSZip from 'jszip'
const $=s=>document.querySelector(s), LOCAL='geofoto_offline_v2', CFG='geofoto_cfg_v1', IDENTITY='gf_identity', ACCOUNT='gf_account', LOCAL_BRAND='gf_brand_local', APP_VERSION='1.5.5'
let token=sessionStorage.getItem('gf_token')||localStorage.getItem('gf_token')||'',role=sessionStorage.getItem('gf_role')||localStorage.getItem('gf_role')||'user',tenant=sessionStorage.getItem('gf_tenant')||localStorage.getItem(ACCOUNT)||'principal',identity=sessionStorage.getItem(IDENTITY)||localStorage.getItem(IDENTITY)||'',points=[],map,markers,stream=null,raw='',photo='',geo=null,cfg=loadCfg(),saving=false,savedPhotoKey='',swRegistration=null,updateReloading=false,pendingBanner='',installPrompt=null,offlineSyncing=false,cloudConnected=false,cloudPending=0,cloudRecords=Number(localStorage.getItem('gf_cloud_count:'+(localStorage.getItem(ACCOUNT)||'principal'))||0),lastCloudSync=Number(localStorage.getItem('gf_cloud_sync:'+(localStorage.getItem(ACCOUNT)||'principal'))||0),cloudStorage=null,recordTechnicianFilter='',recordDateFilter='',torchOn=false,torchSupported=false,captureClockTimer=null

const UI_PATHS={home:'<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',camera:'<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/>',map:'<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16"/>',records:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',export:'<path d="M7 17H5a4 4 0 0 1-1-8 8 8 0 0 1 15-1 5 5 0 0 1 0 10h-2M12 21V11m-4 4 4-4 4 4"/>',settings:'<path d="m9 3-1 3-3 1-2 4 2 2 1 4 3 1 2 3 4-1 1-3 3-1 2-4-2-2-1-4-3-1-2-2z"/><circle cx="12" cy="12" r="3"/>'};
function uiIcon(name){return '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(UI_PATHS[name]||UI_PATHS.camera)+'</svg>'}
function goPage(id){const button=document.querySelector('.nav [data-page="'+id+'"]');if(button)show(id,button)}

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
L.Icon.Default.mergeOptions({iconRetinaUrl:mapMarkerRetina,iconUrl:mapMarkerIcon,shadowUrl:mapMarkerShadow})
function storeKey(base){return base+':'+(tenant||'principal')}
function accountLabel(){if(tenant==='personal')return 'USO PESSOAL';return (tenant||'principal')==='principal'?'MULTIVALE':String(tenant).toLocaleUpperCase('pt-BR')}
function isPersonalMode(){return role==='personal'||tenant==='personal'}
function cloudSyncKey(){return 'gf_cloud_sync:'+String(tenant||'principal')}
function cloudCountKey(){return 'gf_cloud_count:'+String(tenant||'principal')}
function cloudStorageKey(){return 'gf_cloud_storage:'+String(tenant||'principal')}
function formatCloudBytes(v){const n=Math.max(0,Number(v)||0);if(n>=1e9)return (n/1e9).toFixed(n>=9.95?1:2)+' GB';if(n>=1e6)return (n/1e6).toFixed(n>=1e8?0:1)+' MB';if(n>=1e3)return (n/1e3).toFixed(0)+' KB';return n+' B'}
function cachedCloudStorage(){try{return JSON.parse(localStorage.getItem(cloudStorageKey())||'null')}catch{return null}}
function paintCloudStorage(){
 const mini=$('#cloudStorageMini'),fill=$('#cloudStorageMiniFill'),used=$('#cloudStorageUsed'),remaining=$('#cloudStorageRemaining'),count=$('#cloudStorageObjects'),bar=$('#cloudStorageFill');
 if(isPersonalMode()){if(mini)mini.textContent='Dados armazenados somente neste aparelho';return}
 const s=cloudStorage||cachedCloudStorage();if(!s){if(mini)mini.textContent=cloudConnected?'Calculando espaço da nuvem…':'Espaço da nuvem indisponível offline';return}
 const total=Number(s.freeAllowanceBytes)||10000000000,u=Number(s.usedBytes)||0,r=Math.max(0,Number(s.remainingFreeBytes??total-u)),pct=Math.min(100,Math.max(0,u/total*100));
 if(mini)mini.textContent=formatCloudBytes(u)+' usados · '+formatCloudBytes(r)+' disponíveis de 10 GB';
 if(fill)fill.style.width=pct+'%';if(bar)bar.style.width=pct+'%';if(used)used.textContent=formatCloudBytes(u);if(remaining)remaining.textContent=formatCloudBytes(r);if(count)count.textContent=String(Number(s.objects)||0)
}
async function refreshCloudStorage(force=false){
 if(isPersonalMode()||!token)return null;
 const cached=cachedCloudStorage();if(!force&&cached&&Date.now()-Number(cached.cachedAt||0)<10*60*1000){cloudStorage=cached;paintCloudStorage();return cached}
 try{const s=await api('/storage',{timeout:12000});cloudStorage={...s,cachedAt:Date.now()};localStorage.setItem(cloudStorageKey(),JSON.stringify(cloudStorage));paintCloudStorage();return cloudStorage}catch{if(cached){cloudStorage=cached;paintCloudStorage()}return null}
}
function cloudTimeLabel(ts){if(!ts)return 'Ainda não sincronizado';return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(ts))}
function paintCloudDemo(mode=''){
 const top=$('#netStatus'),bar=$('#cloudDemoBar'),state=$('#cloudDemoState'),records=$('#cloudDemoRecords'),pending=$('#cloudDemoPending'),last=$('#cloudDemoLast');
 let label='☁ Conectando',kind='connecting';
 if(isPersonalMode()){label='☁ Uso pessoal · dados neste aparelho';kind='local'}
 else if(mode==='sync'){label='☁ Sincronizando'+(cloudPending?' · '+cloudPending+' pendente'+(cloudPending===1?'':'s'):'');kind='syncing'}
 else if(!navigator.onLine||!cloudConnected){label='☁ Offline'+(cloudPending?' · '+cloudPending+' pendente'+(cloudPending===1?'':'s'):'');kind='offline'}
 else if(cloudPending){label='☁ Nuvem conectada · '+cloudPending+' pendente'+(cloudPending===1?'':'s');kind='pending'}
 else{label='☁ Nuvem conectada';kind='online'}
 if(top){top.textContent=label;top.className='status cloud-indicator '+kind}
 if(bar){bar.className='cloud-demo-bar '+kind;const b=bar.querySelector('[data-cloud-label]');if(b)b.textContent=label}
 if(state)state.textContent=isPersonalMode()?'Somente neste aparelho':(kind==='online'?'Nuvem conectada':kind==='syncing'?'Sincronizando':kind==='pending'?'Conectada com pendências':'Offline');
 if(records)records.textContent=isPersonalMode()?'—':String(cloudRecords);
 if(pending)pending.textContent=String(cloudPending);
 if(last)last.textContent=isPersonalMode()?'Não se aplica':cloudTimeLabel(lastCloudSync)
 paintCloudStorage()
}
function loadCfg(){
 const d={appName:'GEOFOTO KMZ',company:'',logo:'',banner:'',primaryColor:'#0f766e',defaultTemplate:'essential',enabledTemplates:['essential','compact','location','corporate','technical','evidence','minimal'],showLogo:true,showMap:true};
 try{const saved=JSON.parse(localStorage.getItem(storeKey(CFG))||'{}'),out={...d,...saved};if(!Object.prototype.hasOwnProperty.call(saved,'logo')&&saved.banner)out.logo=saved.banner;return out}catch{return d}
}
function saveCfg(){localStorage.setItem(storeKey(CFG),JSON.stringify(cfg))}
function loadLocalBrand(){try{const raw=localStorage.getItem(storeKey(LOCAL_BRAND))||(tenant==='principal'?localStorage.getItem(LOCAL_BRAND):null);return JSON.parse(raw||'{}')}catch{return{}}}
function saveLocalBrand(v){localStorage.setItem(storeKey(LOCAL_BRAND),JSON.stringify(v))}
function mergeLocalBrand(){const b=loadLocalBrand();if(Object.prototype.hasOwnProperty.call(b,'logo'))cfg.logo=b.logo;if(Object.prototype.hasOwnProperty.call(b,'banner'))cfg.banner=b.banner;if(b.primaryColor)cfg.primaryColor=b.primaryColor}
async function optimizeBrandImage(file){
 if(!file)return '';
 if(file.size>12*1024*1024)throw Error('A imagem é muito grande. Use um arquivo de até 12 MB.');
 const src=await fileData(file),img=await loadImg(src),maxW=1200,maxH=700,scale=Math.min(1,maxW/img.width,maxH/img.height);
 const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));
 c.getContext('2d').drawImage(img,0,0,c.width,c.height);
 return c.toDataURL('image/jpeg',.88)
}
function offlineDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('geofoto-offline-v1',2);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('pending'))db.createObjectStore('pending',{keyPath:'id'});if(!db.objectStoreNames.contains('snapshots'))db.createObjectStore('snapshots',{keyPath:'tenant'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function pendingAll(){const db=await offlineDb();return new Promise((resolve,reject)=>{const r=db.transaction('pending').objectStore('pending').getAll();r.onsuccess=()=>resolve((r.result||[]).filter(p=>(p._tenant||'principal')===tenant));r.onerror=()=>reject(r.error)})}
async function pendingPut(p){const db=await offlineDb();return new Promise((resolve,reject)=>{const tx=db.transaction('pending','readwrite');tx.objectStore('pending').put({...p,_pending:true,_tenant:tenant});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function pendingDelete(id){const db=await offlineDb();return new Promise((resolve,reject)=>{const tx=db.transaction('pending','readwrite');tx.objectStore('pending').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function snapshotGet(){const db=await offlineDb();return new Promise((resolve,reject)=>{const r=db.transaction('snapshots').objectStore('snapshots').get(tenant);r.onsuccess=()=>resolve(r.result?.points||[]);r.onerror=()=>reject(r.error)})}
async function snapshotPut(list){const db=await offlineDb();const safe=(list||[]).map(p=>{const q={...p};delete q.photo;delete q._pending;return q});return new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put({tenant,points:safe,updatedAt:Date.now()});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function requestPersistentStorage(){try{if(navigator.storage?.persist)await navigator.storage.persist()}catch{}}
function mergePoints(cloud,pending){const m=new Map();for(const p of cloud||[])m.set(p.id,p);for(const p of pending||[])m.set(p.id,{...p,_pending:true});return [...m.values()].sort((a,b)=>String(a.time).localeCompare(String(b.time)))}
async function updatePendingStatus(mode=''){
 cloudPending=(await pendingAll().catch(()=>[])).length;
 paintCloudDemo(mode);
 return cloudPending
}
async function api(path,opt={}){
 const h={'Content-Type':'application/json',...(opt.headers||{})};if(token)h.Authorization=`Bearer ${token}`;if(identity?.trim())h['X-GeoFoto-Identity']=encodeURIComponent(identity.trim());
 const ms=Number(opt.timeout||7000),ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),ms),{timeout,...fetchOpt}=opt;
 try{const r=await fetch('/api'+path,{...fetchOpt,headers:h,signal:fetchOpt.signal||ctrl.signal});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Falha na comunicação');return d}
 catch(e){if(e?.name==='AbortError')throw Error('Tempo esgotado na conexão');throw e}
 finally{clearTimeout(timer)}
}
async function apiBlob(path){const h={};if(token)h.Authorization=`Bearer ${token}`;const url=path.startsWith('/api/')?path:'/api'+path,ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),10000);try{const r=await fetch(url,{headers:h,signal:ctrl.signal});if(!r.ok)throw Error('Falha ao carregar foto');return r.blob()}finally{clearTimeout(timer)}}
function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}torchOn=false;torchSupported=false;updateTorchButton()}
function updateTorchButton(){const b=$('#flashToggle');if(!b)return;b.disabled=!torchSupported;b.classList.toggle('active',torchOn);b.innerHTML=torchOn?'🔦 Flash ligado':'⚡ Flash';b.title=torchSupported?'Ligar ou desligar o flash da câmera':'Flash não disponível nesta câmera'}
async function detectTorch(){const t=stream?.getVideoTracks?.()[0];let caps={};try{caps=t?.getCapabilities?.()||{}}catch{}torchSupported=!!(t&&caps.torch);torchOn=false;updateTorchButton();return torchSupported}
async function toggleTorch(){const t=stream?.getVideoTracks?.()[0];if(!t)return;let caps={};try{caps=t.getCapabilities?.()||{}}catch{}if(!caps.torch){torchSupported=false;updateTorchButton();const info=$('#camInfo');if(info)info.textContent='Este aparelho/câmera não permite controlar o flash pelo navegador.';return}try{torchOn=!torchOn;await t.applyConstraints({advanced:[{torch:torchOn}]});torchSupported=true;updateTorchButton();const info=$('#camInfo');if(info)info.textContent=torchOn?'Flash ligado para fotos noturnas.':'Flash desligado.'}catch(e){torchOn=false;updateTorchButton();const info=$('#camInfo');if(info)info.textContent='Não foi possível alterar o flash nesta câmera.'}}
function ensureIdentity(){
 if(identity.trim())return Promise.resolve(identity);
 return new Promise(resolve=>{
  const gate=document.createElement('div');gate.className='identity-gate';
  gate.innerHTML='<form class="identity-card"><div class="logo"><img src="/icon-192.png" alt="GeoFoto KMZ"></div><span class="identity-kicker">GeoFoto KMZ</span><h2>Identificação obrigatória</h2><p>Informe o nome do técnico/usuário para continuar.</p><label class="field"><b>Nome do técnico/usuário *</b><input id="identityRequired" maxlength="60" autocomplete="name" placeholder="Ex.: João Silva / Equipe 01" required></label><div id="identityMsg" class="identity-msg"></div><button class="btn primary full" type="submit">Continuar para a câmera</button></form>';
  document.body.appendChild(gate);
  const form=gate.querySelector('form'),input=gate.querySelector('#identityRequired');
  setTimeout(()=>input.focus(),80);
  form.onsubmit=e=>{e.preventDefault();const v=input.value.trim();if(v.length<2){gate.querySelector('#identityMsg').textContent='Informe uma identificação válida.';input.focus();return}identity=v;sessionStorage.setItem(IDENTITY,identity);localStorage.setItem(IDENTITY,identity);gate.remove();resolve(identity)}
 })
}
async function startTenantSession(d,account){
 token=d.token;role=d.role||'user';tenant=d.tenant||account||'principal';identity='';cfg=loadCfg();mergeLocalBrand();
 sessionStorage.setItem('gf_token',token);sessionStorage.setItem('gf_role',role);sessionStorage.setItem('gf_tenant',tenant);
 localStorage.setItem('gf_token',token);localStorage.setItem('gf_role',role);localStorage.setItem(ACCOUNT,tenant);
 sessionStorage.removeItem(IDENTITY);localStorage.removeItem(IDENTITY);await appView()
}
async function copyText(v){
 try{await navigator.clipboard.writeText(v);return true}
 catch{const t=document.createElement('textarea');t.value=v;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();return true}
}
function loginView(){
 stopCamera();
 const saved=localStorage.getItem(ACCOUNT)||tenant||'principal',account=saved==='personal'?'principal':saved;
 $('#app').innerHTML=`<main class="login login-hub">
 <div class="login-card login-card-hub">
  <div class="brand login-brand"><div class="logo"><img src="/icon-192.png" alt="GeoFoto KMZ"></div><div><h1>GEOFOTO KMZ</h1><div class="muted">Registro georreferenciado de campo</div></div></div>
  <div id="accessHome" class="access-pane">
   <div class="access-intro"><span>COMEÇAR</span><h2>Como deseja usar o aplicativo?</h2><p>Escolha uma opção. Você pode trabalhar com uma empresa ou usar o GeoFoto KMZ somente neste aparelho.</p></div>
   <button class="access-choice" id="existingCompany" type="button"><b>🏢 Já possuo acesso de uma empresa</b><span>Entrar com código da empresa, usuário e senha.</span></button>
   <button class="access-choice" id="newCompany" type="button"><b>＋ Cadastrar minha empresa</b><span>Crie a conta e gere acessos de administrador e colaborador.</span></button>
   <button class="access-choice personal" id="personalUse" type="button"><b>👤 Usar para uso próprio</b><span>Sem cadastro e sem vínculo com empresa. Os dados ficam neste aparelho.</span></button>
  </div>
  <div id="companyLogin" class="access-pane hidden">
   <button class="link-back" data-back type="button">← Voltar</button>
   <h2>Entrar pela empresa</h2>
   <form id="loginForm">
    <label class="field">Código da empresa<input id="account" value="${attr(account)}" autocomplete="organization" autocapitalize="none" spellcheck="false" required></label>
    <label class="field">Usuário<input id="user" autocomplete="username" required></label>
    <label class="field">Senha<div class="password-input-wrap"><input id="pass" type="password" autocomplete="current-password" required><button class="password-toggle" id="togglePass" type="button" aria-label="Mostrar senha" title="Mostrar senha">👁</button></div></label>
    <button class="btn primary full">Entrar</button>
    <button class="text-action" id="recoverAccess" type="button">Recuperar acesso administrativo</button>
    <p id="loginMsg" class="muted"></p>
   </form>
  </div>
  <div id="companyRegister" class="access-pane hidden">
   <button class="link-back" data-back type="button">← Voltar</button>
   <h2>Cadastrar empresa</h2>
   <p class="muted">O GeoFoto KMZ criará automaticamente o código da empresa e dois acessos iniciais.</p>
   <form id="registerForm">
    <label class="field">Nome da empresa<input id="companyNameNew" maxlength="80" placeholder="Ex.: Empresa Exemplo Engenharia" required></label>
    <div class="signup-explain"><span>Administrador: configura a conta e gerencia acessos.</span><span>Colaborador: registra fotos, pontos e KMZ.</span></div>
    <button class="btn primary full" type="submit">Criar empresa e acessos</button>
    <p id="registerMsg" class="muted"></p>
   </form>
   <div id="registerResult" class="hidden"></div>
  </div>
  <div id="recoverPane" class="access-pane hidden">
   <button class="link-back" id="backLogin" type="button">← Voltar ao login</button>
   <h2>Recuperar administrador</h2>
   <p class="muted">Use o código de recuperação entregue no cadastro da empresa.</p>
   <form id="recoverForm">
    <label class="field">Código da empresa<input id="recoverAccount" required></label>
    <label class="field">Código de recuperação<input id="recoverCode" placeholder="GFKM-XXXX-XXXX-XXXX" required></label>
    <button class="btn primary full" type="submit">Gerar nova senha de administrador</button>
    <p id="recoverMsg" class="muted"></p>
   </form>
   <div id="recoverResult" class="hidden"></div>
  </div>
 </div>
 </main>`;
 const panes=['#accessHome','#companyLogin','#companyRegister','#recoverPane'];
 const showPane=id=>{for(const p of panes)$(p)?.classList.add('hidden');$(id)?.classList.remove('hidden')};
 document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>showPane('#accessHome'));
 $('#existingCompany').onclick=()=>showPane('#companyLogin');
 $('#newCompany').onclick=()=>showPane('#companyRegister');
 $('#personalUse').onclick=async()=>{
  token='';role='personal';tenant='personal';identity=localStorage.getItem(IDENTITY)||'';cfg=loadCfg();mergeLocalBrand();
  sessionStorage.removeItem('gf_token');sessionStorage.setItem('gf_role','personal');sessionStorage.setItem('gf_tenant','personal');
  localStorage.removeItem('gf_token');localStorage.setItem('gf_role','personal');localStorage.setItem(ACCOUNT,'personal');
  await appView()
 };
 const passInput=$('#pass'),togglePass=$('#togglePass');if(togglePass)togglePass.onclick=()=>{const show=passInput.type==='password';passInput.type=show?'text':'password';togglePass.textContent=show?'🙈':'👁';togglePass.setAttribute('aria-label',show?'Ocultar senha':'Mostrar senha');togglePass.title=show?'Ocultar senha':'Mostrar senha'};
 $('#loginForm').onsubmit=async e=>{
  e.preventDefault();const acc=$('#account').value.trim().toLowerCase();
  try{const d=await api('/login',{method:'POST',body:JSON.stringify({account:acc,user:$('#user').value,pass:$('#pass').value})});await startTenantSession(d,acc)}
  catch(x){$('#loginMsg').textContent=x.message}
 };
 $('#recoverAccess').onclick=()=>{$('#recoverAccount').value=$('#account').value.trim();showPane('#recoverPane')};
 $('#backLogin').onclick=()=>showPane('#companyLogin');
 let created=null;
 $('#registerForm').onsubmit=async e=>{
  e.preventDefault();const btn=e.submitter,msg=$('#registerMsg');btn.disabled=true;btn.textContent='Criando empresa...';msg.textContent='';
  try{
   created=await api('/register-company',{method:'POST',body:JSON.stringify({name:$('#companyNameNew').value.trim()})});
   $('#registerForm').classList.add('hidden');const r=$('#registerResult');r.classList.remove('hidden');
   r.innerHTML='<div class="signup-success"><span class="success-dot">✓</span><h3>Empresa cadastrada</h3><p>Guarde estes dados. O código de recuperação permite redefinir o administrador sem suporte.</p><div class="credential-row"><span>Código da empresa</span><b>'+esc(created.accountCode)+'</b></div><div class="credential-row"><span>Administrador</span><b>'+esc(created.admin.user)+'</b><code>'+esc(created.admin.password)+'</code></div><div class="credential-row"><span>Colaborador</span><b>'+esc(created.collaborator.user)+'</b><code>'+esc(created.collaborator.password)+'</code></div><div class="credential-row recovery"><span>Código de recuperação</span><code>'+esc(created.recoveryCode)+'</code></div><button class="btn secondary full" id="copyCreated" type="button">Copiar dados de acesso</button><button class="btn primary full" id="enterCreated" type="button">Entrar como administrador</button></div>';
   $('#copyCreated').onclick=async()=>{const text='GeoFoto KMZ - '+created.companyName+'\nCódigo da empresa: '+created.accountCode+'\nAdministrador: '+created.admin.user+'\nSenha administrador: '+created.admin.password+'\nColaborador: '+created.collaborator.user+'\nSenha colaborador: '+created.collaborator.password+'\nCódigo de recuperação: '+created.recoveryCode;await copyText(text);$('#copyCreated').textContent='✓ Dados copiados'};
   $('#enterCreated').onclick=async()=>{const d=await api('/login',{method:'POST',body:JSON.stringify({account:created.accountCode,user:created.admin.user,pass:created.admin.password})});await startTenantSession(d,created.accountCode)}
  }catch(x){msg.textContent=x.message}
  finally{btn.disabled=false;btn.textContent='Criar empresa e acessos'}
 };
 $('#recoverForm').onsubmit=async e=>{
  e.preventDefault();const msg=$('#recoverMsg');msg.textContent='';
  try{const d=await api('/recover-company',{method:'POST',body:JSON.stringify({account:$('#recoverAccount').value.trim(),recoveryCode:$('#recoverCode').value.trim()})});const r=$('#recoverResult');r.classList.remove('hidden');r.innerHTML='<div class="signup-success compact"><h3>Nova senha criada</h3><div class="credential-row"><span>Usuário</span><b>'+esc(d.adminUser)+'</b><code>'+esc(d.adminPassword)+'</code></div><button class="btn secondary full" id="copyRecoveryPass" type="button">Copiar nova senha</button></div>';$('#copyRecoveryPass').onclick=()=>copyText(d.adminPassword)}
  catch(x){msg.textContent=x.message}
 };
}

async function appView(){$('#app').innerHTML=`<div class="shell"><aside class="side"><div class="brand"><div class="logo"><img src="/icon-192.png" alt="GeoFoto KMZ"></div><div class="brand-account"><b>${esc(accountLabel())}</b><small>GeoFoto KMZ</small></div></div><nav class="nav" aria-label="Navegação principal">${[['dashboard','home','Início'],['capture','camera','Câmera'],['records','records','Registros'],['mapa','map','Mapa'],['export','export','Exportar'],['settings','settings','Config.']].map(([id,icon,label])=>`<button data-page="${id}" class="${id==='capture'?'active':''}" aria-label="${label}">${uiIcon(icon)}<span>${label}</span></button>`).join('')}</nav></aside><main class="main"><header class="top"><button class="app-home" id="homeLink" aria-label="Ir para o início"><img src="/icon-192.png" alt=""><b>GeoFoto KMZ</b></button><button class="header-settings" id="settingsLink" aria-label="Abrir configurações">${uiIcon('settings')}</button><div class="page-heading"><h2 id="title">Câmera</h2><span class="muted">${esc(accountLabel())}</span></div><span id="netStatus" class="status cloud-indicator connecting">☁ Conectando</span></header><div id="cloudDemoBar" class="cloud-demo-bar connecting"><span class="cloud-demo-icon">☁</span><div><b data-cloud-label>☁ Conectando</b><small id="cloudStorageMini">Calculando espaço da nuvem…</small><div class="cloud-storage-mini-track"><i id="cloudStorageMiniFill"></i></div></div><span class="cloud-demo-pulse"></span></div><div id="appBrandBanner" class="app-brand-banner hidden"></div><section id="dashboard" class="section"></section><section id="capture" class="section active"></section><section id="mapa" class="section"><div class="map-tabs"><button id="mapViewButton" class="active" type="button">Mapa</button><button id="mapListButton" type="button">Lista</button></div><div class="card map-card"><div id="map"></div></div><div id="mapPointList" class="hidden"></div></section><section id="records" class="section"></section><section id="export" class="section"></section><section id="settings" class="section"></section></main></div>`;document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>show(b.dataset.page,b));$('#homeLink').onclick=()=>goPage('dashboard');$('#settingsLink').onclick=()=>goPage('settings');$('#mapViewButton').onclick=()=>setMapView(false);$('#mapListButton').onclick=()=>setMapView(true);await requestPersistentStorage();await loadLocalFirst();await ensureIdentity();renderAll();paintCloudDemo();setTimeout(()=>{if(navigator.onLine&&!isPersonalMode())syncDown().then(()=>{renderAll();syncPendingQueue().catch(()=>{})}).catch(()=>{})},80)}
function show(id,b){if(id!=='capture'){stopCamera();if(captureClockTimer){clearInterval(captureClockTimer);captureClockTimer=null}}else if(!captureClockTimer){captureClockTimer=setInterval(updateLiveCaptureOverlay,1000);updateLiveCaptureOverlay()}document.querySelectorAll('.section').forEach(x=>x.classList.remove('active'));$('#'+id).classList.add('active');document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('.nav button').forEach(x=>x.setAttribute('aria-current',x===b?'page':'false'));$('#title').textContent={dashboard:'Início',capture:'Câmera',mapa:'Mapa geral',records:'Registros',export:'Exportar KML/KMZ',settings:'Configurações'}[id];if(id==='mapa'){setTimeout(()=>{initMap();map.invalidateSize()},180);if(!isPersonalMode()&&navigator.onLine&&(!cloudConnected||Date.now()-lastCloudSync>30000))syncDown().then(()=>{refreshMapPoints();renderDashboard();renderRecords();renderExport()}).catch(()=>{})}if(id==='export')setTimeout(()=>prepareExportFiles().catch(()=>{}),30)}
async function loadLocalFirst(){
 const pending=await pendingAll().catch(()=>[]);
 let base=await snapshotGet().catch(()=>[]);
 if(!base.length){try{const raw=localStorage.getItem(storeKey(LOCAL))||(tenant==='principal'?localStorage.getItem(LOCAL):null)||'[]';base=JSON.parse(raw||'[]')}catch{base=[]}}
 points=mergePoints(base,pending);
 cloudPending=pending.length;cloudConnected=false;cloudRecords=Number(localStorage.getItem(cloudCountKey())||0);lastCloudSync=Number(localStorage.getItem(cloudSyncKey())||0);
 paintCloudDemo()
}
let pointSyncTask=null;
async function syncDown(){
 if(pointSyncTask)return pointSyncTask;
 pointSyncTask=syncDownNow();
 try{return await pointSyncTask}finally{pointSyncTask=null}
}
async function syncDownNow(){
 const pending=await pendingAll().catch(()=>[]);
 if(isPersonalMode()){cloudConnected=false;cloudRecords=0;lastCloudSync=0;const legacyRaw=localStorage.getItem(storeKey(LOCAL))||'[]',legacy=JSON.parse(legacyRaw||'[]');points=mergePoints(legacy,pending);await updatePendingStatus();return}
 try{
  const cloud=await api('/points',{timeout:15000});if(!Array.isArray(cloud))throw Error('Resposta de pontos inválida');await snapshotPut(cloud).catch(()=>{});cloudConnected=true;cloudRecords=cloud.length;lastCloudSync=Date.now();localStorage.setItem(cloudSyncKey(),String(lastCloudSync));localStorage.setItem(cloudCountKey(),String(cloudRecords));points=mergePoints(cloud,pending);refreshMapPoints();
  try{const remoteCfg=await api('/config',{timeout:4000});cfg={...cfg,...remoteCfg};if(!Object.prototype.hasOwnProperty.call(remoteCfg,'logo')&&remoteCfg.banner&&!cfg.logo)cfg.logo=remoteCfg.banner;mergeLocalBrand();saveCfg()}catch{mergeLocalBrand()}
  await updatePendingStatus();refreshCloudStorage(false).catch(()=>{})
 }catch{
  cloudConnected=false;lastCloudSync=Number(localStorage.getItem(cloudSyncKey())||0);cloudRecords=Number(localStorage.getItem(cloudCountKey())||0);
  let cached=await snapshotGet().catch(()=>[]);if(!cached.length){try{const raw=localStorage.getItem(storeKey(LOCAL))||(tenant==='principal'?localStorage.getItem(LOCAL):null)||'[]';cached=JSON.parse(raw||'[]')}catch{cached=[]}}
  points=mergePoints(cached,pending);
  await updatePendingStatus()
 }
}
async function syncPendingQueue(){
 if(isPersonalMode())return updatePendingStatus();
 if(offlineSyncing)return 0;if(!navigator.onLine)return updatePendingStatus();
 const pending=await pendingAll().catch(()=>[]);if(!pending.length)return updatePendingStatus();
 offlineSyncing=true;let sent=0;await updatePendingStatus('sync');
 try{
  for(const p of pending){
   try{const clean={...p};delete clean._pending;delete clean._tenant;await api('/points',{method:'POST',body:JSON.stringify(clean),timeout:20000});await pendingDelete(p.id);sent++}
   catch{cloudConnected=false;break}
  }
  await syncDown().catch(()=>{});
  if(sent){await refreshCloudStorage(true).catch(()=>{});renderDashboard();renderRecords();renderExport();if(map){initMap();setTimeout(()=>map.invalidateSize(),50)}}
  return sent
 }finally{offlineSyncing=false;await updatePendingStatus()}
}
function refreshMapPoints(){
 if(map&&$('#map')){initMap();if(!$('#mapPointList')?.classList.contains('hidden'))setMapView(true)}
}
function renderAll(){renderBranding();renderDashboard();renderCapture();renderRecords();renderExport();renderSettings();refreshMapPoints()}
function renderBranding(){
 const host=$('#appBrandBanner');if(!host)return;host.innerHTML='';
 if(!cfg.banner){host.classList.add('hidden');return}
 const img=document.createElement('img');img.alt='Banner da empresa';img.src=cfg.banner;
 img.onload=()=>host.classList.remove('hidden');img.onerror=()=>host.classList.add('hidden');
 host.appendChild(img)
}
function renderDashboard(){
 const today=new Date().toLocaleDateString('pt-BR'),n=points.filter(p=>new Date(p.time).toLocaleDateString('pt-BR')===today).length;
 $('#dashboard').innerHTML=`<div class="home-intro"><span>REGISTRO GEORREFERENCIADO DE CAMPO</span><h3>Seu trabalho, no mapa.</h3><p class="muted">${esc(identity||accountLabel())}</p></div><div class="home-actions">${[['capture','camera','Tirar foto','Registro de ponto'],['mapa','map','Mapa','Ver pontos no mapa'],['records','records','Registros','Fotos e histórico'],['export','export','Exportar KMZ','Baixar arquivo']].map(([page,icon,title,sub])=>`<button class="home-tile tile-${page}" data-home-page="${page}">${uiIcon(icon)}<b>${title}</b><span>${sub}</span></button>`).join('')}</div><div class="cards home-metrics"><div class="card"><span class="muted">Total de pontos</span><div class="metric">${points.length}</div></div><div class="card"><span class="muted">Fotos hoje</span><div class="metric">${n}</div></div><div class="card"><span class="muted">Com endereço</span><div class="metric">${points.filter(p=>p.address).length}</div></div></div><div class="card recent-card"><h3>Últimos registros</h3>${points.slice(-4).reverse().map(p=>`<div class="recent-row"><b>${esc(p.name)}</b><span class="muted">${fmt(p.time)} · ${esc(p.city||'')}</span></div>`).join('')||'<p class="muted">Seus próximos registros aparecerão aqui.</p>'}</div>`;
 document.querySelectorAll('[data-home-page]').forEach(b=>b.onclick=()=>goPage(b.dataset.homePage))
}
function renderCapture(){
 raw='';photo='';geo=null;saving=false;savedPhotoKey='';
 const enabled=(cfg.enabledTemplates||Object.keys(TEMPLATES)).filter(id=>TEMPLATES[id]);
 const current=enabled.includes(cfg.defaultTemplate)?cfg.defaultTemplate:(enabled[0]||'essential');
 $('#capture').innerHTML=`<div class="grid2 mobile-main"><div class="card capture"><h3>Câmera de campo</h3><details class="capture-guide"><summary>Como registrar uma foto</summary><p>Preencha a identificação e a descrição, libere câmera e GPS e toque em tirar foto. O registro é salvo automaticamente.</p></details>
 <label class="field">Modelo da foto<select id="templateSelect">${enabled.map(id=>`<option value="${id}" ${id===current?'selected':''}>${TEMPLATES[id].name}</option>`).join('')}</select></label>
 <div id="templateHint" class="muted small">${TEMPLATES[current]?.description||''}</div>
 <label class="field"><b>Identificação do ponto *</b><input id="pointName" placeholder="Ex.: CEO 80551 / POSTE 023" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label>
 <div id="pointNameHint" class="muted small">Primeiro informe a identificação do ponto.</div>
 <label class="field">Observação (descrição opcional)<textarea id="note" rows="2" placeholder="Descrição opcional"></textarea></label>
 <div class="sensor-panel"><div id="camState" class="sensor-state waiting"><b>📷 Câmera</b><span>Aguardando identificação</span></div><div id="gpsState" class="sensor-state waiting"><b>⌖ GPS</b><span>Aguardando identificação</span></div></div>
 <button class="btn primary sensor-retry" id="retrySensors" type="button" disabled>Liberar câmera e GPS</button>
 <div class="camera-preview-wrap"><video id="camera" class="camera-large" autoplay playsinline muted></video>
 <div id="liveCaptureOverlay" class="live-capture-overlay">
  <div class="live-camera-top"><span class="live-camera-app">${esc(cfg.appName||'GEOFOTO KMZ')}</span><span id="liveTemplateName" class="live-camera-template">${esc(TEMPLATES[current]?.name||'Essencial')}</span></div>
  <div class="live-camera-panel">
   <div class="live-camera-copy"><b id="livePoint">IDENTIFICAÇÃO DO PONTO</b><span id="liveTech">Técnico: ${esc(identity||'-')}</span><strong id="liveTime">--:-- · --/--/----</strong><span id="liveGps">GPS aguardando localização...</span><span id="livePlace">Endereço será exibido após o GPS.</span><span id="liveNote" class="hidden"></span><small id="liveReady">PRÉVIA · confirme o enquadramento antes de tirar</small></div>
   <div id="liveCameraMap" class="live-camera-map"><span>MAPA</span><small id="liveMapStatus">GPS</small></div>
  </div>
 </div>
 <button class="flash-toggle" id="flashToggle" type="button" disabled title="Flash não disponível nesta câmera">⚡ Flash</button></div><canvas id="canvas" class="hidden"></canvas><img id="preview" class="camera-large hidden">
 <div class="actions shutter-actions"><button class="btn primary" id="take" disabled aria-label="Tirar foto">${uiIcon('camera')}<span>Tirar foto</span></button><button class="btn secondary hidden" id="retake">↻ Tirar novamente</button></div>

 <div class="actions"><button class="btn secondary" id="gps" disabled>Atualizar GPS</button></div><div class="actions hidden" id="shareActions"><button class="btn primary" id="shareBtn">📤 Enviar</button><button class="btn secondary" id="downloadBtn">⬇ Salvar foto</button></div>
 <div id="saveStatus" class="statusline">Preencha a identificação do ponto para liberar câmera e GPS.</div><div id="camInfo" class="muted small"></div><div id="gpsInfo" class="muted small"></div>
 </div><div class="card"><h3>Modelo ativo</h3><div id="templatePreview" class="template-preview"><b>${TEMPLATES[current]?.name||'Essencial'}</b><p class="muted">${TEMPLATES[current]?.description||''}</p></div><p class="muted">A identidade do técnico é obrigatória e fica vinculada visualmente à foto registrada.</p></div></div>`;
 const pn=$('#pointName'),hint=$('#pointNameHint'),note=$('#note');
 pn.addEventListener('input',()=>{const start=pn.selectionStart,end=pn.selectionEnd;pn.value=pn.value.toLocaleUpperCase('pt-BR');try{pn.setSelectionRange(start,end)}catch{}hint.textContent=pn.value.trim()?'Identificação informada.':'Informe a identificação antes da foto.';updateCaptureReady()});
 note?.addEventListener('input',updateLiveCaptureOverlay);
 $('#take').onclick=takePhoto;$('#retake').onclick=retake;$('#gps').onclick=getGps;$('#retrySensors').onclick=startCameraAndGps;$('#flashToggle').onclick=toggleTorch;
 $('#templateSelect').onchange=e=>{const t=TEMPLATES[e.target.value];$('#templateHint').textContent=t?.description||'';$('#templatePreview').innerHTML=`<b>${t?.name||''}</b><p class="muted">${t?.description||''}</p>`;updateLiveCaptureOverlay()}
 if(captureClockTimer)clearInterval(captureClockTimer);captureClockTimer=setInterval(updateLiveCaptureOverlay,1000);
 updateCaptureReady();updateLiveCaptureOverlay();
}
function updateLiveCaptureOverlay(){
 const root=$('#liveCaptureOverlay');if(!root)return;
 const point=($('#pointName')?.value.trim()||'IDENTIFICAÇÃO DO PONTO').toLocaleUpperCase('pt-BR'),note=$('#note')?.value.trim()||'',now=new Date(),template=TEMPLATES[$('#templateSelect')?.value]||TEMPLATES.essential;
 const set=(id,value)=>{const el=$(id);if(el)el.textContent=value};
 set('#livePoint',point);set('#liveTech','Técnico: '+(identity||'-'));set('#liveTime',now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+' · '+now.toLocaleDateString('pt-BR'));
 set('#liveTemplateName',template?.name||'Essencial');
 if(geo){
  set('#liveGps','GPS: '+geo.latitude.toFixed(6)+', '+geo.longitude.toFixed(6)+' · ±'+Math.round(geo.accuracy||0)+' m');
  set('#livePlace',(geo.address||geo.city||'Localização obtida; buscando endereço...').slice(0,110));
  set('#liveMapStatus','GPS OK');root.classList.add('ready');updateLiveMapPreview()
 }else{
  set('#liveGps','GPS aguardando localização...');set('#livePlace','Endereço será exibido após o GPS.');set('#liveMapStatus','GPS');root.classList.remove('ready')
 }
 const noteEl=$('#liveNote');if(noteEl){noteEl.textContent=note?'Obs.: '+note:'';noteEl.classList.toggle('hidden',!note)}
 set('#liveReady',geo&&$('#pointName')?.value.trim()?'PRONTO · confira o enquadramento e as informações':'PRÉVIA · as informações aparecerão antes da foto')
}
async function updateLiveMapPreview(){
 const el=$('#liveCameraMap');if(!el||!geo)return;
 const key=geo.latitude.toFixed(5)+','+geo.longitude.toFixed(5);if(el.dataset.mapKey===key)return;el.dataset.mapKey=key;
 try{const c=await loadOsmSnapshot(geo.latitude,geo.longitude,360,300,17);if(!el||el.dataset.mapKey!==key)return;el.style.backgroundImage='linear-gradient(rgba(2,10,18,.08),rgba(2,10,18,.08)),url('+c.toDataURL('image/jpeg',.82)+')';el.classList.add('loaded')}catch{}
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
 updateLiveCaptureOverlay()
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
  set('ok','Câmera pronta');await detectTorch();updateCaptureReady();return true
 }catch(e){
  const denied=e?.name==='NotAllowedError'||e?.name==='SecurityError';
  set('error',denied?'Permissão da câmera bloqueada. Toque em “Reativar câmera e GPS”.':'Falha ao abrir câmera: '+(e?.message||'erro'));
  updateCaptureReady();return false
 }
}
async function takePhoto(){
 if(!geo){await getGps();if(!geo){alert('É necessário obter o GPS antes de tirar a foto.');return}}
 const v0=$('#camera');if(!stream||!v0?.videoWidth){await startCamera();if(!stream||!$('#camera')?.videoWidth){alert('A câmera ainda não está pronta. Toque em Reativar câmera e GPS.');return}}
 const pn=$('#pointName');let pointName=(pn?.value.trim()||'').toLocaleUpperCase('pt-BR');
 if(!pointName){pointName=(window.prompt('Identificação do ponto\nEx.: CEO 80551 / POSTE 023','')||'').trim().toLocaleUpperCase('pt-BR');if(!pointName){const hint=$('#pointNameHint');if(hint)hint.textContent='⚠ É necessário informar a identificação antes da foto.';return}if(pn)pn.value=pointName;const hint=$('#pointNameHint');if(hint)hint.textContent='Identificação informada.'}
 const v=$('#camera'),c=$('#canvas');if(!v||!v.videoWidth)return;
 const portrait=innerHeight>innerWidth,outW=portrait?1080:1920,outH=portrait?1440:1080;c.width=outW;c.height=outH;
 const sx=v.videoWidth,sy=v.videoHeight,src=sx/sy,dst=outW/outH;let sw=sx,sh=sy,ox=0,oy=0;
 if(src>dst){sw=Math.round(sy*dst);ox=Math.round((sx-sw)/2)}else{sh=Math.round(sx/dst);oy=Math.round((sy-sh)/2)}
 c.getContext('2d').drawImage(v,ox,oy,sw,sh,0,0,outW,outH);
 raw=c.toDataURL('image/jpeg',.9);photo=raw;savedPhotoKey=raw.slice(0,80)+Date.now();stopCamera();
 const st=$('#saveStatus');if(st)st.textContent='Foto tirada. Salvando registro...';
 try{await annotate()}catch(e){console.warn('Falha ao aplicar informações na foto; salvando imagem original.',e);photo=raw}
 captureUi();
 await maybeAutoSave()
}
async function annotate(){
 if(!raw)return;
 const img=await loadImg(raw),c=document.createElement('canvas'),x=c.getContext('2d'),id=$('#templateSelect')?.value||cfg.defaultTemplate||'essential',t=TEMPLATES[id]||TEMPLATES.essential;
 c.width=img.width;c.height=img.height;x.drawImage(img,0,0);
 const pad=Math.round(c.width*.028),hasMap=t.map&&cfg.showMap!==false,panelRatio=Math.max(.12,Math.min(.34,Number(t.panel||(hasMap?.27:.22)))),panelH=Math.round(c.height*panelRatio),panelY=c.height-panelH-Math.round(pad*.55),cardX=pad,cardW=c.width-pad*2,r=Math.round(pad*.75);
 if(t.top&&cfg.showLogo!==false){
   const headerName=(cfg.appName||'GEOFOTO KMZ').trim().toLocaleUpperCase('pt-BR'),pillW=Math.round(c.width*.31),pillH=Math.round(c.height*.062);
   x.fillStyle='rgba(7,18,31,.78)';if(x.roundRect){x.beginPath();x.roundRect(pad,pad,pillW,pillH,r*.55);x.fill()}else x.fillRect(pad,pad,pillW,pillH);
   x.fillStyle='#fff';x.font='800 '+Math.max(24,Math.round(c.width*.028))+'px Arial';x.fillText(headerName,pad+Math.round(pad*.55),pad+Math.round(pillH*.66),pillW-pad);
   if(cfg.logo){try{const bi=await loadImg(cfg.logo),boxW=Math.round(c.width*.24),boxH=Math.round(c.height*.105),bx=c.width-pad-boxW,by=pad,ratio=Math.min((boxW-pad)/bi.width,(boxH-pad*.6)/bi.height),dw=bi.width*ratio,dh=bi.height*ratio;
    x.fillStyle='rgba(255,255,255,.86)';if(x.roundRect){x.beginPath();x.roundRect(bx,by,boxW,boxH,r*.55);x.fill()}else x.fillRect(bx,by,boxW,boxH);
    x.drawImage(bi,bx+(boxW-dw)/2,by+(boxH-dh)/2,dw,dh)}catch{}}
 }
 x.save();x.fillStyle=t.light?'rgba(255,255,255,.94)':'rgba(7,18,31,.78)';
 if(x.roundRect){x.beginPath();x.roundRect(cardX,panelY,cardW,panelH,r);x.fill()}else x.fillRect(cardX,panelY,cardW,panelH);
 x.restore();
 if(id==='essential'){
  const textX=cardX+pad,textW=cardW*.57,title=($('#pointName')?.value.trim()||'Ponto').toLocaleUpperCase('pt-BR');
  const rows=[new Date().toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}),'GPS: '+(geo?.latitude?.toFixed(6)||'-')+', '+(geo?.longitude?.toFixed(6)||'-'),'Precisão: '+Math.round(geo?.accuracy||0)+' m',geo?.city||'Cidade não identificada','Endereço: '+(geo?.address||'Não identificado')];
  const note=$('#note')?.value.trim();if(note)rows.push('Descrição: '+note);
  const top=panelY+panelH*.12,bottom=panelY+panelH*.82,line=panelH*.095;
  x.fillStyle='#fff';x.font='800 '+Math.round(c.width*.032)+'px Arial';x.fillText(title,textX,top,textW);
  x.font='600 '+Math.round(Math.min(c.width*.019,panelH*.059))+'px Arial';
  let y=top+line*1.2;
  for(let i=0;i<rows.length;i++){if(y>bottom)break;y=drawWrappedText(x,rows[i],textX,y,textW,line,i===4?2:1)}
  const footerY=panelY+panelH-pad*.6;x.fillStyle='#00d58b';x.beginPath();x.arc(textX,footerY,Math.max(5,c.width*.005),0,Math.PI*2);x.fill();
  x.fillStyle='#e1eef8';x.font='600 '+Math.round(Math.min(c.width*.017,panelH*.055))+'px Arial';x.fillText('GPS OK · '+(identity||'Foto registrada'),textX+pad*.55,footerY+c.width*.005,cardW-pad*2);
  if(hasMap){const mw=cardW*.31,mh=panelH*.72;await miniMap(x,cardX+cardW-pad-mw,panelY+panelH*.1,mw,mh)}
  photo=c.toDataURL('image/jpeg',.88);return
 }
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
 photo=c.toDataURL('image/jpeg',.88)
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
  jobs.push(loadImg('/api/tile/'+z+'/'+wrapped+'/'+ty+'.png',1500).then(img=>g.drawImage(img,dx,dy,tile,tile)).catch(()=>{}));
 }
 await Promise.all(jobs);
 return c
}
function loadImg(src,ms=5000){return new Promise((r,j)=>{const i=new Image(),timer=setTimeout(()=>{i.src='';j(new Error('Tempo esgotado ao carregar imagem'))},ms);i.onload=()=>{clearTimeout(timer);r(i)};i.onerror=e=>{clearTimeout(timer);j(e)};i.src=src})}
function captureUi(){const v=$('#camera'),p=$('#preview');p.src=photo||raw;p.classList.remove('hidden');v.classList.add('hidden');$('#flashToggle')?.classList.add('hidden');$('#take').classList.add('hidden');$('#retake').classList.remove('hidden');$('#shareActions').classList.remove('hidden');$('#shareBtn').onclick=shareCurrent;$('#downloadBtn').onclick=downloadCurrentPhoto}
function retake(){raw='';photo='';savedPhotoKey='';saving=false;$('#preview').classList.add('hidden');$('#camera').classList.remove('hidden');$('#flashToggle')?.classList.remove('hidden');$('#take').classList.remove('hidden');$('#retake').classList.add('hidden');$('#shareActions').classList.add('hidden');$('#saveStatus').textContent='Aguardando nova foto...';startCamera();getGps()}
async function getGps(){
 const el=$('#gpsInfo'),state=$('#gpsState');const set=(kind,msg)=>{if(state){state.className='sensor-state '+kind;state.querySelector('span').textContent=msg}if(el)el.textContent=msg};
 geo=null;updateCaptureReady();
 if(!navigator.geolocation){set('error','GPS indisponível neste aparelho.');return false}
 set('waiting','Obtendo localização…');
 return new Promise(resolve=>navigator.geolocation.getCurrentPosition(p=>{
  geo={latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,city:'',address:''};
  set('ok','GPS OK · ±'+Math.round(geo.accuracy)+' m');
  if(el)el.innerHTML=`Latitude: <b>${geo.latitude.toFixed(6)}</b> · Longitude: <b>${geo.longitude.toFixed(6)}</b> · Precisão: <b>${Math.round(geo.accuracy)} m</b><br><span>${navigator.onLine?'Buscando endereço…':'Sem internet · coordenadas salvas normalmente'}</span>`;
  updateCaptureReady();resolve(true);
  if(navigator.onLine)reverse(geo.latitude,geo.longitude).then(r=>{if(!geo)return;geo.city=r.city;geo.address=r.address;if(el)el.innerHTML=`Latitude: <b>${geo.latitude.toFixed(6)}</b> · Longitude: <b>${geo.longitude.toFixed(6)}</b> · Precisão: <b>${Math.round(geo.accuracy)} m</b><br><b>${esc(geo.city||'Localização GPS')}</b> · ${esc(geo.address||'Endereço não localizado')}`;updateLiveCaptureOverlay()}).catch(()=>{})
 },e=>{const denied=e.code===1;set('error',denied?'Permissão de localização bloqueada. Ative a localização para o GeoFoto KMZ.':'Falha no GPS: '+e.message);updateCaptureReady();resolve(false)},{enableHighAccuracy:true,timeout:20000,maximumAge:3000}))
}
async function reverse(lat,lng){if(!navigator.onLine)return{address:'',city:''};const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),3500);try{const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,{signal:ctrl.signal}),d=await r.json(),a=d.address||{};return{address:d.display_name||'',city:a.city||a.town||a.village||a.municipality||a.county||''}}catch{return{address:'',city:''}}finally{clearTimeout(timer)}}
async function maybeAutoSave(){
 if(!photo||!geo||saving||!savedPhotoKey)return;
 const key=savedPhotoKey;saving=true;const st=$('#saveStatus');
 const p={id:crypto.randomUUID(),name:($('#pointName').value.trim()||`Ponto ${points.length+1}`).toLocaleUpperCase('pt-BR'),note:$('#note').value.trim(),technician:identity,lat:geo.latitude,lng:geo.longitude,accuracy:geo.accuracy,time:new Date().toISOString(),city:geo.city||'',address:geo.address||'',photo};
 let staged=false,directCloud=false;
 try{
  if(st)st.textContent='Salvando registro e foto…';
  try{
   await pendingPut(p);staged=true;
   points=mergePoints(points,[{...p,_pending:true}]);
   cloudPending=(await pendingAll().catch(()=>[])).length;
   renderDashboard();renderRecords();renderExport();paintCloudDemo(navigator.onLine&&!isPersonalMode()?'sync':'');
   if(map){initMap();setTimeout(()=>map.invalidateSize(),50)}
  }catch(localErr){
   if(isPersonalMode()||!navigator.onLine)throw localErr;
   if(st)st.textContent='Armazenamento local indisponível. Salvando direto na nuvem…';
   await api('/points',{method:'POST',body:JSON.stringify(p),timeout:30000});
   directCloud=true;cloudConnected=true;
   points=mergePoints(points,[p]);await snapshotPut(points).catch(()=>{});
   renderDashboard();renderRecords();renderExport();paintCloudDemo();
   if(map){initMap();setTimeout(()=>map.invalidateSize(),50)}
  }
  if(isPersonalMode()){
   if(st)st.textContent='✓ Foto e informações salvas em Registros.';
  }else if(navigator.onLine){
   if(st)st.textContent=directCloud?'✓ Foto e informações salvas na nuvem.':'Salvo em Registros. Sincronizando foto com a nuvem…';
   if(staged){
    await syncPendingQueue().catch(()=>{});
    const stillPending=(await pendingAll().catch(()=>[])).some(x=>x.id===p.id);
    if(st)st.textContent=stillPending?'✓ Salvo em Registros. Envio para a nuvem pendente.':'✓ Foto e informações salvas em Registros e na nuvem.';
   }else{
    await syncDown().catch(()=>{});
    renderDashboard();renderRecords();renderExport()
   }
  }else{
   if(st)st.textContent='✓ Foto e informações salvas em Registros. Será enviado à nuvem quando a internet voltar.';
  }
 }catch(e){
  console.error('Falha ao salvar registro',e);
  if(st)st.textContent='⚠ Falha ao salvar este registro. Toque em “Tirar novamente” e tente outra vez.';
  alert('Não foi possível salvar a foto e as informações. Tente novamente. Se estiver sem internet, mantenha o aplicativo aberto e tente ao reconectar.')
 }finally{await updatePendingStatus();if(savedPhotoKey===key)saving=false}
}
async function downloadCurrentPhoto(){const src=photo||raw;if(!src)return;const blob=dataToBlob(src),point=safeName($('#pointName')?.value||'geofoto'),name=`${point}-${Date.now()}.jpg`,st=$('#saveStatus');try{saveBlob(blob,name);if(st)st.textContent='✓ Foto salva no celular. Verifique a pasta Downloads.'}catch(e){if(st)st.textContent='Não foi possível salvar a foto neste aparelho.'}}
function googleMapsLink(lat,lng){const a=Number(lat),b=Number(lng);return Number.isFinite(a)&&Number.isFinite(b)?'https://www.google.com/maps/search/?api=1&query='+a.toFixed(6)+','+b.toFixed(6):''}
function shareMessage({name='',note='',lat,lng,technician=''}){const map=googleMapsLink(lat,lng),lines=['GeoFoto KMZ'];if(name)lines.push('Ponto: '+name);if(technician)lines.push('Técnico: '+technician);if(note)lines.push('Descrição: '+note);if(map)lines.push('Abrir no Google Maps: '+map);return lines.join('\n')}
async function shareCurrent(){const src=photo||raw;if(!src)return;const point=($('#pointName')?.value.trim()||'Registro').toLocaleUpperCase('pt-BR'),note=$('#note')?.value.trim()||'',data={name:point,note,lat:geo?.latitude,lng:geo?.longitude,technician:identity};return shareBlob(dataToBlob(src),`${safeName(point)}-${Date.now()}.jpg`,data)}
async function shareRecord(id){const p=points.find(x=>x.id===id);if(!p)return;const data={name:p.name,note:p.note,lat:p.lat,lng:p.lng,technician:p.technician||''};if(p.photo)return shareBlob(dataToBlob(p.photo),`${safeName(p.name)}.jpg`,data);if(p.photoUrl){const b=await apiBlob(p.photoUrl);return shareBlob(b,`${safeName(p.name)}.jpg`,data)}}
async function shareBlob(blob,name,data={}){const f=new File([blob],name,{type:'image/jpeg'}),text=shareMessage(data),url=googleMapsLink(data.lat,data.lng),payload={title:'GeoFoto KMZ',text,files:[f]};if(navigator.canShare&&navigator.canShare({files:[f]})){try{return await navigator.share(payload)}catch(e){if(e?.name==='AbortError')return;try{return await navigator.share({title:'GeoFoto KMZ',text,files:[f]})}catch(e2){if(e2?.name==='AbortError')return}}}saveBlob(blob,name);if(url){try{await navigator.clipboard.writeText(text);alert('Foto salva. O link do Google Maps foi copiado para você enviar junto.')}catch{alert('Foto salva. Local: '+url)}}}
async function openRecordPhoto(id){const p=points.find(x=>x.id===id);if(!p)return;let src=p.photo||'',revoke='';try{if(!src&&p.photoUrl){const b=await apiBlob(p.photoUrl);src=URL.createObjectURL(b);revoke=src}if(!src)return;const box=document.createElement('div');box.className='photo-lightbox';const img=document.createElement('img');img.src=src;img.alt='Foto '+p.name;const meta=document.createElement('div');meta.className='photo-lightbox-meta';meta.innerHTML='<b>'+esc(p.name)+'</b><span>'+esc(fmt(p.time))+' · '+Number(p.lat).toFixed(6)+', '+Number(p.lng).toFixed(6)+'</span>';const close=document.createElement('button');close.className='photo-lightbox-close';close.textContent='×';const done=()=>{box.remove();if(revoke)URL.revokeObjectURL(revoke)};close.onclick=done;box.onclick=e=>{if(e.target===box)done()};box.append(close,img,meta);document.body.appendChild(box)}catch(e){alert('Não foi possível abrir a foto: '+e.message)}}
function recordDateTimeLocal(v){
 const d=new Date(v);if(Number.isNaN(d.getTime()))return '';
 const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
 return local.toISOString().slice(0,16)
}
function openRecordEdit(id){
 if(role!=='admin')return;
 const p=points.find(x=>x.id===id);if(!p)return;
 document.querySelector('.record-edit-gate')?.remove();
 const gate=document.createElement('div');gate.className='record-edit-gate';
 gate.innerHTML=`<div class="record-edit-card"><div class="record-edit-head"><div><span>ADMINISTRADOR</span><h3>Editar registro</h3><p>${esc(p.name)}</p></div><button type="button" class="record-edit-close" aria-label="Fechar">×</button></div><div class="record-edit-lock">Somente <b>data/hora</b> e <b>descrição</b> podem ser alteradas. Ponto, GPS, mapa, técnico e identificação permanecem inalterados.</div><form id="recordEditForm"><label class="field"><b>Data e hora</b><input id="recordEditTime" type="datetime-local" value="${attr(recordDateTimeLocal(p.time))}" required></label><label class="field"><b>Descrição</b><textarea id="recordEditNote" rows="4" placeholder="Descrição do registro">${esc(p.note||'')}</textarea></label><div id="recordEditMsg" class="muted small"></div><div class="record-edit-actions"><button type="button" class="btn secondary" id="recordEditCancel">Cancelar</button><button type="submit" class="btn primary" id="recordEditSave">Salvar alterações</button></div></form></div>`;
 document.body.appendChild(gate);
 const close=()=>gate.remove();
 gate.querySelector('.record-edit-close').onclick=close;
 gate.querySelector('#recordEditCancel').onclick=close;
 gate.onclick=e=>{if(e.target===gate)close()};
 gate.querySelector('#recordEditForm').onsubmit=async e=>{
  e.preventDefault();
  const dt=gate.querySelector('#recordEditTime'),note=gate.querySelector('#recordEditNote'),msg=gate.querySelector('#recordEditMsg'),btn=gate.querySelector('#recordEditSave');
  const when=new Date(dt.value);if(!dt.value||Number.isNaN(when.getTime())){msg.textContent='Informe uma data e hora válidas.';return}
  const updated={...p,time:when.toISOString(),note:note.value.trim()};delete updated._pending;delete updated._tenant;
  btn.disabled=true;btn.textContent='Salvando...';msg.textContent='Salvando alteração sem modificar localização ou ponto...';
  try{
   await pendingPut(updated);
   points=points.map(x=>x.id===id?{...updated,_pending:true}:x).sort((a,b)=>String(a.time).localeCompare(String(b.time)));
   await snapshotPut(points).catch(()=>{});
   renderDashboard();renderRecords();renderExport();await updatePendingStatus();
   if(navigator.onLine&&!isPersonalMode()){
    msg.textContent='Sincronizando alteração com a nuvem...';
    await syncPendingQueue().catch(()=>{});
   }
   const stillPending=(await pendingAll().catch(()=>[])).some(x=>x.id===id);
   close();
   if(stillPending)alert('Alteração salva no aparelho. Ela será enviada para a nuvem automaticamente quando a conexão permitir.');
  }catch(err){
   msg.textContent='Não foi possível salvar a alteração: '+(err?.message||'erro');
   btn.disabled=false;btn.textContent='Salvar alterações'
  }
 }
}
function renderRecords(){
 const techs=[...new Set(points.map(p=>String(p.technician||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
 const hasUnknown=points.some(p=>!String(p.technician||'').trim());
 if(recordTechnicianFilter&&recordTechnicianFilter!=='__unknown__'&&!techs.includes(recordTechnicianFilter))recordTechnicianFilter='';
 let filtered=recordTechnicianFilter==='__unknown__'?points.filter(p=>!String(p.technician||'').trim()):recordTechnicianFilter?points.filter(p=>String(p.technician||'').trim()===recordTechnicianFilter):points;
 if(recordDateFilter==='today')filtered=filtered.filter(p=>new Date(p.time).toLocaleDateString('pt-BR')===new Date().toLocaleDateString('pt-BR'));
 const options='<option value="">Todos os técnicos</option>'+techs.map(n=>'<option value="'+attr(n)+'" '+(recordTechnicianFilter===n?'selected':'')+'>'+esc(n)+'</option>').join('')+(hasUnknown?'<option value="__unknown__" '+(recordTechnicianFilter==='__unknown__'?'selected':'')+'>Registro antigo sem identidade</option>':'');
 $('#records').innerHTML='<div class="record-tabs"><button id="recordsAll" class="'+(!recordDateFilter&&!recordTechnicianFilter?'active':'')+'">Todos</button><button id="recordsToday" class="'+(recordDateFilter==='today'?'active':'')+'">Hoje</button><button id="recordsByTech" class="'+(recordTechnicianFilter?'active':'')+'">Por técnico</button></div><div class="records-toolbar"><label><span>Filtrar por técnico</span><select id="technicianFilter">'+options+'</select></label><div class="records-filter-count"><b>'+filtered.length+'</b><span>de '+points.length+' registros</span></div></div><div class="records-list">'+(filtered.slice().reverse().map(p=>'<div class="card record-card '+((p.photo||p.photoUrl)?'has-photo':'')+'"><div class="record-head"><div><b>'+esc(p.name)+'</b><div class="muted small">'+fmt(p.time)+' · '+esc(p.city||'')+'</div><div class="record-technician"><span>Técnico:</span><b>'+esc(p.technician||'Registro antigo sem identidade')+'</b></div></div><span class="badge">'+Math.round(p.accuracy||0)+' m</span></div>'+((p.photo||p.photoUrl)?'<img class="record-photo" data-photo-id="'+p.id+'" loading="lazy" alt="Foto de '+attr(p.name)+'">':'')+'<div class="record-note"><b>Descrição:</b><span>'+esc(p.note||'Sem descrição informada.')+'</span></div><div class="muted small">'+esc(p.address||'Sem endereço')+'</div><div class="muted small">'+Number(p.lat).toFixed(6)+', '+Number(p.lng).toFixed(6)+'</div><div class="actions"><button class="btn secondary" data-map="'+p.lat+','+p.lng+'">Abrir Maps</button>'+((p.photo||p.photoUrl)?'<button class="btn primary" data-share="'+p.id+'">Enviar</button>':'')+(role==='admin'?'<button class="btn secondary" data-edit="'+p.id+'">Editar</button><button class="btn secondary" data-delete="'+p.id+'">Excluir</button>':'')+'</div></div>').join('')||'<div class="card">Nenhum registro encontrado neste filtro.</div>')+'</div>';
 $('#recordsAll').onclick=()=>{recordDateFilter='';recordTechnicianFilter='';renderRecords()};$('#recordsToday').onclick=()=>{recordDateFilter='today';renderRecords()};$('#recordsByTech').onclick=()=>$('#technicianFilter').focus();
 const filter=$('#technicianFilter');if(filter)filter.onchange=()=>{recordTechnicianFilter=filter.value;renderRecords()};
 document.querySelectorAll('[data-photo-id]').forEach(async img=>{const p=points.find(x=>x.id===img.dataset.photoId);try{if(p?.photo)img.src=p.photo;else if(p?.photoUrl){const b=await apiBlob(p.photoUrl),u=URL.createObjectURL(b);img.src=u;img.onload=()=>setTimeout(()=>URL.revokeObjectURL(u),30000)}}catch{img.alt='Foto indisponível'}});
 document.querySelectorAll('[data-map]').forEach(b=>b.onclick=()=>window.open('https://www.google.com/maps?q='+b.dataset.map,'_blank'));
 document.querySelectorAll('[data-share]').forEach(b=>b.onclick=()=>shareRecord(b.dataset.share));
 document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openRecordEdit(b.dataset.edit));
 document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Excluir este registro e a foto?'))return;try{await api('/points/'+b.dataset.delete,{method:'DELETE'});await syncDown();renderDashboard();renderRecords();renderExport();if(map)initMap()}catch(e){alert(e.message)}})
}
function setMapView(list){
 $('#mapPointList').classList.toggle('hidden',!list);$('#mapa .map-card').classList.toggle('hidden',list);
 $('#mapViewButton').classList.toggle('active',!list);$('#mapListButton').classList.toggle('active',list);
 if(list){$('#mapPointList').innerHTML=points.slice().reverse().map(p=>`<button class="map-list-row" data-point-focus="${attr(p.id)}"><b>${esc(p.name)}</b><span>${esc(p.city||'')} · ${fmt(p.time)}</span><span>${esc(p.note||'Sem descrição informada.')}</span></button>`).join('')||'<div class="card">Nenhum ponto registrado.</div>';document.querySelectorAll('[data-point-focus]').forEach(b=>b.onclick=()=>{setMapView(false);const p=points.find(x=>x.id===b.dataset.pointFocus);if(p){map.setView([Number(p.lat),Number(p.lng)],18);markers.eachLayer(m=>{if(m.options.pointId===p.id)m.openPopup()})}})}else{initMap();setTimeout(()=>map.invalidateSize(),30)}
}
function initMap(){
 if(!map){map=L.map('map',{zoomControl:true}).setView([-25.43,-49.27],11);L.tileLayer('/api/tile/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:19}).addTo(map);markers=L.layerGroup().addTo(map)}
 markers.clearLayers();const valid=points.filter(p=>p.lat!==null&&p.lng!==null&&Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lng)));
 valid.forEach(p=>{
  const box=document.createElement('div');box.className='point-popup';
  box.innerHTML=`<div class="point-popup-head">${p.photo||p.photoUrl?'<img class="popup-photo" alt="Foto do ponto">':''}<div><b>${esc(p.name)}</b><span>${fmt(p.time)}</span><span>${Number(p.lat).toFixed(6)}, ${Number(p.lng).toFixed(6)}</span><span>${esc(p.city||'')}</span></div></div><div class="popup-note"><b>Descrição:</b> ${esc(p.note||'Sem descrição informada.')}</div><div class="popup-technician">Técnico: ${esc(p.technician||'Registro antigo sem identidade')}</div><div class="popup-actions"><button class="view-photo">Ver foto</button><a href="https://www.google.com/maps?q=${Number(p.lat)},${Number(p.lng)}" target="_blank" rel="noopener">Abrir Maps</a><button class="share-photo">Compartilhar</button></div>`;
  box.querySelector('.view-photo').onclick=()=>openRecordPhoto(p.id);box.querySelector('.share-photo').onclick=()=>shareRecord(p.id);
  if(!p.photo&&!p.photoUrl){box.querySelector('.view-photo').disabled=true;box.querySelector('.share-photo').disabled=true}
  const marker=L.marker([Number(p.lat),Number(p.lng)],{pointId:p.id}).bindPopup(box,{maxWidth:310,minWidth:240}).addTo(markers);
  let photoObjectUrl='';marker.on('popupopen',async()=>{const img=box.querySelector('img');if(!img)return;try{if(p.photo)img.src=p.photo;else{const blob=await apiBlob(p.photoUrl);if(!marker.isPopupOpen())return;photoObjectUrl=URL.createObjectURL(blob);img.src=photoObjectUrl}}catch{img.alt='Foto indisponível'}});marker.on('popupclose',()=>{if(photoObjectUrl){URL.revokeObjectURL(photoObjectUrl);photoObjectUrl=''}})
 });
 if(valid.length===1)map.setView([Number(valid[0].lat),Number(valid[0].lng)],17);else if(valid.length>1)map.fitBounds(L.latLngBounds(valid.map(p=>[Number(p.lat),Number(p.lng)])).pad(.2));
 setTimeout(()=>map.invalidateSize(),200)
}
function renderExport(){$("#export").innerHTML=`<div class="card"><h3>Central de registros</h3><p class="muted">Cada foto salva automaticamente já cria um Placemark no KML/KMZ.</p><div class="actions"><button class="btn secondary" id="refreshCloud">Atualizar da nuvem</button><button class="btn secondary" id="kml">Baixar KML</button><button class="btn primary" id="kmz">Baixar KMZ completo</button></div><div id="exportStatus" class="muted small"></div></div>`;$("#refreshCloud").onclick=async()=>{await syncDown();renderAll();alert("Pontos atualizados.")};$("#kml").onclick=()=>download("geofoto-kmz.kml",makeKml(),"application/vnd.google-earth.kml+xml");$("#kmz").onclick=async()=>{const btn=$("#kmz"),st=$("#exportStatus");btn.disabled=true;btn.textContent="Gerando KMZ...";if(st)st.textContent="Preparando pontos e fotos...";try{const z=new JSZip();z.file("doc.kml",makeKml());let fotos=0;for(const p of points){try{let b=null;if(p.photo)b=dataToBlob(p.photo);else if(p.photoUrl)b=await apiBlob(p.photoUrl);if(b){z.file("fotos/"+safeName(p.name)+"-"+String(p.id).slice(0,8)+".jpg",b);fotos++}}catch{}}if(st)st.textContent=`Compactando ${points.length} pontos e ${fotos} fotos...`;const blob=await z.generateAsync({type:"blob",compression:"DEFLATE"});saveBlob(blob,"geofoto-kmz.kmz");if(st)st.textContent=`✓ KMZ gerado com ${points.length} pontos e ${fotos} fotos.`}catch(e){if(st)st.textContent="Falha ao gerar KMZ.";alert("Falha ao gerar KMZ: "+e.message)}finally{btn.disabled=false;btn.textContent="Baixar KMZ completo"}}}
function renderSettings(){
 const enabled=cfg.enabledTemplates||Object.keys(TEMPLATES);
 $('#settings').innerHTML=`
 <div class="settings-reorg">
  <div class="card settings-block">
   <div class="settings-title"><span class="settings-icon">👤</span><div><h3>Identidade do usuário</h3><p>Identificação obrigatória de quem está fazendo os registros.</p></div></div>
   <label class="field">Nome exibido (obrigatório) *<input id="identityName" value="${attr(identity||'')}" placeholder="Ex.: João Silva / Equipe 01" required></label>
   <div class="actions"><button class="btn primary" id="saveIdentity">Salvar identidade</button></div>
  </div>
  <div class="card settings-block">
   <div class="settings-title"><span class="settings-icon">🎨</span><div><h3>Aparência</h3><p>Cor e marca exibidas no aplicativo e nas fotos.</p></div></div>
   <label class="field">Cor principal<input id="primaryColor" type="color" value="${attr(cfg.primaryColor||'#0f766e')}"></label>
   <label class="field">Logo na foto (opcional)<input id="logoFile" type="file" accept="image/*"></label>\n   <label class="field">Banner do aplicativo (opcional)<input id="bannerFile" type="file" accept="image/*"></label>
   ${cfg.logo?`<div class="brand-preview-wrap"><span>Prévia do logo</span><img class="brand-preview logo-preview" src="${cfg.logo}"></div>`:''}\n   ${cfg.banner?`<div class="brand-preview-wrap"><span>Prévia do banner</span><img class="brand-preview app-banner-preview" src="${cfg.banner}"></div>`:''}
   <div class="actions"><button class="btn primary" id="saveAppearance">Salvar aparência</button><button class="btn secondary" id="clearLogo">Remover logo</button><button class="btn secondary" id="clearBanner">Remover banner</button></div>
  </div>
  <div class="card settings-block settings-wide">
   <div class="settings-title"><span class="settings-icon">📷</span><div><h3>Modelos de foto</h3><p>Escolha quais layouts ficarão disponíveis para o técnico.</p></div></div>
   <label class="field">Modelo padrão<select id="defaultTemplate">${Object.entries(TEMPLATES).map(([id,t])=>`<option value="${id}" ${id===cfg.defaultTemplate?'selected':''}>${t.name}</option>`).join('')}</select></label>
   <div class="template-list">${Object.entries(TEMPLATES).map(([id,t])=>`<label class="template-option"><input type="checkbox" data-template="${id}" ${enabled.includes(id)?'checked':''}><span><b>${t.name}</b><small>${t.description}</small></span></label>`).join('')}</div>
   <div class="actions"><button class="btn primary" id="saveTemplates">Salvar modelos</button></div>
  </div>
  <div class="card settings-block">
   <div class="settings-title"><span class="settings-icon">☁</span><div><h3>Sincronização / Nuvem</h3><p>Atualiza a lista de pontos e fotos salvos no servidor.</p></div></div>
   <div class="cloud-panel">
    <div class="cloud-panel-head"><span class="cloud-panel-icon">☁</span><div><b id="cloudDemoState">${isPersonalMode()?'Somente neste aparelho':(cloudConnected?(cloudPending?'Conectada com pendências':'Nuvem conectada'):'Offline')}</b><small>${esc(accountLabel())}</small></div></div>
    <div class="cloud-stats"><div><span>Na nuvem</span><b id="cloudDemoRecords">${isPersonalMode()?'—':cloudRecords}</b></div><div><span>Pendentes</span><b id="cloudDemoPending">${cloudPending}</b></div><div><span>Última sincronização</span><b id="cloudDemoLast">${isPersonalMode()?'Não se aplica':cloudTimeLabel(lastCloudSync)}</b></div></div>
    <div class="cloud-storage-detail">
     <div><span>Espaço usado</span><b id="cloudStorageUsed">${isPersonalMode()?'—':formatCloudBytes((cloudStorage||cachedCloudStorage())?.usedBytes||0)}</b></div>
     <div><span>Disponível na franquia</span><b id="cloudStorageRemaining">${isPersonalMode()?'—':formatCloudBytes((cloudStorage||cachedCloudStorage())?.remainingFreeBytes??10000000000)}</b></div>
     <div><span>Fotos armazenadas</span><b id="cloudStorageObjects">${isPersonalMode()?'—':Number((cloudStorage||cachedCloudStorage())?.objects||0)}</b></div>
    </div>
    <div class="cloud-storage-track"><i id="cloudStorageFill"></i></div>
    <small class="cloud-storage-help">${isPersonalMode()?'Modo pessoal não usa a nuvem do GeoFoto.':'Referência: franquia gratuita atual de 10 GB do R2 Standard.'}</small>
   </div>
   <button class="btn secondary full" id="refresh">${isPersonalMode()?'Atualizar histórico':'Sincronizar agora'}</button>
  </div>
  <div class="card settings-block">
   <div class="settings-title"><span class="settings-icon">↻</span><div><h3>Sobre o aplicativo</h3><p>Atualiza o GeoFoto KMZ sem reinstalar e sem apagar registros.</p></div></div>
   <div class="version-box"><span>Versão instalada</span><b>v${APP_VERSION}</b></div>
   <div class="app-status ok"><span class="app-status-dot"></span><span id="appUpdateState">Aplicativo atualizado</span></div>
   <div class="actions"><button class="btn primary" id="checkUpdate">Verificar nova versão</button></div>
  </div>
  <div class="card settings-block settings-wide settings-session">
   <div><h3>Sessão</h3><p class="muted">Use sair somente para trocar o acesso deste aparelho.</p></div>
   <button class="btn secondary" id="logout">Sair do aplicativo</button>
  </div>
 </div>`;
 const persist=async()=>{saveCfg();if(isPersonalMode())return;try{await api('/config',{method:'POST',body:JSON.stringify(cfg)})}catch(e){if(role==='admin')alert(e.message)}};
 $('#saveIdentity').onclick=()=>{const id=$('#identityName').value.trim();if(id.length<2){alert('Informe o nome do técnico/usuário.');$('#identityName').focus();return}identity=id;sessionStorage.setItem(IDENTITY,identity);alert('Identidade salva.')};
 $('#saveAppearance').onclick=async()=>{cfg.primaryColor=$('#primaryColor').value;const lf=$('#logoFile').files[0],bf=$('#bannerFile').files[0];if(lf)cfg.logo=await optimizeBrandImage(lf);if(bf)cfg.banner=await optimizeBrandImage(bf);saveLocalBrand({logo:cfg.logo,banner:cfg.banner,primaryColor:cfg.primaryColor});await persist();renderBranding();renderSettings();alert('Aparência salva.')};
 $('#clearLogo').onclick=async()=>{cfg.logo='';saveLocalBrand({logo:'',banner:cfg.banner,primaryColor:cfg.primaryColor});await persist();renderSettings()};
 $('#clearBanner').onclick=async()=>{cfg.banner='';saveLocalBrand({logo:cfg.logo,banner:'',primaryColor:cfg.primaryColor});await persist();renderBranding();renderSettings()};
 $('#saveTemplates').onclick=async()=>{const ids=[...document.querySelectorAll('[data-template]:checked')].map(x=>x.dataset.template);cfg.enabledTemplates=ids.length?ids:['essential'];cfg.defaultTemplate=cfg.enabledTemplates.includes($('#defaultTemplate').value)?$('#defaultTemplate').value:cfg.enabledTemplates[0];await persist();alert('Modelos atualizados.')};
 $('#refresh').onclick=async()=>{const b=$('#refresh');b.disabled=true;b.textContent=isPersonalMode()?'Atualizando...':'Sincronizando...';paintCloudDemo('sync');try{if(!isPersonalMode())await syncPendingQueue();await syncDown();if(!isPersonalMode())await refreshCloudStorage(true);renderDashboard();renderRecords();renderExport();renderSettings();if(!isPersonalMode())alert('Sincronização concluída. Registros e espaço da nuvem foram atualizados.')}catch{cloudConnected=false;paintCloudDemo();alert('Não foi possível sincronizar agora. Os registros pendentes continuam salvos no aparelho.')}};
 $('#checkUpdate').onclick=async()=>{const st=$('#appUpdateState');st.textContent='Verificando...';const found=await checkForUpdate(true);if(!found)st.textContent='Aplicativo atualizado'};
 $('#logout').onclick=()=>{sessionStorage.removeItem('gf_token');sessionStorage.removeItem('gf_role');sessionStorage.removeItem('gf_tenant');sessionStorage.removeItem(IDENTITY);localStorage.removeItem('gf_token');localStorage.removeItem('gf_role');localStorage.removeItem(IDENTITY);token='';role='user';identity='';loginView()}
}
function makeKml(){return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>GeoFoto KMZ</name>${points.map(p=>`<Placemark><name>${xml(p.name)}</name><description>${xml(`${p.note||''} | ${fmt(p.time)} | ${p.city||''} | ${p.address||''} | Precisão ${Math.round(p.accuracy||0)}m`)}</description><Point><coordinates>${p.lng},${p.lat},0</coordinates></Point></Placemark>`).join('')}</Document></kml>`}
function fileData(f){return new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(f)})}
function dataToBlob(u){const p=u.split(','),m=(p[0].match(/:(.*?);/)||[])[1]||'image/jpeg',b=atob(p[1]),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return new Blob([a],{type:m})}
function download(n,t,type){saveBlob(new Blob([t],{type}),n)}
function showDownloadNotice(name,size=0){
 document.querySelector('.download-toast')?.remove();
 const t=document.createElement('div');t.className='download-toast';const mb=size?Math.max(.01,size/1048576).toFixed(size>1048576?1:2)+' MB':'';
 t.innerHTML='<b>✓ Download iniciado</b><span>'+esc(name)+(mb?' · '+mb:'')+'</span><small>Procure o arquivo na pasta Downloads do celular.</small>';
 document.body.appendChild(t);setTimeout(()=>t.classList.add('show'),20);setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),260)},5200)
}
function saveBlob(b,n){
 const u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=n;a.rel='noopener';a.target='_self';a.style.position='fixed';a.style.left='-9999px';a.style.top='0';document.body.appendChild(a);
 a.dispatchEvent(new MouseEvent('click',{view:window,bubbles:true,cancelable:true}));
 showDownloadNotice(n,b.size||0);
 setTimeout(()=>{a.remove();URL.revokeObjectURL(u)},60000);
 return true
}
function fmt(v){return new Date(v).toLocaleString('pt-BR')}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function attr(s=''){return String(s).replace(/"/g,'&quot;')}
function xml(s=''){return esc(s)}
function safeName(s='registro'){return String(s).replace(/[^a-z0-9_-]+/gi,'-')}



function photoPath(p){return 'fotos/'+safeName(p.name)+'-'+String(p.id).slice(0,8)+'.jpg'}
let exportPrepared={signature:'',kml:null,kmz:null,points:0,photos:0,server:false},exportPreparing=null;
function exportSignature(all=points){const last=all[all.length-1];return [all.length,last?.id||'',last?.time||'',all.filter(p=>p._pending).length].join('|')}
function exportFileName(ext){const d=new Date(),date=d.toISOString().slice(0,10);return 'geofoto-kmz-'+date+'.'+ext}
document.addEventListener('click',e=>{const img=e.target.closest&&e.target.closest('[data-photo-id]');if(img)openRecordPhoto(img.dataset.photoId)});
makeKml=function(withPhotos=false,exportPoints=points){
 const items=exportPoints.map(p=>{const desc='<b>Descrição:</b> '+esc(p.note||'Sem descrição informada.')+'<br><b>Técnico:</b> '+esc(p.technician||'Registro antigo sem identidade')+'<br><b>Data/Hora:</b> '+esc(fmt(p.time))+'<br><b>Cidade:</b> '+esc(p.city||'Não identificada')+'<br><b>Endereço:</b> '+esc(p.address||'Não identificado')+'<br><b>Precisão GPS:</b> '+Math.round(p.accuracy||0)+' m<br><b>Coordenadas:</b> '+Number(p.lat).toFixed(6)+', '+Number(p.lng).toFixed(6);
  const image=withPhotos&&(p.photo||p.photoUrl)?'<br><br><img src="'+photoPath(p)+'" width="640">':'';
  return '<Placemark><visibility>1</visibility><styleUrl>#geofoto-point</styleUrl><name>'+xml(p.name)+'</name><description><![CDATA['+desc+image+']]></description><Point><coordinates>'+p.lng+','+p.lat+',0</coordinates></Point></Placemark>'});
 return '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>GeoFoto KMZ</name><visibility>1</visibility><Style id="geofoto-point"><IconStyle><scale>1.1</scale><Icon><href>'+xml(withPhotos?'icons/ponto.png':new URL('/map-marker.png',location.origin).href)+'</href></Icon><hotSpot x="0.5" y="0" xunits="fraction" yunits="fraction"/></IconStyle></Style>'+items.join('')+'</Document></kml>'
};

function updateExportCounts(all){const counts=document.querySelectorAll('#export .export-metrics b');if(counts[0])counts[0].textContent=all.length;if(counts[1])counts[1].textContent=all.filter(p=>p.photo||p.photoUrl).length}
async function pointsForExport(){
 // Always await an in-flight refresh, including the initial cloud load.
 if(pointSyncTask)await pointSyncTask;
 else if(navigator.onLine&&!isPersonalMode())await syncDown();
 else if(!points.length)await loadLocalFirst();
 if(!points.length)throw Error('Os pontos ainda não foram carregados. Conecte-se à internet e atualize a nuvem antes de exportar.');
 return points.slice()
}
async function prepareExportFiles(force=false){
 if(exportPreparing)return exportPreparing;
 exportPreparing=(async()=>{
  const st=$('#exportStatus'),kmlBtn=$('#kml'),kmzBtn=$('#kmz');
  try{
   if(st)st.textContent='Atualizando pontos e preparando os arquivos…';
   if(kmlBtn){kmlBtn.disabled=true;kmlBtn.textContent='Preparando KML…'}
   if(kmzBtn){kmzBtn.disabled=true;kmzBtn.textContent='Preparando KMZ…'}
   if(!isPersonalMode()&&navigator.onLine)await syncPendingQueue().catch(()=>{});
   const all=await pointsForExport(),sig=exportSignature(all);updateExportCounts(all);
   if(!force&&exportPrepared.signature===sig&&exportPrepared.kml&&exportPrepared.kmz){
    if(kmlBtn){kmlBtn.disabled=false;kmlBtn.textContent='Baixar KML'}
    if(kmzBtn){kmzBtn.disabled=false;kmzBtn.textContent='Baixar KMZ completo'}
    if(st)st.textContent='✓ Arquivos prontos para baixar. Toque no formato desejado.';
    return exportPrepared
   }
   if(!isPersonalMode()){
    if(st)st.textContent='Preparando download seguro pelo navegador…';
    await api('/session-cookie',{method:'POST',timeout:15000});
    exportPrepared={signature:sig,kml:true,kmz:true,points:all.length,photos:all.filter(p=>p.photo||p.photoUrl).length,server:true};
    if(kmlBtn){kmlBtn.disabled=false;kmlBtn.textContent='Baixar KML'}
    if(kmzBtn){kmzBtn.disabled=false;kmzBtn.textContent='Baixar KMZ completo'}
    if(st)st.textContent='✓ Arquivos prontos. O download será feito pelo navegador do celular.';
    return exportPrepared
   }
   const kmlBlob=new Blob([makeKml(false,all)],{type:'application/vnd.google-earth.kml+xml'});
   exportPrepared={signature:sig,kml:kmlBlob,kmz:null,points:all.length,photos:0,server:false};
   if(kmlBtn){kmlBtn.disabled=false;kmlBtn.textContent='Baixar KML'}
   if(st)st.textContent='✓ KML pronto. Preparando KMZ com as fotos…';
   const z=new JSZip();z.file('doc.kml',makeKml(true,all));
   const icon=await fetch(mapMarkerIcon);if(icon.ok)z.file('icons/ponto.png',await icon.blob());
   let fotos=0,done=0;
   for(const p of all){
    try{let b=null;if(p.photo)b=dataToBlob(p.photo);else if(p.photoUrl)b=await apiBlob(p.photoUrl);if(b){z.file(photoPath(p),b);fotos++}}catch{}
    done++;if(st&&done%5===0)st.textContent='Preparando fotos para o KMZ: '+done+' de '+all.length+'…'
   }
   if(st)st.textContent='Compactando KMZ…';
   const kmzBlob=await z.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}},m=>{if(st&&m.percent)st.textContent='Compactando KMZ: '+Math.round(m.percent)+'%'});
   exportPrepared={signature:sig,kml:kmlBlob,kmz:kmzBlob,points:all.length,photos:fotos,server:false};
   if(kmzBtn){kmzBtn.disabled=false;kmzBtn.textContent='Baixar KMZ completo'}
   if(st)st.textContent='✓ KML e KMZ prontos. Toque no botão para iniciar o download.';
   return exportPrepared
  }catch(e){
   if(st)st.textContent='⚠ '+(e?.message||'Não foi possível preparar os arquivos.');
   if(kmlBtn&&exportPrepared.kml){kmlBtn.disabled=false;kmlBtn.textContent='Baixar KML'}
   if(kmzBtn){kmzBtn.disabled=true;kmzBtn.textContent='KMZ indisponível'}
   throw e
  }finally{exportPreparing=null}
 })();
 return exportPreparing
}
renderExport=function(){
 const sig=exportSignature(points),ready=exportPrepared.signature===sig;
 $('#export').innerHTML='<div class="card export-center"><div class="export-badge">KMZ</div><h3>Exportar para Google Earth</h3><p class="muted">Os arquivos são preparados antes do toque em baixar para o Android não bloquear o download.</p><div class="export-metrics"><div><b>'+points.length+'</b><span>Pontos</span></div><div><b>'+points.filter(p=>p.photo||p.photoUrl).length+'</b><span>Fotos</span></div></div><div class="actions"><button class="btn secondary" id="refreshCloud">'+(isPersonalMode()?'Atualizar histórico':'Atualizar nuvem')+'</button><button class="btn secondary" id="kml" '+(ready&&exportPrepared.kml?'':'disabled')+'>'+(ready&&exportPrepared.kml?'Baixar KML':'Preparando KML…')+'</button><button class="btn primary" id="kmz" '+(ready&&exportPrepared.kmz?'':'disabled')+'>'+(ready&&exportPrepared.kmz?'Baixar KMZ completo':'Preparando KMZ…')+'</button></div><div id="exportStatus" class="export-status '+(ready&&exportPrepared.kmz?'ready':'')+'">'+(ready&&exportPrepared.kmz?'✓ Arquivos prontos para baixar.':'Preparando os arquivos para download…')+'</div></div>';
 $('#refreshCloud').onclick=async()=>{const st=$('#exportStatus');try{if(st)st.textContent='Atualizando registros…';if(!isPersonalMode())await syncPendingQueue();await syncDown();exportPrepared={signature:'',kml:null,kmz:null,points:0,photos:0,server:false};renderExport();await prepareExportFiles(true)}catch(e){if(st)st.textContent='⚠ '+(e?.message||'Não foi possível atualizar.')}};
 $('#kml').onclick=()=>{const st=$('#exportStatus');if(!exportPrepared.kml){if(st)st.textContent='O KML ainda está sendo preparado. Aguarde alguns segundos.';return}const name=exportFileName('kml');if(exportPrepared.server){showDownloadNotice(name);if(st)st.textContent='✓ Download do KML solicitado ao navegador. Aguarde a notificação de download.';location.href='/api/export/kml?t='+Date.now();return}saveBlob(exportPrepared.kml,name);if(st)st.textContent='✓ Download do KML iniciado: '+name+' · procure na pasta Downloads.'};
 $('#kmz').onclick=()=>{const st=$('#exportStatus');if(!exportPrepared.kmz){if(st)st.textContent='O KMZ ainda está sendo preparado. Aguarde a mensagem “arquivos prontos”.';return}const name=exportFileName('kmz');if(exportPrepared.server){showDownloadNotice(name);if(st)st.textContent='✓ Gerando o KMZ completo para download. O navegador avisará quando o arquivo estiver pronto.';location.href='/api/export/kmz?t='+Date.now();return}saveBlob(exportPrepared.kmz,name);if(st)st.textContent='✓ Download do KMZ iniciado: '+name+' · procure na pasta Downloads.'};
 if($('#export')?.classList.contains('active')&&!ready)setTimeout(()=>prepareExportFiles().catch(()=>{}),30)
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
let lastUpdateCheck=0;
async function checkUpdateIfDue(force=false){
 const now=Date.now();if(!force&&now-lastUpdateCheck<30000)return false;lastUpdateCheck=now;
 return checkForUpdate(false)
}
async function initUpdater(){
 if(!('serviceWorker' in navigator))return;
 try{
  swRegistration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updateReloading)return;updateReloading=true;location.reload()});
  await swRegistration.update().catch(()=>{});
  await checkUpdateIfDue(true);
  setInterval(()=>checkUpdateIfDue(true),2*60*1000)
 }catch{}
}
window.addEventListener('load',initUpdater);
window.addEventListener('focus',()=>checkUpdateIfDue(false));
window.addEventListener('pageshow',()=>checkUpdateIfDue(false));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkUpdateIfDue(false)});
window.addEventListener('online',()=>syncPendingQueue().catch(()=>{}));
window.addEventListener('offline',()=>updatePendingStatus());
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&navigator.onLine)syncPendingQueue().catch(()=>{})});
setInterval(()=>{if(navigator.onLine)syncPendingQueue().catch(()=>{})},60000);
token?appView().catch(loginView):loginView()
