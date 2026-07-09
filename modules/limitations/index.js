/* ═══════════════════════════════════════════
   Pilot's Tool — modules/limitations/index.js
   Модуль «Limitations» — B737-800 Ограничения
   ═══════════════════════════════════════════ */

(function() {
  'use strict';

  /* ─── Приватное состояние ─── */
  var _data = null;           // кэш загруженных данных (JSON)
  var _openBlocks = {};       // какие категории раскрыты: { categoryId: true/false }
  var _searchQuery = '';      // текущий поисковый запрос
  var _viewMode = 'list';     // 'list' | 'detail'
  var _activeItem = null;     // текущий item для detail view
  var _listScrollTop = 0;     // сохранение scrollTop body при переходе в detail

  /* ═══════════════════════════════════════════
     SEVERITY HELPERS
     ═══════════════════════════════════════════ */

  /**
   * Получить CSS-класс для severity
   * @param {string} severity - 'limit' | 'caution' | 'warning' | 'info'
   * @returns {string} CSS-класс
   */
  function getSeverityClass(severity) {
    switch (severity) {
      case 'warning': return 'lim-severity--warning';
      case 'caution': return 'lim-severity--caution';
      case 'limit':   return 'lim-severity--limit';
      case 'info':    return 'lim-severity--info';
      default:        return 'lim-severity--info';
    }
  }

  /**
   * Получить метку severity
   * @param {string} severity
   * @returns {string}
   */
  function getSeverityLabel(severity) {
    switch (severity) {
      case 'warning': return 'PROHIBITED';
      case 'caution': return 'CAUTION';
      case 'limit':   return 'LIMIT';
      case 'info':    return 'INFO';
      default:        return '';
    }
  }

  /* ═══════════════════════════════════════════
     SEARCH FILTERING
     ═══════════════════════════════════════════ */

  /**
   * Фильтровать категории и элементы по поиску
   * @param {Array} categories - массив категорий
   * @param {string} query - поисковый запрос
   * @returns {Array} отфильтрованные категории (с элементами)
   */
  function filterCategories(categories, query) {
    var q = query.trim().toLowerCase();
    if (!q) return categories;

    var result = [];
    for (var i = 0; i < categories.length; i++) {
      var cat = categories[i];
      var titleMatch = cat.title && cat.title.toLowerCase().indexOf(q) !== -1;

      var matchedItems = [];
      if (cat.items) {
        for (var j = 0; j < cat.items.length; j++) {
          var item = cat.items[j];
          var labelMatch = item.label && item.label.toLowerCase().indexOf(q) !== -1;
          var valueMatch = item.value && item.value.toLowerCase().indexOf(q) !== -1;
          var sourceMatch = item.source && item.source.toLowerCase().indexOf(q) !== -1;
          if (labelMatch || valueMatch || sourceMatch || titleMatch) {
            matchedItems.push(item);
          }
        }
      }

      if (matchedItems.length > 0) {
        result.push({
          id: cat.id,
          title: cat.title,
          icon: cat.icon,
          items: matchedItems
        });
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

    if (_viewMode === 'detail' && _activeItem) {
      /* §6 редкий случай: detail mode — back button (arrow-left) вместо гамбургера.
         Обоснование: внутри item-детали гамбургер не нужен, кнопка «Назад» возвращает к списку. */
      // Detail mode: arrow-left → возврат к списку Limitations
      left.innerHTML = '<button class="icon-btn" aria-label="Назад">'
        + (window.ICONS['arrow-left'] || '') + '</button>';
      left.onclick = function() {
        _viewMode = 'list';
        _activeItem = null;
        document.body.classList.remove('lim-detail-open');
        renderHeader();
        renderAll();
        // Восстановить позицию скролла списка
        window.scrollTo(0, _listScrollTop);
      };
      center.innerHTML = '<div class="hc-module">Limitations</div>';
    } else {
      // List mode: гамбургер
      left.innerHTML = '<button class="icon-btn" aria-label="Меню">'
        + (window.ICONS.menu || '') + '</button>';
      left.onclick = function() { app.toggleMenu(); };
      center.innerHTML = '<div class="hc-module">Limitations</div>';
    }

    right.innerHTML = '';
    right.onclick = null;
  }


  /* ═══════════════════════════════════════════
     SEARCH BAR
     ═══════════════════════════════════════════ */

  function renderSearchBar() {
    return '<div class="ct-search-bar lim-search" id="limSearchBar">'
      + '<div class="ct-search-input-wrap">'
      + '<span class="ct-search-icon">' + (window.ICONS.search || '') + '</span>'
      + '<input type="text" class="ct-search-input" id="limSearchInput" placeholder="Search limitations…" value="' + window.app.escapeAttr(_searchQuery) + '">'
      + '<button class="ct-search-clear' + (_searchQuery ? ' visible' : '') + '" aria-label="Clear">' + (window.ICONS.x || '') + '</button>'
      + '</div>'
      + '</div>';
  }

  /* ═══════════════════════════════════════════
     META DISCLAIMER
     ═══════════════════════════════════════════ */

  function renderDisclaimer() {
    if (!_data || !_data.meta) return '';
    var meta = _data.meta;
    return '<div class="lim-disclaimer">'
      + '<div class="lim-disclaimer-title"' + window.app.langAttr(meta.aircraft) + '>' + window.app.escapeHtml(meta.aircraft || '') + '</div>'
      + '<div class="lim-disclaimer-text"' + window.app.langAttr(meta.disclaimer) + '>' + window.app.escapeHtml(meta.disclaimer || '') + '</div>'
      + '</div>';
  }

  /* ═══════════════════════════════════════════
     CATEGORY (ACCORDION)
     ═══════════════════════════════════════════ */

  function renderCategory(cat) {
    var isOpen = !!_openBlocks[cat.id];
    var iconSvg = window.ICONS[cat.icon] || '';
    var itemCount = cat.items ? cat.items.length : 0;
    var catClass = 'lim-category' + (isOpen ? ' open' : '');

    var html = '<div class="' + catClass + '" data-cat-id="' + window.app.escapeAttr(cat.id) + '">';

    // Заголовок категории (аккордеон)
    html += '<div class="lim-category-header" data-cat-id="' + window.app.escapeAttr(cat.id) + '">';
    html += '<span class="lim-cat-icon">' + iconSvg + '</span>';
    html += '<span class="lim-cat-title collapsible-title"' + window.app.langAttr(cat.title) + '>' + window.app.escapeHtml(cat.title) + '</span>';
    html += '<span class="lim-cat-count">' + itemCount + '</span>';
    html += '<span class="collapsible-chevron">' + (window.ICONS['chevron-down'] || '') + '</span>';
    html += '</div>';

    // Контент (сворачиваемый)
    html += '<div class="lim-category-content' + (isOpen ? ' lim-category-content--open' : '') + '">';
    html += '<div class="lim-category-inner">';

    // Элементы ограничений
    if (cat.items) {
      for (var i = 0; i < cat.items.length; i++) {
        html += renderItem(cat.items[i]);
      }
    }

    html += '</div>'; // .lim-category-inner
    html += '</div>'; // .lim-category-content
    html += '</div>'; // .lim-category

    return html;
  }

  /* ═══════════════════════════════════════════
     ITEM (SINGLE LIMITATION)
     ═══════════════════════════════════════════ */

  function renderItem(item) {
    var severityClass = getSeverityClass(item.severity);
    var severityLabel = getSeverityLabel(item.severity);

    var itemId = item.id || '';

    var html = '<div class="lim-item ' + severityClass + '" data-item-id="' + window.app.escapeAttr(itemId) + '">';

    // Severity badge
    html += '<span class="lim-item-severity">' + severityLabel + '</span>';

    // Label
    html += '<div class="lim-item-label"' + window.app.langAttr(item.label) + '>' + window.app.renderRichText(item.label) + '</div>';

    // Value
    html += '<div class="lim-item-value"' + window.app.langAttr(item.value) + '>' + window.app.renderRichText(item.value) + '</div>';

    // Source
    if (item.source) {
      html += '<div class="lim-item-source">' + window.app.escapeHtml(item.source) + '</div>';
    }

    html += '</div>'; // .lim-item

    return html;
  }

  /* ═══════════════════════════════════════════
     DETAIL VIEW
     ═══════════════════════════════════════════ */

  function renderDetailView() {
    var item = _activeItem;
    if (!item) return '';

    var severityClass = getSeverityClass(item.severity);
    var severityLabel = getSeverityLabel(item.severity);

    var html = '<div class="module-container">';
    html += '<div class="lim-detail">';

    // Заголовок: severity + label
    html += '<div class="lim-detail-header ' + severityClass + '">';
    html += '<span class="lim-item-severity">' + severityLabel + '</span>';
    html += '<div class="lim-detail-title"' + window.app.langAttr(item.label) + '>' + window.app.renderRichText(item.label) + '</div>';
    html += '</div>';

    // Value
    if (item.value) {
      html += '<div class="lim-detail-value"' + window.app.langAttr(item.value) + '>' + window.app.renderRichText(item.value) + '</div>';
    }

    // Source
    if (item.source) {
      html += '<div class="lim-detail-source">' + window.app.escapeHtml(item.source) + '</div>';
    }

    // Detail content (если есть)
    if (item.detail) {
      // Description
      if (item.detail.description) {
        html += '<div class="lim-detail-section">';
        html += '<div class="lim-detail-section-title">Description</div>';
        html += '<div class="lim-detail-description"' + window.app.langAttr(item.detail.description) + '>' + window.app.renderRichText(item.detail.description) + '</div>';
        html += '</div>';
      }

      // Images (контракт §7: через app.openPhotoSwipe)
      if (item.detail.pics && item.detail.pics.length > 0) {
        html += '<div class="lim-detail-section">';
        html += '<div class="lim-detail-section-title">Images</div>';
        html += '<div class="lim-detail-images">';
        for (var i = 0; i < item.detail.pics.length; i++) {
          html += '<div class="lim-detail-img-wrap">';
          html += '<img src="' + window.app.escapeAttr(item.detail.pics[i]) + '" data-full-src="' + window.app.escapeAttr(item.detail.pics[i]) + '" alt="Image ' + (i + 1) + '" loading="lazy" class="lim-detail-img ct-img-dark-invert">';
          html += '</div>';
        }
        html += '</div>';
        html += '</div>';
      }

      // Tables (контракт §7 п.3: fetch .html → embed как .lim-table-inline)
      if (item.detail.tables && item.detail.tables.length > 0) {
        html += '<div class="lim-detail-section">';
        html += '<div class="lim-detail-section-title">Reference Tables</div>';
        for (var t = 0; t < item.detail.tables.length; t++) {
          html += '<div class="lim-table-inline" data-table-src="' + window.app.escapeAttr(item.detail.tables[t]) + '"></div>';
        }
        html += '</div>';
      }

      // PDFs (контракт §7: через app.openPDFModal)
      if (item.detail.pdfs && item.detail.pdfs.length > 0) {
        html += '<div class="lim-detail-section">';
        html += '<div class="lim-detail-section-title">Documents</div>';
        html += '<div class="lim-detail-pdfs">';
        for (var p = 0; p < item.detail.pdfs.length; p++) {
          html += '<button class="lim-detail-pdf-btn" data-pdf="' + window.app.escapeAttr(item.detail.pdfs[p]) + '">';
          html += (window.ICONS['file-text'] || '');
          html += '<span>PDF Document ' + (p + 1) + '</span>';
          html += (window.ICONS['download'] || '');
          html += '</button>';
        }
        html += '</div>';
        html += '</div>';
      }
    }

    html += '</div>'; // .lim-detail
    html += '</div>'; // .module-container

    return html;
  }

  /**
   * Загрузить HTML-таблицы (fetch .html → embed)
   */
  function loadInlineTables() {
    var container = document.getElementById('limitationsContainer');
    if (!container) return;
    var placeholders = container.querySelectorAll('.lim-table-inline[data-table-src]');
    for (var i = 0; i < placeholders.length; i++) {
      (function(el) {
        var src = el.getAttribute('data-table-src');
        if (!src) return;
        fetch(src)
          .then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
          })
          .then(function(html) {
            /* ИСКЛЮЧЕНИЕ MODULE_CONTRACT §7 ЗАПРЕЩЕНО п.3 / §13: tailwind-table.html — trusted build-time asset.
               app.renderRichText() удалил бы <table>/<thead>/<tbody>/<tr>/<th>/<td> (запрещены вне §13 whitelist).
               Прямое присваивание innerHTML — осознанное исключение, требует Issue к Shell-разработчику
               на app.sanitizeHtml(tablesWhitelist). Источник .html-файла — data-table-src, без пользовательского ввода. */
            el.innerHTML = html;
            el.removeAttribute('data-table-src');
          })
          .catch(function() {
            el.innerHTML = '<div class="lim-table-error">Failed to load table</div>';
          });
      })(placeholders[i]);
    }
  }

  /**
   * Найти item по itemId в _data
   */
  function findItemById(itemId) {
    if (!_data || !_data.categories) return null;
    for (var c = 0; c < _data.categories.length; c++) {
      var cat = _data.categories[c];
      if (cat.items) {
        for (var i = 0; i < cat.items.length; i++) {
          if (cat.items[i].id === itemId) return cat.items[i];
        }
      }
    }
    return null;
  }

  /* ═══════════════════════════════════════════
     RENDER ALL
     ═══════════════════════════════════════════ */

  function renderAll() {
    var container = document.getElementById('limitationsContainer');
    if (!container || !_data) return;

    // Detail mode
    if (_viewMode === 'detail' && _activeItem) {
      app.hideSkeleton(container, renderDetailView());
      loadInlineTables();
      // Скролл в начало detail view
      container.scrollTop = 0;
      return;
    }

    // List mode
    var categories = _data.categories;
    if (!categories || !categories.length) {
      app.hideSkeleton(container,
        '<div class="module-container">'
        + '<div class="ct-empty-state">'
        + '<div class="ct-empty-icon">' + (window.ICONS['shield-alert'] || '') + '</div>'
        + '<div class="ct-empty-title">Нет данных</div>'
        + '</div></div>');
      return;
    }

    var isSearching = _searchQuery.trim().length > 0;
    var filteredCategories = isSearching ? filterCategories(categories, _searchQuery) : categories;

    var html = '<div class="module-container">';

    // Поиск
    html += renderSearchBar();

    // Disclaimer (только если не ищем)
    if (!isSearching) {
      html += renderDisclaimer();
    }

    // Категории
    for (var i = 0; i < filteredCategories.length; i++) {
      html += renderCategory(filteredCategories[i]);
    }

    html += '</div>';

    if (isSearching && filteredCategories.length === 0) {
      html = '<div class="module-container">'
        + renderSearchBar()
        + '<div class="lim-empty">'
        + (window.ICONS.search || '')
        + '<p class="lim-empty-text">Nothing found</p>'
        + '<p class="lim-empty-sub">Try a different search term</p>'
        + '</div>'
        + '</div>';
    }

    app.hideSkeleton(container, html);
  }

  /* ═══════════════════════════════════════════
     ACCORDION TOGGLE
     ═══════════════════════════════════════════ */

  function toggleCategory(catId) {
    _openBlocks[catId] = !_openBlocks[catId];
    renderAll();
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */

  function init(params) {
    var container = document.getElementById('limitationsContainer');
    if (!container) {
      console.error('Контейнер limitationsContainer не найден!');
      return;
    }

    // Контракт MODULE_CONTRACT §7: lang="ru" для hyphens: auto
    container.setAttribute('lang', 'ru');

    // Контракт MODULE_CONTRACT §7: запросить библиотеки лениво через ensureLib
    app.ensureLib('photoswipe', function() {});
    app.ensureLib('pdfjs', function() {});

    // Делегирование событий (контракт MODULE_CONTRACT §5: init() вызывается строго один раз)
    container.addEventListener('click', function(e) {
      // Заголовок категории (аккордеон)
      var catHeader = e.target.closest('.lim-category-header');
      if (catHeader) {
        var catId = catHeader.getAttribute('data-cat-id');
        if (catId) toggleCategory(catId);
        return;
      }

      // Карточка item → detail view
      var itemEl = e.target.closest('.lim-item');
      if (itemEl) {
        var itemId = itemEl.getAttribute('data-item-id');
        if (itemId) {
          var item = findItemById(itemId);
          if (item) {
            // Сохранить позицию скролла списка перед переходом в detail
            _listScrollTop = window.pageYOffset;
            _viewMode = 'detail';
            _activeItem = item;
            document.body.classList.add('lim-detail-open');
            renderHeader();
            renderAll();
          }
        }
        return;
      }

      // Изображение — открыть просмотр (контракт: app.openPhotoSwipe)
      var imgWrap = e.target.closest('.lim-detail-img-wrap');
      if (imgWrap) {
        var imgEl = imgWrap.querySelector('img[data-full-src]');
        var imagesContainer = imgWrap.closest('.lim-detail-images');
        if (imgEl && window.app && window.app.openPhotoSwipe) {
          window.app.openPhotoSwipe(imgEl, imagesContainer);
        }
        return;
      }

      // PDF кнопка — открыть просмотр (контракт: app.openPDFModal)
      var pdfBtn = e.target.closest('.lim-detail-pdf-btn');
      if (pdfBtn) {
        var pdfUrl = pdfBtn.getAttribute('data-pdf');
        if (pdfUrl && window.app && window.app.openPDFModal) {
          window.app.openPDFModal(pdfUrl);
        }
        return;
      }

      // Кнопка очистки поиска
      var clearBtn = e.target.closest('.ct-search-clear');
      if (clearBtn) {
        _searchQuery = '';
        renderAll();
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
        var newInput = document.getElementById('limSearchInput');
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(_searchQuery.length, _searchQuery.length);
        }
      }
    });

    // Начальное состояние (контракт: init() вызывается строго ОДИН раз)
    _openBlocks = {};
    _searchQuery = '';
    _viewMode = 'list';
    _activeItem = null;
    _listScrollTop = 0;

    // Загрузка данных
    if (_data) {
      renderAll();
      return;
    }

    app.showSkeleton(container, 'blocks');

    fetch('modules/limitations/data/limitations.json')
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        _data = data;

        renderAll();
      })
      .catch(function(err) {
        app.showError(container, 'Failed to load limitations data');
        console.error('limitations fetch error:', err);
      });
  }

  /* ═══════════════════════════════════════════
     REGISTER
     ═══════════════════════════════════════════ */

  /* ─── DESTROY (контракт MODULE_CONTRACT §5: очистка при уходе) ─── */

  function destroy() {
    // MODULE_CONTRACT §5: очистка при уходе. Снять scroll-lock если destroy() вызван из detail view.
    document.body.classList.remove('lim-detail-open');
    _viewMode = 'list';
    _activeItem = null;
  }

  window.ModuleRegistry.register('limitations', {
    title:       'Limitations',
    icon:        'shield-alert',
    init:        init,
    renderHeader: renderHeader,
    destroy:     destroy
  });

})();
