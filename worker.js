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
  if(token===env.GEOFOTO_ADMIN_TOKEN)return{tenant_id:'principal',role:'admin',username:'admin',super:false,legacy:true}
  if(token===env.GEOFOTO_TOKEN)return{tenant_id:'principal',role:'user',username:'colaborador',super:false,legacy:true}
  const now=new Date().toISOString()
  if(token.startsWith('mst_')){
    const master=await env.DB.prepare('SELECT expires_at FROM master_sessions WHERE token=? AND expires_at>?').bind(token,now).first().catch(()=>null)
    return master?{tenant_id:'master',role:'superadmin',super:true,legacy:false}:null
  }
  if(token.startsWith('cm_')){
    const master=await env.DB.prepare('SELECT company_id,username,expires_at FROM company_master_sessions WHERE token=? AND expires_at>?').bind(token,now).first().catch(()=>null)
    return master?{tenant_id:'company-master',role:'companymaster',company:true,company_id:String(master.company_id||''),username:String(master.username||''),super:false,legacy:false}:null
  }
  const row=await env.DB.prepare('SELECT s.tenant_id,s.role,s.username,s.expires_at,t.enabled FROM tenant_sessions s JOIN tenants t ON t.id=s.tenant_id WHERE s.token=? AND s.expires_at>?').bind(token,now).first()
  return row&&row.enabled?{tenant_id:row.tenant_id,role:row.role,username:String(row.username||''),super:false,legacy:false}:null
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

  if(url.pathname==='/api/company-master/register'&&req.method==='POST'){
   const b=await req.json().catch(()=>({})),name=String(b.name||'').trim().replace(/\s+/g,' '),user=String(b.user||'').trim(),pass=String(b.pass||''),requested=companySlug(b.company||name)
   if(name.length<2||name.length>80)return json({error:'Informe o nome da organização (2 a 80 caracteres).'},400)
   if(requested.length<3)return json({error:'Identificador da organização inválido.'},400)
   if(user.length<3||pass.length<6)return json({error:'Usuário Master deve ter 3+ caracteres e senha 6+ caracteres.'},400)
   const exists=await env.DB.prepare('SELECT id FROM company_groups WHERE id=?').bind(requested).first().catch(()=>null)
   if(exists)return json({error:'Este identificador de organização já está em uso.'},409)
   const ipHash=await sha256(req.headers.get('CF-Connecting-IP')||'unknown'),since=new Date(Date.now()-86400000).toISOString()
   const lim=await env.DB.prepare('SELECT COUNT(*) n FROM company_master_registration_log WHERE ip_hash=? AND created_at>?').bind(ipHash,since).first().catch(()=>({n:0}))
   if(Number(lim?.n||0)>=3)return json({error:'Limite de cadastros de organizações atingido nesta rede. Tente novamente amanhã.'},429)
   const recovery='ORG-'+randomReadable(4)+'-'+randomReadable(4)+'-'+randomReadable(4),now=new Date().toISOString()
   await env.DB.batch([
    env.DB.prepare('INSERT INTO company_groups (id,name,enabled) VALUES (?,?,1)').bind(requested,name),
    env.DB.prepare('INSERT INTO company_master_users (company_id,username,password_hash,enabled) VALUES (?,?,?,1)').bind(requested,user,await passwordHash(pass)),
    env.DB.prepare('INSERT INTO company_master_recovery (company_id,recovery_hash,created_at) VALUES (?,?,?)').bind(requested,await sha256(recovery),now),
    env.DB.prepare('INSERT INTO company_master_registration_log (ip_hash,company_id,created_at) VALUES (?,?,?)').bind(ipHash,requested,now)
   ])
   return json({ok:true,companyId:requested,companyName:name,masterUser:user,recoveryCode:recovery},201)
  }
  if(url.pathname==='/api/company-master/recover'&&req.method==='POST'){
   const b=await req.json().catch(()=>({})),company=String(b.company||'').trim().toLowerCase(),code=String(b.recoveryCode||'').trim().toUpperCase()
   if(company.length<3||code.length<8)return json({error:'Organização ou código de recuperação inválido.'},400)
   const rec=await env.DB.prepare('SELECT recovery_hash FROM company_master_recovery WHERE company_id=?').bind(company).first().catch(()=>null)
   if(!rec||rec.recovery_hash!==await sha256(code))return json({error:'Organização ou código de recuperação inválido.'},401)
   const master=await env.DB.prepare('SELECT username FROM company_master_users WHERE company_id=? ORDER BY created_at LIMIT 1').bind(company).first()
   if(!master)return json({error:'Acesso Master não encontrado.'},404)
   const pass='MST-'+randomReadable(12)
   await env.DB.batch([
    env.DB.prepare('UPDATE company_master_users SET password_hash=?,enabled=1 WHERE company_id=? AND username=?').bind(await passwordHash(pass),company,master.username),
    env.DB.prepare('DELETE FROM company_master_sessions WHERE company_id=?').bind(company)
   ])
   return json({ok:true,companyId:company,masterUser:master.username,masterPassword:pass})
  }
  if(url.pathname==='/api/master/login'&&req.method==='POST'){
   const b=await req.json().catch(()=>({})),user=String(b.user||'').trim()
   const m=await env.DB.prepare('SELECT password_hash,enabled FROM master_users WHERE username=?').bind(user).first().catch(()=>null)
   if(!m||!m.enabled||!(await verifyPassword(b.pass,m.password_hash)))return json({error:'Usuário ou senha Master inválidos'},401)
   const token='mst_'+crypto.randomUUID()+crypto.randomUUID(),exp=new Date(Date.now()+12*60*60*1000).toISOString()
   await env.DB.prepare('INSERT INTO master_sessions (token,username,expires_at) VALUES (?,?,?)').bind(token,user,exp).run()
   return json({token,role:'superadmin',expiresAt:exp})
  }
  if(url.pathname==='/api/company-master/login'&&req.method==='POST'){
   const b=await req.json().catch(()=>({})),company=String(b.company||'').trim().toLowerCase(),user=String(b.user||'').trim()
   const m=await env.DB.prepare('SELECT u.password_hash,u.enabled,g.name,g.enabled company_enabled FROM company_master_users u JOIN company_groups g ON g.id=u.company_id WHERE u.company_id=? AND u.username=?').bind(company,user).first().catch(()=>null)
   if(!m||!m.enabled||!m.company_enabled||!(await verifyPassword(b.pass,m.password_hash)))return json({error:'Usuário ou senha do Master da empresa inválidos'},401)
   const token='cm_'+crypto.randomUUID()+crypto.randomUUID(),exp=new Date(Date.now()+12*60*60*1000).toISOString()
   await env.DB.prepare('INSERT INTO company_master_sessions (token,company_id,username,expires_at) VALUES (?,?,?,?)').bind(token,company,user,exp).run()
   return json({token,role:'companymaster',companyId:company,companyName:m.name,username:user,expiresAt:exp})
  }
  if(url.pathname==='/api/login'&&req.method==='POST'){
   const b=await req.json().catch(()=>({})),tenant=cleanTenant(b.account)
   if(tenant==='principal'&&b.user===env.GEOFOTO_ADMIN_USER&&b.pass===env.GEOFOTO_ADMIN_PASS)
    return json({token:env.GEOFOTO_ADMIN_TOKEN,role:'admin',tenant:'principal',username:'admin',accountName:'Conta principal'})
   if(tenant==='principal'&&b.user===env.GEOFOTO_USER&&b.pass===env.GEOFOTO_PASS)
    return json({token:env.GEOFOTO_TOKEN,role:'user',tenant:'principal',username:'colaborador',accountName:'Conta principal'})
   const u=await env.DB.prepare('SELECT u.password_hash,u.role,u.enabled,t.name,t.enabled tenant_enabled FROM tenant_users u JOIN tenants t ON t.id=u.tenant_id WHERE u.tenant_id=? AND u.username=?').bind(tenant,String(b.user||'').trim()).first()
   if(!u||!u.enabled||!u.tenant_enabled||!(await verifyPassword(b.pass,u.password_hash)))return json({error:'Conta, usuário ou senha inválidos'},401)
   const token=crypto.randomUUID()+crypto.randomUUID(),exp=new Date(Date.now()+30*86400000).toISOString()
   const username=String(b.user||'').trim()
   await env.DB.prepare('INSERT INTO tenant_sessions (token,tenant_id,role,username,expires_at) VALUES (?,?,?,?,?)').bind(token,tenant,u.role,username,exp).run()
   return json({token,role:u.role,tenant,username,accountName:u.name})
  }
  if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(req)
  const s=await sessionOf(req,env)
  if(!s)return json({error:'Não autorizado'},401)
  const companyMasterResponse=await handleCompanyMasterRoutes(req,env,s,url);if(companyMasterResponse)return companyMasterResponse
  const platformMasterResponse=await handlePlatformMasterRoutes(req,env,s,url);if(platformMasterResponse)return platformMasterResponse
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
   const username=String(s.username||'')
   const refs=await env.DB.prepare("SELECT id,scope,name,size_bytes,owner_username,created_at FROM reference_kmz WHERE tenant_id=? AND (scope='company' OR (scope='personal' AND owner_username=?)) ORDER BY scope,created_at DESC").bind(s.tenant_id,username).all().catch(()=>({results:[]}))
   const referenceKmz=(refs.results||[]).map(r=>({...r,canDelete:r.scope==='company'?isAdmin(s):r.owner_username===username,fileUrl:'/api/reference-kmz/'+r.id+'/file'}))
   return json({id:s.tenant_id,name:t?.name||(s.tenant_id==='principal'?'Conta principal':s.tenant_id),role:s.role,username,referenceKmz})
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

  if(url.pathname==='/api/reference-kmz'&&req.method==='GET'){
   const username=String(s.username||'')
   const {results}=await env.DB.prepare("SELECT id,scope,name,size_bytes,owner_username,created_at FROM reference_kmz WHERE tenant_id=? AND (scope='company' OR (scope='personal' AND owner_username=?)) ORDER BY scope,created_at DESC").bind(s.tenant_id,username).all()
   return json((results||[]).map(r=>({...r,canDelete:r.scope==='company'?isAdmin(s):r.owner_username===username,fileUrl:'/api/reference-kmz/'+r.id+'/file'})))
  }
  if(url.pathname==='/api/reference-kmz'&&req.method==='POST'){
   const username=String(s.username||'')
   if(!username)return json({error:'Entre novamente no aplicativo para usar KMZ de referência.'},409)
   const form=await req.formData().catch(()=>null),file=form?.get('file')
   if(!file||typeof file.arrayBuffer!=='function')return json({error:'Selecione um arquivo KMZ.'},400)
   const name=String(file.name||'referencia.kmz').trim().slice(0,120)
   if(!name.toLowerCase().endsWith('.kmz'))return json({error:'Envie um arquivo com extensão .kmz.'},400)
   if(Number(file.size||0)>20*1024*1024)return json({error:'O KMZ deve ter no máximo 20 MB.'},413)
   const bytes=await file.arrayBuffer()
   try{
    const zip=await JSZip.loadAsync(bytes),entry=Object.values(zip.files).find(x=>!x.dir&&x.name.toLowerCase().endsWith('.kml'))
    if(!entry)return json({error:'KMZ inválido: arquivo KML interno não encontrado.'},400)
    const kml=await entry.async('string')
    if(kml.length>12*1024*1024||!/<kml[\s>]/i.test(kml))return json({error:'KMZ inválido ou complexo demais para visualização.'},400)
   }catch{return json({error:'Não foi possível abrir este KMZ.'},400)}
   const scope=isAdmin(s)?'company':'personal'
   const countRow=await env.DB.prepare("SELECT COUNT(*) n FROM reference_kmz WHERE tenant_id=? AND scope=? AND (?='company' OR owner_username=?)").bind(s.tenant_id,scope,scope,username).first()
   const count=Number(countRow?.n||0)
   if(scope==='company'&&count>=5)return json({error:'Limite de 5 KMZ compartilhados da empresa atingido.'},409)
   if(scope==='personal'&&count>=1){
    const old=await env.DB.prepare("SELECT id,object_key FROM reference_kmz WHERE tenant_id=? AND scope='personal' AND owner_username=? LIMIT 1").bind(s.tenant_id,username).first()
    if(old?.object_key)await env.PHOTOS.delete(old.object_key)
    if(old?.id)await env.DB.prepare('DELETE FROM reference_kmz WHERE id=? AND tenant_id=?').bind(old.id,s.tenant_id).run()
   }
   const id=crypto.randomUUID(),objectKey='tenants/'+s.tenant_id+'/reference-kmz/'+scope+'/'+id+'.kmz'
   await env.PHOTOS.put(objectKey,bytes,{httpMetadata:{contentType:'application/vnd.google-earth.kmz'}})
   await env.DB.prepare('INSERT INTO reference_kmz (id,tenant_id,owner_username,scope,name,size_bytes,object_key) VALUES (?,?,?,?,?,?,?)').bind(id,s.tenant_id,username,scope,name,Number(file.size||bytes.byteLength||0),objectKey).run()
   return json({ok:true,id,scope,name,size_bytes:Number(file.size||bytes.byteLength||0)},201)
  }
  if(/^\/api\/reference-kmz\/[^/]+\/file$/.test(url.pathname)&&req.method==='GET'){
   const id=decodeURIComponent(url.pathname.split('/')[3]),username=String(s.username||'')
   const row=await env.DB.prepare("SELECT object_key,scope,owner_username FROM reference_kmz WHERE id=? AND tenant_id=? AND (scope='company' OR owner_username=?)").bind(id,s.tenant_id,username).first()
   if(!row)return json({error:'KMZ não encontrado'},404)
   const obj=await env.PHOTOS.get(row.object_key);if(!obj)return json({error:'Arquivo KMZ não encontrado'},404)
   return new Response(obj.body,{headers:{'content-type':'application/vnd.google-earth.kmz','cache-control':'private, no-store','content-disposition':'inline'}})
  }
  if(/^\/api\/reference-kmz\/[^/]+$/.test(url.pathname)&&req.method==='DELETE'){
   const id=decodeURIComponent(url.pathname.split('/').pop()||''),username=String(s.username||'')
   const row=await env.DB.prepare('SELECT scope,owner_username,object_key FROM reference_kmz WHERE id=? AND tenant_id=?').bind(id,s.tenant_id).first()
   if(!row)return json({error:'KMZ não encontrado'},404)
   if(row.scope==='company'&&!isAdmin(s))return json({error:'Somente o administrador pode excluir KMZ da empresa.'},403)
   if(row.scope==='personal'&&row.owner_username!==username)return json({error:'Este KMZ pertence a outro usuário.'},403)
   if(row.object_key)await env.PHOTOS.delete(row.object_key)
   await env.DB.prepare('DELETE FROM reference_kmz WHERE id=? AND tenant_id=?').bind(id,s.tenant_id).run()
   return json({ok:true,id})
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


async function companyTenantAllowed(env,companyId,tenantId){
 const row=await env.DB.prepare('SELECT g.tenant_id,g.cluster_name,t.name,t.enabled FROM company_group_tenants g JOIN tenants t ON t.id=g.tenant_id WHERE g.company_id=? AND g.tenant_id=? AND g.enabled=1').bind(companyId,tenantId).first().catch(()=>null)
 return row||null
}
async function companyMasterUsers(env,tenantId){
 const {results}=await env.DB.prepare('SELECT username,role,enabled,created_at FROM tenant_users WHERE tenant_id=? ORDER BY role DESC,username').bind(tenantId).all()
 if(tenantId==='principal'&&!(results||[]).length){
  return [
   {username:String(env.GEOFOTO_ADMIN_USER||'admin'),role:'admin',enabled:1,created_at:null,managed:false,source:'principal'},
   {username:String(env.GEOFOTO_USER||'colaborador'),role:'user',enabled:1,created_at:null,managed:false,source:'principal'}
  ]
 }
 return (results||[]).map(x=>({...x,managed:true}))
}
async function handleCompanyMasterRoutes(req,env,s,url){
 if(!url.pathname.startsWith('/api/company-master/'))return null
 if(!s.company)return json({error:'Acesso exclusivo do Master da empresa'},403)
 const companyId=String(s.company_id||'')
 if(url.pathname==='/api/company-master/logout'&&req.method==='POST'){
  await env.DB.prepare('DELETE FROM company_master_sessions WHERE token=?').bind(bearer(req)||cookieToken(req)).run()
  return json({ok:true})
 }
 if(url.pathname==='/api/company-master/dashboard'&&req.method==='GET'){
  const company=await env.DB.prepare('SELECT id,name,enabled FROM company_groups WHERE id=?').bind(companyId).first()
  if(!company?.enabled)return json({error:'Master da empresa desativado'},403)
  const {results}=await env.DB.prepare(`SELECT g.tenant_id id,COALESCE(NULLIF(g.cluster_name,''),t.name) name,t.name account_name,t.enabled,
   CASE WHEN t.id='principal' AND (SELECT COUNT(*) FROM tenant_users u0 WHERE u0.tenant_id=t.id)=0 THEN 2 ELSE (SELECT COUNT(*) FROM tenant_users u WHERE u.tenant_id=t.id) END users,
   (SELECT COUNT(*) FROM points p WHERE p.tenant_id=t.id) points
   FROM company_group_tenants g JOIN tenants t ON t.id=g.tenant_id
   WHERE g.company_id=? AND g.enabled=1
   ORDER BY CASE WHEN t.id='principal' THEN 0 ELSE 1 END,COALESCE(NULLIF(g.cluster_name,''),t.name)`).bind(companyId).all()
  const clusters=results||[],totals=clusters.reduce((a,x)=>({clusters:a.clusters+1,users:a.users+Number(x.users||0),points:a.points+Number(x.points||0)}),{clusters:0,users:0,points:0})
  const recent=await env.DB.prepare(`SELECT p.id,p.name,p.technician,p.time,p.city,p.tenant_id,COALESCE(NULLIF(g.cluster_name,''),t.name) cluster
   FROM points p JOIN company_group_tenants g ON g.tenant_id=p.tenant_id JOIN tenants t ON t.id=p.tenant_id
   WHERE g.company_id=? AND g.enabled=1 ORDER BY p.time DESC LIMIT 12`).bind(companyId).all().catch(()=>({results:[]}))
  return json({company:{id:company.id,name:company.name},totals,clusters,recent:recent.results||[]})
 }

 if(url.pathname==='/api/company-master/clusters/create'&&req.method==='POST'){
  const b=await req.json().catch(()=>({})),name=String(b.name||'').trim().replace(/\s+/g,' ')
  if(name.length<2||name.length>80)return json({error:'Informe o nome da conta/cluster (2 a 80 caracteres).'},400)
  let tenantId=''
  for(let i=0;i<8;i++){const candidate=companySlug(name)+'-'+randomReadable(4).toLowerCase(),exists=await env.DB.prepare('SELECT id FROM tenants WHERE id=?').bind(candidate).first();if(!exists){tenantId=candidate;break}}
  if(!tenantId)return json({error:'Não foi possível gerar o código da conta.'},500)
  const adminPass='ADM-'+randomReadable(10),userPass='COL-'+randomReadable(10),recovery='GFKM-'+randomReadable(4)+'-'+randomReadable(4)+'-'+randomReadable(4),now=new Date().toISOString()
  await env.DB.batch([
   env.DB.prepare('INSERT INTO tenants (id,name,enabled) VALUES (?,?,1)').bind(tenantId,name),
   env.DB.prepare('INSERT INTO tenant_users (tenant_id,username,password_hash,role,enabled) VALUES (?,?,?,?,1)').bind(tenantId,'admin',await passwordHash(adminPass),'admin'),
   env.DB.prepare('INSERT INTO tenant_users (tenant_id,username,password_hash,role,enabled) VALUES (?,?,?,?,1)').bind(tenantId,'colaborador',await passwordHash(userPass),'user'),
   env.DB.prepare('INSERT INTO tenant_recovery (tenant_id,recovery_hash,created_at) VALUES (?,?,?)').bind(tenantId,await sha256(recovery),now),
   env.DB.prepare('INSERT INTO company_group_tenants (company_id,tenant_id,cluster_name,enabled) VALUES (?,?,?,1)').bind(companyId,tenantId,name)
  ])
  return json({ok:true,accountCode:tenantId,clusterName:name,admin:{user:'admin',password:adminPass},collaborator:{user:'colaborador',password:userPass},recoveryCode:recovery},201)
 }
 if(url.pathname==='/api/company-master/clusters/link'&&req.method==='POST'){
  const b=await req.json().catch(()=>({})),tenantId=cleanTenant(b.account),adminUser=String(b.user||'').trim(),pass=String(b.pass||''),clusterName=String(b.clusterName||'').trim()
  if(!tenantId||tenantId==='principal')return json({error:'Esta conta não pode ser vinculada por autoatendimento.'},400)
  const t=await env.DB.prepare('SELECT id,name,enabled FROM tenants WHERE id=?').bind(tenantId).first()
  if(!t||!t.enabled)return json({error:'Conta não encontrada ou desativada.'},404)
  const u=await env.DB.prepare('SELECT password_hash,role,enabled FROM tenant_users WHERE tenant_id=? AND username=?').bind(tenantId,adminUser).first()
  if(!u||!u.enabled||u.role!=='admin'||!(await verifyPassword(pass,u.password_hash)))return json({error:'Informe um administrador válido da conta que será vinculada.'},401)
  const linked=await env.DB.prepare('SELECT company_id FROM company_group_tenants WHERE tenant_id=? AND enabled=1 LIMIT 1').bind(tenantId).first()
  if(linked&&linked.company_id!==companyId)return json({error:'Esta conta já está vinculada a outra organização.'},409)
  const display=(clusterName||t.name).slice(0,100)
  await env.DB.prepare('INSERT INTO company_group_tenants (company_id,tenant_id,cluster_name,enabled) VALUES (?,?,?,1) ON CONFLICT(company_id,tenant_id) DO UPDATE SET cluster_name=excluded.cluster_name,enabled=1').bind(companyId,tenantId,display).run()
  return json({ok:true,tenantId,clusterName:display})
 }
 let m=url.pathname.match(/^\/api\/company-master\/clusters\/([^/]+)\/users$/)
 if(m&&req.method==='GET'){
  const tenantId=cleanTenant(decodeURIComponent(m[1])),allowed=await companyTenantAllowed(env,companyId,tenantId)
  if(!allowed)return json({error:'Cluster não vinculado à empresa'},403)
  return json({cluster:{id:tenantId,name:allowed.cluster_name||allowed.name},users:await companyMasterUsers(env,tenantId)})
 }
 if(m&&req.method==='POST'){
  const tenantId=cleanTenant(decodeURIComponent(m[1])),allowed=await companyTenantAllowed(env,companyId,tenantId)
  if(!allowed)return json({error:'Cluster não vinculado à empresa'},403)
  const b=await req.json().catch(()=>({})),user=String(b.user||'').trim(),pass=String(b.pass||''),role=b.role==='admin'?'admin':'user'
  if(user.length<3||pass.length<6)return json({error:'Usuário deve ter 3+ caracteres e senha 6+ caracteres'},400)
  await env.DB.prepare('INSERT INTO tenant_users (tenant_id,username,password_hash,role,enabled) VALUES (?,?,?,?,1) ON CONFLICT(tenant_id,username) DO UPDATE SET password_hash=excluded.password_hash,role=excluded.role,enabled=1').bind(tenantId,user,await passwordHash(pass),role).run()
  return json({ok:true,user,role},201)
 }
 m=url.pathname.match(/^\/api\/company-master\/clusters\/([^/]+)\/enter$/)
 if(m&&req.method==='POST'){
  const tenantId=cleanTenant(decodeURIComponent(m[1])),allowed=await companyTenantAllowed(env,companyId,tenantId)
  if(!allowed)return json({error:'Cluster não vinculado à empresa'},403)
  if(!allowed.enabled)return json({error:'Este cluster está desativado'},409)
  const accessToken=crypto.randomUUID()+crypto.randomUUID(),exp=new Date(Date.now()+12*60*60*1000).toISOString()
  await env.DB.prepare('INSERT INTO tenant_sessions (token,tenant_id,role,username,expires_at) VALUES (?,?,?,?,?)').bind(accessToken,tenantId,'admin','MASTER MULTIVALE',exp).run()
  return json({token:accessToken,role:'admin',tenant:tenantId,username:'MASTER MULTIVALE',accountName:allowed.cluster_name||allowed.name,masterCompany:companyId})
 }
 m=url.pathname.match(/^\/api\/company-master\/clusters\/([^/]+)\/users\/([^/]+)\/password$/)
 if(m&&req.method==='POST'){
  const tenantId=cleanTenant(decodeURIComponent(m[1])),user=decodeURIComponent(m[2]),allowed=await companyTenantAllowed(env,companyId,tenantId)
  if(!allowed)return json({error:'Cluster não vinculado à empresa'},403)
  const row=await env.DB.prepare('SELECT username FROM tenant_users WHERE tenant_id=? AND username=?').bind(tenantId,user).first()
  if(!row)return json({error:tenantId==='principal'?'O acesso principal é protegido e não pode ser alterado por esta tela.':'Usuário não encontrado'},404)
  const b=await req.json().catch(()=>({})),pass=String(b.pass||'')
  if(pass.length<6)return json({error:'A senha deve ter no mínimo 6 caracteres'},400)
  await env.DB.prepare('UPDATE tenant_users SET password_hash=?,enabled=1 WHERE tenant_id=? AND username=?').bind(await passwordHash(pass),tenantId,user).run()
  await env.DB.prepare('DELETE FROM tenant_sessions WHERE tenant_id=? AND username=?').bind(tenantId,user).run()
  return json({ok:true,user})
 }
 m=url.pathname.match(/^\/api\/company-master\/clusters\/([^/]+)\/users\/([^/]+)$/)
 if(m&&(req.method==='PATCH'||req.method==='DELETE')){
  const tenantId=cleanTenant(decodeURIComponent(m[1])),user=decodeURIComponent(m[2]),allowed=await companyTenantAllowed(env,companyId,tenantId)
  if(!allowed)return json({error:'Cluster não vinculado à empresa'},403)
  const row=await env.DB.prepare('SELECT username,role,enabled FROM tenant_users WHERE tenant_id=? AND username=?').bind(tenantId,user).first()
  if(!row)return json({error:tenantId==='principal'?'O acesso principal é protegido e não pode ser alterado por esta tela.':'Usuário não encontrado'},404)
  if(req.method==='DELETE'){
   await env.DB.prepare('DELETE FROM tenant_users WHERE tenant_id=? AND username=?').bind(tenantId,user).run()
   await env.DB.prepare('DELETE FROM tenant_sessions WHERE tenant_id=? AND username=?').bind(tenantId,user).run()
   return json({ok:true,user,historyPreserved:true})
  }
  const b=await req.json().catch(()=>({})),enabled=b.enabled===undefined?Number(row.enabled):(b.enabled?1:0),role=b.role?(b.role==='admin'?'admin':'user'):row.role
  await env.DB.prepare('UPDATE tenant_users SET enabled=?,role=? WHERE tenant_id=? AND username=?').bind(enabled,role,tenantId,user).run()
  if(!enabled)await env.DB.prepare('DELETE FROM tenant_sessions WHERE tenant_id=? AND username=?').bind(tenantId,user).run()
  return json({ok:true,user,enabled,role})
 }
 return json({error:'Rota Master da empresa não encontrada'},404)
}


async function platformMasterUsers(env,tenantId){
 const {results}=await env.DB.prepare('SELECT username,role,enabled,created_at FROM tenant_users WHERE tenant_id=? ORDER BY role DESC,username').bind(tenantId).all()
 if(tenantId==='principal'&&!(results||[]).length){
  return [
   {username:String(env.GEOFOTO_ADMIN_USER||'admin'),role:'admin',enabled:1,created_at:null,managed:false,source:'principal'},
   {username:String(env.GEOFOTO_USER||'colaborador'),role:'user',enabled:1,created_at:null,managed:false,source:'principal'}
  ]
 }
 return (results||[]).map(x=>({...x,managed:true}))
}
async function handlePlatformMasterRoutes(req,env,s,url){
 if(!url.pathname.startsWith('/api/master/'))return null
 if(!s.super)return null
 if(url.pathname==='/api/master/dashboard'&&req.method==='GET'){
  const {results}=await env.DB.prepare(`SELECT t.id,t.name,t.enabled,t.created_at,
   CASE WHEN t.id='principal' AND (SELECT COUNT(*) FROM tenant_users u0 WHERE u0.tenant_id=t.id)=0 THEN 2 ELSE (SELECT COUNT(*) FROM tenant_users u WHERE u.tenant_id=t.id) END users,
   (SELECT COUNT(*) FROM points p WHERE p.tenant_id=t.id) points,
   (SELECT group_concat(company_id,',') FROM company_group_tenants g WHERE g.tenant_id=t.id AND g.enabled=1) company_ids
   FROM tenants t ORDER BY CASE WHEN t.id='principal' THEN 0 ELSE 1 END,t.created_at DESC`).all()
  const companies=results||[],totals=companies.reduce((a,x)=>({accounts:a.accounts+1,users:a.users+Number(x.users||0),points:a.points+Number(x.points||0),active:a.active+(x.enabled?1:0)}),{accounts:0,users:0,points:0,active:0})
  return json({totals,companies})
 }
 let m=url.pathname.match(/^\/api\/master\/tenants\/([^/]+)\/users$/)
 if(m&&req.method==='GET'){
  const tenantId=cleanTenant(decodeURIComponent(m[1])),t=await env.DB.prepare('SELECT id,name,enabled FROM tenants WHERE id=?').bind(tenantId).first()
  if(!t)return json({error:'Conta não encontrada'},404)
  return json({tenant:t,users:await platformMasterUsers(env,tenantId)})
 }
 if(m&&req.method==='POST'){
  const tenantId=cleanTenant(decodeURIComponent(m[1])),t=await env.DB.prepare('SELECT id FROM tenants WHERE id=?').bind(tenantId).first()
  if(!t)return json({error:'Conta não encontrada'},404)
  const b=await req.json().catch(()=>({})),user=String(b.user||'').trim(),pass=String(b.pass||''),role=b.role==='admin'?'admin':'user'
  if(user.length<3||pass.length<6)return json({error:'Usuário deve ter 3+ caracteres e senha 6+ caracteres'},400)
  await env.DB.prepare('INSERT INTO tenant_users (tenant_id,username,password_hash,role,enabled) VALUES (?,?,?,?,1) ON CONFLICT(tenant_id,username) DO UPDATE SET password_hash=excluded.password_hash,role=excluded.role,enabled=1').bind(tenantId,user,await passwordHash(pass),role).run()
  return json({ok:true,user,role},201)
 }
 m=url.pathname.match(/^\/api\/master\/tenants\/([^/]+)\/enter$/)
 if(m&&req.method==='POST'){
  const tenantId=cleanTenant(decodeURIComponent(m[1])),t=await env.DB.prepare('SELECT id,name,enabled FROM tenants WHERE id=?').bind(tenantId).first()
  if(!t)return json({error:'Conta não encontrada'},404)
  if(!t.enabled)return json({error:'Esta conta está desativada'},409)
  const accessToken=crypto.randomUUID()+crypto.randomUUID(),exp=new Date(Date.now()+12*60*60*1000).toISOString()
  await env.DB.prepare('INSERT INTO tenant_sessions (token,tenant_id,role,username,expires_at) VALUES (?,?,?,?,?)').bind(accessToken,tenantId,'admin','MASTER DO APLICATIVO',exp).run()
  return json({token:accessToken,role:'admin',tenant:tenantId,username:'MASTER DO APLICATIVO',accountName:t.name,ownerMaster:true})
 }
 m=url.pathname.match(/^\/api\/master\/tenants\/([^/]+)\/link$/)
 if(m&&req.method==='POST'){
  const tenantId=cleanTenant(decodeURIComponent(m[1])),t=await env.DB.prepare('SELECT id,name FROM tenants WHERE id=?').bind(tenantId).first()
  if(!t)return json({error:'Conta não encontrada'},404)
  const b=await req.json().catch(()=>({})),companyId=String(b.companyId||'').trim().toLowerCase(),clusterName=String(b.clusterName||t.name).trim().slice(0,100)
  if(!companyId){
   await env.DB.prepare('DELETE FROM company_group_tenants WHERE tenant_id=?').bind(tenantId).run()
   return json({ok:true,tenantId,companyId:null})
  }
  const company=await env.DB.prepare('SELECT id FROM company_groups WHERE id=? AND enabled=1').bind(companyId).first()
  if(!company)return json({error:'Empresa Master não encontrada'},404)
  await env.DB.prepare('INSERT INTO company_group_tenants (company_id,tenant_id,cluster_name,enabled) VALUES (?,?,?,1) ON CONFLICT(company_id,tenant_id) DO UPDATE SET cluster_name=excluded.cluster_name,enabled=1').bind(companyId,tenantId,clusterName).run()
  return json({ok:true,tenantId,companyId,clusterName})
 }
 m=url.pathname.match(/^\/api\/master\/tenants\/([^/]+)\/status$/)
 if(m&&req.method==='PATCH'){
  const tenantId=cleanTenant(decodeURIComponent(m[1]))
  if(tenantId==='principal')return json({error:'A conta PRINCIPAL é protegida'},409)
  const t=await env.DB.prepare('SELECT id,name FROM tenants WHERE id=?').bind(tenantId).first();if(!t)return json({error:'Conta não encontrada'},404)
  const b=await req.json().catch(()=>({})),enabled=b.enabled?1:0
  await env.DB.prepare('UPDATE tenants SET enabled=? WHERE id=?').bind(enabled,tenantId).run()
  if(!enabled)await env.DB.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').bind(tenantId).run()
  return json({ok:true,id:tenantId,enabled})
 }
 m=url.pathname.match(/^\/api\/master\/tenants\/([^/]+)\/users\/([^/]+)\/password$/)
 if(m&&req.method==='POST'){
  const tenantId=cleanTenant(decodeURIComponent(m[1])),user=decodeURIComponent(m[2]),row=await env.DB.prepare('SELECT username FROM tenant_users WHERE tenant_id=? AND username=?').bind(tenantId,user).first()
  if(!row)return json({error:tenantId==='principal'?'O acesso principal é protegido e ainda usa credencial segura do ambiente.':'Usuário não encontrado'},404)
  const b=await req.json().catch(()=>({})),pass=String(b.pass||'');if(pass.length<6)return json({error:'A senha deve ter no mínimo 6 caracteres'},400)
  await env.DB.prepare('UPDATE tenant_users SET password_hash=?,enabled=1 WHERE tenant_id=? AND username=?').bind(await passwordHash(pass),tenantId,user).run()
  await env.DB.prepare('DELETE FROM tenant_sessions WHERE tenant_id=? AND username=?').bind(tenantId,user).run()
  return json({ok:true,user})
 }
 m=url.pathname.match(/^\/api\/master\/tenants\/([^/]+)\/users\/([^/]+)$/)
 if(m&&(req.method==='PATCH'||req.method==='DELETE')){
  const tenantId=cleanTenant(decodeURIComponent(m[1])),user=decodeURIComponent(m[2]),row=await env.DB.prepare('SELECT username,role,enabled FROM tenant_users WHERE tenant_id=? AND username=?').bind(tenantId,user).first()
  if(!row)return json({error:tenantId==='principal'?'O acesso principal é protegido e ainda usa credencial segura do ambiente.':'Usuário não encontrado'},404)
  if(req.method==='DELETE'){
   await env.DB.prepare('DELETE FROM tenant_users WHERE tenant_id=? AND username=?').bind(tenantId,user).run()
   await env.DB.prepare('DELETE FROM tenant_sessions WHERE tenant_id=? AND username=?').bind(tenantId,user).run()
   return json({ok:true,user,historyPreserved:true})
  }
  const b=await req.json().catch(()=>({})),enabled=b.enabled===undefined?Number(row.enabled):(b.enabled?1:0),role=b.role?(b.role==='admin'?'admin':'user'):row.role
  await env.DB.prepare('UPDATE tenant_users SET enabled=?,role=? WHERE tenant_id=? AND username=?').bind(enabled,role,tenantId,user).run()
  if(!enabled)await env.DB.prepare('DELETE FROM tenant_sessions WHERE tenant_id=? AND username=?').bind(tenantId,user).run()
  return json({ok:true,user,enabled,role})
 }
 return null
}
