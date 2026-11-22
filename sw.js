/* 우리 아이 색칠놀이 — 오프라인 서비스 워커
   - 설치 시 앱 껍데기(HTML·매니페스트·아이콘)를 통째로 캐시에 저장
   - 오프라인이거나 네트워크가 실패하면 캐시에서 100% 응답
   - 새 버전을 올리면 CACHE 이름만 올린다 */
const VERSION = 'v1';
const CACHE = 'coloring-book-' + VERSION;

const INDEX = new URL('./index.html', self.location.href).href;
const SHELL = [
  new URL('./', self.location.href).href,
  INDEX,
  new URL('./manifest.webmanifest', self.location.href).href,
  new URL('./icon-192.png', self.location.href).href,
  new URL('./icon-512.png', self.location.href).href
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) {
        // 개별 add 는 하나만 실패해도 전체가 실패하므로, 항목별로 담아 최대한 확보
        return Promise.all(SHELL.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          if (key !== CACHE) return caches.delete(key);
          return null;
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function putInCache(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  var copy = response.clone();
  caches.open(CACHE).then(function (cache) { cache.put(request, copy); }).catch(function () {});
}

function fromCacheOrIndex(request) {
  // ?v=2 같은 쿼리가 붙어도 같은 파일을 찾도록 ignoreSearch 사용
  return caches.match(request, { ignoreSearch: true })
    .then(function (hit) { return hit || caches.match(INDEX, { ignoreSearch: true }); })
    .then(function (hit) { return hit || caches.match(SHELL[0], { ignoreSearch: true }); })
    .then(function (hit) {
      if (hit) return hit;
      throw new Error('offline and not cached');
    });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 페이지 이동(홈 화면에서 앱 열기, 새로고침): 네트워크 우선 → 실패하면 캐시
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          putInCache(INDEX, response);   // 최신 HTML 을 index.html 자리에 저장
          putInCache(request, response);
          return response;
        })
        .catch(function () { return fromCacheOrIndex(request); })
    );
    return;
  }

  // 그 밖의 같은 출처 GET(아이콘·매니페스트 등): 캐시 우선, 뒤에서 조용히 갱신
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(function (hit) {
      if (hit) {
        fetch(request).then(function (response) { putInCache(request, response); }).catch(function () {});
        return hit;
      }
      return fetch(request)
        .then(function (response) {
          putInCache(request, response);
          return response;
        })
        .catch(function () { return fromCacheOrIndex(request); });
    })
  );
});
