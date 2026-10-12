const CACHE='geofoto-kmz-v57';
const MAP_CACHE='geofoto-offline-map-tiles-v1';
const CORE=['/','/manifest.webmanifest','/map-marker.png','/navegacao/index.html','/navegacao/style.css','/navegacao/app.js','/navegacao/vendor/leaflet/leaflet.css','/navegacao/vendor/leaflet/leaflet.js','/navegacao/vendor/jszip.min.js','/navegacao/vendor/pmtiles.js','/navegacao/vendor/protomaps-leaflet.js'];
self.addEventListener('install',e=>e.waitUntil((async()=>{
 const c=await caches.open(CACHE);
 await Promise.all(CORE.map(u=>c.add(u).catch(()=>{})));
 try{
  const r=await fetch('/',{cache:'no-store'}),html=await r.text();
  const urls=[...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m=>m[1]).filter(u=>u.startsWith('/')&&!u.startsWith('/api/'));
  await Promise.all([...new Set(urls)].map(u=>c.add(u).catch(()=>{})))
 }catch{}
})()));
self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([
 caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('geofoto-kmz-')&&k!==CACHE).map(k=>caches.delete(k)))),
 self.clients.claim()
])));
self.addEventListener('fetch',e=>{
 const req=e.request;if(req.method!=='GET')return;
 const u=new URL(req.url);
 if(u.origin!==location.origin)return;
 if(u.pathname==='/version.json'){e.respondWith(fetch(req,{cache:'no-store'}));return}
 if(u.pathname.startsWith('/api/tile/')){
  e.respondWith((async()=>{
   const c=await caches.open(MAP_CACHE),hit=await c.match(req);
   if(hit)return hit;
   try{
    const r=await fetch(req);
    if(r.ok)c.put(req,r.clone());
    return r
   }catch{
    return hit||new Response('',{status:504,statusText:'Mapa offline indisponível'})
   }
  })());return
 }
 if(u.pathname.startsWith('/api/'))return;
 if(req.mode==='navigate'){
  const key=u.pathname.startsWith('/navegacao/')?'/navegacao/index.html':'/';
  e.respondWith(fetch(req).then(r=>{if(r.ok)caches.open(CACHE).then(c=>c.put(key,r.clone()));return r}).catch(()=>caches.match(key).then(hit=>hit||caches.match('/'))));return
 }
 e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok)caches.open(CACHE).then(c=>c.put(req,r.clone()));return r})))
});
