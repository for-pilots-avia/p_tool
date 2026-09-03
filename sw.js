/* Pilot's Tool — Service Worker v59 */

var CACHE_NAME = 'pilots-tool-v59';

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
  'modules/limitations/data/limitations.json':              'Limitations',
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
  './modules/limitations/data/limitations.json',
  // Документы
  './modules/docs/AOMA.pdf',
  './modules/docs/AOMB.pdf',
  // Медиа — flightprocedures
  './modules/flightprocedures/data/maneuvers_stall.html',
  './modules/flightprocedures/data/ext_walk1.png',
  './modules/flightprocedures/data/sop_after_loadsheet_clean.html',
  // Медиа — ffstraining
  './modules/ffstraining/data/ext_walk1.png',
  './modules/ffstraining/data/tables/man_WS.html',
  './modules/ffstraining/data/B737_С7Тренинг.html',
  './modules/ffstraining/data/B737_Санкт-Петербург.html',
  './modules/ffstraining/data/B737_Ульяновск.html',
  // Медиа — ffstraining (таблицы)
  './modules/ffstraining/data/tables/br_C-1.html',
  './modules/ffstraining/data/tables/br_C-2.html',
  './modules/ffstraining/data/tables/br_C-3.html',
  './modules/ffstraining/data/tables/br_C-4.html',
  './modules/ffstraining/data/tables/br_R-6.html',
  './modules/ffstraining/data/tables/br_R-7.html',
  './modules/ffstraining/data/tables/br_R-8.html',
  './modules/ffstraining/data/tables/perf_C2.html',
  './modules/ffstraining/data/tables/perf_R2.html',
  // Медиа — ffstraining (снимки экранов)
  './modules/ffstraining/data/AER_02_ILS.jpg',
  './modules/ffstraining/data/AER_02_ILS_L.jpg',
  './modules/ffstraining/data/AER_02_RNPY.jpg',
  './modules/ffstraining/data/AER_02_RNPY_L.jpg',
  './modules/ffstraining/data/AER_ALT.jpg',
  './modules/ffstraining/data/AER_IRGIT1C.jpg',
  './modules/ffstraining/data/SVO_24C_ILS.jpg',
  './modules/ffstraining/data/SVO_24C_ILS_L.jpg',
  './modules/ffstraining/data/SVO_EMGAS3H.jpg',
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
  './modules/krs/data/krs055.webp',
  './modules/krs/data/krs061_1.webp',
  './modules/krs/data/krs061_2.webp',
  './modules/krs/data/krs061_3.webp',
  './modules/krs/data/krs060.pdf',
  './modules/krs/data/krs058_1.webp',
  './modules/krs/data/krs058_2.webp',
  './modules/krs/data/krs058_3.webp',
  './modules/krs/data/krs058_4.webp',
  './modules/krs/data/krs058_5.webp',
  './modules/krs/data/krs058_6.webp',
  './modules/krs/data/krs058_1.pdf',
  './modules/krs/data/krs058_2.pdf',
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

/* ─── F5: Versions table (feature-05-offline-versions.md, Вариант 1) ───
   Хранится в localStorage['swVersionsTable'] = { file: { lastChecked, changed, prevHash, currHash } }
   Обновляется при JSON_UPDATED dispatch + при hash-сравнении docs/*.pdf
   UI читает эту таблицу через app.updateOfflineVersionsUI() */
var VERSIONS_CACHE_KEY = 'swVersionsTable';

function updateVersionsTable(file, changed, hash) {
  try {
    var raw = localStorage.getItem(VERSIONS_CACHE_KEY);
    var table = raw ? JSON.parse(raw) : {};
    var prevHash = table[file] ? table[file].currHash : null;
    table[file] = {
      lastChecked: Date.now(),
      changed: changed,
      prevHash: prevHash,
      currHash: hash || (table[file] ? table[file].currHash : null)
    };
    localStorage.setItem(VERSIONS_CACHE_KEY, JSON.stringify(table));
  } catch (e) {
    console.warn('[sw] updateVersionsTable failed', e);
  }
}

