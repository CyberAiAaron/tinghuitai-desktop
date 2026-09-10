// Cache only the application shell, never sessions, credentials or API responses.
const CACHE='tinghuitai-desktop-v65';
const ASSETS=['./','./index.html','./recording-safety.js?v=1','./work.html','./work.js?v=6','./work-style.css?v=5','./theme.css?v=2','./manifest.json','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('tinghuitai-desktop-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||!u.pathname.startsWith('/tinghuitai/')||u.searchParams.has('token')||!/\/(?:index\.html|work\.html|work\.js|work-style\.css|theme\.css|recording-safety\.js|manifest\.json|icon-(?:192|512)\.png)?$/.test(u.pathname))return;e.respondWith(fetch(e.request,{cache:'no-cache'}).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return r;}).catch(()=>caches.match(e.request,{ignoreSearch:true})));});
