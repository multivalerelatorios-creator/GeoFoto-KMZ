import JSZip from 'jszip'
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=UTF-8',...extra}})
const cleanTenant=v=>String(v||'principal').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,50)||'principal'
const bearer=req=>{const a=req.headers.get('Authorization')||'';return a.startsWith('Bearer ')?a.slice(7):''}
const cookieToken=req=>{const raw=req.headers.get('Cookie')||'';const m=raw.match(/(?:^|;\s*)gf_session=([^;]+)/);if(!m)return'';try{return decodeURIComponent(m[1])}catch{return m[1]}}
const sessionCookie=(req,token,maxAge=2592000)=>'gf_session='+encodeURIComponent(token)+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+maxAge+(new URL(req.url).protocol==='https:'?'; Secure':'')
async function sha256(v){
  const bytes=new TextEncoder().encode(String(v||''))
  const hash=await crypto.subtle.digest('SHA-256',bytes)
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')
}
function hex(bytes){return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function fromHex(v){const a=new Uint8Array(v.length/2);for(let i=0;i<a.length;i++)a[i]=parseInt(v.slice(i*2,i*2+2),16);return a}
async function passwordHash(pass){
  const salt=crypto.getRandomValues(new Uint8Array(16))
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(String(pass||'')),'PBKDF2',false,['deriveBits'])
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},key,256)
  return 'pbkdf2$100000$'+hex(salt)+'$'+hex(bits)
}
async function verifyPassword(pass,stored){
  if(String(stored||'').startsWith('pbkdf2$')){
    const [,it,saltHex,hashHex]=stored.split('$')
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(String(pass||'')),'PBKDF2',false,['deriveBits'])
    const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:fromHex(saltHex),iterations:Number(it)||100000},key,256)
    return hex(bits)===hashHex
  }
  return String(stored||'')===await sha256(pass)
}
function randomReadable(n=10){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',a=crypto.getRandomValues(new Uint8Array(n));return [...a].map(x=>chars[x%chars.length]).join('')}
function companySlug(name){return String(name||'empresa').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,28)||'empresa'}
async function sessionOf(req,env){
  const token=bearer(req)||cookieToken(req); if(!token)return null
  if(token===env.GEOFOTO_ADMIN_TOKEN)return{tenant_id:'principal',role:'admin',super:false,legacy:true}
  if(token===env.GEOFOTO_TOKEN)return{tenant_id:'principal',role:'user',super:false,legacy:true}
  const now=new Date().toISOString()
  if(token.startsWith('mst_')){
    const master=await env.DB.prepare('SELECT expires_at FROM master_sessions WHERE token=? AND expires_at>?').bind(token,now).first().catch(()=>null)
    return master?{tenant_id:'master',role:'superadmin',super:true,legacy:false}:null
  }
  const row=await env.DB.prepare('SELECT s.tenant_id,s.role,s.expires_at,t.enabled FROM tenant_sessions s JOIN tenants t ON t.id=s.tenant_id WHERE s.token=? AND s.expires_at>?').bind(token,now).first()
  return row&&row.enabled?{tenant_id:row.tenant_id,role:row.role,super:false,legacy:false}:null
}
const isAdmin=s=>s&&(s.role==='admin'||s.role==='superadmin')

