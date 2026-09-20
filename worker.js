const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=UTF-8'}})
const cleanTenant=v=>String(v||'principal').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,50)||'principal'
const bearer=req=>{const a=req.headers.get('Authorization')||'';return a.startsWith('Bearer ')?a.slice(7):''}
async function sha256(v){
  const bytes=new TextEncoder().encode(String(v||''))
  const hash=await crypto.subtle.digest('SHA-256',bytes)
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')
}
async function sessionOf(req,env){
  const token=bearer(req); if(!token)return null
  if(token===env.GEOFOTO_ADMIN_TOKEN)return{tenant_id:'principal',role:'admin',super:true,legacy:true}
  if(token===env.GEOFOTO_TOKEN)return{tenant_id:'principal',role:'user',super:false,legacy:true}
  const now=new Date().toISOString()
  const row=await env.DB.prepare('SELECT tenant_id,role,expires_at FROM tenant_sessions WHERE token=? AND expires_at>?').bind(token,now).first()
  return row?{tenant_id:row.tenant_id,role:row.role,super:false,legacy:false}:null
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
  if(url.pathname==='/api/login'&&req.method==='POST'){
   const b=await req.json().catch(()=>({})),tenant=cleanTenant(b.account)
   if(tenant==='principal'&&b.user===env.GEOFOTO_ADMIN_USER&&b.pass===env.GEOFOTO_ADMIN_PASS)
    return json({token:env.GEOFOTO_ADMIN_TOKEN,role:'admin',tenant:'principal',accountName:'Conta principal'})
   if(tenant==='principal'&&b.user===env.GEOFOTO_USER&&b.pass===env.GEOFOTO_PASS)
    return json({token:env.GEOFOTO_TOKEN,role:'user',tenant:'principal',accountName:'Conta principal'})
   const u=await env.DB.prepare('SELECT u.password_hash,u.role,u.enabled,t.name,t.enabled tenant_enabled FROM tenant_users u JOIN tenants t ON t.id=u.tenant_id WHERE u.tenant_id=? AND u.username=?').bind(tenant,String(b.user||'').trim()).first()
   if(!u||!u.enabled||!u.tenant_enabled||u.password_hash!==await sha256(b.pass))return json({error:'Conta, usuário ou senha inválidos'},401)
   const token=crypto.randomUUID()+crypto.randomUUID(),exp=new Date(Date.now()+30*86400000).toISOString()
   await env.DB.prepare('INSERT INTO tenant_sessions (token,tenant_id,role,expires_at) VALUES (?,?,?,?)').bind(token,tenant,u.role,exp).run()
   return json({token,role:u.role,tenant,accountName:u.name})
  }
  if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(req)
  const s=await sessionOf(req,env)
  if(!s)return json({error:'Não autorizado'},401)

  if(url.pathname==='/api/account'&&req.method==='GET'){
   const t=await env.DB.prepare('SELECT name FROM tenants WHERE id=?').bind(s.tenant_id).first().catch(()=>null)
   return json({id:s.tenant_id,name:t?.name||(s.tenant_id==='principal'?'Conta principal':s.tenant_id),role:s.role})
  }
  if(url.pathname==='/api/points'&&req.method==='GET'){
   const {results}=await env.DB.prepare('SELECT id,name,note,lat,lng,accuracy,time,city,address,photo_key FROM points WHERE tenant_id=? ORDER BY time ASC').bind(s.tenant_id).all()
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
   const h=await sha256(pass)
   await env.DB.prepare('INSERT INTO tenant_users (tenant_id,username,password_hash,role,enabled) VALUES (?,?,?,?,1) ON CONFLICT(tenant_id,username) DO UPDATE SET password_hash=excluded.password_hash,role=excluded.role,enabled=1').bind(s.tenant_id,user,h,role).run()
   return json({ok:true,user,role},201)
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
   await env.DB.prepare('INSERT INTO tenant_users (tenant_id,username,password_hash,role,enabled) VALUES (?,?,?,?,1)').bind(id,user,await sha256(pass),'admin').run()
   return json({ok:true,id,name,admin:user},201)
  }
  return json({error:'Rota não encontrada'},404)
 }
}
async function savePoint(req,env,s){
 const p=await req.json().catch(()=>({}))
 if(typeof p.lat!=='number'||typeof p.lng!=='number')return json({error:'Coordenadas inválidas'},400)
 const id=p.id||crypto.randomUUID();let photoKey=''
 if(typeof p.photo==='string'&&p.photo.startsWith('data:image/')){
  const [meta,b64]=p.photo.split(','),type=(meta.match(/data:(.*?);/)||[])[1]||'image/jpeg'
  const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0))
  photoKey='tenants/'+s.tenant_id+'/photos/'+id+'.jpg'
  await env.PHOTOS.put(photoKey,bytes,{httpMetadata:{contentType:type}})
 }
 await env.DB.prepare("INSERT INTO points (id,name,note,lat,lng,accuracy,time,city,address,photo_key,tenant_id) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,note=excluded.note,lat=excluded.lat,lng=excluded.lng,accuracy=excluded.accuracy,time=excluded.time,city=excluded.city,address=excluded.address,photo_key=CASE WHEN excluded.photo_key<>'' THEN excluded.photo_key ELSE points.photo_key END WHERE points.tenant_id=excluded.tenant_id")
  .bind(id,String(p.name||'Ponto'),String(p.note||''),p.lat,p.lng,Number(p.accuracy||0),p.time||new Date().toISOString(),String(p.city||''),String(p.address||''),photoKey,s.tenant_id).run()
 return json({id,name:p.name||'Ponto',note:p.note||'',lat:p.lat,lng:p.lng,accuracy:p.accuracy||0,time:p.time||new Date().toISOString(),city:p.city||'',address:p.address||'',photoUrl:photoKey?'/api/photo/'+id:''},201)
}
async function getPhoto(url,env,s){
 const id=url.pathname.split('/').pop()
 const row=await env.DB.prepare('SELECT photo_key FROM points WHERE id=? AND tenant_id=?').bind(id,s.tenant_id).first()
 if(!row?.photo_key)return new Response('Não encontrada',{status:404})
 const obj=await env.PHOTOS.get(row.photo_key)
 if(!obj)return new Response('Não encontrada',{status:404})
 return new Response(obj.body,{headers:{'content-type':obj.httpMetadata?.contentType||'image/jpeg','cache-control':'private, max-age=3600'}})
}