/* ── INSTALL — кэширование с прогрессом по РАЗМЕРУ файлов ── */
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      var total = STATIC_ASSETS.length;
      var cached = 0;
      var failed = 0;

      // Фаза 1: получить Content-Length всех файлов (HEAD запросы)
      // Для файлов без Content-Length — размер 0 (не влияет на прогресс)
      return Promise.all(
        STATIC_ASSETS.map(function(url) {
          return fetch(url, { method: 'HEAD' })
            .then(function(resp) {
              var len = parseInt(resp.headers.get('Content-Length'), 10);
              return { url: url, size: (len > 0) ? len : 0 };
            })
            .catch(function() {
              return { url: url, size: 0 };
            });
        })
      ).then(function(fileInfos) {
        // Вычислить totalSize (сумма всех известных размеров)
        var totalSize = 0;
        var knownFiles = 0;
        fileInfos.forEach(function(info) {
          totalSize += info.size;
          if (info.size > 0) knownFiles++;
        });

        // Если ни один файл не вернул Content-Length — fallback на count-based
        if (totalSize === 0) {
          return Promise.allSettled(
            STATIC_ASSETS.map(function(url) {
              return cache.add(url)
                .then(function() { cached++; })
                .catch(function(err) {
                  failed++;
                  console.warn('SW: не удалось кэшировать:', url, err);
                })
                .finally(function() {
                  progressChannel.postMessage({
                    type: 'CACHE_PROGRESS',
                    progress: (cached + failed) / total,
                    cached: cached, total: total, failed: failed,
                    url: url
                  });
                });
            })
          ).then(function() {
            progressChannel.postMessage({ type: 'CACHE_DONE', failed: failed });
          });
        }

        // Фаза 2: загрузка с отслеживанием progress по размеру
        var loadedSize = 0;
        var sizeMap = {};
        fileInfos.forEach(function(info) { sizeMap[info.url] = info.size; });

        return Promise.allSettled(
          STATIC_ASSETS.map(function(url) {
            var fileSize = sizeMap[url] || 0;

            return fetch(url)
              .then(function(response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);

                // Клонировать response для чтения тела (оригинал — для cache.put)
                var reader = response.clone().body.getReader();
                var bytesRead = 0;

                function readChunk() {
                  return reader.read().then(function(chunk) {
                    if (chunk.done) {
                      // Файл полностью загружен — обновить прогресс
                      loadedSize += fileSize;
                      cached++;
                      progressChannel.postMessage({
                        type: 'CACHE_PROGRESS',
                        progress: totalSize > 0 ? loadedSize / totalSize : (cached + failed) / total,
                        cached: cached, total: total, failed: failed,
                        url: url,
                        loadedSize: loadedSize,
                        totalSize: totalSize
                      });
                      return;
                    }
                    bytesRead += chunk.value.length;
                    // Прогресс во время загрузки файла (частичный)
                    progressChannel.postMessage({
                      type: 'CACHE_PROGRESS',
                      progress: totalSize > 0 ? (loadedSize + bytesRead) / totalSize : (cached + failed) / total,
                      cached: cached, total: total, failed: failed,
                      url: url,
                      loadedSize: loadedSize + bytesRead,
                      totalSize: totalSize
                    });
                    return readChunk();
                  });
                }

                // Начать чтение + параллельно положить в cache
                return Promise.all([
                  readChunk(),
                  cache.put(url, response)
                ]);
              })
              .catch(function(err) {
                failed++;
                loadedSize += fileSize;  // всё равно добавляем размер для корректного прогресса
                console.warn('SW: не удалось кэшировать:', url, err);
                progressChannel.postMessage({
                  type: 'CACHE_PROGRESS',
                  progress: totalSize > 0 ? loadedSize / totalSize : (cached + failed) / total,
                  cached: cached, total: total, failed: failed,
                  url: url,
                  loadedSize: loadedSize,
                  totalSize: totalSize
                });
              });
          })
        ).then(function() {
          progressChannel.postMessage({ type: 'CACHE_DONE', failed: failed });
        });
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
                  // F5: обновить versions table
                  updateVersionsTable(relPath, true, null);
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

          // F5: hash-сравнение для docs/*.pdf (feature-05)
          var urlPath = new URL(event.request.url).pathname;
          if (urlPath.indexOf('/docs/') !== -1 && /\.pdf$/i.test(urlPath)) {
            response.clone().text().then(function(text) {
              // Простой hash (djb2) — достаточно для change detection
              var hash = 5381;
              for (var i = 0; i < text.length; i++) {
                hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
              }
              var hashStr = String(hash);
              var relPath = urlPath.replace(/^\//, '');

              // Сравнить с предыдущим hash
              try {
                var raw = localStorage.getItem(VERSIONS_CACHE_KEY);
                var table = raw ? JSON.parse(raw) : {};
                var prev = table[relPath];
                if (prev && prev.currHash && prev.currHash !== hashStr) {
                  // PDF изменился — диспатчить JSON_UPDATED
                  progressChannel.postMessage({
                    type: 'JSON_UPDATED',
                    module: 'docs:' + relPath.split('/').pop()
                  });
                  updateVersionsTable(relPath, true, hashStr);
                } else {
                  updateVersionsTable(relPath, false, hashStr);
                }
              } catch (e) {
                updateVersionsTable(relPath, false, hashStr);
              }
            }).catch(function() {});
          }
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