export default {
 async fetch(req,env){
  const url=new URL(req.url)
  if(url.pathname==='/api/health')return json({ok:true,service:'GeoFoto KMZ Cloud',multiTenant:true})
  if(url.pathname.startsWith('/api/tile/')&&req.method==='GET'){
   const m=url.pathname.match(/^\/api\/tile\/(\d+)\/(\d+)\/(\d+)\.png$/)
   if(!m)return new Response('Tile invalido',{status:400})
   const z=Number(m[1]),x=Number(m[2]),y=Number(m[3])
   if(!Number.isInteger(z)||z<0||z>19||!Number.isInteger(x)||!Number.isInteger(y))return new Response('Tile invalido',{status:400})
   const rr=await fetch('https://tile.openstreetmap.org/'+z+'/'+x+'/'+y+'.png',{headers:{'User-Agent':'GeoFoto-KMZ/1.2 (field mapping app)'}})
   if(!rr.ok)return new Response('Tile indisponivel',{status:rr.status})
   return new Response(rr.body,{headers:{'content-type':'image/png','cache-control':'public, max-age=86400'}})
  }
  if(url.pathname==='/api/register-company'&&req.method==='POST'){
   const b=await req.json().catch(()=>({})),name=String(b.name||'').trim().replace(/\s+/g,' ')
   if(name.length<2||name.length>80)return json({error:'Informe o nome da empresa (2 a 80 caracteres).'},400)
   const ipHash=await sha256(req.headers.get('CF-Connecting-IP')||'unknown'),since=new Date(Date.now()-86400000).toISOString()
   const lim=await env.DB.prepare('SELECT COUNT(*) n FROM registration_log WHERE ip_hash=? AND created_at>?').bind(ipHash,since).first().catch(()=>({n:0}))
   if(Number(lim?.n||0)>=3)return json({error:'Limite de cadastros atingido nesta rede. Tente novamente amanhã.'},429)
   let id=''
   for(let i=0;i<8;i++){const candidate=companySlug(name)+'-'+randomReadable(4).toLowerCase(),exists=await env.DB.prepare('SELECT id FROM tenants WHERE id=?').bind(candidate).first();if(!exists){id=candidate;break}}
   if(!id)return json({error:'Não foi possível gerar o código da empresa. Tente novamente.'},500)
   const adminPass='ADM-'+randomReadable(10),userPass='COL-'+randomReadable(10),recovery='GFKM-'+randomReadable(4)+'-'+randomReadable(4)+'-'+randomReadable(4),now=new Date().toISOString()
   await env.DB.batch([
    env.DB.prepare('INSERT INTO tenants (id,name,enabled) VALUES (?,?,1)').bind(id,name),
    env.DB.prepare('INSERT INTO tenant_users (tenant_id,username,password_hash,role,enabled) VALUES (?,?,?,?,1)').bind(id,'admin',await passwordHash(adminPass),'admin'),
    env.DB.prepare('INSERT INTO tenant_users (tenant_id,username,password_hash,role,enabled) VALUES (?,?,?,?,1)').bind(id,'colaborador',await passwordHash(userPass),'user'),
    env.DB.prepare('INSERT INTO tenant_recovery (tenant_id,recovery_hash,created_at) VALUES (?,?,?)').bind(id,await sha256(recovery),now),
    env.DB.prepare('INSERT INTO registration_log (ip_hash,tenant_id,created_at) VALUES (?,?,?)').bind(ipHash,id,now)
   ])
   return json({ok:true,accountCode:id,companyName:name,admin:{user:'admin',password:adminPass},collaborator:{user:'colaborador',password:userPass},recoveryCode:recovery},201)
  }
  if(url.pathname==='/api/recover-company'&&req.method==='POST'){
   const b=await req.json().catch(()=>({})),tenant=cleanTenant(b.account),code=String(b.recoveryCode||'').trim().toUpperCase()
   if(tenant==='principal'||code.length<8)return json({error:'Código da conta ou recuperação inválido.'},400)
   const rec=await env.DB.prepare('SELECT recovery_hash FROM tenant_recovery WHERE tenant_id=?').bind(tenant).first()
   if(!rec||rec.recovery_hash!==await sha256(code))return json({error:'Código da conta ou recuperação inválido.'},401)
   const pass='ADM-'+randomReadable(10),h=await passwordHash(pass)
   await env.DB.batch([
    env.DB.prepare("UPDATE tenant_users SET password_hash=?,enabled=1 WHERE tenant_id=? AND username='admin'").bind(h,tenant),
    env.DB.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').bind(tenant)
   ])
   return json({ok:true,accountCode:tenant,adminUser:'admin',adminPassword:pass})
  }
  if(url.pathname==='/api/master/login'&&req.method==='POST'){
   const b=await req.json().catch(()=>({})),user=String(b.user||'').trim()
   const m=await env.DB.prepare('SELECT password_hash,enabled FROM master_users WHERE username=?').bind(user).first().catch(()=>null)
   if(!m||!m.enabled||!(await verifyPassword(b.pass,m.password_hash)))return json({error:'Usuário ou senha Master inválidos'},401)
   const token='mst_'+crypto.randomUUID()+crypto.randomUUID(),exp=new Date(Date.now()+12*60*60*1000).toISOString()
   await env.DB.prepare('INSERT INTO master_sessions (token,username,expires_at) VALUES (?,?,?)').bind(token,user,exp).run()
   return json({token,role:'superadmin',expiresAt:exp})
  }
  if(url.pathname==='/api/login'&&req.method==='POST'){
   const b=await req.json().catch(()=>({})),tenant=cleanTenant(b.account)
   if(tenant==='principal'&&b.user===env.GEOFOTO_ADMIN_USER&&b.pass===env.GEOFOTO_ADMIN_PASS)
    return json({token:env.GEOFOTO_ADMIN_TOKEN,role:'admin',tenant:'principal',accountName:'Conta principal'})
   if(tenant==='principal'&&b.user===env.GEOFOTO_USER&&b.pass===env.GEOFOTO_PASS)
    return json({token:env.GEOFOTO_TOKEN,role:'user',tenant:'principal',accountName:'Conta principal'})
   const u=await env.DB.prepare('SELECT u.password_hash,u.role,u.enabled,t.name,t.enabled tenant_enabled FROM tenant_users u JOIN tenants t ON t.id=u.tenant_id WHERE u.tenant_id=? AND u.username=?').bind(tenant,String(b.user||'').trim()).first()
   if(!u||!u.enabled||!u.tenant_enabled||!(await verifyPassword(b.pass,u.password_hash)))return json({error:'Conta, usuário ou senha inválidos'},401)
   const token=crypto.randomUUID()+crypto.randomUUID(),exp=new Date(Date.now()+30*86400000).toISOString()
   await env.DB.prepare('INSERT INTO tenant_sessions (token,tenant_id,role,expires_at) VALUES (?,?,?,?)').bind(token,tenant,u.role,exp).run()
   return json({token,role:u.role,tenant,accountName:u.name})
  }
  if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(req)
  const s=await sessionOf(req,env)
  if(!s)return json({error:'Não autorizado'},401)
  if(url.pathname==='/api/master/logout'&&req.method==='POST'&&s.super){
   await env.DB.prepare('DELETE FROM master_sessions WHERE token=?').bind(bearer(req)||cookieToken(req)).run()
   return json({ok:true},200,{'set-cookie':'gf_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'})
  }
  if(url.pathname==='/api/session-cookie'&&req.method==='POST'){
   const token=bearer(req);if(!token)return json({error:'Token ausente'},400)
   return json({ok:true},200,{'set-cookie':sessionCookie(req,token,s.super?43200:2592000),'cache-control':'no-store'})
  }
  if(url.pathname==='/api/export/kml'&&req.method==='GET')return exportKml(req,env,s)
  if(url.pathname==='/api/export/kmz'&&req.method==='GET')return exportKmz(req,env,s)

  if(url.pathname==='/api/account'&&req.method==='GET'){
   const t=await env.DB.prepare('SELECT name FROM tenants WHERE id=?').bind(s.tenant_id).first().catch(()=>null)
   return json({id:s.tenant_id,name:t?.name||(s.tenant_id==='principal'?'Conta principal':s.tenant_id),role:s.role})
  }
  if(url.pathname==='/api/storage'&&req.method==='GET'){
   const prefix='tenants/'+s.tenant_id+'/photos/'
   let cursor,usedBytes=0,objects=0,truncated=true,pages=0
   while(truncated&&pages<50){
    const page=await env.PHOTOS.list({prefix,limit:1000,...(cursor?{cursor}:{})})
    for(const obj of page.objects||[]){usedBytes+=Number(obj.size||0);objects++}
    truncated=!!page.truncated;cursor=page.cursor;pages++
   }
   const freeAllowanceBytes=10000000000
   return json({usedBytes,objects,freeAllowanceBytes,remainingFreeBytes:Math.max(0,freeAllowanceBytes-usedBytes),overFreeBytes:Math.max(0,usedBytes-freeAllowanceBytes),complete:!truncated})
  }
  if(url.pathname==='/api/points'&&req.method==='GET'){
   const {results}=await env.DB.prepare('SELECT id,name,note,technician,lat,lng,accuracy,time,city,address,photo_key FROM points WHERE tenant_id=? ORDER BY time ASC').bind(s.tenant_id).all()
   return json(results.map(p=>({...p,photoUrl:p.photo_key?'/api/photo/'+p.id:''})))
  }
  if(url.pathname==='/api/points'&&req.method==='POST')return savePoint(req,env,s)
  if(url.pathname.startsWith('/api/photo/')&&req.method==='GET')return getPhoto(url,env,s)

  if(url.pathname==='/api/config'&&req.method==='GET'){
   const row=await env.DB.prepare('SELECT data FROM tenant_config WHERE tenant_id=?').bind(s.tenant_id).first()
   return json(JSON.parse(row?.data||'{}'))
  }
  if(url.pathname==='/api/config'&&req.method==='POST'){
   if(!isAdmin(s))return json({error:'Acesso exclusivo do administrador'},403)
   const b=await req.json().catch(()=>({}))
   await env.DB.prepare('INSERT INTO tenant_config (tenant_id,data) VALUES (?,?) ON CONFLICT(tenant_id) DO UPDATE SET data=excluded.data').bind(s.tenant_id,JSON.stringify(b)).run()
   return json(b)
  }
  if(url.pathname.startsWith('/api/points/')&&req.method==='DELETE'){
   if(!isAdmin(s))return json({error:'Acesso exclusivo do administrador'},403)
   const id=url.pathname.split('/').pop()
   const row=await env.DB.prepare('SELECT photo_key FROM points WHERE id=? AND tenant_id=?').bind(id,s.tenant_id).first()
   if(!row)return json({error:'Registro não encontrado'},404)
   if(row.photo_key)await env.PHOTOS.delete(row.photo_key)
   await env.DB.prepare('DELETE FROM points WHERE id=? AND tenant_id=?').bind(id,s.tenant_id).run()
   return json({ok:true,id})
  }
  if(url.pathname==='/api/points'&&req.method==='DELETE'){
   if(!isAdmin(s))return json({error:'Acesso exclusivo do administrador'},403)
   const {results}=await env.DB.prepare("SELECT photo_key FROM points WHERE tenant_id=? AND photo_key<>''").bind(s.tenant_id).all()
   for(const r of results)await env.PHOTOS.delete(r.photo_key)
   await env.DB.prepare('DELETE FROM points WHERE tenant_id=?').bind(s.tenant_id).run()
   return json({ok:true})
  }

  if(url.pathname==='/api/admin/users'&&req.method==='GET'){
   if(!isAdmin(s))return json({error:'Acesso exclusivo do administrador'},403)
   const {results}=await env.DB.prepare('SELECT username,role,enabled,created_at FROM tenant_users WHERE tenant_id=? ORDER BY username').bind(s.tenant_id).all()
   return json(results)
  }
  if(url.pathname==='/api/admin/users'&&req.method==='POST'){
   if(!isAdmin(s))return json({error:'Acesso exclusivo do administrador'},403)
   const b=await req.json().catch(()=>({})),user=String(b.user||'').trim(),pass=String(b.pass||''),role=b.role==='admin'?'admin':'user'
   if(user.length<3||pass.length<6)return json({error:'Usuário deve ter 3+ caracteres e senha 6+ caracteres'},400)
   const h=await passwordHash(pass)
   await env.DB.prepare('INSERT INTO tenant_users (tenant_id,username,password_hash,role,enabled) VALUES (?,?,?,?,1) ON CONFLICT(tenant_id,username) DO UPDATE SET password_hash=excluded.password_hash,role=excluded.role,enabled=1').bind(s.tenant_id,user,h,role).run()
   return json({ok:true,user,role},201)
  }

  if(url.pathname==='/api/master/companies'&&req.method==='GET'){
   if(!s.super)return json({error:'Acesso exclusivo do Master'},403)
   const {results}=await env.DB.prepare(`SELECT t.id,t.name,t.enabled,t.created_at,
     (SELECT COUNT(*) FROM tenant_users u WHERE u.tenant_id=t.id) users,
     (SELECT COUNT(*) FROM points p WHERE p.tenant_id=t.id) points
     FROM tenants t WHERE t.id<>'principal' ORDER BY t.created_at DESC`).all()
   return json(results)
  }
  if(url.pathname.startsWith('/api/master/companies/')&&req.method==='PATCH'){
   if(!s.super)return json({error:'Acesso exclusivo do Master'},403)
   const id=cleanTenant(decodeURIComponent(url.pathname.split('/').pop()||''))
   if(!id||id==='principal'||id==='master')return json({error:'Empresa inválida'},400)
   const b=await req.json().catch(()=>({})),enabled=b.enabled===true||b.enabled===1?1:0
   const row=await env.DB.prepare('SELECT id,name FROM tenants WHERE id=?').bind(id).first()
   if(!row)return json({error:'Empresa não encontrada'},404)
   await env.DB.prepare('UPDATE tenants SET enabled=? WHERE id=?').bind(enabled,id).run()
   if(!enabled)await env.DB.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').bind(id).run()
   return json({ok:true,id,name:row.name,enabled})
  }

  if(url.pathname==='/api/admin/tenants'&&req.method==='GET'){
   if(!s.super)return json({error:'Acesso exclusivo do administrador geral'},403)
   const {results}=await env.DB.prepare('SELECT id,name,enabled,created_at FROM tenants ORDER BY name').all()
   return json(results)
  }
  if(url.pathname==='/api/admin/tenants'&&req.method==='POST'){
   if(!s.super)return json({error:'Acesso exclusivo do administrador geral'},403)
   const b=await req.json().catch(()=>({})),id=cleanTenant(b.id),name=String(b.name||'').trim(),user=String(b.user||'admin').trim(),pass=String(b.pass||'')
   if(id==='principal'||id.length<3||name.length<2||user.length<3||pass.length<6)return json({error:'Dados da nova conta inválidos'},400)
   const exists=await env.DB.prepare('SELECT id FROM tenants WHERE id=?').bind(id).first()
   if(exists)return json({error:'Este código de conta já existe'},409)
   await env.DB.prepare('INSERT INTO tenants (id,name,enabled) VALUES (?,?,1)').bind(id,name).run()
   await env.DB.prepare('INSERT INTO tenant_users (tenant_id,username,password_hash,role,enabled) VALUES (?,?,?,?,1)').bind(id,user,await passwordHash(pass),'admin').run()
   return json({ok:true,id,name,admin:user},201)
  }
  return json({error:'Rota não encontrada'},404)
 }
}
async function savePoint(req,env,s){
 const p=await req.json().catch(()=>({}))
 if(typeof p.lat!=='number'||typeof p.lng!=='number')return json({error:'Coordenadas inválidas'},400)
 let headerIdentity='';try{headerIdentity=decodeURIComponent(req.headers.get('X-GeoFoto-Identity')||'').trim()}catch{}
 const technician=String(p.technician||headerIdentity||'').trim().slice(0,80)
 const id=p.id||crypto.randomUUID();let photoKey=''
 if(typeof p.photo==='string'&&p.photo.startsWith('data:image/')){
  const [meta,b64]=p.photo.split(','),type=(meta.match(/data:(.*?);/)||[])[1]||'image/jpeg'
  const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0))
  photoKey='tenants/'+s.tenant_id+'/photos/'+id+'.jpg'
  await env.PHOTOS.put(photoKey,bytes,{httpMetadata:{contentType:type}})
 }
 await env.DB.prepare("INSERT INTO points (id,name,note,technician,lat,lng,accuracy,time,city,address,photo_key,tenant_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,note=excluded.note,technician=excluded.technician,lat=excluded.lat,lng=excluded.lng,accuracy=excluded.accuracy,time=excluded.time,city=excluded.city,address=excluded.address,photo_key=CASE WHEN excluded.photo_key<>'' THEN excluded.photo_key ELSE points.photo_key END WHERE points.tenant_id=excluded.tenant_id")
  .bind(id,String(p.name||'Ponto'),String(p.note||''),technician,p.lat,p.lng,Number(p.accuracy||0),p.time||new Date().toISOString(),String(p.city||''),String(p.address||''),photoKey,s.tenant_id).run()
 return json({id,name:p.name||'Ponto',note:p.note||'',technician,lat:p.lat,lng:p.lng,accuracy:p.accuracy||0,time:p.time||new Date().toISOString(),city:p.city||'',address:p.address||'',photoUrl:photoKey?'/api/photo/'+id:''},201)
}
async function getPhoto(url,env,s){
 const id=url.pathname.split('/').pop()
 const row=await env.DB.prepare('SELECT photo_key FROM points WHERE id=? AND tenant_id=?').bind(id,s.tenant_id).first()
 if(!row?.photo_key)return new Response('Não encontrada',{status:404})
 const obj=await env.PHOTOS.get(row.photo_key)
 if(!obj)return new Response('Não encontrada',{status:404})
 return new Response(obj.body,{headers:{'content-type':obj.httpMetadata?.contentType||'image/jpeg','cache-control':'no-store, no-cache, must-revalidate','pragma':'no-cache','expires':'0'}})
}

