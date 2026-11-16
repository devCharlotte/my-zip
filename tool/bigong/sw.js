const CACHE="bigong-v9";
const FONT="https://fastly.jsdelivr.net/gh/projectnoonnu/2408-5@1.0/HakgyoansimNadeuriTTF-B.woff2";
const ASSETS=["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./icon.svg","./landmask.bin"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS).then(()=>c.add(FONT).catch(()=>{})))));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  if(e.request.url===FONT){e.respondWith(caches.match(FONT).then(hit=>hit||fetch(e.request)));return;}
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin)return;
  e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(res=>{
    const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return res;
  }).catch(()=>e.request.mode==="navigate"?caches.match("./index.html"):Response.error())));
});
