/* ═══════════════════════════════════════════
   Pilot's Tool — app.js (Global Logic)
   Pure static version — uses ModuleRegistry
   ═══════════════════════════════════════════ */

window.app = {};

/* ─── Current module tracker (for destroy on navigation) ─── */
var _currentModule = null;

/* ═══════════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════════ */

window.app.navigateTo = function(screenName) {
  // Destroy previous module before switching (контракт SHELL_CONTRACT §2)
  if (_currentModule && _currentModule !== screenName) {
    ModuleRegistry.destroy(_currentModule);
  }
  _currentModule = screenName;

  app.resetHeader();

  // Hide all screens
  document.querySelectorAll('.screen').forEach(function(s) {
    s.classList.remove('active');
  });

  // Show target screen
  var screen = document.getElementById(screenName + 'Screen');
  if (screen) screen.classList.add('active');

  // Close menu
  app.closeMenu();

  // Update menu active state
  document.querySelectorAll('.menu-item[data-nav]').forEach(function(item) {
    item.classList.remove('menu-item--active');
    if (item.dataset.nav === screenName) {
      item.classList.add('menu-item--active');
    }
  });

  // Handle navigation
  if (screenName === 'main') {
    app.renderMainHeader();
  } else {
    // Use module registry
    var mod = window.ModuleRegistry.get(screenName);
    if (mod) {
      ModuleRegistry.renderHeader(screenName);
      ModuleRegistry.init(screenName);
    }
  }
};

window.app.resetHeader = function() {
  var left   = document.getElementById('headerLeft');
  var center = document.getElementById('headerCenter');
  var right  = document.getElementById('headerRight');
  if (left)   { left.innerHTML = '';   left.onclick = null; }
  if (center) {
    center.innerHTML = '';
  }
  if (right)  { right.innerHTML = '';  right.onclick = null; }
};

window.app.renderMainHeader = function() {
  var left   = document.getElementById('headerLeft');
  var center = document.getElementById('headerCenter');
  var right  = document.getElementById('headerRight');
  if (!left || !center || !right) return;

  left.innerHTML = '<button id="menuBtn" class="icon-btn" aria-label="Меню" onclick="app.toggleMenu()">'
    + window.ICONS.menu + '</button>';
  left.onclick = null;

  center.innerHTML = '<div class="hc-default">Pilot\'s Tool</div>';

  right.innerHTML = '';
  right.onclick = null;

  app.renderMainQuote();
};

/* ── Typewriter Quote ── */
window.app._twCancel = false;

window.app.typewriterQuote = function(text, speed) {
  if (!speed) speed = 38;

  var textEl   = document.getElementById('mainQuoteText');
  var cursorEl = document.getElementById('mainQuoteCursor');
  if (!textEl) return;

  window.app._twCancel = true;

  textEl.textContent = '';
  if (cursorEl) {
    cursorEl.classList.remove('visible');
  }

  setTimeout(function() {
    window.app._twCancel = false;

    var i = 0;

    if (cursorEl) cursorEl.classList.add('visible');

    function typeNext() {
      if (window.app._twCancel) {
        if (cursorEl) cursorEl.classList.remove('visible');
        return;
      }

      i++;
      textEl.textContent = text.slice(0, i);

      if (i < text.length) {
        setTimeout(typeNext, speed);
      } else {
        setTimeout(function() {
          if (!window.app._twCancel && cursorEl) {
            cursorEl.classList.remove('visible');
          }
        }, 1200);
      }
    }

    setTimeout(typeNext, 200);
  }, 20);
};

/* ── Render Main Quote ── */
window.app.renderMainQuote = function() {
  var STORAGE_KEY_IDX  = 'mainQuoteIndex';
  var STORAGE_KEY_DATA = 'mainQuoteData';

  function applyQuote(sayings) {
    var raw = localStorage.getItem(STORAGE_KEY_IDX);
    var idx = raw !== null ? parseInt(raw, 10) : -1;
    idx = (idx + 1) % sayings.length;
    localStorage.setItem(STORAGE_KEY_IDX, String(idx));
    var item = sayings[idx];
    var text = (item.ru || item.en || '').trim();
    window.app.typewriterQuote(text, 38);
  }

  var cached = null;
  try {
    var rawCache = localStorage.getItem(STORAGE_KEY_DATA);
    if (rawCache) cached = JSON.parse(rawCache);
  } catch(e) { cached = null; }

  if (cached && cached.length) {
    applyQuote(cached);
    return;
  }

  fetch('modules/aviation_sayings.json')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var sayings = (data && data.sayings)
        ? data.sayings
        : (Array.isArray(data) ? data : []);
      if (!sayings.length) return;
      try { localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(sayings)); } catch(e) {}
      applyQuote(sayings);
    })
    .catch(function() {
      var textEl = document.getElementById('mainQuoteText');
      if (textEl) textEl.textContent = 'Лучше тупой карандаш, чем острая память!';
    });
};

