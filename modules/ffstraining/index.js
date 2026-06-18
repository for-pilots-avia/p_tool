/* ═══════════════════════════════════════════
   Pilot's Tool — modules/ffstraining/index.js
   Модуль «FFS Training» — Unified rendering
   ═══════════════════════════════════════════ */

(function() {
  'use strict';

  /* ─── Приватное состояние ─── */
  var _data       = null;   // кэш загруженных данных
  var _filter     = '';     // текущий поисковый запрос
  var _htmlCache  = {};     // кэш загруженных таблиц
  var _delegated  = false;  // флаг делегирования событий (вместо dataset.delegated)

  /* ─── Маппинги ─── */
  var TYPE_LABELS = {
    'Recurrent':    'Повторная',
    'Type Rating':  'На тип',
    'Special':      'Спецподготовка',
    'Proficiency':  'Профессиональная'
  };

  var STATUS_LABELS = {
    'completed': 'Завершено',
    'pending':   'Предстоит',
    'overdue':   'Просрочено'
  };

  var SEVERITY_MAP = {
    'Recurrent':    'normal',
    'Type Rating':  'abnormal',
    'Special':      'emergency',
    'Proficiency':  'success'
  };

  var SEVERITY_LABELS = {
    'normal':    'Норм',
    'abnormal':  'Абнорм',
    'emergency': 'Авар',
    'success':   'ОК',
    'neutral':   'Инфо'
  };

  var BADGE_TYPES = ['normal', 'abnormal', 'emergency', 'success', 'neutral'];

  /* ─── Inline badge renderer ───
     LABEL проходит через renderRichText (может содержать <b>, {{link:...}}).
     Вызывается ПОСЛЕ экранирования, НО до renderInlineLinks.
  */
  function renderInlineBadges(text) {
    if (!text) return '';
    return text.replace(/\{\{badge:(\w+)(?::([^}]+))?\}\}/g, function(match, type, label) {
      if (BADGE_TYPES.indexOf(type) < 0) return match;
      var badgeLabel = label || SEVERITY_LABELS[type] || type;
      return '<span class="badge badge--' + type + '">' + escapeHtml(badgeLabel) + '</span>';
    });
  }

  /* ─── Rich text renderer ───
     Безопасно обрабатывает текст из JSON:
       - литеральный "\\n" → реальный перенос → <br>
       - реальный "\n" → <br>
       - whitelist тегов: b, i, em, strong, u, br, ul, ol, li, sup, sub,
         table, thead, tbody, tr, th, td (атрибуты запрещены)
       - остальные теги экранируются
       - затем применяются бейджи и ссылки
  */
  var ALLOWED_TAGS = {
    'b': true, 'i': true, 'em': true, 'strong': true, 'u': true,
    'br': true, 'ul': true, 'ol': true, 'li': true,
    'sup': true, 'sub': true,
    'table': true, 'thead': true, 'tbody': true, 'tr': true, 'th': true, 'td': true
  };

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
  }

  function renderRichText(text) {
    if (text === null || text === undefined || text === '') return '';
    var s = String(text);
    s = s.replace(/\\\\n/g, '\n');
    var out = '';
    var i = 0;
    while (i < s.length) {
      var ch = s.charAt(i);
      if (ch === '<') {
        var close = s.indexOf('>', i);
        if (close < 0) { out += '&lt;'; i++; continue; }
        var tag = s.substring(i + 1, close).trim();
        var isClosing = tag.charAt(0) === '/';
        var name = isClosing ? tag.substring(1).toLowerCase() : tag.toLowerCase().split(/\s+/)[0];
        if (name.charAt(name.length - 1) === '/') name = name.substring(0, name.length - 1);
        if (ALLOWED_TAGS[name]) {
          out += '<' + (isClosing ? '/' : '') + name + '>';
        } else {
          out += '&lt;' + tag + '&gt;';
        }
        i = close + 1;
      } else if (ch === '\n') {
        out += '<br>';
        i++;
      } else if (ch === '&' && s.substring(i, i + 5).toLowerCase() === '&amp;') {
        out += '&amp;'; i += 5;
      } else if (ch === '&' && s.substring(i, i + 4).toLowerCase() === '&lt;') {
        out += '&lt;'; i += 4;
      } else if (ch === '&' && s.substring(i, i + 4).toLowerCase() === '&gt;') {
        out += '&gt;'; i += 4;
      } else {
        out += escapeHtml(ch);
        i++;
      }
    }
    return renderInlineLinks(renderInlineBadges(out));
  }

  /* ─── Inline link renderer ───
     Заменяет {{link:MODULE:ID:LABEL}}
     на кликабельный элемент навигации между модулями.
     Вызывается ПОСЛЕ renderInlineBadges().
  */
  function renderInlineLinks(text) {
    if (!text) return '';
    return text.replace(/\{\{link:(\w+):([^:}]+):([^}]+)\}\}/g, function(match, mod, id, label) {
      return '<span class="module-link" role="button" tabindex="0"'
        + ' data-module="' + mod + '"'
        + ' data-id="' + id + '">'
        + label
        + '</span>';
    });
  }

  /* ─── Combined content renderer (legacy alias) ───
     Теперь = renderRichText.
  */
  function renderContent(text) {
    return renderRichText(text);
  }

  /* ═══════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════ */

  function renderAll() {
    var container = document.getElementById('ffstrainingContainer');
    if (!container || !_data) return;

    // lang="ru" включает слоговые переносы (hyphens: auto) в заголовках аккордеонов
    container.setAttribute('lang', 'ru');

    // Filter data recursively
    var q = _filter.trim().toLowerCase();
    var filtered = q ? filterItems(_data, q) : _data;

    // Group by category (free-string, JSON order)
    var grouped = {};
    var cat;
    for (var i = 0; i < filtered.length; i++) {
      var item = filtered[i];
      cat = item.category || 'Без категории';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    }

    var html = '<div class="module-container">';

    /* Search bar */
    html += '<div class="ffstraining-search-bar">';
    html += '<div class="ffstraining-search-input-wrap">';
    html += '<span class="ffstraining-search-input-icon">' + window.ICONS.search + '</span>';
    html += '<input type="text" class="ffstraining-search-input" placeholder="Поиск по тренировкам…"'
      + ' value="' + escapeAttr(_filter || '') + '">';
    html += '</div>';
    if (_filter) {
      html += '<button class="ffstraining-search-clear" aria-label="Очистить">' + window.ICONS.x + '</button>';
    }
    html += '</div>';

    if (filtered.length === 0 && q) {
      html += '<div class="ffstraining-empty">';
      html += '<div class="ffstraining-empty-icon">' + window.ICONS.search + '</div>';
      html += '<p class="ffstraining-empty-text">Ничего не найдено</p>';
      html += '<p class="ffstraining-empty-sub">Попробуйте изменить запрос</p>';
      html += '</div>';
    } else {
      // Render sections with dividers
      var categories = Object.keys(grouped);
      for (var c = 0; c < categories.length; c++) {
        cat = categories[c];
        var items = grouped[cat];
        if (!items || items.length === 0) continue;
        var isOpen = (c === 0); // первая секция открыта

        // Divider (label + линия)
        html += '<div class="list-divider ffs-section-toggle' + (isOpen ? ' is-open' : '') + '" data-category="' + escapeAttr(cat) + '">';
        html += '<span class="list-divider-label">' + renderRichText(cat) + '</span>';
        html += '<span class="ffs-section-count">' + items.length + '</span>';
        html += '</div>';

        html += '<div class="ffs-section-cards' + (isOpen ? ' open' : '') + '" data-category="' + escapeAttr(cat) + '">';

        for (i = 0; i < items.length; i++) {
          html += renderItem(items[i], 1);
        }

        html += '</div>'; // section-cards
      }
    }

    html += '</div>';

    app.hideSkeleton(container, html);

    // Load external table files
    loadTableFiles(container);

    // Bind search input
    bindSearchInput(container);

    // Bind clear button
    var clearBtn = container.querySelector('.ffstraining-search-clear');
    if (clearBtn && !clearBtn.dataset.bound) {
      clearBtn.dataset.bound = 'true';
      clearBtn.addEventListener('click', function() {
        _filter = '';
        renderAll();
        var inp = container.querySelector('.ffstraining-search-input');
        if (inp) inp.focus();
      });
    }
  }

  /* ─── Рекурсивный рендер элемента (аккордеон любой глубины) ─── */
  function renderItem(item, depth) {
    // Простой текстовый блок (без аккордеона) — для любого уровня
    if (item.layout === 'text') {
      return renderTextBlock(item, depth);
    }
    // Badge severity: use severity if present, otherwise derive from type
    var sev = item.severity || SEVERITY_MAP[item.type] || 'neutral';
    var showHeaderBadge = item.headerBadge !== false;
    var hasChildren = item.children && item.children.length > 0;

    var badgeClass = 'badge badge--' + sev;
    var badgeLabel = item.type ? (TYPE_LABELS[item.type] || item.type) : (SEVERITY_LABELS[sev] || sev);

    var html = '<div class="ffstraining-card" data-depth="' + depth + '" data-id="' + escapeAttr(item.id || '') + '">';

    // Card header
    var headerCls = 'ffstraining-card-header';
    if (!showHeaderBadge) headerCls += ' ffstraining-card-header--no-badge';
    html += '<div class="' + headerCls + '">';
    if (showHeaderBadge) {
      html += '<span class="' + badgeClass + '">' + renderRichText(badgeLabel) + '</span>';
    }
    html += '<div class="ffstraining-card-info">';
    html += '<div class="ffstraining-card-title">' + renderRichText(item.title) + '</div>';

    // refCode (FP-style)
    if (item.refCode) {
      html += '<div class="ffstraining-card-ref">' + renderRichText(item.refCode) + '</div>';
    }

    // aircraft / duration
    if (item.aircraft || item.duration) {
      html += '<div class="ffstraining-card-meta">';
      if (item.aircraft) {
        html += '<span class="ffstraining-card-aircraft">' + renderRichText(item.aircraft) + '</span>';
      }
      if (item.aircraft && item.duration) {
        html += '<span class="ffstraining-card-sep"> \u00B7 </span>';
      }
      if (item.duration) {
        html += '<span class="ffstraining-card-duration">' + renderRichText(item.duration) + '</span>';
      }
      html += '</div>';
    }

    html += '</div>'; // card-info

    // child count (right before chevron)
    if (hasChildren) {
      html += '<span class="ffstraining-card-child-count">' + item.children.length + '</span>';
    }

    // status
    if (item.status) {
      var statusLabel = STATUS_LABELS[item.status] || item.status;
      html += '<span class="ffstraining-status ffstraining-status--' + item.status + '">' + renderRichText(statusLabel) + '</span>';
    }

    html += '<span class="ffstraining-card-chevron">' + window.ICONS['chevron-down'] + '</span>';
    html += '</div>'; // card-header

    // Card body (expanded)
    html += '<div class="ffstraining-card-body">';
    html += '<div class="ffstraining-card-content">';

    // Determine if this item has any own content
    var hasOwnContent = item.description || item.image
      || (item.memoryItems && item.memoryItems.length > 0)
      || (item.radioItems && item.radioItems.length > 0)
      || (item.steps && item.steps.length > 0)
      || item.tableFile || item.tableHtml
      || (item.equipment && item.equipment.length > 0)
      || item.instructorNotes || item.criteria
      || (item.documents && item.documents.length > 0)
      || (item.references && item.references.length > 0);

    if (hasOwnContent) {

      // 1. Description
      if (item.description) {
        html += '<div class="ffstraining-description">' + renderContent(item.description) + '</div>';
      }

      // 2. Image (FP-style, PhotoSwipe by contract)
      if (item.image) {
        html += '<div class="ffstraining-image-gallery">';
        html += '<img class="ffstraining-image-thumb"'
          + ' src="' + escapeAttr(item.image) + '"'
          + ' data-full-src="' + escapeAttr(item.image) + '"'
          + ' alt="' + escapeAttr(item.title) + '"'
          + ' loading="lazy">';
        html += '</div>';
      }

      // 3. Memory Items (FP-style)
      if (item.memoryItems && item.memoryItems.length > 0) {
        html += '<div class="ffstraining-memory">';
        html += '<div class="ffstraining-memory-title">'
          + window.ICONS['alert-triangle']
          + ' Memory Items</div>';
        html += '<ul class="ffstraining-memory-list">';
        for (var m = 0; m < item.memoryItems.length; m++) {
          html += '<li class="ffstraining-memory-item">' + renderContent(item.memoryItems[m]) + '</li>';
        }
        html += '</ul></div>';
      }

      // 3b. Radio script (зелёный блок, по аналогии с Memory Items)
      if (item.radioItems && item.radioItems.length > 0) {
        html += '<div class="ffstraining-radio">';
        html += '<div class="ffstraining-radio-title">'
          + (window.ICONS['radio'] || '')
          + ' Radio Script</div>';
        html += '<ul class="ffstraining-radio-list">';
        for (var rs = 0; rs < item.radioItems.length; rs++) {
          html += '<li class="ffstraining-radio-item">' + renderContent(item.radioItems[rs]) + '</li>';
        }
        html += '</ul></div>';
      }

      // 4. Steps (FP-style)
      if (item.steps && item.steps.length > 0) {
        html += '<div class="ffstraining-steps">';
        html += '<div class="ffstraining-steps-title">Порядок действий</div>';
        html += '<ol class="ffstraining-steps-list">';
        for (var s = 0; s < item.steps.length; s++) {
          html += '<li class="ffstraining-step">' + renderContent(item.steps[s]) + '</li>';
        }
        html += '</ol></div>';
      }

      // 5. Table File (FP-style)
      if (item.tableFile) {
        html += '<div class="ffstraining-table-wrap ffstraining-table-file" data-table-src="' + escapeAttr(item.tableFile) + '">';
        html += '<div class="ffstraining-table-loading">Загрузка таблицы…</div>';
        html += '</div>';
      }

      // 5b. Inline HTML table (from JSON field tableHtml)
      if (item.tableHtml) {
        html += '<div class="ffstraining-table-wrap ffstraining-table-inline">' + renderRichText(item.tableHtml) + '</div>';
      }

      // 6. Equipment
      if (item.equipment && item.equipment.length > 0) {
        html += '<div class="ffstraining-equipment">';
        html += '<div class="ffstraining-equipment-title">Оборудование</div>';
        html += '<ul class="ffstraining-equipment-list">';
        for (var e = 0; e < item.equipment.length; e++) {
          html += '<li>' + renderRichText(item.equipment[e]) + '</li>';
        }
        html += '</ul>';
        html += '</div>';
      }

      // 7. Instructor notes
      if (item.instructorNotes) {
        html += '<div class="ffstraining-notes">';
        html += '<div class="ffstraining-notes-title">' + window.ICONS['comments'] + ' Указания инструктора</div>';
        html += '<div class="ffstraining-notes-text">' + renderContent(item.instructorNotes) + '</div>';
        html += '</div>';
      }

      // 8. Completion criteria
      if (item.criteria) {
        html += '<div class="ffstraining-criteria">';
        html += '<div class="ffstraining-criteria-title">' + window.ICONS['check-circle'] + ' Критерии завершения</div>';
        html += '<div class="ffstraining-criteria-text">' + renderRichText(item.criteria) + '</div>';
        html += '</div>';
      }

      // 9. Documents + References (FP-style)
      var hasDocs = item.documents && item.documents.length > 0;
      var hasRefs = item.references && item.references.length > 0;

      if (hasDocs || hasRefs) {
        html += '<div class="ffstraining-refs">';
        html += '<div class="ffstraining-refs-title">Ссылки</div>';
        html += '<ul class="ffstraining-refs-list">';

        if (hasDocs) {
          for (var d = 0; d < item.documents.length; d++) {
            var doc = item.documents[d];
            var docPage = doc.page || 1;
            html += '<li class="ffstraining-ref ffstraining-ref--link"'
              + ' data-pdf-src="' + escapeAttr(doc.src) + '"'
              + ' data-pdf-page="' + docPage + '"'
              + ' role="button" tabindex="0"'
              + ' aria-label="Открыть PDF, стр. ' + docPage + '">';
            html += '<span class="ffstraining-ref-icon">' + (window.ICONS['file-text'] || '') + '</span>';
            html += '<span class="ffstraining-ref-text">' + renderRichText(doc.title) + '</span>';
            html += '<span class="ffstraining-ref-page">стр.&nbsp;' + docPage + '</span>';
            html += '</li>';
          }
        }

        if (hasRefs) {
          for (var r = 0; r < item.references.length; r++) {
            var ref = item.references[r];
            var refText = (typeof ref === 'string') ? ref : (ref.text || '');
            html += '<li class="ffstraining-ref">' + renderContent(refText) + '</li>';
          }
        }

        html += '</ul></div>';
      }
    }

    // Nested children (recursive)
    if (hasChildren) {
      html += '<div class="ffstraining-nested">';
      for (var ch = 0; ch < item.children.length; ch++) {
        html += renderItem(item.children[ch], depth + 1);
      }
      html += '</div>';
    }

    html += '</div>'; // card-content
    html += '</div>'; // card-body
    html += '</div>'; // card

    return html;
  }

  /* ─── Текстовый блок (без аккордеона) — для layout: "text" ─── */
  function renderTextBlock(item, depth) {
    var html = '<div class="ffstraining-text-block" data-depth="' + depth + '" data-id="' + escapeAttr(item.id || '') + '">';

    if (item.title) {
      html += '<div class="ffstraining-text-block-title">' + renderRichText(item.title) + '</div>';
    }
    if (item.description) {
      html += '<div class="ffstraining-text-block-desc">' + renderRichText(item.description) + '</div>';
    }
    if (item.image) {
      html += '<div class="ffstraining-image-gallery">';
      html += '<img class="ffstraining-image-thumb"'
        + ' src="' + escapeAttr(item.image) + '"'
        + ' data-full-src="' + escapeAttr(item.image) + '"'
        + ' alt="' + escapeAttr(item.title || '') + '"'
        + ' loading="lazy">';
      html += '</div>';
    }
    if (item.memoryItems && item.memoryItems.length > 0) {
      html += '<div class="ffstraining-memory">';
      html += '<div class="ffstraining-memory-title">' + window.ICONS['alert-triangle'] + ' Memory Items</div>';
      html += '<ul class="ffstraining-memory-list">';
      for (var m = 0; m < item.memoryItems.length; m++) {
        html += '<li class="ffstraining-memory-item">' + renderRichText(item.memoryItems[m]) + '</li>';
      }
      html += '</ul></div>';
    }
    if (item.radioItems && item.radioItems.length > 0) {
      html += '<div class="ffstraining-radio">';
      html += '<div class="ffstraining-radio-title">' + (window.ICONS['radio'] || '') + ' Radio Script</div>';
      html += '<ul class="ffstraining-radio-list">';
      for (var rs = 0; rs < item.radioItems.length; rs++) {
        html += '<li class="ffstraining-radio-item">' + renderRichText(item.radioItems[rs]) + '</li>';
      }
      html += '</ul></div>';
    }
    if (item.steps && item.steps.length > 0) {
      html += '<div class="ffstraining-steps">';
      html += '<ol class="ffstraining-steps-list">';
      for (var s = 0; s < item.steps.length; s++) {
        html += '<li class="ffstraining-step">' + renderRichText(item.steps[s]) + '</li>';
      }
      html += '</ol></div>';
    }
    if (item.tableHtml) {
      html += '<div class="ffstraining-table-wrap ffstraining-table-inline">' + renderRichText(item.tableHtml) + '</div>';
    }
    if (item.references && item.references.length > 0) {
      html += '<ul class="ffstraining-refs-list">';
      for (var r = 0; r < item.references.length; r++) {
        var ref = item.references[r];
        var refText = (typeof ref === 'string') ? ref : (ref.text || '');
        html += '<li class="ffstraining-ref">' + renderRichText(refText) + '</li>';
      }
      html += '</ul>';
    }

    if (item.children && item.children.length > 0) {
      html += '<div class="ffstraining-nested">';
      for (var ch = 0; ch < item.children.length; ch++) {
        html += renderItem(item.children[ch], depth + 1);
      }
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  /* ─── Load external table HTML files ─── */
  function loadTableFiles(container) {
    var fileSlots = container.querySelectorAll('.ffstraining-table-file');
    for (var i = 0; i < fileSlots.length; i++) {
      (function(slot) {
        var src = slot.dataset.tableSrc;
        if (!src) return;
        if (_htmlCache[src]) { slot.innerHTML = _htmlCache[src]; return; }
        fetch(src)
          .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
          .then(function(html) { _htmlCache[src] = html; slot.innerHTML = html; })
          .catch(function() { slot.innerHTML = '<div class="ffstraining-table-error">Не удалось загрузить таблицу</div>'; });
      })(fileSlots[i]);
    }
  }

  /* ─── Рекурсивная фильтрация ─── */
  function filterItems(items, q) {
    var result = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var match = itemMatches(item, q);
      var filteredChildren = (item.children) ? filterItems(item.children, q) : [];
      if (match || filteredChildren.length > 0) {
        var copy = shallowCopy(item);
        if (filteredChildren.length > 0) {
          copy.children = filteredChildren;
        }
        result.push(copy);
      }
    }
    return result;
  }

  function itemMatches(item, q) {
    var titleMatch = (item.title || '').toLowerCase().indexOf(q) >= 0;
    var aircraftMatch = (item.aircraft || '').toLowerCase().indexOf(q) >= 0;
    var descMatch = (item.description || '').toLowerCase().indexOf(q) >= 0;
    var catMatch = (item.category || '').toLowerCase().indexOf(q) >= 0;
    var typeLabel = TYPE_LABELS[item.type] || '';
    var typeMatch = typeLabel.toLowerCase().indexOf(q) >= 0 || (item.type || '').toLowerCase().indexOf(q) >= 0;
    var refCodeMatch = (item.refCode || '').toLowerCase().indexOf(q) >= 0;
    var statusLabel = STATUS_LABELS[item.status] || '';
    var statusMatch = statusLabel.toLowerCase().indexOf(q) >= 0 || (item.status || '').toLowerCase().indexOf(q) >= 0;

    var memoryMatch = false;
    if (item.memoryItems) {
      for (var m = 0; m < item.memoryItems.length; m++) {
        if (item.memoryItems[m].toLowerCase().indexOf(q) >= 0) { memoryMatch = true; break; }
      }
    }

    var stepsMatch = false;
    if (item.steps) {
      for (var s = 0; s < item.steps.length; s++) {
        if (item.steps[s].toLowerCase().indexOf(q) >= 0) { stepsMatch = true; break; }
      }
    }

    var docMatch = false;
    if (item.documents) {
      for (var d = 0; d < item.documents.length; d++) {
        if (item.documents[d].title.toLowerCase().indexOf(q) >= 0) { docMatch = true; break; }
      }
    }

    return titleMatch || aircraftMatch || descMatch || catMatch || typeMatch || refCodeMatch || statusMatch || memoryMatch || stepsMatch || docMatch;
  }

  function shallowCopy(obj) {
    var copy = {};
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        copy[key] = obj[key];
      }
    }
    return copy;
  }

  /* ─── Event binding ─── */

  function bindSearchInput(container) {
    var input = container.querySelector('.ffstraining-search-input');
    if (input) {
      input.addEventListener('input', function(e) {
        _filter = e.target.value;
        renderAll();
        // Restore focus and cursor
        var inp = container.querySelector('.ffstraining-search-input');
        if (inp) {
          inp.focus();
          inp.setSelectionRange(_filter.length, _filter.length);
        }
      });
    }
  }

  /* ─── Cross-module navigation: open item by ID ─── */
  function openAndScrollTo(id) {
    var container = document.getElementById('ffstrainingContainer');
    if (!container) return;
    var target = container.querySelector('[data-id="' + id + '"]');
    if (!target) return;

    // Open all ancestor cards and section
    var el = target.parentElement;
    while (el && el !== container) {
      if (el.classList.contains('ffstraining-card')) el.classList.add('open');
      if (el.classList.contains('ffs-section-cards')) {
        el.classList.add('open');
        var cat = el.dataset.category;
        var toggle = container.querySelector('.ffs-section-toggle[data-category="' + cat + '"]');
        if (toggle) toggle.classList.add('is-open');
      }
      el = el.parentElement;
    }
    target.classList.add('open');

    setTimeout(function() {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */

  function init(params) {
    var container = document.getElementById('ffstrainingContainer');
    if (!container) {
      console.error('Контейнер ffstrainingContainer не найден!');
      return;
    }

    // params — всегда объект (пустой {} если навигация без параметров)

    // Делегирование: вешать ровно ОДИН раз
    if (!_delegated) {
      container.addEventListener('click', function(e) {
        // Section divider toggle
        var sectionToggle = e.target.closest('.ffs-section-toggle');
        if (sectionToggle) {
          var cat = sectionToggle.dataset.category;
          var cards = container.querySelector('.ffs-section-cards[data-category="' + cat + '"]');
          if (cards) {
            cards.classList.toggle('open');
            sectionToggle.classList.toggle('is-open');
          }
          return;
        }

        // Module link click → navigate to another module
        var moduleLink = e.target.closest('.module-link');
        if (moduleLink) {
          var targetModule = moduleLink.dataset.module;
          var targetId = moduleLink.dataset.id;
          if (targetModule) {
            app.navigateTo(targetModule, targetId ? { openId: targetId } : undefined);
          }
          return;
        }

        // Image click → PhotoSwipe
        var imgThumb = e.target.closest('.ffstraining-image-thumb');
        if (imgThumb) {
          var gallery = imgThumb.closest('.ffstraining-image-gallery');
          app.openPhotoSwipe(imgThumb, gallery);
          return;
        }

        // PDF reference click → openPDFModal
        var refLink = e.target.closest('.ffstraining-ref--link');
        if (refLink) {
          var pdfSrc = refLink.dataset.pdfSrc;
          var pdfPage = parseInt(refLink.dataset.pdfPage, 10) || 1;
          if (pdfSrc) {
            app.openPDFModal(pdfSrc, pdfPage);
          }
          return;
        }

        // Card header toggle (works at any depth)
        var cardHeader = e.target.closest('.ffstraining-card-header');
        if (cardHeader) {
          var card = cardHeader.closest('.ffstraining-card');
          if (card) {
            card.classList.toggle('open');
          }
          return;
        }
      });
      _delegated = true;
    }

    // Сброс фильтра при повторном входе
    _filter = '';

    // Если данные закэшированы — сразу рендер
    if (_data) {
      renderAll();
      if (params && params.openId) openAndScrollTo(params.openId);
      return;
    }

    // Показать скелетон
    app.showSkeleton(container, 'blocks');

    // Загрузка данных
    fetch('modules/ffstraining/data/ffstraining.json')
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        _data = data;
        renderAll();
        if (params && params.openId) openAndScrollTo(params.openId);
      })
      .catch(function(err) {
        app.showError(container, 'Не удалось загрузить тренировки');
        console.error('ffstraining fetch error:', err);
      });
  }

  /* ═══════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════ */

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
     REGISTER
     ═══════════════════════════════════════════ */

  window.ModuleRegistry.register('ffstraining', {
    title:        'FFS Training',
    icon:         'monitor',
    init:          init
  });

})();
