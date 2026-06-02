/* ═══════════════════════════════════════════
   Pilot's Tool — modules/krs/index.js
   Модуль «КРС — Указания»
   ═══════════════════════════════════════════ */

(function() {
  'use strict';

  /* ─── Приватное состояние ─── */
  var _data = null;           // кэш загруженных данных (JSON)
  var _openBlocks = {};       // какие блоки раскрыты: { blockId: true/false }
  var _searchQuery = '';      // текущий поисковый запрос
  var _sortBy = 'date';       // сортировка: 'date' | 'alpha'
  var _sortMenuOpen = false;  // состояние выпадающего меню сортировки

  /* ═══════════════════════════════════════════
     AGE BADGE LOGIC
     ═══════════════════════════════════════════ */

  /**
   * Определить категорию возраста документа
   * @param {string} dateStr - ISO дата
   * @returns {string} 'new' | 'mid' | 'old'
   */
  function getAgeCategory(dateStr) {
    var docDate = new Date(dateStr);
    var now = new Date();
    var diffMs = now.getTime() - docDate.getTime();
    var diffYears = diffMs / (1000 * 60 * 60 * 24 * 365.25);
    if (diffYears < 1) return 'new';
    if (diffYears < 3) return 'mid';
    return 'old';
  }

  function getAgeLabel(category) {
    switch (category) {
      case 'new': return 'Новый';
      case 'mid': return 'Устар.';
      case 'old': return 'Старый';
    }
    return '';
  }

  /* ═══════════════════════════════════════════
     DATE FORMATTING
     ═══════════════════════════════════════════ */

  function formatDate(dateStr) {
    var d = new Date(dateStr);
    var months = [
      'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
    ];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  /* ═══════════════════════════════════════════
     COLLECT ALL PDFs FROM AN INSTRUCTION
     ═══════════════════════════════════════════ */

  function getPdfs(instruction) {
    var pdfs = [];
    if (instruction.pdf) pdfs.push(instruction.pdf);
    if (instruction.pdfs) {
      for (var i = 0; i < instruction.pdfs.length; i++) {
        pdfs.push(instruction.pdfs[i]);
      }
    }
    return pdfs;
  }

  /* ═══════════════════════════════════════════
     COLLECT ALL IMAGES FROM AN INSTRUCTION
     ═══════════════════════════════════════════ */

  function getImages(instruction) {
    var images = [];
    if (instruction.pic) images.push(instruction.pic);
    if (instruction.pics) {
      for (var i = 0; i < instruction.pics.length; i++) {
        images.push(instruction.pics[i]);
      }
    }
    return images;
  }

  /* ═══════════════════════════════════════════
     SEARCH FILTERING
     ═══════════════════════════════════════════ */

  function filterItems(items, query) {
    var q = query.trim().toLowerCase();
    if (!q) return items;

    var result = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.type === 'divider') continue;

      var titleMatch = item.title && item.title.toLowerCase().indexOf(q) !== -1;
      var textMatch = item.text && item.text.toLowerCase().indexOf(q) !== -1;
      var nameMatch = item.name && item.name.toLowerCase().indexOf(q) !== -1;

      if (titleMatch || textMatch || nameMatch) {
        result.push(item);
      }
    }
    return result;
  }

  /* ═══════════════════════════════════════════
     HEADER
     ═══════════════════════════════════════════ */

  function renderHeader() {
    var left = document.getElementById('headerLeft');
    var center = document.getElementById('headerCenter');
    var right = document.getElementById('headerRight');
    if (!left || !center || !right) return;

    // Левая кнопка: Назад
    left.innerHTML = '<button class="icon-btn" aria-label="Назад">'
      + (window.ICONS['arrow-left'] || '') + '</button>';
    left.onclick = function() { app.navigateTo('main'); };

    // Центр: название модуля
    center.innerHTML = '<div class="hc-default">Указания КРС</div>';

    // Правая кнопка: меню сортировки
    right.innerHTML = '<button class="icon-btn krs-sort-toggle" aria-label="Сортировка">'
      + (window.ICONS['ellipsis-vertical'] || '') + '</button>';
    right.onclick = function(e) {
      e.stopPropagation();
      if (_sortMenuOpen) {
        hideSortMenu();
      } else {
        showSortMenu();
      }
    };
  }

  /* ═══════════════════════════════════════════
     SORT MENU
     ═══════════════════════════════════════════ */

  function showSortMenu() {
    _sortMenuOpen = true;
    var container = document.getElementById('krsContainer');
    if (!container) return;

    // Удалить предыдущее меню если есть
    var existing = container.querySelector('.krs-sort-menu');
    if (existing) existing.remove();
    var existingOverlay = container.querySelector('.krs-sort-overlay');
    if (existingOverlay) existingOverlay.remove();

    var isDate = _sortBy === 'date';
    var isAlpha = _sortBy === 'alpha';

    var menuHtml = '<div class="krs-sort-overlay"></div>'
      + '<div class="krs-sort-menu">'
      + '<button class="krs-sort-btn' + (isDate ? ' krs-sort-btn--active' : '') + '" data-sort="date">'
      + '<span>По дате</span>'
      + '</button>'
      + '<button class="krs-sort-btn' + (isAlpha ? ' krs-sort-btn--active' : '') + '" data-sort="alpha">'
      + '<span>По алфавиту</span>'
      + '</button>'
      + '</div>';

    var wrapper = document.createElement('div');
    wrapper.innerHTML = menuHtml;
    while (wrapper.firstChild) {
      container.insertBefore(wrapper.firstChild, container.firstChild);
    }
  }

  function hideSortMenu() {
    _sortMenuOpen = false;
    var container = document.getElementById('krsContainer');
    if (!container) return;

    var overlay = container.querySelector('.krs-sort-overlay');
    var menu = container.querySelector('.krs-sort-menu');
    if (overlay) overlay.remove();
    if (menu) menu.remove();
  }

  /* ═══════════════════════════════════════════
     SEARCH TOGGLE
     ═══════════════════════════════════════════ */

  function toggleSearch() {
    var searchBar = document.getElementById('krsSearchBar');
    var input = document.getElementById('krsSearchInput');
    if (!searchBar) return;

    if (searchBar.classList.contains('krs-search-bar--open')) {
      // Закрыть поиск
      searchBar.classList.remove('krs-search-bar--open');
      _searchQuery = '';
      if (input) input.value = '';
      renderAll();
    } else {
      // Открыть поиск
      searchBar.classList.add('krs-search-bar--open');
      if (input) input.focus();
    }
  }

  /* ═══════════════════════════════════════════
     DIVIDER
     ═══════════════════════════════════════════ */

  function renderDivider(entry) {
    return '<div class="list-divider krs-divider">'
      + '<span class="list-divider-label">' + escapeHtml(entry.label || '') + '</span>'
      + '</div>';
  }

  /* ═══════════════════════════════════════════
     BLOCK (ACCORDION)
     ═══════════════════════════════════════════ */

  function renderBlock(inst) {
    var isOpen = !!_openBlocks[inst.id];
    var ageCat = getAgeCategory(inst.date);
    var ageLabel = getAgeLabel(ageCat);
    var blockClass = 'krs-block' + (isOpen ? ' krs-block--open' : '');

    var html = '<div class="' + blockClass + '" data-block-id="' + inst.id + '">';

    // Заголовок аккордеона
    html += '<div class="krs-block-header" data-block-id="' + inst.id + '">';
    if (ageLabel) {
      html += '<span class="krs-age-badge krs-age-badge--' + ageCat + '">' + ageLabel + '</span>';
    }
    html += '<span class="krs-block-title">' + escapeHtml(inst.title) + '</span>';
    html += '<span class="collapsible-chevron' + (isOpen ? ' open' : '') + '">'
      + (window.ICONS['chevron-down'] || '') + '</span>';
    html += '</div>';

    // Контент (сворачиваемый)
    html += '<div class="krs-block-content" id="krs-content-' + inst.id + '"'
      + ' style="max-height:' + (isOpen ? '5000px' : '0') + ';">';
    html += '<div class="krs-block-inner">';

    // Мета: дата + автор
    html += '<div class="krs-meta">';
    html += '<span class="krs-meta-date">' + formatDate(inst.date) + '</span>';
    html += '<span class="krs-meta-sep">·</span>';
    html += '<span class="krs-meta-author">' + escapeHtml(inst.name) + '</span>';
    html += '</div>';

    // Текст указания
    html += '<div class="krs-text">' + formatText(inst.text) + '</div>';

    // Изображения
    var images = getImages(inst);
    if (images.length > 0) {
      html += '<div class="krs-images">';
      for (var i = 0; i < images.length; i++) {
        html += '<div class="krs-img-wrap">';
        html += '<img src="' + escapeHtml(images[i]) + '" data-full-src="' + escapeHtml(images[i]) + '" alt="Вложение ' + (i + 1) + '" loading="lazy" class="krs-img">';
        html += '</div>';
      }
      html += '</div>';
    }

    // PDF файлы
    var pdfs = getPdfs(inst);
    if (pdfs.length > 0) {
      html += '<div class="krs-pdfs">';
      for (var j = 0; j < pdfs.length; j++) {
        html += '<button class="krs-pdf-btn" data-pdf="' + escapeHtml(pdfs[j]) + '">';
        html += (window.ICONS['file-text'] || '');
        html += '<span>' + (j + 1) + '. PDF</span>';
        html += (window.ICONS['download'] || '');
        html += '</button>';
      }
      html += '</div>';
    }

    html += '</div>'; // .krs-block-inner
    html += '</div>'; // .krs-block-content
    html += '</div>'; // .krs-block

    return html;
  }

  /* ═══════════════════════════════════════════
     RENDER ALL
     ═══════════════════════════════════════════ */

  function renderAll() {
    var container = document.getElementById('krsContainer');
    if (!container || !_data) return;

    var instructions = _data.instructions;
    if (!instructions) {
      app.hideSkeleton(container,
        '<div class="ct-empty-state">'
        + '<div class="ct-empty-title">Нет данных</div>'
        + '</div>');
      return;
    }

    var isSearching = _searchQuery.trim().length > 0;
    var items = isSearching ? filterItems(instructions, _searchQuery) : instructions;

    // Сортировка (только для не-divider элементов)
    if (_sortBy === 'alpha') {
      var dividers = [];
      var entries = [];
      for (var d = 0; d < items.length; d++) {
        if (items[d].type === 'divider') {
          dividers.push(items[d]);
        } else {
          entries.push(items[d]);
        }
      }
      entries.sort(function(a, b) {
        var tA = (a.title || '').toLowerCase();
        var tB = (b.title || '').toLowerCase();
        if (tA < tB) return -1;
        if (tA > tB) return 1;
        return 0;
      });
      items = entries;
    } else if (_sortBy === 'date') {
      // По умолчанию — по дате (новые сверху)
      var dividersD = [];
      var entriesD = [];
      for (var dd = 0; dd < items.length; dd++) {
        if (items[dd].type === 'divider') {
          dividersD.push(items[dd]);
        } else {
          entriesD.push(items[dd]);
        }
      }
      entriesD.sort(function(a, b) {
        var dA = new Date(a.date || 0).getTime();
        var dB = new Date(b.date || 0).getTime();
        return dB - dA;
      });
      items = entriesD;
    }

    var hasInstructions = false;

    var html = '<div>';

    // Поиск
    html += renderSearchBar();

    // Записи
    for (var i = 0; i < items.length; i++) {
      var entry = items[i];
      if (entry.type === 'divider') {
        // Скрываем разделители при поиске или сортировке
        if (!isSearching && _sortBy === 'date') {
          html += renderDivider(entry);
        }
      } else if (entry.id) {
        hasInstructions = true;
        html += renderBlock(entry);
      }
    }

    html += '</div>';

    if (isSearching && !hasInstructions) {
      html = '<div>'
        + renderSearchBar()
        + '<div class="krs-empty">'
        + (window.ICONS['search'] || '')
        + '<p class="krs-empty-text">Ничего не найдено</p>'
        + '<p class="krs-empty-sub">Попробуйте изменить запрос</p>'
        + '</div>'
        + '</div>';
    }

    app.hideSkeleton(container, html);
  }

  /* ═══════════════════════════════════════════
     SEARCH BAR
     ═══════════════════════════════════════════ */

  function renderSearchBar() {
    var isOpen = _searchQuery.trim().length > 0 ? ' krs-search-bar--open' : '';
    return '<div class="krs-search-bar' + isOpen + '" id="krsSearchBar">'
      + '<div class="krs-search-input-wrap">'
      + '<span class="krs-search-icon">' + (window.ICONS['search'] || '') + '</span>'
      + '<input type="text" class="krs-search-input" id="krsSearchInput" placeholder="Поиск по указаниям…" value="' + escapeAttr(_searchQuery) + '">'
      + (_searchQuery ? '<button class="krs-search-clear" aria-label="Очистить">' + (window.ICONS['x'] || '') + '</button>' : '')
      + '</div>'
      + '</div>';
  }

  /* ═══════════════════════════════════════════
     ACCORDION TOGGLE
     ═══════════════════════════════════════════ */

  function toggleBlock(blockId) {
    _openBlocks[blockId] = !_openBlocks[blockId];
    renderAll();
  }

  /* ═══════════════════════════════════════════
     TEXT FORMATTING
     ═══════════════════════════════════════════ */

  /**
   * Форматирование текста: перевод \n в <br>, поддержка <pre>, <b> тегов из JSON
   */
  function formatText(str) {
    if (!str) return '';
    // Разбить на блоки по <pre> тегам
    var parts = str.split(/(<pre>[\s\S]*?<\/pre>)/gi);
    var result = '';
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (part.match(/^<pre>/i)) {
        // Пропускаем <pre> блоки как есть (с HTML)
        result += part;
      } else {
        // Обычный текст: экранируем HTML (кроме <b> и </b>), \n → <br>
        var escaped = escapeHtml(part);
        // Восстанавливаем <b> и </b> из исходного текста
        escaped = escaped.replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
        escaped = escaped.replace(/\n/g, '<br>');
        result += escaped;
      }
    }
    return result;
  }

  /* ═══════════════════════════════════════════
     HTML ESCAPE
     ═══════════════════════════════════════════ */

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */

  function init() {
    var container = document.getElementById('krsContainer');
    if (!container) {
      console.error('Контейнер krsContainer не найден!');
      return;
    }

    // Контракт MODULE_CONTRACT §7: запросить библиотеки лениво через ensureLib
    app.ensureLib('photoswipe', function() {});
    app.ensureLib('pdfjs', function() {});

    // Делегирование: вешать ровно ОДИН раз
    if (!container.dataset.delegated) {
      container.addEventListener('click', function(e) {
        // Заголовок блока (аккордеон)
        var blockHeader = e.target.closest('.krs-block-header');
        if (blockHeader) {
          var blockId = blockHeader.getAttribute('data-block-id');
          if (blockId) toggleBlock(blockId);
          return;
        }

        // Кнопка очистки поиска
        var clearBtn = e.target.closest('.krs-search-clear');
        if (clearBtn) {
          _searchQuery = '';
          renderAll();
          return;
        }

        // Оверлей меню сортировки
        var sortOverlay = e.target.closest('.krs-sort-overlay');
        if (sortOverlay) {
          hideSortMenu();
          return;
        }

        // Кнопка сортировки
        var sortBtn = e.target.closest('.krs-sort-btn');
        if (sortBtn) {
          var sort = sortBtn.getAttribute('data-sort');
          if (sort && sort !== _sortBy) {
            _sortBy = sort;
          }
          hideSortMenu();
          renderAll();
          return;
        }

        // Изображение — открыть просмотр (галерея из всех фото в указании)
        // Контракт SHELL_CONTRACT §6: передаём <img> с data-full-src в app.openPhotoSwipe
        var imgWrap = e.target.closest('.krs-img-wrap');
        if (imgWrap) {
          var imgEl = imgWrap.querySelector('img[data-full-src]');
          var imagesContainer = imgWrap.closest('.krs-images');
          if (imgEl && window.app && window.app.openPhotoSwipe) {
            window.app.openPhotoSwipe(imgEl, imagesContainer);
          }
          return;
        }

        // PDF кнопка
        var pdfBtn = e.target.closest('.krs-pdf-btn');
        if (pdfBtn) {
          var pdfUrl = pdfBtn.getAttribute('data-pdf');
          if (pdfUrl && window.app && window.app.openPDFModal) {
            window.app.openPDFModal(pdfUrl);
          }
          return;
        }
      });

      // Обработчик ввода в поиск
      container.addEventListener('input', function(e) {
        var input = e.target.closest('.krs-search-input');
        if (input) {
          _searchQuery = input.value;
          renderAll();
          // Вернуть фокус в input после перерендера
          var newInput = document.getElementById('krsSearchInput');
          if (newInput) {
            newInput.focus();
            newInput.setSelectionRange(_searchQuery.length, _searchQuery.length);
          }
        }
      });

      container.dataset.delegated = 'true';
    }

    // Сбросить состояние при повторном входе
    _openBlocks = {};
    _searchQuery = '';
    _sortBy = 'date';
    _sortMenuOpen = false;

    // Загрузка данных
    if (_data) {
      renderAll();
      return;
    }

    app.showSkeleton(container, 'blocks');

    fetch('modules/krs/data/krs.json')
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        _data = data;
        renderAll();
      })
      .catch(function(err) {
        app.showError(container, 'Не удалось загрузить указания КРС');
        console.error('krs fetch error:', err);
      });
  }

  /* ═══════════════════════════════════════════
     REGISTER
     ═══════════════════════════════════════════ */

  window.ModuleRegistry.register('krs', {
    title: 'Указания КРС',
    icon: 'file-text',
    init: init,
    renderHeader: renderHeader
  });

})();