/* ── Marquee for accordion titles ── */
window.app.initMarquee = function(container) {
  var titles = container.querySelectorAll('.collapsible-title');
  for (var i = 0; i < titles.length; i++) {
    (function(title) {
      var inner = title.querySelector('.marquee-inner');
      if (!inner) return;
      if (inner.scrollWidth > title.clientWidth) {
        inner.classList.add('is-overflowing');
      } else {
        inner.classList.remove('is-overflowing');
      }
    })(titles[i]);
  }
};

/* ── Notes Quick Button (draggable) ── */
function initNotesQuickBtn() {
  var btn = document.getElementById('notesQuickBtn');
  if (!btn) return;

  if (window.ICONS && window.ICONS['edit-3']) {
    btn.innerHTML = window.ICONS['edit-3'];
  }

  var saved = null;
  try {
    var raw = localStorage.getItem('notesQuickBtnPos');
    if (raw) saved = JSON.parse(raw);
  } catch(e) {}

  if (saved && typeof saved.right === 'number' && typeof saved.bottom === 'number') {
    btn.style.left   = 'auto';
    btn.style.top    = 'auto';
    btn.style.right  = saved.right  + 'px';
    btn.style.bottom = saved.bottom + 'px';
  }

  var dragging    = false;
  var startX      = 0;
  var startY      = 0;
  var startRight  = 0;
  var startBottom = 0;
  var moved       = false;

  btn.addEventListener('pointerdown', function(e) {
    if (e.button !== undefined && e.button !== 0) return;

    dragging  = true;
    moved     = false;
    btn.setPointerCapture(e.pointerId);
    btn.classList.add('dragging');

    var rect = btn.getBoundingClientRect();
    startX      = e.clientX;
    startY      = e.clientY;
    startRight  = window.innerWidth  - rect.right;
    startBottom = window.innerHeight - rect.bottom;

    btn.style.left = 'auto';
    btn.style.top  = 'auto';
    btn.style.right  = startRight  + 'px';
    btn.style.bottom = startBottom + 'px';

    e.preventDefault();
  }, { passive: false });

  btn.addEventListener('pointermove', function(e) {
    if (!dragging) return;

    var dx = e.clientX - startX;
    var dy = e.clientY - startY;

    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      moved = true;
    }

    if (!moved) return;

    var newRight  = startRight  - dx;
    var newBottom = startBottom - dy;

    var maxRight  = window.innerWidth  - btn.offsetWidth  - 8;
    var maxBottom = window.innerHeight - btn.offsetHeight - 8;
    newRight  = Math.max(8, Math.min(newRight,  maxRight));
    newBottom = Math.max(8, Math.min(newBottom, maxBottom));

    btn.style.right  = newRight  + 'px';
    btn.style.bottom = newBottom + 'px';

    e.preventDefault();
  }, { passive: false });

  btn.addEventListener('pointerup', function(e) {
    if (!dragging) return;
    dragging = false;
    btn.classList.remove('dragging');
    btn.releasePointerCapture(e.pointerId);

    if (moved) {
      try {
        localStorage.setItem('notesQuickBtnPos', JSON.stringify({
          right:  parseFloat(btn.style.right),
          bottom: parseFloat(btn.style.bottom)
        }));
      } catch(e2) {}
    } else {
      // Контракт v3.10 §1: pointerup без перемещения → notes с флагом
      window.app._pendingNoteAction = 'new-draw';
      window.app.navigateTo('notes');
    }
  });

  btn.addEventListener('pointercancel', function() {
    dragging = false;
    btn.classList.remove('dragging');
  });
}

/* ═══════════════════════════════════════════
   MENU — Dynamic generation from ModuleRegistry
   ═══════════════════════════════════════════ */

