/* Pilot's Tool — Service Worker v50 */

var CACHE_NAME = 'pilots-tool-v50';

var JSON_MODULE_NAMES = {
  'modules/aviation_sayings.json':                        'Авиационные цитаты',
  'modules/phonebook/data/phonebook.json':                'Телефонный справочник',
  'modules/faq/data/faq.json':                            'FAQ',
  'modules/checklists/data/checklists.json':              'Чеклисты',
  'modules/krs/data/krs.json':                            'Указания КРС',
  'modules/metbriefing/data/metbriefing.json':             'Метеобрифинг',
  'modules/rulesthumb/data/rules.json':                    'Rules of Thumb',
  'modules/flightprocedures/data/flightprocedures.json':   'Лётные процедуры',
  'modules/survey/data/survey.json':                       'Контрольный опрос',
  'modules/ffstraining/data/ffstraining.json':             'FFS Training',
  'modules/checkride/data/line.json':                      'Checkride LINE',
  'modules/checkride/data/ffs.json':                       'Checkride FFS',
  'modules/quiz/data/quiz-tests.json':                     'Quiz test1',
  'modules/quiz/data/test-line.json':                      'Quiz test2',
  'modules/quiz/data/test-comm.json':                      'Quiz test3',
  'modules/quiz/data/test-instructor.json':                'Quiz test4',
  'modules/quiz/data/tb_2024.json':                        'Quiz test5',
  'modules/quiz/data/afl-first_aid.json':                  'Quiz test6',
  'modules/quiz/data/kpk_meteorology.json':                'Quiz test7',
};

var STATIC_ASSETS = [
  // Корень
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  // Иконки
  './icons/favicon.ico',
  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/android-chrome-192.png',
  './icons/android-chrome-512.png',
  './icons/android-chrome-192-maskable.png',
  './icons/android-chrome-512-maskable.png',
  './icons.js',
  // Шрифты
  './fonts/Caveat-Bold.woff2',
  // Модули JS
  './modules/registry.js',
  './modules/worktime/index.js',
  './modules/metbriefing/index.js',
  './modules/checklists/index.js',
  './modules/krs/index.js',
  './modules/flightprocedures/index.js',
  './modules/rulesthumb/index.js',
  './modules/survey/index.js',
  './modules/ffstraining/index.js',
  './modules/checkride/index.js',
  './modules/quiz/index.js',
  './modules/phonebook/index.js',
  './modules/notes/index.js',
  './modules/faq/index.js',
  './modules/limitations/index.js',
  // Модули CSS (подгружаются динамически через registry.ensureCss)
  './modules/worktime/worktime.css',
  './modules/metbriefing/metbriefing.css',
  './modules/checklists/checklists.css',
  './modules/krs/krs.css',
  './modules/flightprocedures/flightprocedures.css',
  './modules/rulesthumb/rulesthumb.css',
  './modules/survey/survey.css',
  './modules/ffstraining/ffstraining.css',
  './modules/checkride/checkride.css',
  './modules/quiz/quiz.css',
  './modules/phonebook/phonebook.css',
  './modules/notes/notes.css',
  './modules/faq/faq.css',
  './modules/limitations/limitations.css',
  // JSON данных
  './modules/checklists/data/checklists.json',
  './modules/krs/data/krs.json',
  './modules/metbriefing/data/metbriefing.json',
  './modules/flightprocedures/data/flightprocedures.json',
  './modules/rulesthumb/data/rules.json',
  './modules/survey/data/survey.json',
  './modules/ffstraining/data/ffstraining.json',
  './modules/checkride/data/line.json',
  './modules/checkride/data/ffs.json',
  './modules/quiz/data/quiz-tests.json',
  './modules/quiz/data/test-comm.json',
  './modules/quiz/data/test-line.json',
  './modules/quiz/data/test-instructor.json',
  './modules/quiz/data/afl-first_aid.json',
  './modules/quiz/data/tb_2024.json',
  './modules/quiz/data/kpk_meteorology.json',
  './modules/phonebook/data/phonebook.json',
  './modules/faq/data/faq.json',
  './modules/aviation_sayings.json',
  // Документы
  './modules/docs/AOMA.pdf',
  './modules/docs/AOMB.pdf',
  // Медиа — flightprocedures
  './modules/flightprocedures/data/maneuvers_stall.html',
  './modules/flightprocedures/data/ext_walk1.png',
  './modules/flightprocedures/data/sop_after_loadsheet_clean.html',
  // Медиа — ffstraining
  './modules/ffstraining/data/tables/man_WS.html',
  './modules/ffstraining/data/B737_С7Тренинг.html',
  './modules/ffstraining/data/B737_Санкт-Петербург.html',
  './modules/ffstraining/data/B737_Ульяновск.html',
  // Медиа — krs
  './modules/krs/data/krs001.webp',
  './modules/krs/data/krs009_1.webp',
  './modules/krs/data/krs009_2.webp',
  './modules/krs/data/krs009_3.webp',
  './modules/krs/data/krs016.webp',
  './modules/krs/data/krs022_1.webp',
  './modules/krs/data/krs022_2.webp',
  './modules/krs/data/krs022_3.webp',
  './modules/krs/data/krs023_1.webp',
  './modules/krs/data/krs023_2.webp',
  './modules/krs/data/krs023_3.webp',
  './modules/krs/data/page027_1.pdf',
  './modules/krs/data/page027_2.pdf',
  './modules/krs/data/krs029.webp',
  './modules/krs/data/page039.pdf',
  './modules/krs/data/krs044.webp',
  // Медиа — quiz
  './modules/quiz/data/questions.txt',
  './modules/quiz/data/images/B737NG.jpg',
  './modules/quiz/data/images/boeing737.svg',
  './modules/quiz/data/images/evac-slide.svg',
  './modules/quiz/data/images/fragile.svg',
  './modules/quiz/data/images/papi.svg',
  './modules/quiz/data/images/tow-tractor.svg',
  // Библиотеки
  './libs/photoswipe/photoswipe.min.js',
  './libs/photoswipe/photoswipe-ui-default.min.js',
  './libs/photoswipe/photoswipe.css',
  './libs/photoswipe/default-skin/default-skin.css',
  './libs/photoswipe/default-skin/default-skin.png',
  './libs/photoswipe/default-skin/default-skin.svg',
  './libs/pdfjs/pdf.min.js',
  './libs/pdfjs/pdf.worker.min.js',
  // Фоновые изображения (responsive + webp, контракт SHELL_CONTRACT §7.3)
  './background-mobile.webp',
  './background-mobile.jpg',
  './background-desktop.webp',
  './background-desktop.jpg',
  // Скриншоты PWA (manifest.json screenshots)
  './screenshots/screenshot-mobile.png',
  './screenshots/screenshot-desktop.png'
];