function htmlEscape(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function xmlEscape(s=''){return htmlEscape(s)}
function exportSafeName(s='registro'){return String(s).replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'')||'registro'}
function exportPhotoPath(p){return 'fotos/'+exportSafeName(p.name)+'-'+String(p.id).slice(0,8)+'.jpg'}
function exportDateName(ext){return 'geofoto-kmz-'+new Date().toISOString().slice(0,10)+'.'+ext}
function exportTime(v){try{return new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}catch{return String(v||'')}}
function exportKmlText(points,withPhotos=false,origin=''){
 const items=points.map(p=>{
  const desc='<b>Descrição:</b> '+htmlEscape(p.note||'Sem descrição informada.')+
   '<br><b>Técnico:</b> '+htmlEscape(p.technician||'Registro antigo sem identidade')+
   '<br><b>Data/Hora:</b> '+htmlEscape(exportTime(p.time))+
   '<br><b>Cidade:</b> '+htmlEscape(p.city||'Não identificada')+
   '<br><b>Endereço:</b> '+htmlEscape(p.address||'Não identificado')+
   '<br><b>Precisão GPS:</b> '+Math.round(Number(p.accuracy||0))+' m'+
   '<br><b>Coordenadas:</b> '+Number(p.lat).toFixed(6)+', '+Number(p.lng).toFixed(6);
  const image=withPhotos&&p.photo_key?'<br><br><img src="'+exportPhotoPath(p)+'" width="640">':'';
  return '<Placemark><visibility>1</visibility><styleUrl>#geofoto-point</styleUrl><name>'+xmlEscape(p.name||'Ponto')+'</name><description><![CDATA['+desc+image+']]></description><Point><coordinates>'+p.lng+','+p.lat+',0</coordinates></Point></Placemark>'
 });
 const icon=withPhotos?'icons/ponto.png':(origin?origin+'/map-marker.png':'');
 return '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>GeoFoto KMZ</name><visibility>1</visibility><Style id="geofoto-point"><IconStyle><scale>1.1</scale><Icon><href>'+xmlEscape(icon)+'</href></Icon><hotSpot x="0.5" y="0" xunits="fraction" yunits="fraction"/></IconStyle></Style>'+items.join('')+'</Document></kml>'
}
async function exportRows(env,tenant){
 const {results}=await env.DB.prepare('SELECT id,name,note,technician,lat,lng,accuracy,time,city,address,photo_key FROM points WHERE tenant_id=? ORDER BY time ASC').bind(tenant).all();
 return results||[]
}
async function exportKml(req,env,s){
 const rows=await exportRows(env,s.tenant_id);if(!rows.length)return new Response('Nenhum ponto disponível para exportar.',{status:404});
 const body=exportKmlText(rows,false,new URL(req.url).origin);
 return new Response(body,{headers:{'content-type':'application/vnd.google-earth.kml+xml; charset=UTF-8','content-disposition':'attachment; filename="'+exportDateName('kml')+'"','cache-control':'no-store','x-content-type-options':'nosniff'}})
}
async function exportKmz(req,env,s){
 const rows=await exportRows(env,s.tenant_id);if(!rows.length)return new Response('Nenhum ponto disponível para exportar.',{status:404});
 const z=new JSZip();z.file('doc.kml',exportKmlText(rows,true,new URL(req.url).origin));
 try{const rr=await env.ASSETS.fetch(new Request(new URL('/map-marker.png',req.url)));if(rr.ok)z.file('icons/ponto.png',new Uint8Array(await rr.arrayBuffer()))}catch{}
 for(const p of rows){
  if(!p.photo_key)continue;
  try{const obj=await env.PHOTOS.get(p.photo_key);if(obj)z.file(exportPhotoPath(p),new Uint8Array(await obj.arrayBuffer()))}catch{}
 }
 const bytes=await z.generateAsync({type:'uint8array',compression:'STORE'});
 return new Response(bytes,{headers:{'content-type':'application/vnd.google-earth.kmz','content-disposition':'attachment; filename="'+exportDateName('kmz')+'"','cache-control':'no-store','x-content-type-options':'nosniff','content-length':String(bytes.byteLength)}})
}