function initMenuIcons() {
  var offlineIcon = document.getElementById('offlineStatusIcon');
  if (offlineIcon) offlineIcon.innerHTML = window.ICONS.download || '';

  var bannerIcon = document.getElementById('menuBannerIcon');
  if (bannerIcon) bannerIcon.innerHTML = window.ICONS.plane;

  // updateBadgeIcon — заполняется ICONS.download (контракт SHELL_CONTRACT §1)
  var updateBadgeIconEl = document.getElementById('updateBadgeIcon');
  if (updateBadgeIconEl) updateBadgeIconEl.innerHTML = window.ICONS.download || '';

  app.updateThemeIcon();
}

function buildMenuFromRegistry() {
  var menuList = document.getElementById('menuList');
  if (!menuList) return;

  var modules = window.ModuleRegistry.getAll();
  var html = '';

  for (var i = 0; i < modules.length; i++) {
    var mod = modules[i];
    var iconSvg = window.ICONS[mod.icon] || '';
    html += '<li class="menu-item" data-nav="' + mod.id + '">'
      + '<span class="menu-icon">' + iconSvg + '</span>'
      + mod.title
      + '</li>';
  }

  menuList.innerHTML = html;
}

window.app.toggleMenu = function() {
  var menu    = document.getElementById('sideMenu');
  var overlay = document.getElementById('menuOverlay');
  var btn     = document.getElementById('menuBtn');
  if (!menu || !overlay) return;

  var isOpen = menu.classList.contains('open');
  menu.classList.toggle('open');
  overlay.classList.toggle('open');

  if (btn) {
    if (isOpen) {
      btn.classList.remove('menu-btn-open');
      btn.innerHTML = window.ICONS.menu;
    } else {
      btn.classList.add('menu-btn-open');
      btn.innerHTML = window.ICONS.close;
    }
  }
};

window.app.closeMenu = function() {
  var menu    = document.getElementById('sideMenu');
  var overlay = document.getElementById('menuOverlay');
  var btn     = document.getElementById('menuBtn');
  if (menu)    menu.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
  if (btn) {
    btn.classList.remove('menu-btn-open');
    btn.innerHTML = window.ICONS.menu;
  }
};

window.app.toggleTheme = function() {
  var isDark = document.body.classList.toggle('dark-theme');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  app.updateThemeIcon();
};

window.app.updateThemeIcon = function() {
  var themeIcon  = document.getElementById('themeIcon');
  var themeLabel = document.getElementById('themeLabel');
  var isDark = document.body.classList.contains('dark-theme');
  if (themeIcon)  themeIcon.innerHTML  = isDark ? window.ICONS.sun  : window.ICONS.moon;
  if (themeLabel) themeLabel.textContent = isDark ? 'Дневной режим' : 'Ночной режим';
};

window.app.updateOfflineStatus = function(ready) {
  var iconEl = document.getElementById('offlineStatusIcon');
  var textEl = document.getElementById('offlineStatusText');
  if (!iconEl || !textEl) return;
  if (ready) {
    iconEl.innerHTML = window.ICONS['check-circle'] || '';
    textEl.textContent = 'Офлайн доступно';
  } else {
    iconEl.innerHTML = window.ICONS['clock'] || '';
    textEl.textContent = 'Загружается...';
  }
};

window.app.showUpdateBadge = function(moduleName) {
  var badge = document.getElementById('updateBadge');
  if (!badge) return;
  var textEl = badge.querySelector('.update-badge-text');
  if (textEl) textEl.textContent = 'Обновлено: ' + moduleName;

  // Переиграть анимацию: снять классы → reflow → вернуть
  badge.classList.remove('update-badge-visible');
  badge.classList.remove('update-badge-hidden');
  void badge.offsetWidth;
  badge.classList.add('update-badge-visible');
};

