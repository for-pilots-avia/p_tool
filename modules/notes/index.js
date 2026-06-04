/* ═══════════════════════════════════════════
   Pilot's Tool — modules/notes/index.js
   Модуль «Заметки» — vanilla JS
   Совместим по формату данных с React-компонентом (notes.tsx)
   IndexedDB: pilot-tool-fs, stores: handwritten-notes, text-notes
   Draw note schema: { data: dataURL, ts, category }
   Text note schema: { title, body, ts, category }
   Category values: 'Важно' | 'Работа' | 'Личное' | '' (пустая строка = без категории)
   ═══════════════════════════════════════════ */

(function() {
  'use strict';

  /* ── Приватное состояние ── */
  var _currentView = 'list';        /* 'list' | 'draw' | 'text' */
  var _activeCategory = 'all';      /* 'all' | 'Важно' | 'Работа' | 'Личное' */
  var _menuOpen = false;
  var _menuOutsideHandler = null;
  var _drawCtx = null;
  var _drawStrokeWidth = 2;         /* 2 | 5 | 10 — actual pixel widths */
  var _drawEraser = false;
  var _drawCategory = '';
  var _drawHasContent = false;
  var _drawPoints = [];
  var _editingTextId = null;        /* null = новая, number = редактирование */
  var _textCategory = '';
  var _cachedDrawNotes = [];
  var _cachedTextNotes = [];

  /* ── IndexedDB ── */
  var DB_NAME = 'pilot-tool-fs';
  var DB_VERSION = 3;
  var STORE_DRAW = 'handwritten-notes';
  var STORE_TEXT = 'text-notes';

  /* ── Categories ── */
  var CATEGORY_TABS = [
    { key: 'all', label: 'Все' },
    { key: 'Важно', label: 'Важно' },
    { key: 'Работа', label: 'Работа' },
    { key: 'Личное', label: 'Личное' }
  ];

  var CAT_COLORS = {
    'Важно':  'var(--color-danger)',
    'Работа': 'var(--color-warning)',
    'Личное': 'var(--color-success)'
  };

  function getCategoryBorderColor(cat) {
    return CAT_COLORS[cat] || 'transparent';
  }

  /* ── IndexedDB helpers ── */

  function openDB() {
    return new Promise(function(resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('photos')) {
          db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(STORE_DRAW)) {
          db.createObjectStore(STORE_DRAW, { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(STORE_TEXT)) {
          db.createObjectStore(STORE_TEXT, { keyPath: 'id', autoIncrement: true });
        }
      };
      request.onsuccess = function() { resolve(request.result); };
      request.onerror = function() { reject(request.error); };
    });
  }

  function getAllFromStore(storeName) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        var req = store.getAll();
        req.onsuccess = function() { resolve(req.result || []); };
        req.onerror = function() { reject(req.error); };
      });
    });
  }

  function saveDrawNote(data, category) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE_DRAW, 'readwrite');
        var store = tx.objectStore(STORE_DRAW);
        var record = { data: data, ts: Date.now(), category: category || '' };
        var req = store.add(record);
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
      });
    });
  }

  function saveTextNote(title, body, category) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE_TEXT, 'readwrite');
        var store = tx.objectStore(STORE_TEXT);
        var record;
        if (_editingTextId) {
          record = { id: _editingTextId, title: title, body: body, ts: Date.now(), category: category || '' };
          var req = store.put(record);
          req.onsuccess = function() { resolve(req.result); };
          req.onerror = function() { reject(req.error); };
        } else {
          record = { title: title, body: body, ts: Date.now(), category: category || '' };
          var req2 = store.add(record);
          req2.onsuccess = function() { resolve(req2.result); };
          req2.onerror = function() { reject(req2.error); };
        }
      });
    });
  }

  function deleteDrawNote(id) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE_DRAW, 'readwrite');
        tx.objectStore(STORE_DRAW).delete(Number(id));
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { reject(tx.error); };
      });
    });
  }

  function deleteTextNote(id) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE_TEXT, 'readwrite');
        tx.objectStore(STORE_TEXT).delete(Number(id));
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { reject(tx.error); };
      });
    });
  }

  /* ═══════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════ */

  function formatDate(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var day = d.getDate();
    var mon = d.getMonth() + 1;
    var h = d.getHours();
    var m = d.getMinutes();
    return (day < 10 ? '0' : '') + day + '.'
      + (mon < 10 ? '0' : '') + mon + ' '
      + (h < 10 ? '0' : '') + h + ':'
      + (m < 10 ? '0' : '') + m;
  }

  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ═══════════════════════════════════════════
     HEADER
     ═══════════════════════════════════════════ */

  function renderListHeader() {
    var left   = document.getElementById('headerLeft');
    var center = document.getElementById('headerCenter');
    var right  = document.getElementById('headerRight');
    if (!left || !center || !right) return;

    left.innerHTML = '<button class="icon-btn" aria-label="Назад">'
      + window.ICONS['arrow-left'] + '</button>';
    left.onclick = function() { app.navigateTo('main'); };

    center.innerHTML = '<div class="hc-module">Заметки</div>';

    /* Right: ellipsis-vertical menu */
    var hasAnyNotes = _cachedDrawNotes.length > 0 || _cachedTextNotes.length > 0;
    var dropdownHtml = '';
    dropdownHtml += '<div class="notes-header-dropdown">';
    dropdownHtml += '<button class="notes-header-dropdown-item" data-action="new-draw">'
      + (window.ICONS['pen-line'] || '') + '<span>Рисунок</span></button>';
    dropdownHtml += '<button class="notes-header-dropdown-item" data-action="new-text">'
      + (window.ICONS['type'] || '') + '<span>Текст</span></button>';
    if (hasAnyNotes) {
      dropdownHtml += '<div class="notes-header-dropdown-divider"></div>';
      dropdownHtml += '<button class="notes-header-dropdown-item notes-header-dropdown-item--danger" data-action="delete-all">'
        + (window.ICONS.trash || '') + '<span>Удалить все</span></button>';
    }
    dropdownHtml += '</div>';

    right.innerHTML = '<div class="notes-header-menu" id="notesHeaderMenu">'
      + '<button class="icon-btn" id="notesMenuBtn" aria-label="Меню">'
      + (window.ICONS['ellipsis-vertical'] || '')
      + '</button>'
      + (_menuOpen ? dropdownHtml : '')
      + '</div>';
    right.onclick = null;

    /* Menu toggle */
    var menuBtn = document.getElementById('notesMenuBtn');
    if (menuBtn) {
      menuBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        _menuOpen = !_menuOpen;
        renderListHeader();
      });
    }

    /* Dropdown item handlers */
    var menuContainer = document.getElementById('notesHeaderMenu');
    if (menuContainer) {
      menuContainer.addEventListener('click', function(e) {
        var item = e.target.closest('.notes-header-dropdown-item');
        if (!item) return;
        var action = item.dataset.action;
        _menuOpen = false;
        if (action === 'new-draw') {
          showDrawView();
        } else if (action === 'new-text') {
          showTextView();
        } else if (action === 'delete-all') {
          handleDeleteAll();
        }
      });
    }

    /* Outside click to close menu */
    setupMenuOutsideClick();
  }

  function setupMenuOutsideClick() {
    if (_menuOutsideHandler) {
      document.removeEventListener('pointerdown', _menuOutsideHandler);
    }
    if (!_menuOpen) return;
    _menuOutsideHandler = function(e) {
      var menu = document.getElementById('notesHeaderMenu');
      if (menu && !menu.contains(e.target)) {
        _menuOpen = false;
        renderListHeader();
      }
    };
    document.addEventListener('pointerdown', _menuOutsideHandler);
  }

  function renderDrawHeader() {
    var left   = document.getElementById('headerLeft');
    var center = document.getElementById('headerCenter');
    var right  = document.getElementById('headerRight');
    if (!left || !center || !right) return;

    /* Left: decorative pen icon */
    left.innerHTML = '<span class="notes-header-icon-muted" aria-hidden="true">'
      + (window.ICONS['edit-3'] || '') + '</span>';
    left.onclick = null;

    center.innerHTML = '<div class="hc-module">Рисование</div>';

    /* Right: X close button */
    right.innerHTML = '<button class="icon-btn" aria-label="Закрыть">'
      + (window.ICONS['x'] || window.ICONS.close || '') + '</button>';
    right.onclick = null;

    var closeBtn = right.querySelector('.icon-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() { showListView(); });
    }
  }

  function renderTextHeader() {
    var left   = document.getElementById('headerLeft');
    var center = document.getElementById('headerCenter');
    var right  = document.getElementById('headerRight');
    if (!left || !center || !right) return;

    /* Left: semi-transparent non-clickable "T" icon (decorative) */
    left.innerHTML = '<span class="notes-header-icon-muted" aria-hidden="true">'
      + (window.ICONS['type'] || '') + '</span>';
    left.onclick = null;

    center.innerHTML = '<div class="hc-module">'
      + (_editingTextId ? 'Редактирование' : 'Текстовая заметка') + '</div>';

    /* Right: X close button */
    right.innerHTML = '<button class="icon-btn" aria-label="Закрыть">'
      + (window.ICONS['x'] || window.ICONS.close || '') + '</button>';
    right.onclick = null;

    var closeBtn = right.querySelector('.icon-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() { showListView(); });
    }
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */

  function init() {
    var container = document.getElementById('notesContainer');
    if (!container) { console.error('Контейнер notesContainer не найден!'); return; }

    /* Делегирование: вешать ровно ОДИН раз */
    if (!container.dataset.delegated) {
      container.addEventListener('click', function(e) {

        /* Фото заметки — открыть просмотр PhotoSwipe */
        var imgEl = e.target.closest('.notes-thumb-img img');
        if (imgEl) {
          e.preventDefault();
          e.stopPropagation();
          var grid = container.querySelector('.notes-grid');
          app.openPhotoSwipe(imgEl, grid || container);
          return;
        }

        /* Удаление текстовой заметки */
        var textDelBtn = e.target.closest('.notes-text-item-del');
        if (textDelBtn) {
          e.stopPropagation();
          var noteId = textDelBtn.dataset.id;
          if (noteId) {
            app.showConfirm('Удалить заметку?', function() {
              deleteNote(noteId, 'text');
            }, 'Удалить');
          }
          return;
        }

        /* Удаление рисунка */
        var thumbDelBtn = e.target.closest('.notes-thumb-del');
        if (thumbDelBtn) {
          e.stopPropagation();
          var drawId = thumbDelBtn.dataset.id;
          if (drawId) {
            app.showConfirm('Удалить заметку?', function() {
              deleteNote(drawId, 'draw');
            }, 'Удалить');
          }
          return;
        }

        /* Текстовая заметка — открыть редактор */
        var textItem = e.target.closest('.notes-text-item');
        if (textItem) {
          var textId = textItem.dataset.id;
          if (textId) openTextNote(textId);
          return;
        }

        /* Категория — фильтр */
        var catTab = e.target.closest('.notes-category-tab');
        if (catTab) {
          filterByCategory(catTab);
          return;
        }

      });
      container.dataset.delegated = 'true';
    }

    /* Сброс состояния */
    _currentView = 'list';
    _menuOpen = false;
    _editingTextId = null;
    _activeCategory = 'all';

    /* Проверяем флаг от notesQuickBtn — открыть рисование сразу */
    if (window.app._pendingNoteAction === 'new-draw') {
      window.app._pendingNoteAction = null;
      showDrawView();
      return;
    }

    /* renderHeader() уже вызван navigateTo() — не вызывать повторно из init() */
    renderAll();
  }

  /* ═══════════════════════════════════════════
     RENDER — LIST VIEW
     ═══════════════════════════════════════════ */

  function renderAll() {
    var container = document.getElementById('notesContainer');
    if (!container) return;

    app.showSkeleton(container, 'blocks');

    Promise.all([getAllFromStore(STORE_DRAW), getAllFromStore(STORE_TEXT)])
      .then(function(results) {
        var drawNotes = results[0] || [];
        var textNotes = results[1] || [];

        /* Normalize draw notes: support old dataURL field */
        for (var i = 0; i < drawNotes.length; i++) {
          drawNotes[i].data = drawNotes[i].data || drawNotes[i].dataURL || '';
          drawNotes[i].category = drawNotes[i].category || '';
        }
        for (var j = 0; j < textNotes.length; j++) {
          textNotes[j].category = textNotes[j].category || '';
        }

        _cachedDrawNotes = drawNotes;
        _cachedTextNotes = textNotes;

        renderList(container, drawNotes, textNotes);
      })
      .catch(function(err) {
        console.error('Notes load error:', err);
        container.innerHTML = '<div class="notes-empty"><p class="notes-empty-text">Не удалось загрузить заметки</p></div>';
      });
  }

  function renderList(container, drawNotes, textNotes) {
    var hasAnyNotes = drawNotes.length > 0 || textNotes.length > 0;

    /* Filter */
    var filteredTextNotes = textNotes
      .filter(function(n) { return _activeCategory === 'all' || (n.category || '') === _activeCategory; })
      .sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });

    var filteredDrawNotes = drawNotes
      .filter(function(n) { return _activeCategory === 'all' || (n.category || '') === _activeCategory; })
      .sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });

    var html = '';

    /* Category tabs */
    html += '<div class="notes-category-tabs">';
    for (var t = 0; t < CATEGORY_TABS.length; t++) {
      var tabClass = 'notes-category-tab';
      if (CATEGORY_TABS[t].key === _activeCategory) tabClass += ' notes-category-tab--active';
      html += '<button class="' + tabClass + '" data-cat-key="' + CATEGORY_TABS[t].key + '">' + CATEGORY_TABS[t].label + '</button>';
    }
    html += '</div>';

    if (!hasAnyNotes) {
      /* Полностью пустой список */
      html += '<div class="notes-empty">';
      html += '<div class="notes-empty-icon">' + (window.ICONS['edit-3'] || '') + '</div>';
      html += '<p class="notes-empty-text">Нет сохранённых заметок</p>';
      html += '<p class="notes-empty-hint">Нажмите ⋮ чтобы создать первую</p>';
      html += '</div>';
    } else if (filteredTextNotes.length === 0 && filteredDrawNotes.length === 0) {
      /* Есть заметки, но не в этой категории */
      html += '<div class="notes-empty">';
      html += '<div class="notes-empty-icon">' + (window.ICONS['edit-3'] || '') + '</div>';
      html += '<p class="notes-empty-text">Нет заметок в этой категории</p>';
      html += '</div>';
    } else {
      /* ── Блок текстовых заметок ── */
      if (filteredTextNotes.length > 0) {
        html += '<div class="notes-section">';
        html += '<div class="notes-section-header">';
        html += '<span class="notes-section-title">' + (window.ICONS['file-text'] || '') + ' Текстовые</span>';
        html += '<span class="notes-section-count">' + filteredTextNotes.length + '</span>';
        html += '</div>';
        html += '<div class="notes-text-list">';
        for (var tn = 0; tn < filteredTextNotes.length; tn++) {
          html += renderTextNoteItem(filteredTextNotes[tn]);
        }
        html += '</div>';
        html += '</div>';
      }

      /* ── Блок рисунков ── */
      if (filteredDrawNotes.length > 0) {
        html += '<div class="notes-section">';
        html += '<div class="notes-section-header">';
        html += '<span class="notes-section-title">' + (window.ICONS['pen-line'] || window.ICONS['edit-3'] || '') + ' Рисунки</span>';
        html += '<span class="notes-section-count">' + filteredDrawNotes.length + '</span>';
        html += '</div>';
        html += '<div class="notes-grid">';
        for (var dn = 0; dn < filteredDrawNotes.length; dn++) {
          html += renderDrawNoteCard(filteredDrawNotes[dn]);
        }
        html += '</div>';
        html += '</div>';
      }
    }

    app.hideSkeleton(container, html);

    /* Update header to reflect hasAnyNotes for dropdown menu */
    renderListHeader();
  }

  /* ── Render text note as list item ── */
  function renderTextNoteItem(note) {
    var borderColor = getCategoryBorderColor(note.category);
    var html = '<div class="notes-text-item" data-id="' + note.id + '">';

    /* Accent bar */
    html += '<div class="notes-text-item-accent" style="background:' + borderColor + '"></div>';

    /* Body: title + preview */
    html += '<div class="notes-text-item-body">';
    html += '<div class="notes-text-item-title">' + escHtml(note.title || 'Без заголовка') + '</div>';
    html += '<div class="notes-text-item-preview">' + escHtml(note.body || '') + '</div>';
    html += '</div>';

    /* Meta: category badge + date */
    html += '<div class="notes-text-item-meta">';
    if (note.category) {
      html += '<span class="notes-text-item-cat" style="background:' + borderColor + '">' + escHtml(note.category) + '</span>';
    }
    html += '<span class="notes-text-item-date">' + formatDate(note.ts) + '</span>';
    html += '</div>';

    /* Delete button */
    html += '<button class="notes-text-item-del" data-id="' + note.id + '" aria-label="Удалить заметку">'
      + (window.ICONS.trash || window.ICONS.close || '') + '</button>';

    html += '</div>';
    return html;
  }

  /* ── Render draw note as thumbnail card ── */
  function renderDrawNoteCard(note) {
    var borderColor = getCategoryBorderColor(note.category);
    var html = '<div class="notes-thumb" data-id="' + note.id + '">';

    /* Accent top bar */
    html += '<div class="notes-thumb-accent" style="background:' + borderColor + '"></div>';

    /* Image */
    html += '<div class="notes-thumb-img">';
    html += '<img src="' + note.data + '" data-full-src="' + note.data + '" alt="Заметка от ' + formatDate(note.ts) + '" loading="lazy">';
    html += '<div class="notes-thumb-type-badge notes-thumb-type-badge--draw">' + (window.ICONS['pen-line'] || window.ICONS['edit-3'] || '') + '</div>';
    html += '</div>';

    /* Caption */
    html += '<div class="notes-thumb-caption">';
    if (note.category) {
      html += '<span class="notes-thumb-cat-label" style="background:' + borderColor + '">' + escHtml(note.category) + '</span>';
    } else {
      html += '<span class="notes-thumb-cat-dot" style="background:transparent"></span>';
    }
    html += '<span class="notes-thumb-date">' + formatDate(note.ts) + '</span>';
    html += '<button class="notes-thumb-del" data-id="' + note.id + '" aria-label="Удалить">'
      + (window.ICONS.trash || window.ICONS.close || '') + '</button>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  /* ═══════════════════════════════════════════
     DELETE
     ═══════════════════════════════════════════ */

  function deleteNote(id, type) {
    var promise;
    if (type === 'draw') {
      promise = deleteDrawNote(id);
    } else {
      promise = deleteTextNote(id);
    }
    promise.then(function() {
      app.showToast('Заметка удалена');
      renderAll();
    }).catch(function() {
      app.showToast('Ошибка удаления');
    });
  }

  function handleDeleteAll() {
    app.showConfirm('Удалить все заметки?', function() {
      Promise.all([
        openDB().then(function(db) {
          return new Promise(function(resolve, reject) {
            var tx = db.transaction(STORE_DRAW, 'readwrite');
            tx.objectStore(STORE_DRAW).clear();
            tx.oncomplete = function() { resolve(); };
            tx.onerror = function() { reject(tx.error); };
          });
        }),
        openDB().then(function(db) {
          return new Promise(function(resolve, reject) {
            var tx = db.transaction(STORE_TEXT, 'readwrite');
            tx.objectStore(STORE_TEXT).clear();
            tx.oncomplete = function() { resolve(); };
            tx.onerror = function() { reject(tx.error); };
          });
        })
      ]).then(function() {
        app.showToast('Все заметки удалены');
        renderAll();
      }).catch(function() {
        app.showToast('Ошибка удаления');
      });
    }, 'Удалить все');
  }

  /* ═══════════════════════════════════════════
     CATEGORY FILTER
     ═══════════════════════════════════════════ */

  function filterByCategory(tabEl) {
    var key = tabEl.dataset.catKey || tabEl.textContent.trim();
    /* Map 'Все' to 'all' */
    if (key === 'Все') key = 'all';

    var tabs = document.querySelectorAll('.notes-category-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.remove('notes-category-tab--active');
    }
    tabEl.classList.add('notes-category-tab--active');
    _activeCategory = key;

    /* Re-render with cached data */
    var container = document.getElementById('notesContainer');
    if (container) {
      renderList(container, _cachedDrawNotes, _cachedTextNotes);
    }
  }

  /* ═══════════════════════════════════════════
     TEXT NOTE — OPEN
     ═══════════════════════════════════════════ */

  function openTextNote(id) {
    _editingTextId = Number(id);
    getAllFromStore(STORE_TEXT).then(function(notes) {
      var note = null;
      for (var i = 0; i < notes.length; i++) {
        if (notes[i].id === Number(id)) { note = notes[i]; break; }
      }
      if (note) {
        showTextView(note);
      } else {
        app.showToast('Заметка не найдена');
      }
    }).catch(function() {
      app.showToast('Ошибка загрузки');
    });
  }

  /* ═══════════════════════════════════════════
     VIEW SWITCHING
     ═══════════════════════════════════════════ */

  function showListView() {
    _currentView = 'list';
    _menuOpen = false;
    _editingTextId = null;
    /* Clean up menu outside click */
    if (_menuOutsideHandler) {
      document.removeEventListener('pointerdown', _menuOutsideHandler);
      _menuOutsideHandler = null;
    }
    var container = document.getElementById('notesContainer');
    if (container) {
      container.classList.remove('notes-fullscreen');
      container.innerHTML = '';
    }
    renderListHeader();
    renderAll();
  }

  function showDrawView() {
    _currentView = 'draw';
    _drawStrokeWidth = 2;
    _drawEraser = false;
    _drawCategory = '';
    _drawHasContent = false;
    _drawPoints = [];

    var container = document.getElementById('notesContainer');
    if (!container) return;
    container.classList.add('notes-fullscreen');

    var html = '<div class="notes-draw-screen">';
    html += '<div class="notes-draw-wrap">';

    /* Toolbar — stroke/eraser (top) */
    html += '<div class="notes-draw-toolbar">';
    html += '<div class="notes-stroke-controls">';
    html += '<button class="notes-stroke-btn notes-stroke-thin' + (_drawStrokeWidth === 2 ? ' notes-stroke-active' : '') + '" data-stroke="2"></button>';
    html += '<button class="notes-stroke-btn notes-stroke-mid' + (_drawStrokeWidth === 5 ? ' notes-stroke-active' : '') + '" data-stroke="5"></button>';
    html += '<button class="notes-stroke-btn notes-stroke-thick' + (_drawStrokeWidth === 10 ? ' notes-stroke-active' : '') + '" data-stroke="10"></button>';
    html += '</div>';
    html += '<button class="notes-tool-eraser' + (_drawEraser ? ' notes-eraser-active' : '') + '" id="notesDrawEraser" aria-label="Ластик">'
      + (window.ICONS.eraser || '') + '</button>';
    html += '</div>';

    /* Canvas */
    html += '<canvas class="notes-canvas" id="notesDrawCanvas"></canvas>';

    /* Bottom bar — categories left, actions right */
    html += '<div class="notes-draw-bottom-bar">';
    html += '<div class="notes-draw-category-bar">';
    var catKeys = ['Важно', 'Работа', 'Личное'];
    for (var c = 0; c < catKeys.length; c++) {
      var catPillClass = 'notes-draw-cat-pill';
      var catStyle = '';
      if (CAT_COLORS[catKeys[c]]) {
        catStyle = ' style="--pill-border:' + CAT_COLORS[catKeys[c]] + '"';
      }
      html += '<button class="' + catPillClass + '"' + catStyle + ' data-cat="' + catKeys[c] + '">' + catKeys[c] + '</button>';
    }
    html += '</div>';
    html += '<div class="notes-draw-actions">';
    html += '<button class="notes-tool-clear" id="notesDrawClear">Очистить</button>';
    html += '<button class="btn-primary" id="notesDrawSaveBtn" style="padding:6px 16px;font-size:var(--font-sm);min-height:32px;border-radius:16px">Сохранить</button>';
    html += '</div>';
    html += '</div>';

    html += '</div>';
    html += '</div>';

    app.hideSkeleton(container, html);
    renderDrawHeader();
    initCanvas();
  }

  function showTextView(existingNote) {
    _currentView = 'text';
    var container = document.getElementById('notesContainer');
    if (!container) return;
    container.classList.add('notes-fullscreen');

    var title = existingNote ? escHtml(existingNote.title || '') : '';
    var body = existingNote ? escHtml(existingNote.body || '') : '';
    var cat = existingNote ? (existingNote.category || '') : '';

    var html = '<div class="notes-text-editor">';
    html += '<div class="notes-text-editor-body">';
    html += '<input type="text" class="notes-text-title-input" id="notesTextTitle" placeholder="Заголовок" maxlength="120" value="' + title + '">';
    html += '<textarea class="notes-text-body-input" id="notesTextBody" placeholder="Текст заметки...">' + body + '</textarea>';

    /* Category pills + Save button in one row */
    html += '<div class="notes-category-selector">';
    html += '<div class="notes-category-pills">';
    var catKeys = ['Важно', 'Работа', 'Личное'];
    for (var c = 0; c < catKeys.length; c++) {
      var pillClass = 'notes-category-pill';
      var pillStyle = '';
      if (CAT_COLORS[catKeys[c]]) {
        pillStyle = ' style="--pill-border:' + CAT_COLORS[catKeys[c]] + '"';
      }
      if (catKeys[c] === cat) pillClass += ' notes-category-pill--selected';
      html += '<button class="' + pillClass + '"' + pillStyle + ' data-cat="' + catKeys[c] + '">' + catKeys[c] + '</button>';
    }
    html += '</div>';
    html += '<button class="btn-primary" id="notesTextSaveBtn" style="flex-shrink:0;padding:6px 16px;font-size:var(--font-sm);min-height:32px;border-radius:16px">Сохранить</button>';
    html += '</div>';

    html += '</div>';
    html += '</div>';

    app.hideSkeleton(container, html);
    renderTextHeader();
    initTextEditor(cat);
  }

  /* ═══════════════════════════════════════════
     CANVAS DRAWING
     ═══════════════════════════════════════════ */

  function initCanvas() {
    var canvas = document.getElementById('notesDrawCanvas');
    if (!canvas) return;

    var wrap = canvas.parentElement;
    if (!wrap) return;

    /* Defer sizing so CSS layout is fully resolved */
    setTimeout(function() {
      var c = document.getElementById('notesDrawCanvas');
      var w2 = c ? c.parentElement : null;
      if (!c || !w2) return;

      var dpr = window.devicePixelRatio || 1;

      /* Wrap has CSS height = 100dvh - header - safe-area, use it directly */
      var wrapRect = w2.getBoundingClientRect();
      var w = Math.max(1, Math.floor(wrapRect.width));

      /* Subtract toolbar and bottom bar from wrap height */
      var toolbarEl = w2.querySelector('.notes-draw-toolbar');
      var bottomBarEl = w2.querySelector('.notes-draw-bottom-bar');
      var barsH = (toolbarEl ? toolbarEl.offsetHeight : 0) + (bottomBarEl ? bottomBarEl.offsetHeight : 0);
      var h = Math.max(200, Math.floor(wrapRect.height - barsH));

      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = w + 'px';
      c.style.height = h + 'px';

      _drawCtx = c.getContext('2d');
      _drawCtx.scale(dpr, dpr);
      _drawCtx.fillStyle = '#ffffff';
      _drawCtx.fillRect(0, 0, w, h);
      _drawCtx.lineCap = 'round';
      _drawCtx.lineJoin = 'round';
      _drawCtx.strokeStyle = '#1a1a1a';
      _drawCtx.lineWidth = _drawStrokeWidth;
    }, 50);

    /* Pointer events */
    canvas.addEventListener('pointerdown', onDrawStart, { passive: false });
    canvas.addEventListener('pointermove', onDrawMove, { passive: false });
    canvas.addEventListener('pointerup', onDrawEnd, { passive: false });
    canvas.addEventListener('pointercancel', onDrawEnd, { passive: false });

    /* Toolbar delegation */
    var drawScreen = document.querySelector('.notes-draw-screen');
    if (drawScreen && !drawScreen.dataset.delegated) {
      drawScreen.addEventListener('click', function(e) {
        /* Stroke size */
        var strokeBtn = e.target.closest('.notes-stroke-btn');
        if (strokeBtn) {
          _drawStrokeWidth = parseInt(strokeBtn.dataset.stroke, 10) || 2;
          _drawEraser = false;
          var eraserBtn = document.getElementById('notesDrawEraser');
          if (eraserBtn) eraserBtn.classList.remove('notes-eraser-active');
          var allBtns = drawScreen.querySelectorAll('.notes-stroke-btn');
          for (var i = 0; i < allBtns.length; i++) allBtns[i].classList.remove('notes-stroke-active');
          strokeBtn.classList.add('notes-stroke-active');
          if (_drawCtx) {
            _drawCtx.globalCompositeOperation = 'source-over';
            _drawCtx.strokeStyle = '#1a1a1a';
            _drawCtx.lineWidth = _drawStrokeWidth;
          }
          return;
        }

        /* Eraser */
        var eraserBtn2 = e.target.closest('.notes-tool-eraser');
        if (eraserBtn2) {
          _drawEraser = !_drawEraser;
          eraserBtn2.classList.toggle('notes-eraser-active', _drawEraser);
          if (_drawEraser) {
            var allBtns2 = drawScreen.querySelectorAll('.notes-stroke-btn');
            for (var j = 0; j < allBtns2.length; j++) allBtns2[j].classList.remove('notes-stroke-active');
            if (_drawCtx) {
              _drawCtx.globalCompositeOperation = 'destination-out';
              _drawCtx.lineWidth = 30;
            }
          } else {
            if (_drawCtx) {
              _drawCtx.globalCompositeOperation = 'source-over';
              _drawCtx.strokeStyle = '#1a1a1a';
              _drawCtx.lineWidth = _drawStrokeWidth;
            }
          }
          return;
        }

        /* Clear */
        var clearBtn = e.target.closest('.notes-tool-clear');
        if (clearBtn) {
          if (_drawCtx) {
            _drawCtx.globalCompositeOperation = 'source-over';
            _drawCtx.fillStyle = '#ffffff';
            _drawCtx.fillRect(0, 0, canvas.width, canvas.height);
          }
          _drawHasContent = false;
          return;
        }

        /* Category pill */
        var catPill = e.target.closest('.notes-draw-cat-pill');
        if (catPill) {
          var allPills = drawScreen.querySelectorAll('.notes-draw-cat-pill');
          for (var k = 0; k < allPills.length; k++) allPills[k].classList.remove('notes-draw-cat-pill--active');
          if (_drawCategory === catPill.dataset.cat) {
            _drawCategory = '';
          } else {
            _drawCategory = catPill.dataset.cat;
            catPill.classList.add('notes-draw-cat-pill--active');
          }
          return;
        }

        /* Save button (in toolbar, not header) */
        var saveBtn = e.target.closest('#notesDrawSaveBtn');
        if (saveBtn) {
          handleDrawSave();
          return;
        }
      });
      drawScreen.dataset.delegated = 'true';
    }
  }

  function onDrawStart(e) {
    if (!_drawCtx) return;
    e.preventDefault();
    var canvas = document.getElementById('notesDrawCanvas');
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);

    var r = canvas.getBoundingClientRect();
    var x = e.clientX - r.left;
    var y = e.clientY - r.top;
    _drawPoints = [{ x: x, y: y }];

    if (_drawEraser) {
      _drawCtx.globalCompositeOperation = 'destination-out';
    } else {
      _drawCtx.globalCompositeOperation = 'source-over';
      _drawCtx.strokeStyle = '#1a1a1a';
    }
    _drawCtx.lineWidth = _drawEraser ? 30 : _drawStrokeWidth;
    _drawCtx.beginPath();
    _drawCtx.moveTo(x, y);
  }

  function onDrawMove(e) {
    if (!_drawCtx || _drawPoints.length === 0) return;
    e.preventDefault();

    var canvas = document.getElementById('notesDrawCanvas');
    if (!canvas) return;
    var r = canvas.getBoundingClientRect();
    var x = e.clientX - r.left;
    var y = e.clientY - r.top;
    _drawPoints.push({ x: x, y: y });

    var points = _drawPoints;
    if (points.length >= 3) {
      var p1 = points[points.length - 2];
      var p2 = points[points.length - 1];
      var midX = (p1.x + p2.x) / 2;
      var midY = (p1.y + p2.y) / 2;
      _drawCtx.quadraticCurveTo(p1.x, p1.y, midX, midY);
      _drawCtx.stroke();
      _drawCtx.beginPath();
      _drawCtx.moveTo(midX, midY);
    } else {
      _drawCtx.lineTo(x, y);
      _drawCtx.stroke();
      _drawCtx.beginPath();
      _drawCtx.moveTo(x, y);
    }

    if (!_drawHasContent) {
      _drawHasContent = true;
    }
  }

  function onDrawEnd(e) {
    if (!_drawCtx) return;
    _drawCtx.globalCompositeOperation = 'source-over';
    _drawPoints = [];
  }

  function handleDrawSave() {
    var canvas = document.getElementById('notesDrawCanvas');
    if (!canvas || !_drawHasContent) return;

    var data = canvas.toDataURL('image/png');
    saveDrawNote(data, _drawCategory).then(function() {
      app.showToast('Заметка сохранена');
      showListView();
    }).catch(function() {
      app.showToast('Ошибка сохранения');
    });
  }

  /* ═══════════════════════════════════════════
     TEXT EDITOR
     ═══════════════════════════════════════════ */

  function initTextEditor(initialCat) {
    _textCategory = initialCat || '';

    var editor = document.querySelector('.notes-text-editor');
    if (!editor) return;

    if (!editor.dataset.delegated) {
      editor.addEventListener('click', function(e) {
        /* Category pill toggle */
        var pill = e.target.closest('.notes-category-pill');
        if (pill) {
          var allPills = editor.querySelectorAll('.notes-category-pill');
          for (var i = 0; i < allPills.length; i++) allPills[i].classList.remove('notes-category-pill--selected');
          if (_textCategory === pill.dataset.cat) {
            _textCategory = '';
          } else {
            _textCategory = pill.dataset.cat;
            pill.classList.add('notes-category-pill--selected');
          }
          return;
        }

        /* Save button (in body, not header) */
        var saveBtn = e.target.closest('#notesTextSaveBtn');
        if (saveBtn) {
          handleTextSave();
          return;
        }
      });
      editor.dataset.delegated = 'true';
    }
  }

  function handleTextSave() {
    var titleEl = document.getElementById('notesTextTitle');
    var bodyEl = document.getElementById('notesTextBody');
    if (!titleEl || !bodyEl) return;

    var title = titleEl.value.trim();
    var body = bodyEl.value.trim();

    if (!title && !body) {
      app.showToast('Введите заголовок или текст');
      return;
    }

    saveTextNote(title, body, _textCategory).then(function() {
      app.showToast('Заметка сохранена');
      showListView();
    }).catch(function() {
      app.showToast('Ошибка сохранения');
    });
  }

  /* ═══════════════════════════════════════════
     DESTROY — cleanup при уходе с экрана
     ═══════════════════════════════════════════ */

  function destroy() {
    _menuOpen = false;
    _currentView = 'list';
    _drawCtx = null;
    _drawPoints = [];
    _editingTextId = null;
    _cachedDrawNotes = [];
    _cachedTextNotes = [];
    if (_menuOutsideHandler) {
      document.removeEventListener('pointerdown', _menuOutsideHandler);
      _menuOutsideHandler = null;
    }
  }

  /* ═══════════════════════════════════════════
     REGISTER
     ═══════════════════════════════════════════ */

  window.ModuleRegistry.register('notes', {
    title:        'Заметки',
    icon:         'edit-3',
    init:          init,
    renderHeader:  renderListHeader,
    destroy:       destroy
  });

})();
