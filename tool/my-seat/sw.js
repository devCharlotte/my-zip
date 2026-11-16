const CACHE='my-seat-v3';
const FONT='https://fastly.jsdelivr.net/gh/projectnoonnu/2408-5@1.0/HakgyoansimNadeuriTTF-B.woff2';
const ASSETS=['./','./index.html','../../shared.css','./style.css','./js/app.js','./js/sun.js','./js/geometry.js','./js/recommendation.js','./data/routes.js','./manifest.webmanifest','./assets/icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS).then(()=>c.add(FONT).catch(()=>{}))).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method==='GET'&&e.request.url===FONT){e.respondWith(caches.match(FONT).then(hit=>hit||fetch(e.request)));return;}
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return r;}).catch(()=>caches.match(e.request,{ignoreSearch:true})));
});