window.app.initServiceWorker = function() {
  if (!('serviceWorker' in navigator)) return;

  // Постоянный канал — обрабатывает ВСЕ типы сообщений от SW
  var swChannel = new BroadcastChannel('sw-progress');

  swChannel.onmessage = function(event) {
    var data = event.data;
    var bar     = document.getElementById('swProgressFill');
    var overlay = document.getElementById('cacheProgressOverlay');
    var oBar    = document.getElementById('cacheProgressBar');
    var oText   = document.getElementById('cacheProgressText');
    var swBar   = document.getElementById('swProgressBar');

    // ── Прогресс первичного кэширования ──
    if (data.type === 'CACHE_PROGRESS') {
      var pct = Math.round(data.progress * 100);
      if (bar)  bar.style.width = pct + '%';
      if (oBar) oBar.style.width = pct + '%';
      if (oText) oText.textContent = pct + '%';
    }

    if (data.type === 'CACHE_DONE') {
      if (bar)  bar.style.width = '100%';
      if (oBar) oBar.style.width = '100%';
      if (oText) oText.textContent = '100%';
      localStorage.setItem('offlineReady', 'true');
      app.updateOfflineStatus(true);
      setTimeout(function() {
        if (overlay) overlay.style.display = 'none';
        // Плавно убрать прогресс-бар
        if (swBar) { swBar.style.opacity = '0'; }
        setTimeout(function() {
          if (bar)  bar.style.width = '0%';
          if (swBar) { swBar.style.opacity = '1'; swBar.style.transition = ''; }
        }, 400);
      }, 600);
      // Канал НЕ закрываем — продолжает слушать JSON_UPDATED
    }

    // ── Фоновое обновление JSON ──
    if (data.type === 'JSON_UPDATED') {
      // Показать indeterminate-бар на 2 секунды
      if (swBar) {
        swBar.classList.add('indeterminate');
        setTimeout(function() { swBar.classList.remove('indeterminate'); }, 2000);
      }
      app.showUpdateBadge(data.module);
    }
  };

  navigator.serviceWorker.register('./sw.js').then(function(reg) {
    // Показать overlay и прогресс-бар только при первой установке SW
    if (reg.installing) {
      var overlay = document.getElementById('cacheProgressOverlay');
      var swBar   = document.getElementById('swProgressBar');
      if (overlay) overlay.style.display = 'flex';
      if (swBar)   swBar.style.display   = 'block';
    }
  }).catch(function(err) {
    console.error('SW registration failed:', err);
  });
};

/* ── Toast ── */
var _toastTimer = null;


window.app.showToast = function(message) {
  var toast = document.getElementById('globalToast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('visible');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() {
    toast.classList.remove('visible');
    _toastTimer = null;
  }, 3000);
};

/* ── Show Confirm ── */
var _confirmCleanup = null;

window.app.showConfirm = function(message, onConfirm, okLabel) {
  var overlay   = document.getElementById('globalConfirmOverlay');
  var msgEl     = document.getElementById('globalConfirmMessage');
  var okBtn     = document.getElementById('globalConfirmOk');
  var cancelBtn = document.getElementById('globalConfirmCancel');

  if (!overlay || !msgEl || !okBtn || !cancelBtn) {
    if (window.confirm(message)) {
      if (typeof onConfirm === 'function') onConfirm();
    }
    return;
  }

  if (typeof _confirmCleanup === 'function') {
    _confirmCleanup();
    _confirmCleanup = null;
  }

  msgEl.textContent = message;
  okBtn.textContent = okLabel || 'Подтвердить';

  function close() {
    overlay.classList.remove('visible');
    okBtn.removeEventListener('click', handleOk);
    cancelBtn.removeEventListener('click', handleCancel);
    overlay.removeEventListener('click', handleOverlay);
    _confirmCleanup = null;
  }

  function handleOk() { close(); if (typeof onConfirm === 'function') onConfirm(); }
  function handleCancel() { close(); }
  function handleOverlay(e) { if (e.target === overlay) close(); }

  okBtn.addEventListener('click', handleOk);
  cancelBtn.addEventListener('click', handleCancel);
  overlay.addEventListener('click', handleOverlay);

  _confirmCleanup = close;
  overlay.classList.add('visible');
};

/* ═══════════════════════════════════════════
   LAZY LIB LOADER — SHELL_CONTRACT v3.10 §6
   ═══════════════════════════════════════════ */

window.app._loadedLibs = {};

