const CACHE='geofoto-kmz-v31';
const CORE=['/','/manifest.webmanifest'];
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
 caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),
 self.clients.claim()
])));
self.addEventListener('fetch',e=>{
 const req=e.request;if(req.method!=='GET')return;
 const u=new URL(req.url);
 if(u.origin!==location.origin)return;
 if(u.pathname==='/version.json'){e.respondWith(fetch(req,{cache:'no-store'}));return}
 if(u.pathname.startsWith('/api/tile/')){e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok)caches.open(CACHE).then(c=>c.put(req,r.clone()));return r})));return}
 if(u.pathname.startsWith('/api/'))return;
 if(req.mode==='navigate'){e.respondWith(fetch(req).then(r=>{if(r.ok)caches.open(CACHE).then(c=>c.put('/',r.clone()));return r}).catch(()=>caches.match('/')));return}
 e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok)caches.open(CACHE).then(c=>c.put(req,r.clone()));return r})))
});