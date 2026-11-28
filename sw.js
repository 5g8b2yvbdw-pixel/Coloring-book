/* 우리 아이 색칠놀이 — 오프라인 서비스 워커
   - 설치 시 앱 껍데기(HTML·매니페스트·아이콘)를 통째로 캐시에 저장
   - 페이지 열기: 네트워크 우선이되 3초 안에 안 되면 캐시로 즉시 열고, 네트워크는 뒤에서 마저 받아 둔다
   - 그 밖의 파일: 캐시 우선 + 뒤에서 조용히 갱신 → 오프라인에서도 100% 열림
   - 새 버전을 올리면 CACHE 이름만 올린다 */
const VERSION = 'v9';
const CACHE = 'coloring-book-' + VERSION;
const NAV_TIMEOUT = 3000;

const ROOT = new URL('./', self.location.href).href;
const INDEX = new URL('./index.html', self.location.href).href;
const SHELL = [
  ROOT,
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
      // 예전 버전이 ?v=4 같은 쿼리 열쇠로 남긴 사본을 지운다(오래된 HTML 이 끼어들지 않도록)
      .then(function () { return caches.open(CACHE); })
      .then(function (cache) {
        return cache.keys().then(function (requests) {
          return Promise.all(requests.map(function (request) {
            var url = new URL(request.url);
            return (url.search || url.hash) ? cache.delete(request) : null;
          }));
        });
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* 쿼리(?v=2 등)는 캐시 열쇠에서 떼어 같은 파일이 여러 벌 쌓이지 않게 한다 */
function keyFor(request) {
  var url = new URL(typeof request === 'string' ? request : request.url);
  url.search = '';
  url.hash = '';
  return url.href;
}

function putInCache(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  var key = keyFor(request);
  var copy = response.clone();
  caches.open(CACHE).then(function (cache) { cache.put(key, copy); }).catch(function () {});
}

function fromCacheOrIndex(request) {
  // ?v=2 같은 쿼리가 붙어도 같은 파일을 찾도록 ignoreSearch 사용
  return caches.match(request, { ignoreSearch: true })
    .then(function (hit) { return hit || caches.match(INDEX, { ignoreSearch: true }); })
    .then(function (hit) { return hit || caches.match(ROOT, { ignoreSearch: true }); })
    .then(function (hit) {
      if (hit) return hit;
      throw new Error('offline and not cached');
    });
}

/* 페이지 열기: 네트워크 우선, NAV_TIMEOUT 넘으면 캐시로 먼저 열어 준다.
   네트워크 응답은 도착하는 대로 캐시에 저장해 두고, 캐시도 없으면 네트워크를 끝까지 기다린다. */
function navigationResponse(request) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = null;

    function finish(response) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(response);
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    }

    fetch(request).then(function (response) {
      putInCache(INDEX, response.clone());   // 최신 HTML 을 index.html 자리에 저장
      putInCache(request, response.clone());
      finish(response);
    }).catch(function (error) {
      // 네트워크 실패 → 캐시가 있으면 캐시, 없으면 오류
      fromCacheOrIndex(request).then(finish, function () { fail(error); });
    });

    timer = setTimeout(function () {
      fromCacheOrIndex(request).then(function (hit) {
        finish(hit);   // 느린 네트워크는 기다리지 않고 캐시로 연다(응답은 위에서 계속 저장됨)
      }).catch(function () { /* 캐시가 없으면 네트워크를 계속 기다린다 */ });
    }, NAV_TIMEOUT);
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
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