window.app.ensureLib = function(id, callback) {
  if (window.app._loadedLibs[id]) { if (callback) callback(); return; }

  var configs = {
    'photoswipe': {
      css: [
        'libs/photoswipe/photoswipe.css',
        'libs/photoswipe/default-skin/default-skin.css'
      ],
      js: [
        'libs/photoswipe/photoswipe.min.js',
        'libs/photoswipe/photoswipe-ui-default.min.js'
      ],
      onload: function() {
        // PhotoSwipe требует статический .pswp шаблон в DOM
        if (!document.querySelector('.pswp')) {
          var div = document.createElement('div');
          div.innerHTML = '<div class="pswp" tabindex="-1" role="dialog" aria-hidden="true">'
            + '<div class="pswp__bg"></div>'
            + '<div class="pswp__scroll-wrap">'
            + '<div class="pswp__container">'
            + '<div class="pswp__item"></div>'
            + '<div class="pswp__item"></div>'
            + '<div class="pswp__item"></div>'
            + '</div>'
            + '<div class="pswp__ui pswp__ui--hidden">'
            + '<div class="pswp__top-bar">'
            + '<div class="pswp__counter"></div>'
            + '<button class="pswp__button pswp__button--close" title="Close"></button>'
            + '<button class="pswp__button pswp__button--zoom" title="Zoom"></button>'
            + '<div class="pswp__preloader"></div>'
            + '</div>'
            + '<button class="pswp__button pswp__button--arrow--left"></button>'
            + '<button class="pswp__button pswp__button--arrow--right"></button>'
            + '<div class="pswp__caption"><div class="pswp__caption__center"></div></div>'
            + '</div></div></div>';
          document.body.appendChild(div.firstChild);
        }
      }
    },
    'pdfjs': {
      css: [],
      js: ['libs/pdfjs/pdf.min.js'],
      onload: function() {
        if (window.pdfjsLib) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdfjs/pdf.worker.min.js';
        }
      }
    }
  };

  var cfg = configs[id];
  if (!cfg) { console.error('ensureLib: неизвестная библиотека:', id); return; }

  // Загрузить CSS синхронно (не блокируют callback)
  cfg.css.forEach(function(href) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  });

  // Загрузить JS последовательно, вызвать callback после последнего
  function loadNext(scripts, idx) {
    if (idx >= scripts.length) {
      cfg.onload();
      window.app._loadedLibs[id] = true;
      if (callback) callback();
      return;
    }
    var s = document.createElement('script');
    s.src = scripts[idx];
    s.onload = function() { loadNext(scripts, idx + 1); };
    s.onerror = function() { console.error('ensureLib: не удалось загрузить', scripts[idx]); };
    document.head.appendChild(s);
  }
  loadNext(cfg.js, 0);
};

/* ═══════════════════════════════════════════
   PHOTO VIEWER — PhotoSwipe v4
   Контракт: SHELL_CONTRACT v3.9 §6
   ═══════════════════════════════════════════ */

window.app.openPhotoSwipe = function(thumbEl, container) {
  app.ensureLib('photoswipe', function() {
    var thumbs = container
      ? Array.prototype.slice.call(container.querySelectorAll('img[data-full-src]'))
      : [thumbEl];

    var items = thumbs.map(function(img) {
      return {
        src:  img.dataset.fullSrc || img.src,
        msrc: img.src,
        w: img.naturalWidth  || screen.width,
        h: img.naturalHeight || screen.height,
        el: img
      };
    });

    var startIndex = thumbs.indexOf(thumbEl);
    if (startIndex < 0) startIndex = 0;

    var pswpEl = document.querySelector('.pswp');
    var gallery = new window.PhotoSwipe(
      pswpEl,
      window.PhotoSwipeUI_Default,
      items,
      {
        index: startIndex,
        history: false,
        getThumbBoundsFn: function(idx) {
          var el = items[idx].el;
          if (!el) return null;
          var r = el.getBoundingClientRect();
          return { x: r.left, y: r.top + window.pageYOffset, w: r.width };
        }
      }
    );
    // Дозагрузить реальные размеры если неизвестны
    gallery.listen('gettingData', function(idx, item) {
      if (item.w < 2 || item.h < 2) {
        var img = new Image();
        img.onload = function() {
          item.w = img.naturalWidth;
          item.h = img.naturalHeight;
          gallery.updateSize(true);
        };
        img.src = item.src;
      }
    });
    gallery.init();
  });
};

/* ═══════════════════════════════════════════
   PDF VIEWER — PDF.js v3
   Контракт: SHELL_CONTRACT §6
   ═══════════════════════════════════════════ */

