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

  function formatBadgeDate(dateStr) {
    var d = new Date(dateStr);
    var year = d.getFullYear();
    var month = d.getMonth() + 1;
    return year + '.' + (month < 10 ? '0' + month : month);
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

    // Левая кнопка: Боковое меню
    left.innerHTML = '<button class="icon-btn" aria-label="Меню">'
      + (window.ICONS.menu || '') + '</button>';
    left.onclick = function() { app.toggleMenu(); };

    // Центр: название модуля
    center.innerHTML = '<div class="hc-module">Указания КРС</div>';

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

    // Удалить предыдущее меню и оверлей если есть
    var existing = container.querySelector('.krs-sort-menu');
    if (existing) existing.remove();
    var existingOverlay = document.getElementById('krs-sort-overlay');
    if (existingOverlay) existingOverlay.remove();

    // Оверлей на весь экран (включая хедер) — клик по нему закрывает меню
    var overlay = document.createElement('div');
    overlay.id = 'krs-sort-overlay';
    overlay.className = 'krs-sort-overlay';
    overlay.addEventListener('click', function() { hideSortMenu(); });
    document.body.appendChild(overlay);

    var isDate = _sortBy === 'date';
    var isAlpha = _sortBy === 'alpha';

    var menuHtml = '<div class="krs-sort-menu">'
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

    var menu = container.querySelector('.krs-sort-menu');
    if (menu) menu.remove();

    // Удалить оверлей
    var overlay = document.getElementById('krs-sort-overlay');
    if (overlay) overlay.remove();
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
      + '<span class="list-divider-label">' + window.app.renderRichText(entry.label || '') + '</span>'
      + '</div>';
  }

  /* ═══════════════════════════════════════════
     BLOCK (ACCORDION)
     ═══════════════════════════════════════════ */

  function renderBlock(inst) {
    var isOpen = !!_openBlocks[inst.id];
    var ageCat = getAgeCategory(inst.date);
    var ageLabel = formatBadgeDate(inst.date);
    var blockClass = 'krs-block' + (isOpen ? ' open' : '');

    var html = '<div class="' + blockClass + '" data-block-id="' + inst.id + '">';

    // Заголовок аккордеона
    html += '<div class="krs-block-header" data-block-id="' + inst.id + '">';
    var addres = inst.addres ? window.app.renderRichText(inst.addres) : '';
    if (addres) {
      // Бейдж даты + маркер адресата в вертикальном стеке
      html += '<div class="krs-badge-stack">';
      if (ageLabel) {
        html += '<span class="krs-age-badge krs-age-badge--' + ageCat + '">' + ageLabel + '</span>';
      }
      html += '<span class="krs-addres-marker">' + addres + '</span>';
      html += '</div>';
    } else if (ageLabel) {
      html += '<span class="krs-age-badge krs-age-badge--' + ageCat + '">' + ageLabel + '</span>';
    }
    html += '<span class="collapsible-title"' + window.app.langAttr(inst.title) + '><span class="marquee-inner">' + window.app.escapeHtml(inst.title) + '</span></span>';
    html += '<span class="collapsible-chevron">'
      + (window.ICONS['chevron-down'] || '') + '</span>';
    html += '</div>';

    // Контент (сворачиваемый)
    html += '<div class="krs-block-content' + (isOpen ? ' krs-block-content--open' : '') + '" id="krs-content-' + inst.id + '">';
    html += '<div class="krs-block-inner">';

    // Мета: дата + автор
    html += '<div class="krs-meta">';
    html += '<span class="krs-meta-date">' + formatDate(inst.date) + '</span>';
    html += '<span class="krs-meta-sep">·</span>';
    html += '<span class="krs-meta-author">' + window.app.escapeHtml(inst.name) + '</span>';
    html += '</div>';

    // Текст указания
    html += '<div class="krs-text"' + window.app.langAttr(inst.text) + '>' + window.app.renderRichText(inst.text) + '</div>';

    // Изображения
    var images = getImages(inst);
    if (images.length > 0) {
      html += '<div class="krs-images">';
      for (var i = 0; i < images.length; i++) {
        html += '<div class="krs-img-wrap">';
        html += '<img src="' + window.app.escapeAttr(images[i]) + '" data-full-src="' + window.app.escapeAttr(images[i]) + '" alt="Вложение ' + (i + 1) + '" loading="lazy" class="krs-img">';
        html += '</div>';
      }
      html += '</div>';
    }

    // PDF файлы
    var pdfs = getPdfs(inst);
    if (pdfs.length > 0) {
      html += '<div class="krs-pdfs">';
      for (var j = 0; j < pdfs.length; j++) {
        html += '<button class="krs-pdf-btn" data-pdf="' + window.app.escapeAttr(pdfs[j]) + '">';
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

    var html = '<div class="module-container">';

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
      html = '<div class="module-container">'
        + renderSearchBar()
        + '<div class="krs-empty">'
        + (window.ICONS['search'] || '')
        + '<p class="krs-empty-text">Ничего не найдено</p>'
        + '<p class="krs-empty-sub">Попробуйте изменить запрос</p>'
        + '</div>'
        + '</div>';
    }

    app.hideSkeleton(container, html);

    // Marquee убран: заголовки переносятся в 2 строки через CSS -webkit-line-clamp
  }

  /* ═══════════════════════════════════════════
     SEARCH BAR
     ═══════════════════════════════════════════ */

  function renderSearchBar() {
    var isOpen = _searchQuery.trim().length > 0 ? ' krs-search-bar--open' : '';
    return '<div class="ct-search-bar krs-search' + isOpen + '" id="krsSearchBar">'
      + '<div class="ct-search-input-wrap">'
      + '<span class="ct-search-icon">' + (window.ICONS['search'] || '') + '</span>'
      + '<input type="text" class="ct-search-input" id="krsSearchInput" placeholder="Поиск по указаниям…" value="' + window.app.escapeAttr(_searchQuery) + '">'
      + (_searchQuery ? '<button class="ct-search-clear visible" aria-label="Очистить">' + (window.ICONS['x'] || '') + '</button>' : '')
      + '</div>'
      + '</div>';
  }

  /* ═══════════════════════════════════════════
     ACCORDION TOGGLE
     ═══════════════════════════════════════════ */

  function toggleBlock(blockId) {
    var wasOpen = _openBlocks[blockId];
    _openBlocks = {};
    if (!wasOpen) {
      _openBlocks[blockId] = true;
    }
    renderAll();
    // Прокрутить к открываемому блоку с поправкой на хедер
    if (!wasOpen) {
      var blockEl = document.querySelector('.krs-block[data-block-id="' + blockId + '"]');
      if (blockEl) {
        setTimeout(function() {
          var rect = blockEl.getBoundingClientRect();
          var headerEl = document.getElementById('appHeader');
          var headerH = headerEl ? headerEl.offsetHeight : 56;
          var y = window.pageYOffset + rect.top - headerH - 8;
          window.scrollTo({ top: y, behavior: 'smooth' });
        }, 50);
      }
    }
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */

  function init(params) {
    var container = document.getElementById('krsContainer');
    if (!container) {
      console.error('Контейнер krsContainer не найден!');
      return;
    }

    // lang="ru" для корректной расстановки переносов (hyphens: auto в CSS)
    container.setAttribute('lang', 'ru');

    // Контракт MODULE_CONTRACT §7: запросить библиотеки лениво через ensureLib
    app.ensureLib('photoswipe', function() {});
    app.ensureLib('pdfjs', function() {});

    // Делегирование событий (контракт MODULE_CONTRACT §5: init() вызывается строго один раз)
    container.addEventListener('click', function(e) {
        // Заголовок блока (аккордеон)
        var blockHeader = e.target.closest('.krs-block-header');
        if (blockHeader) {
          var blockId = blockHeader.getAttribute('data-block-id');
          if (blockId) toggleBlock(blockId);
          return;
        }

        // Кнопка очистки поиска
        var clearBtn = e.target.closest('.ct-search-clear');
        if (clearBtn) {
          _searchQuery = '';
          renderAll();
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
      var input = e.target.closest('.ct-search-input');
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

    // Начальное состояние (контракт: init() вызывается строго ОДИН раз)
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

  /* ─── DESTROY (контракт MODULE_CONTRACT §5: очистка при уходе) ─── */

  function destroy() {
    // Удалить динамический оверлей сортировки если был открыт
    hideSortMenu();
  }

  window.ModuleRegistry.register('krs', {
    title: 'Указания КРС',
    icon: 'file-text',
    init: init,
    renderHeader: renderHeader,
    destroy: destroy
  });

})();