/* Единый канал для всех сообщений SW → страница */
var progressChannel = new BroadcastChannel('sw-progress');

/* ── INSTALL — кэширование с прогрессом ── */
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      var cached = 0;
      var total = STATIC_ASSETS.length;

      var failed = 0;

      return Promise.allSettled(
        STATIC_ASSETS.map(function(url) {
          return cache.add(url)
            .then(function() {
              cached++;
            })
            .catch(function(err) {
              failed++;
              console.warn('SW: не удалось кэшировать:', url, err);
            })
            .finally(function() {
              progressChannel.postMessage({
                type: 'CACHE_PROGRESS',
                progress: (cached + failed) / total,
                cached: cached,
                total: total,
                failed: failed,
                url: url
              });
            });
        })
      ).then(function() {
        progressChannel.postMessage({ type: 'CACHE_DONE', failed: failed });
      });
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

/* ── ACTIVATE — очистка старого кэша ── */
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(keys) {
        return Promise.all(
          keys.filter(function(k) { return k !== CACHE_NAME; })
              .map(function(k) { return caches.delete(k); })
        );
      })
      .then(function() { return self.clients.claim(); })
  );
});

// Обработка SKIP_WAITING от кнопки «Обновить»
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ── FETCH — стратегии + детекция обновления JSON ── */
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // Не перехватывать внешние запросы
  if (url.origin !== self.location.origin) return;

  // ── JSON: Stale-While-Revalidate + детекция обновления ──
  if (url.pathname.endsWith('.json')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function(cache) {
        return cache.match(event.request).then(function(cached) {

          var networkFetch = fetch(event.request).then(function(response) {
            if (!response || response.status !== 200) return response;

            // Сравниваем текст ответа — надёжнее Content-Length и blob.size
            var newTextPromise = response.clone().text();

            if (!cached) {
              cache.put(event.request, response.clone());
              return response;
            }

            return newTextPromise.then(function(newText) {
              return cached.text().then(function(oldText) {
                cache.put(event.request, response.clone());
                if (newText !== oldText) {
                  var relPath = url.pathname.replace(/^\//, '');
                  var moduleName = JSON_MODULE_NAMES[relPath] || relPath;
                  progressChannel.postMessage({ type: 'JSON_UPDATED', module: moduleName });
                }
                return response;
              });
            });
          }).catch(function() { return null; });

          // Отдать кэш немедленно; фоновый запрос продолжается
          return cached || networkFetch;
        });
      })
    );
    return;
  }

  // ── Cache-First для всего остального ──
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, response.clone());
          });
        }
        return response;
      }).catch(function() {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response(null, { status: 204 });
      });
    })
  );
});