window.app.openPDFModal = function(url, startPage) {
  if (!url) return;
  app.ensureLib('pdfjs', function() {

  var overlay = document.createElement('div');
  overlay.className = 'pdf-modal-overlay';

  var toolbar = document.createElement('div');
  toolbar.className = 'pdf-modal-toolbar';

  var titleSpan = document.createElement('span');
  titleSpan.className = 'pdf-modal-title';
  titleSpan.textContent = 'PDF документ';

  var zoomGroup = document.createElement('div');
  zoomGroup.className = 'pdf-modal-zoom-group';

  var zoomOutBtn = document.createElement('button');
  zoomOutBtn.className = 'icon-btn pdf-modal-zoom-btn';
  zoomOutBtn.innerHTML = window.ICONS['zoom-out'] || '';
  zoomOutBtn.setAttribute('aria-label', 'Уменьшить');

  var zoomLabel = document.createElement('span');
  zoomLabel.className = 'pdf-modal-zoom-label';

  var zoomInBtn = document.createElement('button');
  zoomInBtn.className = 'icon-btn pdf-modal-zoom-btn';
  zoomInBtn.innerHTML = window.ICONS['zoom-in'] || '';
  zoomInBtn.setAttribute('aria-label', 'Увеличить');

  var fitBtn = document.createElement('button');
  fitBtn.className = 'icon-btn pdf-modal-zoom-btn';
  fitBtn.innerHTML = window.ICONS['maximize-2'] || '';
  fitBtn.setAttribute('aria-label', 'По ширине');

  zoomGroup.appendChild(zoomOutBtn);
  zoomGroup.appendChild(zoomLabel);
  zoomGroup.appendChild(zoomInBtn);
  zoomGroup.appendChild(fitBtn);

  var closeBtn = document.createElement('button');
  closeBtn.className = 'icon-btn pdf-modal-close';
  closeBtn.innerHTML = window.ICONS.x || window.ICONS.close;
  closeBtn.setAttribute('aria-label', 'Закрыть');

  toolbar.appendChild(titleSpan);
  toolbar.appendChild(zoomGroup);
  toolbar.appendChild(closeBtn);

  var canvasWrap = document.createElement('div');
  canvasWrap.className = 'pdf-modal-canvas-wrap';
  canvasWrap.style.justifyContent = 'flex-start';

  var canvas = document.createElement('canvas');
  canvas.className = 'pdf-modal-canvas';
  canvas.style.margin = '0 auto';
  canvas.style.alignSelf = 'flex-start';
  canvasWrap.appendChild(canvas);

  var navBar = document.createElement('div');
  navBar.className = 'pdf-modal-nav';

  var prevBtn = document.createElement('button');
  prevBtn.className = 'btn-outline';
  prevBtn.textContent = '←';

  var pageLabel = document.createElement('span');
  pageLabel.className = 'pdf-modal-page-label';

  var nextBtn = document.createElement('button');
  nextBtn.className = 'btn-outline';
  nextBtn.textContent = '→';

  navBar.appendChild(prevBtn);
  navBar.appendChild(pageLabel);
  navBar.appendChild(nextBtn);

  overlay.appendChild(toolbar);
  overlay.appendChild(canvasWrap);
  overlay.appendChild(navBar);
  document.body.appendChild(overlay);

  var baseWrapWidth = canvasWrap.clientWidth;

  function handleResize() {
    baseWrapWidth = canvasWrap.clientWidth;
    if (currentPdf) renderPage(currentPage);
  }
  window.addEventListener('resize', handleResize);

  var currentPdf = null;
  var currentPage = startPage || 1;
  var rendering = false;
  var pendingPage = null;
  var zoomLevel = 1;
  var ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
  var fitScale = 1.5;

  function updateZoomLabel() {
    var pct = (zoomLevel === 1)
      ? Math.round(fitScale * 100)
      : Math.round(fitScale * zoomLevel * 100);
    zoomLabel.textContent = pct + '%';
  }

  function renderPage(num) {
    if (!currentPdf) return;
    if (rendering) { pendingPage = num; return; }
    rendering = true;
    currentPdf.getPage(num).then(function(page) {
      var baseViewport = page.getViewport({ scale: 1.5 });
      var wrapWidth = baseWrapWidth - 32;
      if (wrapWidth <= 0) wrapWidth = canvasWrap.clientWidth - 32;
      var computedFit = 1.5;
      if (wrapWidth > 0 && baseViewport.width > wrapWidth) {
        computedFit = wrapWidth / (baseViewport.width / 1.5);
      }
      fitScale = computedFit;
      var scale = fitScale * zoomLevel;
      var viewport = page.getViewport({ scale: scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      page.render({
        canvasContext: canvas.getContext('2d'),
        viewport: viewport
      }).promise.then(function() {
        rendering = false;
        pageLabel.textContent = num + ' / ' + currentPdf.numPages;
        prevBtn.disabled = (num <= 1);
        nextBtn.disabled = (num >= currentPdf.numPages);
        updateZoomLabel();
        if (pendingPage !== null) {
          var p = pendingPage;
          pendingPage = null;
          renderPage(p);
        }
      }).catch(function(err) {
        rendering = false;
        console.error('PDF render error:', err);
        if (pendingPage !== null) {
          var p2 = pendingPage;
          pendingPage = null;
          renderPage(p2);
        }
      });
    }).catch(function(err) {
      rendering = false;
      console.error('PDF page load error:', err);
    });
  }

  function zoomIn() {
    var idx = 0;
    for (var i = 0; i < ZOOM_STEPS.length; i++) {
      if (ZOOM_STEPS[i] <= zoomLevel + 0.01) idx = i;
    }
    if (idx < ZOOM_STEPS.length - 1) {
      zoomLevel = ZOOM_STEPS[idx + 1];
      renderPage(currentPage);
    }
  }
  function zoomOut() {
    var idx = ZOOM_STEPS.length - 1;
    for (var i = ZOOM_STEPS.length - 1; i >= 0; i--) {
      if (ZOOM_STEPS[i] >= zoomLevel - 0.01) idx = i;
    }
    if (idx > 0) {
      zoomLevel = ZOOM_STEPS[idx - 1];
      renderPage(currentPage);
    }
  }
  function zoomFit() { zoomLevel = 1; renderPage(currentPage); }

  pdfjsLib.getDocument(url).promise.then(function(pdf) {
    currentPdf = pdf;
    renderPage(currentPage);
  }).catch(function() {
    window.app.showToast('Не удалось загрузить PDF');
    closePDF();
  });

  zoomInBtn.addEventListener('click', zoomIn);
  zoomOutBtn.addEventListener('click', zoomOut);
  fitBtn.addEventListener('click', zoomFit);
  prevBtn.addEventListener('click', function() {
    if (currentPage > 1) { currentPage--; renderPage(currentPage); }
  });
  nextBtn.addEventListener('click', function() {
    if (currentPdf && currentPage < currentPdf.numPages) {
      currentPage++; renderPage(currentPage);
    }
  });

  // Pinch-to-zoom
  var pinchStartDist = 0, pinchStartZoom = 1, pinchActive = false;

  canvasWrap.addEventListener('touchstart', function(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      pinchActive = true;
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist = Math.sqrt(dx * dx + dy * dy);
      pinchStartZoom = zoomLevel;
    }
  }, { passive: false });

  canvasWrap.addEventListener('touchmove', function(e) {
    if (!pinchActive || e.touches.length !== 2) return;
    e.preventDefault();
    var dx = e.touches[0].clientX - e.touches[1].clientX;
    var dy = e.touches[0].clientY - e.touches[1].clientY;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (pinchStartDist < 1) return;
    var newZoom = pinchStartZoom * (dist / pinchStartDist);
    newZoom = Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], newZoom));
    for (var s = 0; s < ZOOM_STEPS.length; s++) {
      if (Math.abs(newZoom - ZOOM_STEPS[s]) < 0.08) { newZoom = ZOOM_STEPS[s]; break; }
    }
    zoomLevel = newZoom;
    renderPage(currentPage);
  }, { passive: false });

  canvasWrap.addEventListener('touchend', function(e) {
    if (pinchActive && e.touches.length < 2) {
      pinchActive = false;
      var best = ZOOM_STEPS[0], bestDist = Math.abs(zoomLevel - ZOOM_STEPS[0]);
      for (var s = 1; s < ZOOM_STEPS.length; s++) {
        var d = Math.abs(zoomLevel - ZOOM_STEPS[s]);
        if (d < bestDist) { bestDist = d; best = ZOOM_STEPS[s]; }
      }
      zoomLevel = best;
      renderPage(currentPage);
    }
  });

  // Double-tap
  var lastTapTime = 0, lastTapX = 0, lastTapY = 0;

  canvasWrap.addEventListener('touchend', function(e) {
    if (pinchActive || e.touches.length > 0) return;
    var touch = e.changedTouches[0];
    if (!touch) return;
    var now = Date.now();
    var dx = touch.clientX - lastTapX;
    var dy = touch.clientY - lastTapY;
    if (now - lastTapTime < 350 && Math.sqrt(dx*dx+dy*dy) < 30) {
      e.preventDefault();
      if (zoomLevel > 1.01) zoomFit();
      else { zoomLevel = 2; renderPage(currentPage); }
      lastTapTime = 0;
    } else {
      lastTapTime = now; lastTapX = touch.clientX; lastTapY = touch.clientY;
    }
  });

  // Ctrl+scroll
  canvasWrap.addEventListener('wheel', function(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (e.deltaY < 0) zoomIn(); else zoomOut();
  }, { passive: false });

  function closePDF() {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.removeEventListener('keydown', handleKey);
    window.removeEventListener('resize', handleResize);
  }

  function handleKey(e) {
    if (e.key === 'Escape') closePDF();
    else if (e.key === 'ArrowLeft') prevBtn.click();
    else if (e.key === 'ArrowRight') nextBtn.click();
    else if ((e.key === '+' || e.key === '=') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); zoomIn(); }
    else if (e.key === '-' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); zoomOut(); }
    else if (e.key === '0' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); zoomFit(); }
  }
  document.addEventListener('keydown', handleKey);

  closeBtn.addEventListener('click', closePDF);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closePDF(); });

  }); // end ensureLib('pdfjs')
};

