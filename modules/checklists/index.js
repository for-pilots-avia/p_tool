/* ═══════════════════════════════════════════
   Pilot's Tool — modules/checklists/index.js
   Модуль «Чеклисты»
   ═══════════════════════════════════════════ */

(function() {
  'use strict';

  /* ─── Приватное состояние ─── */
  var _data = null;           // кэш загруженных данных (JSON)
  var _activeTab = 'safa';    // текущая вкладка: 'safa' | 'customs'
  var _openBlocks = {};       // какие блоки раскрыты: { blockId: true/false }
  var _checkedItems = {};     // отмеченные пункты: { itemId: true/false }
  var _domCreated = false;    // флаг: DOM модалок создан
  var _modalBackdrops = [];   // ссылки на backdrop-оверлеи

  /* ═══════════════════════════════════════════
     SESSION STORAGE HELPERS
     ═══════════════════════════════════════════ */

  /**
   * Загрузить состояние отмеченных пунктов из sessionStorage
   * @param {string} tab - 'safa' или 'customs'
   * @returns {Object} - { itemId: boolean }
   */
  function loadCheckedState(tab) {
    try {
      var key = 'checklists-' + tab;
      var stored = sessionStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      // ignore parse errors
    }
    return {};
  }

  /**
   * Сохранить текущее состояние _checkedItems в sessionStorage
   */
  function saveCheckedState() {
    try {
      var key = 'checklists-' + _activeTab;
      sessionStorage.setItem(key, JSON.stringify(_checkedItems));
    } catch (e) {
      // ignore quota errors
    }
  }

  /* ═══════════════════════════════════════════
     BLOCK STATUS
     ═══════════════════════════════════════════ */

  /**
   * Вычислить статус блока: все ли обязательные пункты отмечены
   * @param {Object} block - объект блока из данных
   * @returns {string} 'ok' или 'no'
   */
  function getBlockStatus(block) {
    if (!block || !block.items) return 'no';
    for (var i = 0; i < block.items.length; i++) {
      var item = block.items[i];
      if (item.required && !_checkedItems[item.id]) {
        return 'no';
      }
    }
    return 'ok';
  }

  /**
   * Подсчитать количество отмеченных обязательных и общее обязательных
   * @param {Object} block
   * @returns {{ checked: number, total: number }}
   */
  function getBlockProgress(block) {
    var checked = 0;
    var total = 0;
    if (!block || !block.items) return { checked: 0, total: 0 };
    for (var i = 0; i < block.items.length; i++) {
      var item = block.items[i];
      if (item.required) {
        total++;
        if (_checkedItems[item.id]) {
          checked++;
        }
      }
    }
    return { checked: checked, total: total };
  }

  /* ═══════════════════════════════════════════
     HEADER
     ═══════════════════════════════════════════ */

  function renderHeader() {
    var left = document.getElementById('headerLeft');
    var center = document.getElementById('headerCenter');
    var right = document.getElementById('headerRight');
    if (!left || !center || !right) return;

    // Левая кнопка: Боковое меню
    left.innerHTML = '<button class="icon-btn" aria-label="Меню">'
      + (window.ICONS.menu || '') + '</button>';
    left.onclick = function() { app.toggleMenu(); };

    // Центр: название модуля (не зависит от вкладки)
    center.innerHTML = '<div class="hc-module">Чеклисты</div>';

    // Правая кнопка: меню действий (три точки)
    right.innerHTML = '<button class="icon-btn" aria-label="Действия">'
      + (window.ICONS['ellipsis-vertical'] || '') + '</button>';
    right.onclick = function(e) {
      e.stopPropagation();
      openCommitsPanel();
    };
  }

  /* ═══════════════════════════════════════════
     DOM CREATION (динамически по контракту)
     ═══════════════════════════════════════════ */

  /**
   * Создать все DOM-элементы модалок и панелей модуля.
   * Вызывается один раз при первом init().
   * По MODULE_CONTRACT v2.2 модуль сам формирует свой HTML.
   */
  function ensureDom() {
    if (_domCreated) return;
    _domCreated = true;

    // Commits Panel Overlay
    var overlay = document.createElement('div');
    overlay.id = 'checklists-commitsOverlay';

    // Commits Panel
    var panel = document.createElement('div');
    panel.id = 'checklists-commitsPanel';
    panel.innerHTML =
      '<div class="cl-panel-body">'
      + '<button class="cl-panel-btn" id="commitsCameraBtn">'
      + '<span id="commitCameraIcon"></span>'
      + '<span>Камера</span>'
      + '</button>'
      + '<button class="cl-panel-btn" id="commitsNotesBtn">'
      + '<span id="commitNotesIcon"></span>'
      + '<span>Заметки</span>'
      + '</button>'
      + '<button class="cl-panel-btn" id="commitsDocsBtn">'
      + '<span id="commitDocsIcon"></span>'
      + '<span>Документы по рейсу</span>'
      + '</button>'
      + '<button class="cl-panel-btn" id="commitsResetBtn">'
      + '<span id="commitResetIcon"></span>'
      + '<span>Сбросить рейс</span>'
      + '</button>'
      + '</div>';

    // Camera Modal (bottom sheet)
    var cameraBackdrop = document.createElement('div');
    cameraBackdrop.className = 'cl-modal-backdrop';
    cameraBackdrop.id = 'checklists-cameraBackdrop';

    var cameraModal = document.createElement('div');
    cameraModal.id = 'checklists-cameraModal';
    cameraModal.className = 'cl-modal';
    cameraModal.innerHTML =
      '<div class="cl-modal-handle"></div>'
      + '<div class="cl-modal-header">'
      + '<button class="icon-btn" id="cameraModalClose" aria-label="Закрыть"></button>'
      + '<span class="cl-modal-title">Камера</span>'
      + '<button class="icon-btn" id="cameraAddBtn" aria-label="Добавить фото"></button>'
      + '</div>'
      + '<div class="cl-modal-body">'
      + '<input type="file" id="cameraFileInput" accept="image/*" capture="environment" multiple style="display:none">'
      + '<div id="cameraGallery" class="cl-camera-gallery">'
      + '<div class="cl-camera-empty">'
      + (window.ICONS['camera'] || '')
      + '<span>Нет фотографий</span>'
      + '</div>'
      + '</div>'
      + '</div>';

    // Notes Modal (bottom sheet)
    var notesBackdrop = document.createElement('div');
    notesBackdrop.className = 'cl-modal-backdrop';
    notesBackdrop.id = 'checklists-notesBackdrop';

    var notesModal = document.createElement('div');
    notesModal.id = 'checklists-notesModal';
    notesModal.className = 'cl-modal';
    notesModal.innerHTML =
      '<div class="cl-modal-handle"></div>'
      + '<div class="cl-modal-header">'
      + '<button class="icon-btn" id="notesModalClose" aria-label="Закрыть"></button>'
      + '<span class="cl-modal-title">Заметки</span>'
      + '<span></span>'
      + '</div>'
      + '<div class="cl-modal-body">'
      + '<div class="cl-notes-input-wrap">'
      + '<textarea id="notesInput" class="cl-notes-input" placeholder="Введите заметку..." rows="3"></textarea>'
      + '<button class="cl-notes-add-btn" id="notesAddBtn">'
      + '<span id="notesSendIcon"></span>'
      + '</button>'
      + '</div>'
      + '<div id="notesList" class="cl-notes-list"></div>'
      + '</div>';

    // Docs Modal (bottom sheet) — показывает фото + заметки
    var docsBackdrop = document.createElement('div');
    docsBackdrop.className = 'cl-modal-backdrop';
    docsBackdrop.id = 'checklists-docsBackdrop';

    var docsModal = document.createElement('div');
    docsModal.id = 'checklists-docsModal';
    docsModal.className = 'cl-modal';
    docsModal.innerHTML =
      '<div class="cl-modal-handle"></div>'
      + '<div class="cl-modal-header">'
      + '<button class="icon-btn" id="docsModalClose" aria-label="Закрыть"></button>'
      + '<span class="cl-modal-title">Документы по рейсу</span>'
      + '<span></span>'
      + '</div>'
      + '<div class="cl-modal-body">'
      + '<div id="docsContent"></div>'
      + '</div>';

    // Сохранить ссылки на backdrop
    _modalBackdrops = [cameraBackdrop, notesBackdrop, docsBackdrop];

    // Добавить в body
    document.body.appendChild(overlay);
    document.body.appendChild(panel);
    document.body.appendChild(cameraBackdrop);
    document.body.appendChild(cameraModal);
    document.body.appendChild(notesBackdrop);
    document.body.appendChild(notesModal);
    document.body.appendChild(docsBackdrop);
    document.body.appendChild(docsModal);
  }

  /**
   * Удалить все DOM-элементы модалок и панелей.
   * Вызывается из destroy() при уходе с модуля.
   */
  function removeDom() {
    var ids = [
      'checklists-commitsOverlay', 'checklists-commitsPanel',
      'checklists-cameraBackdrop', 'checklists-cameraModal',
      'checklists-notesBackdrop', 'checklists-notesModal',
      'checklists-docsBackdrop', 'checklists-docsModal'
    ];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) el.remove();
    }
    _modalBackdrops = [];
    _domCreated = false;
  }

  /* ═══════════════════════════════════════════
     COMMITS PANEL
     ═══════════════════════════════════════════ */

  function openCommitsPanel() {
    var panel = document.getElementById('checklists-commitsPanel');
    var overlay = document.getElementById('checklists-commitsOverlay');
    if (panel) panel.classList.add('open');
    if (overlay) overlay.classList.add('open');
  }

  function closeCommitsPanel() {
    var panel = document.getElementById('checklists-commitsPanel');
    var overlay = document.getElementById('checklists-commitsOverlay');
    if (panel) panel.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
  }

  function initCommitsPanelListeners() {
    var panel = document.getElementById('checklists-commitsPanel');
    if (!panel) return;

    // Клик по оверлею закрывает панель (как «Сбросить рейс»)
    var overlay = document.getElementById('checklists-commitsOverlay');
    if (overlay) {
      overlay.addEventListener('click', function() { closeCommitsPanel(); });
    }

    // Иконки
    var closeBtn = document.getElementById('commitsPanelClose');
    var resetIcon = document.getElementById('commitResetIcon');
    var cameraIcon = document.getElementById('commitCameraIcon');
    var notesIcon = document.getElementById('commitNotesIcon');
    var docsIcon = document.getElementById('commitDocsIcon');
    if (window.ICONS) {
      if (closeBtn) closeBtn.innerHTML = window.ICONS['x'];
      if (resetIcon) resetIcon.innerHTML = window.ICONS['rotate-ccw'];
      if (cameraIcon) cameraIcon.innerHTML = window.ICONS['camera'];
      if (notesIcon) notesIcon.innerHTML = window.ICONS['message-square'];
      if (docsIcon) docsIcon.innerHTML = window.ICONS['file-text'];
    }

    // Панель
    panel.addEventListener('click', function(e) {
      if (e.target.closest('#commitsPanelClose')) { closeCommitsPanel(); return; }
      if (e.target.closest('#commitsResetBtn')) { closeCommitsPanel(); resetChecks(); return; }
      if (e.target.closest('#commitsCameraBtn')) { closeCommitsPanel(); openCameraModal(); return; }
      if (e.target.closest('#commitsNotesBtn')) { closeCommitsPanel(); openNotesModal(); return; }
      if (e.target.closest('#commitsDocsBtn')) { closeCommitsPanel(); openDocsModal(); return; }
    });
  }

  /* ═══════════════════════════════════════════
     CAMERA MODAL
     ═══════════════════════════════════════════ */

  var _cameraPhotos = []; // { id, dataUrl, name }

  function openCameraModal() {
    var backdrop = document.getElementById('checklists-cameraBackdrop');
    var modal = document.getElementById('checklists-cameraModal');
    if (backdrop) backdrop.style.display = 'block';
    if (modal) modal.classList.add('open');
    renderCameraGallery();
  }

  function closeCameraModal() {
    var backdrop = document.getElementById('checklists-cameraBackdrop');
    var modal = document.getElementById('checklists-cameraModal');
    if (backdrop) backdrop.style.display = 'none';
    if (modal) modal.classList.remove('open');
  }

  function renderCameraGallery() {
    var gallery = document.getElementById('cameraGallery');
    if (!gallery) return;

    if (_cameraPhotos.length === 0) {
      gallery.innerHTML = '<div class="cl-camera-empty">'
        + (window.ICONS['camera'] || '')
        + '<span>Нет фотографий</span></div>';
      return;
    }

    var html = '';
    for (var i = 0; i < _cameraPhotos.length; i++) {
      var photo = _cameraPhotos[i];
      html += '<div class="cl-camera-thumb" data-index="' + i + '">'
        + '<img src="' + photo.dataUrl + '" data-full-src="' + photo.dataUrl + '" alt="' + window.app.escapeAttr(photo.name) + '">'
        + '<button class="cl-camera-thumb-delete" data-photo-id="' + photo.id + '" aria-label="Удалить">'
        + (window.ICONS['x'] || '') + '</button>'
        + '</div>';
    }
    gallery.innerHTML = html;
  }

  function initCameraListeners() {
    var modal = document.getElementById('checklists-cameraModal');
    if (!modal) return;

    var closeBtn = document.getElementById('cameraModalClose');
    var addBtn = document.getElementById('cameraAddBtn');
    if (closeBtn) closeBtn.innerHTML = window.ICONS['arrow-left'] || '';
    if (addBtn) addBtn.innerHTML = window.ICONS['plus'] || '';

    // Закрытие по клику на backdrop
    var cameraBackdrop = document.getElementById('checklists-cameraBackdrop');
    if (cameraBackdrop) {
      cameraBackdrop.addEventListener('click', closeCameraModal);
    }

    modal.addEventListener('click', function(e) {
      if (e.target.closest('#cameraModalClose')) { closeCameraModal(); return; }
      if (e.target.closest('#cameraAddBtn')) {
        var fileInput = document.getElementById('cameraFileInput');
        if (fileInput) fileInput.click();
        return;
      }
      var deleteBtn = e.target.closest('.cl-camera-thumb-delete');
      if (deleteBtn) {
        var photoId = deleteBtn.getAttribute('data-photo-id');
        _cameraPhotos = _cameraPhotos.filter(function(p) { return p.id !== photoId; });
        renderCameraGallery();
        return;
      }
      var thumb = e.target.closest('.cl-camera-thumb');
      if (thumb) {
        // Фото-просмотр через PhotoSwipe (контракт SHELL_CONTRACT §6)
        var imgEl = thumb.querySelector('img[data-full-src]');
        if (imgEl && window.app && window.app.openPhotoSwipe) {
          window.app.openPhotoSwipe(imgEl, document.getElementById('cameraGallery'));
        }
        return;
      }
    });

    var fileInput = document.getElementById('cameraFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', function(e) {
        var files = e.target.files;
        for (var i = 0; i < files.length; i++) {
          (function(file) {
            var reader = new FileReader();
            reader.onload = function(ev) {
              _cameraPhotos.push({
                id: 'photo-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
                dataUrl: ev.target.result,
                name: file.name
              });
              renderCameraGallery();
            };
            reader.readAsDataURL(file);
          })(files[i]);
        }
        fileInput.value = '';
      });
    }
  }

  /* ═══════════════════════════════════════════
     NOTES MODAL
     ═══════════════════════════════════════════ */

  var _notes = []; // { id, text, time }

  function openNotesModal() {
    var backdrop = document.getElementById('checklists-notesBackdrop');
    var modal = document.getElementById('checklists-notesModal');
    if (backdrop) backdrop.style.display = 'block';
    if (modal) modal.classList.add('open');
    loadNotes();
    renderNotesList();
  }

  function closeNotesModal() {
    var backdrop = document.getElementById('checklists-notesBackdrop');
    var modal = document.getElementById('checklists-notesModal');
    if (backdrop) backdrop.style.display = 'none';
    if (modal) modal.classList.remove('open');
  }

  function loadNotes() {
    try {
      var stored = sessionStorage.getItem('checklists-notes');
      if (stored) _notes = JSON.parse(stored);
    } catch (e) { /* ignore */ }
  }

  function saveNotes() {
    try {
      sessionStorage.setItem('checklists-notes', JSON.stringify(_notes));
    } catch (e) { /* ignore */ }
  }

  function addNote() {
    var input = document.getElementById('notesInput');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;

    _notes.unshift({
      id: 'note-' + Date.now(),
      text: text,
      time: new Date().toLocaleString('ru-RU')
    });
    saveNotes();
    input.value = '';
    renderNotesList();
  }

  function deleteNote(noteId) {
    _notes = _notes.filter(function(n) { return n.id !== noteId; });
    saveNotes();
    renderNotesList();
  }

  function renderNotesList() {
    var list = document.getElementById('notesList');
    if (!list) return;

    if (_notes.length === 0) {
      list.innerHTML = '<div class="cl-notes-empty">Нет заметок</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < _notes.length; i++) {
      var note = _notes[i];
      html += '<div class="cl-note-item">'
        + '<div class="cl-note-item-text">' + window.app.escapeHtmlWithBreaks(note.text) + '</div>'
        + '<div class="cl-note-item-time">' + window.app.escapeHtml(note.time) + '</div>'
        + '<button class="cl-note-item-delete" data-note-id="' + note.id + '" aria-label="Удалить">'
        + (window.ICONS['trash-2'] || '') + '</button>'
        + '</div>';
    }
    list.innerHTML = html;
  }

  function initNotesListeners() {
    var modal = document.getElementById('checklists-notesModal');
    if (!modal) return;

    var closeBtn = document.getElementById('notesModalClose');
    var sendIcon = document.getElementById('notesSendIcon');
    if (closeBtn) closeBtn.innerHTML = window.ICONS['arrow-left'] || '';
    if (sendIcon) sendIcon.innerHTML = window.ICONS['send'] || '';

    // Закрытие по клику на backdrop
    var notesBackdrop = document.getElementById('checklists-notesBackdrop');
    if (notesBackdrop) {
      notesBackdrop.addEventListener('click', closeNotesModal);
    }

    modal.addEventListener('click', function(e) {
      if (e.target.closest('#notesModalClose')) { closeNotesModal(); return; }
      if (e.target.closest('#notesAddBtn')) { addNote(); return; }
      var delBtn = e.target.closest('.cl-note-item-delete');
      if (delBtn) {
        var noteId = delBtn.getAttribute('data-note-id');
        if (noteId) deleteNote(noteId);
        return;
      }
    });
  }

  /* ═══════════════════════════════════════════
     DOCS MODAL (сводное окно: фото + заметки)
     ═══════════════════════════════════════════ */

  function openDocsModal() {
    var backdrop = document.getElementById('checklists-docsBackdrop');
    var modal = document.getElementById('checklists-docsModal');
    if (backdrop) backdrop.style.display = 'block';
    if (modal) modal.classList.add('open');
    loadNotes(); // подгрузить актуальные заметки
    renderDocsContent();
  }

  function closeDocsModal() {
    var backdrop = document.getElementById('checklists-docsBackdrop');
    var modal = document.getElementById('checklists-docsModal');
    if (backdrop) backdrop.style.display = 'none';
    if (modal) modal.classList.remove('open');
  }

  /**
   * Рендер содержимого окна Документы: фото из Камеры + заметки из Заметок
   */
  function renderDocsContent() {
    var content = document.getElementById('docsContent');
    if (!content) return;

    var hasPhotos = _cameraPhotos.length > 0;
    var hasNotes = _notes.length > 0;

    if (!hasPhotos && !hasNotes) {
      content.innerHTML = '<div class="cl-docs-empty">'
        + (window.ICONS['file-text'] || '')
        + '<span>Нет документов</span></div>';
      return;
    }

    var html = '';

    // Секция: Фотографии
    if (hasPhotos) {
      html += '<div class="cl-docs-section">'
        + '<div class="cl-docs-section-title">'
        + (window.ICONS['camera'] || '')
        + '<span>Фотографии</span>'
        + '<span class="cl-docs-section-count">' + _cameraPhotos.length + '</span>'
        + '</div>'
        + '<div class="cl-docs-photos">';
      for (var i = 0; i < _cameraPhotos.length; i++) {
        var photo = _cameraPhotos[i];
        html += '<div class="cl-docs-photo-thumb" data-doc-photo-index="' + i + '">'
          + '<img src="' + photo.dataUrl + '" data-full-src="' + photo.dataUrl + '" alt="' + window.app.escapeAttr(photo.name) + '">'
          + '</div>';
      }
      html += '</div></div>';
    }

    // Секция: Заметки
    if (hasNotes) {
      html += '<div class="cl-docs-section">'
        + '<div class="cl-docs-section-title">'
        + (window.ICONS['message-square'] || '')
        + '<span>Заметки</span>'
        + '<span class="cl-docs-section-count">' + _notes.length + '</span>'
        + '</div>';
      for (var j = 0; j < _notes.length; j++) {
        var note = _notes[j];
        html += '<div class="cl-docs-note">'
          + '<div class="cl-docs-note-text">' + window.app.escapeHtmlWithBreaks(note.text) + '</div>'
          + '<div class="cl-docs-note-time">' + window.app.escapeHtml(note.time) + '</div>'
          + '</div>';
      }
      html += '</div>';
    }

    content.innerHTML = html;
  }

  function initDocsListeners() {
    var modal = document.getElementById('checklists-docsModal');
    if (!modal) return;

    var closeBtn = document.getElementById('docsModalClose');
    if (closeBtn) closeBtn.innerHTML = window.ICONS['arrow-left'] || '';

    // Закрытие по клику на backdrop
    var docsBackdrop = document.getElementById('checklists-docsBackdrop');
    if (docsBackdrop) {
      docsBackdrop.addEventListener('click', closeDocsModal);
    }

    modal.addEventListener('click', function(e) {
      if (e.target.closest('#docsModalClose')) { closeDocsModal(); return; }

      // Клик на миниатюру фото — открыть просмотр через PhotoSwipe (контракт SHELL_CONTRACT §6)
      var photoThumb = e.target.closest('.cl-docs-photo-thumb');
      if (photoThumb) {
        var imgEl = photoThumb.querySelector('img[data-full-src]');
        var docsContentEl = document.getElementById('docsContent');
        var photosContainer = docsContentEl ? docsContentEl.querySelector('.cl-docs-photos') : null;
        if (imgEl && window.app && window.app.openPhotoSwipe) {
          window.app.openPhotoSwipe(imgEl, photosContainer);
        }
        return;
      }
    });
  }

  /* ═══════════════════════════════════════════
     TAB BAR
     ═══════════════════════════════════════════ */

  function renderTabBar() {
    var safaActive = _activeTab === 'safa' ? ' cl-tab-active' : '';
    var customsActive = _activeTab === 'customs' ? ' cl-tab-active' : '';

    return '<div class="cl-tabs">'
      + '<button class="cl-tab-btn' + safaActive + '" data-tab="safa">SAFA</button>'
      + '<button class="cl-tab-btn' + customsActive + '" data-tab="customs">Таможня</button>'
      + '</div>';
  }

  /* ═══════════════════════════════════════════
     DIVIDER
     ═══════════════════════════════════════════ */

  function renderDivider(entry) {
    return '<div class="list-divider cl-divider">'
      + '<span class="list-divider-label">' + window.app.renderRichText(entry.label) + '</span>'
      + '</div>';
  }

  /* ═══════════════════════════════════════════
     BLOCK (ACCORDION)
     ═══════════════════════════════════════════ */

  function renderBlock(block) {
    var isOpen = !!_openBlocks[block.id];
    var status = getBlockStatus(block);
    var progress = getBlockProgress(block);
    var isOk = status === 'ok';
    var badgeClass = 'cl-badge ' + (isOk ? 'cl-badge--ok' : 'cl-badge--no');
    var badgeText = isOk ? 'OK' : 'NO';
    var blockClass = 'cl-block' + (isOpen ? ' open' : '') + (isOk ? ' cl-block--ok' : '');

    var pct = progress.total > 0
      ? Math.round((progress.checked / progress.total) * 100)
      : 0;

    var html = '<div class="' + blockClass + '" data-block-id="' + block.id + '">';

    // Заголовок аккордеона (контракт MODULE_CONTRACT §7: шеврон — прямой потомок .cl-block-header)
    html += '<div class="cl-block-header" data-block-id="' + block.id + '">';
    html += '<span class="collapsible-chevron">'
      + (window.ICONS['chevron-down'] || '') + '</span>';
    html += '<span class="collapsible-title"' + window.app.langAttr(block.title) + '><span class="marquee-inner">' + window.app.escapeHtml(block.title) + '</span></span>';
    html += '<span class="' + badgeClass + '">' + badgeText + '</span>';
    html += '</div>';

    // Заметка блока (видна всегда)
    if (block.note) {
      html += '<div class="cl-block-note"' + window.app.langAttr(block.note) + '>' + window.app.escapeHtmlWithBreaks(block.note) + '</div>';
    }

    // Контент (сворачиваемый)
    html += '<div class="cl-block-content' + (isOpen ? ' cl-block-content--open' : '') + '" id="cl-content-' + block.id + '">';
    html += '<div class="cl-block-items">';

    // Прогресс-бар
    html += '<div class="cl-progress">';
    html += '<span class="cl-progress-text">' + progress.checked + ' / ' + progress.total + ' обязательных</span>';
    html += '<div class="cl-progress-bar">';
    html += '<div class="cl-progress-fill" style="width:' + pct + '%;"></div>';
    html += '</div>';
    html += '</div>';

    // Пункты чеклиста
    for (var i = 0; i < block.items.length; i++) {
      var item = block.items[i];
      var isChecked = !!_checkedItems[item.id];
      var itemClass = 'cl-item' + (!item.required ? ' cl-item--optional' : '');

      html += '<label class="' + itemClass + '" data-item-id="' + item.id + '">';
      html += '<input type="checkbox" class="cl-checkbox" data-item-id="' + item.id + '"'
        + (isChecked ? ' checked' : '') + '>';
      html += '<span class="cl-checkbox-visual' + (isChecked ? ' cl-checkbox-checked' : '') + '">'
        + '<svg class="cl-checkmark" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
        + ' stroke-width="3" stroke-linecap="round" stroke-linejoin="round">'
        + '<polyline points="20 6 9 17 4 12"></polyline>'
        + '</svg></span>';
      html += '<span class="cl-item-text">';
      html += '<span class="cl-item-label"' + window.app.langAttr(item.label) + '>' + window.app.escapeHtml(item.label) + '</span>';
      if (!item.required) {
        html += '<span class="cl-optional-badge">необязательно</span>';
      }
      if (item.note) {
        html += '<span class="cl-item-note"' + window.app.langAttr(item.note) + '>' + window.app.escapeHtmlWithBreaks(item.note) + '</span>';
      }
      html += '</span>';
      html += '</label>';
    }

    html += '</div>'; // .cl-block-items
    html += '</div>'; // .cl-block-content
    html += '</div>'; // .cl-block

    return html;
  }

  /* ═══════════════════════════════════════════
     RENDER ALL
     ═══════════════════════════════════════════ */

  function renderAll() {
    var container = document.getElementById('checklistsContainer');
    if (!container || !_data) return;

    var entries = _data[_activeTab];
    if (!entries) {
      app.hideSkeleton(container,
        '<div class="ct-empty-state">'
        + '<div class="ct-empty-title">Нет данных</div>'
        + '</div>');
      return;
    }

    var html = '<div class="module-container">';

    // Табы
    html += renderTabBar();

    // Записи
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (entry.type === 'divider') {
        html += renderDivider(entry);
      } else if (entry.id && entry.items) {
        html += renderBlock(entry);
      }
    }

    html += '</div>';

    app.hideSkeleton(container, html);

    // Marquee убран: заголовки переносятся в 2 строки через CSS -webkit-line-clamp
  }

  /* ═══════════════════════════════════════════
     TAB SWITCHING
     ═══════════════════════════════════════════ */

  function switchTab(tab) {
    if (tab === _activeTab) return;

    // Сохранить текущее состояние перед переключением
    saveCheckedState();

    _activeTab = tab;
    _openBlocks = {};
    _checkedItems = loadCheckedState(tab);

    renderHeader();
    renderAll();
  }

  /* ═══════════════════════════════════════════
     ACCORDION TOGGLE
     ═══════════════════════════════════════════ */

  function toggleBlock(blockId) {
    _openBlocks[blockId] = !_openBlocks[blockId];
    renderAll();
  }

  /* ═══════════════════════════════════════════
     ITEM TOGGLE
     ═══════════════════════════════════════════ */

  function toggleItem(itemId) {
    _checkedItems[itemId] = !_checkedItems[itemId];
    saveCheckedState();

    // Обновить только изменённый блок без полного перерендера
    updateItemVisual(itemId);
    updateBlockBadgeForItem(itemId);
  }

  /**
   * Обновить визуальное состояние чекбокса без перерендера
   */
  function updateItemVisual(itemId) {
    var container = document.getElementById('checklistsContainer');
    if (!container) return;

    var checkbox = container.querySelector('.cl-checkbox[data-item-id="' + itemId + '"]');
    if (!checkbox) return;

    var isChecked = !!_checkedItems[itemId];
    checkbox.checked = isChecked;

    var visual = checkbox.parentElement.querySelector('.cl-checkbox-visual');
    if (visual) {
      if (isChecked) {
        visual.classList.add('cl-checkbox-checked');
      } else {
        visual.classList.remove('cl-checkbox-checked');
      }
    }
  }

  /**
   * Обновить бейдж и прогресс-бар блока, содержащего пункт
   */
  function updateBlockBadgeForItem(itemId) {
    var container = document.getElementById('checklistsContainer');
    if (!container || !_data) return;

    // Найти блок, содержащий этот itemId
    var entries = _data[_activeTab];
    if (!entries) return;

    var block = null;
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (entry.items) {
        for (var j = 0; j < entry.items.length; j++) {
          if (entry.items[j].id === itemId) {
            block = entry;
            break;
          }
        }
      }
      if (block) break;
    }

    if (!block) return;

    var status = getBlockStatus(block);
    var progress = getBlockProgress(block);
    var isOk = status === 'ok';
    var pct = progress.total > 0
      ? Math.round((progress.checked / progress.total) * 100)
      : 0;

    // Обновить бейдж
    var blockEl = container.querySelector('.cl-block[data-block-id="' + block.id + '"]');
    if (blockEl) {
      var badge = blockEl.querySelector('.cl-badge');
      if (badge) {
        badge.className = 'cl-badge ' + (isOk ? 'cl-badge--ok' : 'cl-badge--no');
        badge.textContent = isOk ? 'OK' : 'NO';
      }

      // Обновить класс блока
      if (isOk) {
        blockEl.classList.add('cl-block--ok');
      } else {
        blockEl.classList.remove('cl-block--ok');
      }

      // Обновить прогресс
      var progressText = blockEl.querySelector('.cl-progress-text');
      if (progressText) {
        progressText.textContent = progress.checked + ' / ' + progress.total + ' обязательных';
      }

      var progressFill = blockEl.querySelector('.cl-progress-fill');
      if (progressFill) {
        progressFill.style.width = pct + '%';
      }
    }
  }

  /* ═══════════════════════════════════════════
     RESET
     ═══════════════════════════════════════════ */

  function resetChecks() {
    app.showConfirm('Сбросить рейс?', function() {
      _checkedItems = {};
      try {
        sessionStorage.removeItem('checklists-' + _activeTab);
      } catch (e) {
        // ignore
      }
      closeCommitsPanel();
      renderAll();
      app.showToast('Рейс сброшен');
    }, 'Сбросить');
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */

  function init(params) {
    var container = document.getElementById('checklistsContainer');
    if (!container) {
      console.error('Контейнер checklistsContainer не найден!');
      return;
    }

    // lang="ru" для корректной расстановки переносов (hyphens: auto в CSS, MODULE_CONTRACT §7)
    container.setAttribute('lang', 'ru');

    // Контракт MODULE_CONTRACT §7: запросить библиотеку лениво через ensureLib
    app.ensureLib('photoswipe', function() {});

    // Создать DOM модалок/панелей динамически (по контракту)
    ensureDom();

    // Делегирование событий (контракт MODULE_CONTRACT §5: init() вызывается строго один раз)
    container.addEventListener('click', function(e) {
      // Табы
      var tabBtn = e.target.closest('.cl-tab-btn');
      if (tabBtn) {
        var tab = tabBtn.getAttribute('data-tab');
        if (tab) switchTab(tab);
        return;
      }

      // Заголовок блока (аккордеон)
      var blockHeader = e.target.closest('.cl-block-header');
      if (blockHeader) {
        var blockId = blockHeader.getAttribute('data-block-id');
        if (blockId) toggleBlock(blockId);
        return;
      }
    });

    // Обработчик change для чекбоксов
    container.addEventListener('change', function(e) {
      var checkbox = e.target.closest('.cl-checkbox');
      if (checkbox) {
        var itemId = checkbox.getAttribute('data-item-id');
        if (itemId) toggleItem(itemId);
      }
    });

    // Начальное состояние (контракт: init() вызывается строго ОДИН раз)
    _activeTab = 'safa';
    _openBlocks = {};
    _checkedItems = loadCheckedState(_activeTab);
    initCommitsPanelListeners();
    initCameraListeners();
    initNotesListeners();
    initDocsListeners();

    // Загрузка данных
    if (_data) {
      renderAll();
      return;
    }

    app.showSkeleton(container, 'blocks');

    fetch('modules/checklists/data/checklists.json')
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        _data = data;
        renderAll();
      })
      .catch(function(err) {
        app.showError(container, 'Не удалось загрузить чеклисты');
        console.error('checklist fetch error:', err);
      });
  }

  /* ═══════════════════════════════════════════
     DESTROY (cleanup при уходе с модуля)
     ═══════════════════════════════════════════ */

  function destroy() {
    // Закрыть все открытые панели/модалки
    closeCommitsPanel();
    closeCameraModal();
    closeNotesModal();
    closeDocsModal();

    // Удалить динамически созданный DOM модалок
    removeDom();
  }

  /* ═══════════════════════════════════════════
     REGISTER
     ═══════════════════════════════════════════ */

  window.ModuleRegistry.register('checklists', {
    title: 'Чеклисты',
    icon: 'checklist',
    init: init,
    renderHeader: renderHeader,
    destroy: destroy
  });

})();
