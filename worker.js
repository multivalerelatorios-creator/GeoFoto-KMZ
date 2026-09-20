const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=UTF-8'}})
const roleOf=(req,env)=>{const a=req.headers.get('Authorization');if(a===`Bearer ${env.GEOFOTO_ADMIN_TOKEN}`)return 'admin';if(a===`Bearer ${env.GEOFOTO_TOKEN}`)return 'user';return ''}
const auth=(req,env)=>!!roleOf(req,env)
const admin=(req,env)=>roleOf(req,env)==='admin'

export default {
  async fetch(req,env){
    const url=new URL(req.url)
    if(url.pathname==='/api/health') return json({ok:true,service:'GeoFoto KMZ Cloud'})
    if(url.pathname.startsWith('/api/tile/')&&req.method==='GET'){
      const m=url.pathname.match(/^\/api\/tile\/(\d+)\/(\d+)\/(\d+)\.png$/);
      if(!m) return new Response('Tile invalido',{status:400});
      const z=Number(m[1]),x=Number(m[2]),y=Number(m[3]);
      if(!Number.isInteger(z)||z<0||z>19||!Number.isInteger(x)||!Number.isInteger(y)) return new Response('Tile invalido',{status:400});
      const src='https://tile.openstreetmap.org/'+z+'/'+x+'/'+y+'.png';
      const rr=await fetch(src,{headers:{'User-Agent':'GeoFoto-KMZ/1.1 (field mapping app)'}});
      if(!rr.ok) return new Response('Tile indisponivel',{status:rr.status});
      return new Response(rr.body,{headers:{'content-type':'image/png','cache-control':'public, max-age=86400'}});
    }
    if(url.pathname==='/api/login'&&req.method==='POST'){
      const b=await req.json().catch(()=>({}))
      if(b.user===env.GEOFOTO_ADMIN_USER&&b.pass===env.GEOFOTO_ADMIN_PASS) return json({token:env.GEOFOTO_ADMIN_TOKEN,role:'admin'})
      if(b.user===env.GEOFOTO_USER&&b.pass===env.GEOFOTO_PASS) return json({token:env.GEOFOTO_TOKEN,role:'user'})
      return json({error:'Usuário ou senha inválidos'},401)
    }
    if(url.pathname.startsWith('/api/')&&!auth(req,env)) return json({error:'Não autorizado'},401)
    if(url.pathname==='/api/points'&&req.method==='GET'){
      const {results}=await env.DB.prepare('SELECT id,name,note,lat,lng,accuracy,time,city,address,photo_key FROM points ORDER BY time ASC').all()
      return json(results.map(p=>({...p,photoUrl:p.photo_key?`/api/photo/${p.id}`:''})))
    }
    if(url.pathname==='/api/points'&&req.method==='POST') return savePoint(req,env)
    if(url.pathname.startsWith('/api/photo/')&&req.method==='GET') return getPhoto(url,env)
    if(url.pathname==='/api/config'&&req.method==='GET'){
      const row=await env.DB.prepare('SELECT data FROM app_config WHERE id=1').first();
      return json(JSON.parse(row?.data||'{}'))
    }
    if(url.pathname==='/api/config'&&req.method==='POST'){
      if(!admin(req,env)) return json({error:'Acesso exclusivo do administrador'},403)
      const b=await req.json().catch(()=>({})); await env.DB.prepare('INSERT INTO app_config (id,data) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(JSON.stringify(b)).run(); return json(b)
    }
    if(url.pathname.startsWith('/api/points/')&&req.method==='DELETE'){
      if(!admin(req,env)) return json({error:'Acesso exclusivo do administrador'},403)
      const id=url.pathname.split('/').pop(),row=await env.DB.prepare('SELECT photo_key FROM points WHERE id=?').bind(id).first();
      if(row?.photo_key) await env.PHOTOS.delete(row.photo_key); await env.DB.prepare('DELETE FROM points WHERE id=?').bind(id).run(); return json({ok:true,id})
    }
    if(url.pathname==='/api/points'&&req.method==='DELETE'){
      if(!admin(req,env)) return json({error:'Acesso exclusivo do administrador'},403)
      const {results}=await env.DB.prepare('SELECT photo_key FROM points WHERE photo_key<>\'\'').all(); for(const r of results) await env.PHOTOS.delete(r.photo_key); await env.DB.prepare('DELETE FROM points').run(); return json({ok:true})
    }
    return env.ASSETS.fetch(req)
  }
}
async function savePoint(req,env){
  const p=await req.json().catch(()=>({}))
  if(typeof p.lat!=='number'||typeof p.lng!=='number') return json({error:'Coordenadas inválidas'},400)
  const id=p.id||crypto.randomUUID(); let photoKey=''
  if(typeof p.photo==='string'&&p.photo.startsWith('data:image/')){
    const [meta,b64]=p.photo.split(','); const type=(meta.match(/data:(.*?);/)||[])[1]||'image/jpeg'
    const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)); photoKey=`photos/${id}.jpg`
    await env.PHOTOS.put(photoKey,bytes,{httpMetadata:{contentType:type}})
  }
  await env.DB.prepare('INSERT INTO points (id,name,note,lat,lng,accuracy,time,city,address,photo_key) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(id,String(p.name||'Ponto'),String(p.note||''),p.lat,p.lng,Number(p.accuracy||0),p.time||new Date().toISOString(),String(p.city||''),String(p.address||''),photoKey).run()
  return json({id,name:p.name||'Ponto',note:p.note||'',lat:p.lat,lng:p.lng,accuracy:p.accuracy||0,time:p.time||new Date().toISOString(),city:p.city||'',address:p.address||'',photoUrl:photoKey?`/api/photo/${id}`:''},201)
}
async function getPhoto(url,env){
  const id=url.pathname.split('/').pop(); const row=await env.DB.prepare('SELECT photo_key FROM points WHERE id=?').bind(id).first()
  if(!row?.photo_key) return new Response('Não encontrada',{status:404})
  const obj=await env.PHOTOS.get(row.photo_key); if(!obj) return new Response('Não encontrada',{status:404})
  return new Response(obj.body,{headers:{'content-type':obj.httpMetadata?.contentType||'image/jpeg','cache-control':'private, max-age=3600'}})
}