/* ═══════════════════════════════════════════
   SKELETON & ERROR UTILITIES
   ═══════════════════════════════════════════ */

/* ── Show skeleton loading placeholder ── */
window.app.showSkeleton = function(container, type) {
  if (!container) return;
  var skeletonType = type || 'list';
  var html = '<div class="skeleton skeleton--' + skeletonType + '">';

  if (skeletonType === 'blocks') {
    for (var i = 0; i < 3; i++) {
      html += '<div class="skeleton-block">'
        + '<div class="skeleton-line skeleton-line--title"></div>'
        + '<div class="skeleton-line skeleton-line--text"></div>'
        + '<div class="skeleton-line skeleton-line--text skeleton-line--short"></div>'
        + '</div>';
    }
  } else {
    /* type === 'list' */
    for (var j = 0; j < 6; j++) {
      html += '<div class="skeleton-item">'
        + '<div class="skeleton-circle"></div>'
        + '<div class="skeleton-lines">'
        + '<div class="skeleton-line skeleton-line--title"></div>'
        + '<div class="skeleton-line skeleton-line--text"></div>'
        + '</div>'
        + '</div>';
    }
  }

  html += '</div>';
  container.innerHTML = html;
};

/* ── Hide skeleton and insert real content ── */
window.app.hideSkeleton = function(container, html) {
  if (!container) return;
  container.innerHTML = html || '';
};

