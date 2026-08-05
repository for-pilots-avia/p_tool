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
  var _viewMode = 'list';     // 'list' | 'detail' | 'quiz-setup' | 'quiz-active' | 'quiz-results'
  var _activeItem = null;     // текущий item для detail view
  var _listScrollTop = 0;     // сохранение scrollTop body при переходе в detail

  /* ─── Состояние квиза (test знаний) ─── */
  var _quizConfig = {                          // настройки, выбираемые пользователем
    selectedCats: {},                          // { categoryId: true }
    count: 10                                  // 5 | 10 | 15 | 20 | 'all'
  };
  var _quizState = null;                       // { questions:[], currentIdx:0, answers:[], startTime:0 }
  var _quizAdvanceTimer = null;                // setTimeout для авто-перехода к следующему вопросу
  var _QUIZ_ADVANCE_DELAY = 1500;              // мс задержки после ответа (для просмотра подсветки)

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
     QUIZ HELPERS
     ═══════════════════════════════════════════ */

  /**
   * Определить «тип значения» для подбора однопорядковых дистракторов.
   * Числовое значение (200 kt, 35000 ft, 140°C) → { kind:'numeric', num, unit, unitKey, prefix }
   * Текстовое значение (PROHIBITED, Do NOT...) → { kind:'text' }
   * Базовая единица = первое слово после числа (до пробела/скобки), lowercase.
   * Группирует kt/ft/kg/psi/°C/%/lb вместе независимо от пояснений в скобках.
   * @param {string} value
   * @returns {Object}
   */
  function getValueKind(value) {
    var v = (value || '').trim();
    if (!v) return { kind: 'text' };
    var m = v.match(/(\d+(?:[.,]\d+)?)\s*([^0-9]*)/);
    if (!m || !m[1]) return { kind: 'text' };
    var numStr = m[1];
    /* Comma handling: в авиаданных «8,400» = 8400 (разделитель тысяч), «0,82» = 0.82 (десятичная).
       Правило: «,ddd» (ровно 3 цифры) → thousands → убрать запятую; иначе → decimal → точка. */
    if (numStr.indexOf(',') !== -1) {
      numStr = numStr.replace(/,(\d{3})(?=\D|$)/g, '$1').replace(/,/g, '.');
    }
    var num = parseFloat(numStr);
    var rawUnit = (m[2] || '').trim();
    var unitToken = rawUnit.split(/[\s(]/)[0].replace(/[:;,.\)]+$/, '');
    var unitKey = unitToken.toLowerCase();
    if (!unitKey) return { kind: 'text' };
    var prefix = v.substring(0, v.length - m[0].length).trim();
    return { kind: 'numeric', num: num, unit: unitToken, unitKey: unitKey, prefix: prefix };
  }

  /**
   * Перемешать массив (Fisher-Yates, ES2018-совместимо — без ?., ??, .at())
   * @param {Array} arr
   * @returns {Array} новый перемешанный массив
   */
  function shuffleArray(arr) {
    var copy = arr.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  /**
   * Получить массив всех item'ов из выбранных категорий
   * @returns {Array} массив { item, categoryId, categoryTitle }
   */
  function getQuizPool() {
    if (!_data || !_data.categories) return [];
    var pool = [];
    for (var c = 0; c < _data.categories.length; c++) {
      var cat = _data.categories[c];
      if (!_quizConfig.selectedCats[cat.id]) continue;
      if (!cat.items) continue;
      for (var i = 0; i < cat.items.length; i++) {
        pool.push({
          item: cat.items[i],
          categoryId: cat.id,
          categoryTitle: cat.title
        });
      }
    }
    return pool;
  }

  /**
   * Сгенерировать список вопросов для квиза
   * @returns {Array} массив вопросов: { item, categoryId, categoryTitle, options: [value...], correctIdx: 0..3 }
   */
  function generateQuestions() {
    var pool = getQuizPool();
    if (pool.length === 0) return [];

    // Перемешиваем пул и берём нужное количество
    var shuffled = shuffleArray(pool);
    var count = _quizConfig.count === 'all' ? shuffled.length : _quizConfig.count;
    if (count > shuffled.length) count = shuffled.length;
    var selected = shuffled.slice(0, count);

    // Группируем значения по базовой единице для подбора однопорядковых дистракторов.
    // Числовые значения группируются по unitKey (kt, ft, kg, psi, °C, %, lb...),
    // текстовые — в общий пул textValues.
    var numericByUnit = {};
    var textValues = [];
    for (var k = 0; k < pool.length; k++) {
      var val = pool[k].item.value;
      if (!val) continue;
      var kind = getValueKind(val);
      if (kind.kind === 'numeric') {
        if (!numericByUnit[kind.unitKey]) numericByUnit[kind.unitKey] = [];
        numericByUnit[kind.unitKey].push({ value: val, num: kind.num });
      } else {
        if (textValues.indexOf(val) === -1) textValues.push(val);
      }
    }

    var questions = [];
    for (var q = 0; q < selected.length; q++) {
      var entry = selected[q];
      var correctValue = entry.item.value || '—';
      var correctKind = getValueKind(correctValue);
      var distractors = [];

      if (correctKind.kind === 'numeric') {
        // Дистракторы той же единицы, ближайшие по величине (одного порядка)
        var sameUnit = numericByUnit[correctKind.unitKey] || [];
        var candidates = [];
        for (var s = 0; s < sameUnit.length; s++) {
          if (sameUnit[s].value !== correctValue) candidates.push(sameUnit[s]);
        }
        candidates.sort(function(a, b) {
          return Math.abs(a.num - correctKind.num) - Math.abs(b.num - correctKind.num);
        });
        // Берём до 6 ближайших, перемешиваем, берём 3 — чтобы не шли подряд по возрастанию
        var closest = candidates.slice(0, Math.min(candidates.length, 6));
        var shuffledCandidates = shuffleArray(closest);
        for (var d = 0; d < shuffledCandidates.length && distractors.length < 3; d++) {
          if (distractors.indexOf(shuffledCandidates[d].value) === -1) {
            distractors.push(shuffledCandidates[d].value);
          }
        }
        // Если не хватает — синтетические дистракторы (±5/10/15%, та же единица)
        var deltas = [-0.15, 0.15, -0.10, 0.10, -0.05, 0.05];
        for (var di = 0; di < deltas.length && distractors.length < 3; di++) {
          var fakeNum;
          if (correctKind.num < 10) {
            fakeNum = Math.round(correctKind.num * (1 + deltas[di]) * 100) / 100;
          } else {
            fakeNum = Math.round(correctKind.num * (1 + deltas[di]));
          }
          var fakeValue = fakeNum + (correctKind.unit ? ' ' + correctKind.unit : '');
          if (fakeValue !== correctValue && distractors.indexOf(fakeValue) === -1) {
            distractors.push(fakeValue);
          }
        }
      } else {
        // Текстовые дистракторы — из общего пула текстовых значений
        var textCandidates = [];
        for (var t = 0; t < textValues.length; t++) {
          if (textValues[t] !== correctValue) textCandidates.push(textValues[t]);
        }
        var shuffledText = shuffleArray(textCandidates);
        for (var d2 = 0; d2 < shuffledText.length && distractors.length < 3; d2++) {
          distractors.push(shuffledText[d2]);
        }
        while (distractors.length < 3) {
          distractors.push('—');
        }
      }

      // Собираем 4 опции, перемешиваем
      var options = distractors.slice(0, 3);
      options.push(correctValue);
      options = shuffleArray(options);
      var correctIdx = options.indexOf(correctValue);

      questions.push({
        item: entry.item,
        categoryId: entry.categoryId,
        categoryTitle: entry.categoryTitle,
        options: options,
        correctIdx: correctIdx
      });
    }
    return questions;
  }

  /**
   * Подсчитать количество выбранных категорий
   * @returns {number}
   */
  function countSelectedCats() {
    var n = 0;
    for (var k in _quizConfig.selectedCats) {
      if (_quizConfig.selectedCats.hasOwnProperty(k)) n++;
    }
    return n;
  }

  /**
   * Подсчитать доступное количество вопросов из выбранных категорий
   * @returns {number}
   */
  function availableQuestionCount() {
    var pool = getQuizPool();
    return pool.length;
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
      right.innerHTML = '';
      right.onclick = null;
    } else if (_viewMode === 'quiz-setup' || _viewMode === 'quiz-active' || _viewMode === 'quiz-results') {
      /* §6 редкий случай: quiz mode — back button (arrow-left) вместо гамбургера.
         Обоснование: квиз-режим — модальный вложенный режим внутри модуля (как detail view).
         Кнопка «Назад» возвращает к списку ограничений, прерывая тест.
         Аналогично расхождению #13 (detail view) — осознанное исключение. */
      left.innerHTML = '<button class="icon-btn" aria-label="Назад">'
        + (window.ICONS['arrow-left'] || '') + '</button>';
      left.onclick = function() {
        closeQuiz();
      };
      var quizTitle = _viewMode === 'quiz-setup' ? 'Тест знаний — настройки'
        : _viewMode === 'quiz-active' ? 'Тест знаний'
        : 'Тест знаний — результат';
      center.innerHTML = '<div class="hc-module">' + window.app.escapeHtml(quizTitle) + '</div>';
      right.innerHTML = '';
      right.onclick = null;
    } else {
      // List mode: гамбургер + кнопка теста в headerRight
      left.innerHTML = '<button class="icon-btn" aria-label="Меню">'
        + (window.ICONS.menu || '') + '</button>';
      left.onclick = function() { app.toggleMenu(); };
      center.innerHTML = '<div class="hc-module">Limitations</div>';
      // Кнопка [graduation-cap] → открыть тест знаний
      right.innerHTML = '<button class="icon-btn" id="limQuizBtn" aria-label="Тест знаний">'
        + (window.ICONS['graduation-cap'] || '') + '</button>';
      right.onclick = function(e) {
        e.stopPropagation();
        openQuizSetup();
      };
    }
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

    // Quiz modes
    if (_viewMode === 'quiz-setup') {
      app.hideSkeleton(container, renderQuizSetup());
      container.scrollTop = 0;
      return;
    }
    if (_viewMode === 'quiz-active' && _quizState) {
      app.hideSkeleton(container, renderQuizQuestion());
      container.scrollTop = 0;
      return;
    }
    if (_viewMode === 'quiz-results' && _quizState) {
      app.hideSkeleton(container, renderQuizResults());
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
     QUIZ — TEST ЗНАНИЙ ОГРАНИЧЕНИЙ
     ═══════════════════════════════════════════ */

  /**
   * Открыть экран настроек квиза. Предустановить все категории если пусто.
   */
  function openQuizSetup() {
    // Сохранить позицию скролла списка для возврата
    _listScrollTop = window.pageYOffset;
    // Если категории не выбраны — предустановить все
    if (countSelectedCats() === 0 && _data && _data.categories) {
      for (var i = 0; i < _data.categories.length; i++) {
        _quizConfig.selectedCats[_data.categories[i].id] = true;
      }
    }
    _viewMode = 'quiz-setup';
    renderHeader();
    renderAll();
  }

  /**
   * Закрыть квиз и вернуться к списку ограничений
   */
  function closeQuiz() {
    // Сбросить таймер авто-перехода если активен
    if (_quizAdvanceTimer) {
      clearTimeout(_quizAdvanceTimer);
      _quizAdvanceTimer = null;
    }
    _viewMode = 'list';
    _quizState = null;
    renderHeader();
    renderAll();
    // Восстановить позицию скролла списка
    window.scrollTo(0, _listScrollTop);
  }

  /**
   * Начать квиз: сгенерировать вопросы, перейти к первому
   */
  function startQuiz() {
    var available = availableQuestionCount();
    if (available === 0) {
      window.app.showToast('Выберите хотя бы одну категорию');
      return;
    }
    var questions = generateQuestions();
    if (questions.length === 0) {
      window.app.showToast('Не удалось сгенерировать вопросы');
      return;
    }
    _quizState = {
      questions: questions,
      currentIdx: 0,
      answers: [],   // массив { questionIdx, selectedIdx, correct:bool }
      startTime: Date.now()
    };
    if (_quizAdvanceTimer) {
      clearTimeout(_quizAdvanceTimer);
      _quizAdvanceTimer = null;
    }
    _viewMode = 'quiz-active';
    renderHeader();
    renderAll();
  }

  /**
   * Обработать выбор варианта ответа
   * @param {number} optIdx — индекс выбранной опции (0..3)
   */
  function selectAnswer(optIdx) {
    if (!_quizState) return;
    // Защита от повторного ответа на тот же вопрос
    var current = _quizState.questions[_quizState.currentIdx];
    if (!current) return;
    // Если уже отвечен (есть answer для currentIdx) — игнор
    for (var i = 0; i < _quizState.answers.length; i++) {
      if (_quizState.answers[i].questionIdx === _quizState.currentIdx) return;
    }

    var correct = (optIdx === current.correctIdx);
    _quizState.answers.push({
      questionIdx: _quizState.currentIdx,
      selectedIdx: optIdx,
      correct: correct
    });

    // Перерендерить чтобы показать подсветку + источник + кнопку «Следующий»
    renderAll();

    // Авто-переход к следующему вопросу через задержку (для просмотра ответа)
    if (_quizAdvanceTimer) {
      clearTimeout(_quizAdvanceTimer);
    }
    _quizAdvanceTimer = setTimeout(function() {
      _quizAdvanceTimer = null;
      nextQuestion();
    }, _QUIZ_ADVANCE_DELAY);
  }

  /**
   * Перейти к следующему вопросу или завершить квиз
   */
  function nextQuestion() {
    if (!_quizState) return;
    if (_quizAdvanceTimer) {
      clearTimeout(_quizAdvanceTimer);
      _quizAdvanceTimer = null;
    }
    if (_quizState.currentIdx + 1 >= _quizState.questions.length) {
      // Последний вопрос — переход к результатам
      _viewMode = 'quiz-results';
      renderHeader();
      renderAll();
      return;
    }
    _quizState.currentIdx++;
    renderAll();
  }

  /**
   * Рендер экрана настроек квиза
   * @returns {string} HTML
   */
  function renderQuizSetup() {
    if (!_data || !_data.categories) return '';

    var html = '<div class="module-container">';
    html += '<div class="lim-quiz-header">';
    html += '<div class="lim-quiz-header-icon">' + (window.ICONS['graduation-cap'] || '') + '</div>';
    html += '<div class="lim-quiz-header-title">Тест знаний ограничений</div>';
    html += '<div class="lim-quiz-header-sub">Проверьте знание ограничений B737-800</div>';
    html += '</div>';

    // Количество вопросов
    html += '<div class="lim-quiz-section-title">Количество вопросов</div>';
    html += '<div class="lim-quiz-count-row">';
    var counts = [5, 10, 15, 20];
    for (var i = 0; i < counts.length; i++) {
      var isActive = _quizConfig.count === counts[i];
      html += '<button class="lim-quiz-count-btn' + (isActive ? ' active' : '') + '" data-count="' + counts[i] + '">'
        + counts[i] + '</button>';
    }
    var isAllActive = _quizConfig.count === 'all';
    html += '<button class="lim-quiz-count-btn' + (isAllActive ? ' active' : '') + '" data-count="all">Все</button>';
    html += '</div>';

    // CTA «Начать тест» (перед топиками — сразу после выбора количества)
    var available = availableQuestionCount();
    var willAsk = Math.min(available, _quizConfig.count === 'all' ? available : _quizConfig.count);
    var ctaDisabled = available === 0;
    html += '<button class="lim-quiz-start-btn' + (ctaDisabled ? ' disabled' : '') + '"' + (ctaDisabled ? ' aria-disabled="true"' : '') + '>';
    html += '<span class="lim-quiz-start-icon">' + (window.ICONS['graduation-cap'] || '') + '</span>';
    html += '<span class="lim-quiz-start-text">Начать тест</span>';
    html += '<span class="lim-quiz-start-meta">' + willAsk + ' вопр.</span>';
    html += '</button>';

    // Категории
    var selectedCount = countSelectedCats();
    html += '<div class="lim-quiz-section-title">';
    html += 'Топики';
    html += '<span class="lim-quiz-section-meta">' + selectedCount + ' выбрано · ' + available + ' вопросов</span>';
    html += '</div>';
    html += '<div class="lim-quiz-cat-actions">';
    html += '<button class="lim-quiz-select-all">Выбрать все</button>';
    html += '<button class="lim-quiz-clear-all">Снять все</button>';
    html += '</div>';

    html += '<div class="lim-quiz-cat-list">';
    for (var c = 0; c < _data.categories.length; c++) {
      var cat = _data.categories[c];
      var checked = !!_quizConfig.selectedCats[cat.id];
      var itemCount = cat.items ? cat.items.length : 0;
      html += '<label class="lim-quiz-cat-check' + (checked ? ' checked' : '') + '" data-cat-id="' + window.app.escapeAttr(cat.id) + '">';
      html += '<span class="lim-quiz-cat-checkbox">' + (checked ? (window.ICONS['check-circle'] || '') : '') + '</span>';
      html += '<span class="lim-quiz-cat-icon">' + (window.ICONS[cat.icon] || '') + '</span>';
      html += '<span class="lim-quiz-cat-title"' + window.app.langAttr(cat.title) + '>' + window.app.escapeHtml(cat.title) + '</span>';
      html += '<span class="lim-quiz-cat-count">' + itemCount + '</span>';
      html += '</label>';
    }
    html += '</div>';

    html += '</div>'; // .module-container
    return html;
  }

  /**
   * Рендер экрана активного вопроса
   * @returns {string} HTML
   */
  function renderQuizQuestion() {
    if (!_quizState) return '';
    var q = _quizState.questions[_quizState.currentIdx];
    if (!q) return '';

    var total = _quizState.questions.length;
    var idx = _quizState.currentIdx;
    var progressPct = Math.round(((idx) / total) * 100);

    // Найти ответ на текущий вопрос (если уже отвечен)
    var answered = null;
    for (var a = 0; a < _quizState.answers.length; a++) {
      if (_quizState.answers[a].questionIdx === idx) {
        answered = _quizState.answers[a];
        break;
      }
    }

    var html = '<div class="module-container">';

    // Прогресс-бар
    html += '<div class="lim-quiz-progress">';
    html += '<div class="lim-quiz-progress-track">';
    /* ИСКЛЮЧЕНИЕ MODULE_CONTRACT §7 ЗАПРЕЩЕНО п.1: style="width:X%" — динамическое значение из JS
       (progressPct вычисляется на основе currentIdx/total). Аналогично checklists progress bar (расхождение #3). */
    html += '<div class="lim-quiz-progress-fill" style="width: ' + progressPct + '%"></div>';
    html += '</div>';
    html += '<div class="lim-quiz-progress-text">Вопрос ' + (idx + 1) + ' из ' + total + '</div>';
    html += '</div>';

    // Бейдж: категория (бейдж типа убран — дистракторы подбираются однопорядковые, тип не нужен)
    html += '<div class="lim-quiz-badges">';
    html += '<span class="lim-quiz-badge lim-quiz-badge--cat">' + window.app.escapeHtml(q.categoryTitle) + '</span>';
    html += '</div>';

    // Вопрос
    html += '<div class="lim-quiz-question-label">Какое ограничение для:</div>';
    html += '<div class="lim-quiz-question"' + window.app.langAttr(q.item.label) + '>' + window.app.renderRichText(q.item.label) + '</div>';

    // Варианты ответа
    html += '<div class="lim-quiz-options">';
    var letters = ['A', 'B', 'C', 'D'];
    for (var o = 0; o < q.options.length; o++) {
      var isCorrect = (o === q.correctIdx);
      var isSelected = answered && answered.selectedIdx === o;
      var cls = 'lim-quiz-option';
      if (answered) {
        if (isCorrect) cls += ' lim-quiz-option--correct';
        else if (isSelected) cls += ' lim-quiz-option--wrong';
        else cls += ' lim-quiz-option--muted';
      }
      html += '<button class="' + cls + '" data-idx="' + o + '"' + (answered ? ' disabled' : '') + '>';
      html += '<span class="lim-quiz-option-letter">' + letters[o] + '</span>';
      html += '<span class="lim-quiz-option-value"' + window.app.langAttr(q.options[o]) + '>' + window.app.renderRichText(q.options[o]) + '</span>';
      if (answered && isCorrect) {
        html += '<span class="lim-quiz-option-icon">' + (window.ICONS['check-circle'] || '') + '</span>';
      } else if (answered && isSelected && !isCorrect) {
        html += '<span class="lim-quiz-option-icon">' + (window.ICONS['x'] || '') + '</span>';
      }
      html += '</button>';
    }
    html += '</div>';

    // После ответа: источник + кнопка «Следующий»
    if (answered) {
      if (q.item.source) {
        html += '<div class="lim-quiz-source">';
        html += '<span class="lim-quiz-source-label">Источник</span>';
        html += '<span class="lim-quiz-source-value"' + window.app.langAttr(q.item.source) + '>' + window.app.escapeHtml(q.item.source) + '</span>';
        html += '</div>';
      }
      var isLast = (idx + 1 >= total);
      html += '<button class="lim-quiz-next-btn">';
      html += '<span>' + (isLast ? 'Показать результат' : 'Следующий вопрос') + '</span>';
      html += '<span class="lim-quiz-next-icon">' + (window.ICONS['arrow-right'] || '') + '</span>';
      html += '</button>';
    }

    html += '</div>'; // .module-container
    return html;
  }

  /**
   * Рендер экрана результатов
   * @returns {string} HTML
   */
  function renderQuizResults() {
    if (!_quizState) return '';
    var total = _quizState.questions.length;
    var correctCount = 0;
    for (var i = 0; i < _quizState.answers.length; i++) {
      if (_quizState.answers[i].correct) correctCount++;
    }
    var pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    var html = '<div class="module-container">';

    // Большой счёт
    html += '<div class="lim-quiz-results-hero">';
    html += '<div class="lim-quiz-results-icon">' + (window.ICONS['star'] || '') + '</div>';
    html += '<div class="lim-quiz-results-score">' + correctCount + ' / ' + total + '</div>';
    html += '<div class="lim-quiz-results-pct">' + pct + '%</div>';
    html += '<div class="lim-quiz-progress-track lim-quiz-results-progress">';
    /* ИСКЛЮЧЕНИЕ MODULE_CONTRACT §7 ЗАПРЕЩЕНО п.1: style="width:X%" — динамическое значение из JS (pct = score%). */
    html += '<div class="lim-quiz-progress-fill" style="width: ' + pct + '%"></div>';
    html += '</div>';
    html += '</div>';

    // Детальный список
    html += '<div class="lim-quiz-section-title">Детали</div>';
    html += '<div class="lim-quiz-results-list">';
    for (var q = 0; q < _quizState.questions.length; q++) {
      var question = _quizState.questions[q];
      var ans = null;
      for (var k = 0; k < _quizState.answers.length; k++) {
        if (_quizState.answers[k].questionIdx === q) { ans = _quizState.answers[k]; break; }
      }
      var isCorrect = ans && ans.correct;
      html += '<div class="lim-quiz-results-item' + (isCorrect ? ' correct' : ' wrong') + '">';
      html += '<div class="lim-quiz-results-item-header">';
      html += '<span class="lim-quiz-results-item-icon">' + (isCorrect ? (window.ICONS['check-circle'] || '') : (window.ICONS['x'] || '')) + '</span>';
      html += '<span class="lim-quiz-results-item-label"' + window.app.langAttr(question.item.label) + '>' + window.app.renderRichText(question.item.label) + '</span>';
      html += '</div>';
      if (!isCorrect) {
        html += '<div class="lim-quiz-results-item-answers">';
        if (ans) {
          html += '<div class="lim-quiz-results-item-answer wrong">';
          html += '<span class="lim-quiz-results-item-answer-label">Ваш ответ:</span>';
          html += '<span class="lim-quiz-results-item-answer-value"' + window.app.langAttr(question.options[ans.selectedIdx]) + '>' + window.app.renderRichText(question.options[ans.selectedIdx]) + '</span>';
          html += '</div>';
        }
        html += '<div class="lim-quiz-results-item-answer correct">';
        html += '<span class="lim-quiz-results-item-answer-label">Правильно:</span>';
        html += '<span class="lim-quiz-results-item-answer-value"' + window.app.langAttr(question.options[question.correctIdx]) + '>' + window.app.renderRichText(question.options[question.correctIdx]) + '</span>';
        html += '</div>';
        html += '</div>';
      }
      html += '<div class="lim-quiz-results-item-meta">';
      html += '<span class="lim-quiz-badge lim-quiz-badge--cat">' + window.app.escapeHtml(question.categoryTitle) + '</span>';
      if (question.item.source) {
        html += '<span class="lim-quiz-results-item-source"' + window.app.langAttr(question.item.source) + '>' + window.app.escapeHtml(question.item.source) + '</span>';
      }
      html += '</div>';
      html += '</div>'; // .lim-quiz-results-item
    }
    html += '</div>'; // .lim-quiz-results-list

    // Кнопки действий
    html += '<div class="lim-quiz-results-actions">';
    html += '<button class="lim-quiz-retry-btn">';
    html += '<span class="lim-quiz-action-icon">' + (window.ICONS['rotate-ccw'] || '') + '</span>';
    html += '<span>Пройти ещё раз</span>';
    html += '</button>';
    html += '<button class="lim-quiz-tolist-btn">';
    html += '<span class="lim-quiz-action-icon">' + (window.ICONS['arrow-left'] || '') + '</span>';
    html += '<span>К списку ограничений</span>';
    html += '</button>';
    html += '</div>';

    html += '</div>'; // .module-container
    return html;
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

      // ─── QUIZ: setup screen interactions ───
      // Выбор количества вопросов (5/10/15/20/Все)
      var countBtn = e.target.closest('.lim-quiz-count-btn');
      if (countBtn) {
        var cnt = countBtn.getAttribute('data-count');
        if (cnt === 'all') {
          _quizConfig.count = 'all';
        } else {
          _quizConfig.count = parseInt(cnt, 10) || 10;
        }
        renderAll();
        return;
      }

      // Чекбокс категории
      var catCheck = e.target.closest('.lim-quiz-cat-check');
      if (catCheck) {
        var catId = catCheck.getAttribute('data-cat-id');
        if (catId) {
          if (_quizConfig.selectedCats[catId]) {
            delete _quizConfig.selectedCats[catId];
          } else {
            _quizConfig.selectedCats[catId] = true;
          }
          renderAll();
        }
        return;
      }

      // Кнопки «Выбрать все» / «Снять все»
      var selectAllBtn = e.target.closest('.lim-quiz-select-all');
      if (selectAllBtn) {
        if (_data && _data.categories) {
          for (var i = 0; i < _data.categories.length; i++) {
            _quizConfig.selectedCats[_data.categories[i].id] = true;
          }
        }
        renderAll();
        return;
      }
      var clearAllBtn = e.target.closest('.lim-quiz-clear-all');
      if (clearAllBtn) {
        _quizConfig.selectedCats = {};
        renderAll();
        return;
      }

      // Кнопка «Начать тест»
      var startBtn = e.target.closest('.lim-quiz-start-btn');
      if (startBtn) {
        startQuiz();
        return;
      }

      // ─── QUIZ: active screen — выбор варианта ответа ───
      var optBtn = e.target.closest('.lim-quiz-option');
      if (optBtn) {
        var optIdx = parseInt(optBtn.getAttribute('data-idx'), 10);
        if (!isNaN(optIdx)) {
          selectAnswer(optIdx);
        }
        return;
      }

      // Кнопка «Следующий» (ручной переход раньше задержки)
      var nextBtn = e.target.closest('.lim-quiz-next-btn');
      if (nextBtn) {
        nextQuestion();
        return;
      }

      // ─── QUIZ: results screen ───
      var retryBtn = e.target.closest('.lim-quiz-retry-btn');
      if (retryBtn) {
        startQuiz();
        return;
      }
      var toListBtn = e.target.closest('.lim-quiz-tolist-btn');
      if (toListBtn) {
        closeQuiz();
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
    // Сброс квиза: остановить таймер авто-перехода если активен
    if (_quizAdvanceTimer) {
      clearTimeout(_quizAdvanceTimer);
      _quizAdvanceTimer = null;
    }
    _viewMode = 'list';
    _activeItem = null;
    _quizState = null;
  }

  window.ModuleRegistry.register('limitations', {
    title:       'Limitations',
    icon:        'shield-alert',
    init:        init,
    renderHeader: renderHeader,
    destroy:     destroy
  });

})();
