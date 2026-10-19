/* 旅宴ゲーム：一度ひらいたらネットがなくても動くようにする */
const CACHE = 'tabiutage-v4';
const FILES = ['./', 'index.html', 'quiz.html', 'mission.html', 'oekaki.html', 'beer.html', 'hayaate.html', 'mqtt.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* 保存してある版をすぐ返し、裏で最新に更新する（電波が弱くても待たされない） */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => {
    const net = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => hit || caches.match('index.html'));
    return hit || net;
  }));
});