/* ── Show error message ── */
window.app.showError = function(container, text) {
  if (!container) return;
  container.innerHTML = '<div class="ct-empty-state">'
    + '<div class="ct-empty-icon" style="width:48px;height:48px;color:var(--color-danger);opacity:0.7;">'
    + (window.ICONS['alert-triangle'] || '')
    + '</div>'
    + '<div class="ct-empty-title" style="color:var(--color-danger);">Ошибка</div>'
    + '<div class="ct-empty-text">' + (text || 'Не удалось загрузить данные') + '</div>'
    + '</div>';
};

/* ═══════════════════════════════════════════
   DOMContentLoaded
   ═══════════════════════════════════════════ */

function _appInit() {
  // Restore theme
  if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-theme');
  }

  // Build menu from registry
  buildMenuFromRegistry();
  initMenuIcons();

  // Theme toggle
  var themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function() {
      app.toggleTheme();
      app.closeMenu();
    });
  }

  // Menu overlay click to close
  var menuOverlay = document.getElementById('menuOverlay');
  if (menuOverlay) {
    menuOverlay.addEventListener('click', function() { app.closeMenu(); });
  }

  // Menu navigation (dynamic from registry)
  document.querySelectorAll('.menu-item[data-nav]').forEach(function(item) {
    item.addEventListener('click', function() {
      app.navigateTo(item.dataset.nav);
    });
  });

  // Offline status
  if (localStorage.getItem('offlineReady') === 'true') {
    app.updateOfflineStatus(true);
  }

  // Network status
  window.addEventListener('online', function() {
    var el = document.getElementById('menuNetworkStatus');
    if (el) { el.textContent = '● Онлайн'; el.style.color = ''; }
  });
  window.addEventListener('offline', function() {
    var el = document.getElementById('menuNetworkStatus');
    if (el) { el.textContent = '● Офлайн'; el.style.color = 'rgba(255,255,255,0.4)'; }
  });

  // Notes quick button
  initNotesQuickBtn();

  // LAST: show main screen
  window.app.navigateTo('main');
}

// Handle both cases: DOMContentLoaded not yet fired, or already fired
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _appInit);
} else {
  _appInit();
}
