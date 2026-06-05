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

  /* ─── Inline badge renderer ─── */
  function renderInlineBadges(text) {
    if (!text) return '';
    return text.replace(/\{\{badge:(\w+)(?::([^}]+))?\}\}/g, function(match, type, label) {
      if (BADGE_TYPES.indexOf(type) < 0) return match;
      var badgeLabel = label || SEVERITY_LABELS[type] || type;
      return '<span class="badge badge--' + type + '">' + escapeHtml(badgeLabel) + '</span>';
    });
  }

  /* ═══════════════════════════════════════════
     HEADER
     ═══════════════════════════════════════════ */

  function renderHeader() {
    var left   = document.getElementById('headerLeft');
    var center = document.getElementById('headerCenter');
    var right  = document.getElementById('headerRight');
    if (!left || !center || !right) return;

    left.innerHTML = '<button class="icon-btn" aria-label="Назад">'
      + window.ICONS['arrow-left'] + '</button>';
    left.onclick = function() { app.navigateTo('main'); };

    center.innerHTML = '<div class="hc-module">FFS Training</div>';

    right.innerHTML = '';
    right.onclick = null;
  }

  /* ═══════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════ */

  function renderAll() {
    var container = document.getElementById('ffstrainingContainer');
    if (!container || !_data) return;

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

    var html = '';

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
        html += '<span class="list-divider-label">' + escapeHtml(cat) + '</span>';
        html += '<span class="ffs-section-count">' + countLeaves(items) + '</span>';
        html += '</div>';

        html += '<div class="ffs-section-cards' + (isOpen ? ' open' : '') + '" data-category="' + escapeAttr(cat) + '">';

        for (i = 0; i < items.length; i++) {
          html += renderItem(items[i], 1);
        }

        html += '</div>'; // section-cards
      }
    }

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
      html += '<span class="' + badgeClass + '">' + escapeHtml(badgeLabel) + '</span>';
    }
    html += '<div class="ffstraining-card-info">';
    html += '<div class="ffstraining-card-title">' + escapeHtml(item.title) + '</div>';

    // refCode (FP-style)
    if (item.refCode) {
      html += '<div class="ffstraining-card-ref">' + escapeHtml(item.refCode) + '</div>';
    }

    // aircraft / duration
    if (item.aircraft || item.duration) {
      html += '<div class="ffstraining-card-meta">';
      if (item.aircraft) {
        html += '<span class="ffstraining-card-aircraft">' + escapeHtml(item.aircraft) + '</span>';
      }
      if (item.aircraft && item.duration) {
        html += '<span class="ffstraining-card-sep"> \u00B7 </span>';
      }
      if (item.duration) {
        html += '<span class="ffstraining-card-duration">' + escapeHtml(item.duration) + '</span>';
      }
      html += '</div>';
    }

    // child count
    if (hasChildren) {
      html += '<span class="ffstraining-card-child-count">' + item.children.length + '</span>';
    }
    html += '</div>'; // card-info

    // status
    if (item.status) {
      var statusLabel = STATUS_LABELS[item.status] || item.status;
      html += '<span class="ffstraining-status ffstraining-status--' + item.status + '">' + escapeHtml(statusLabel) + '</span>';
    }

    html += '<span class="ffstraining-card-chevron">' + window.ICONS['chevron-down'] + '</span>';
    html += '</div>'; // card-header

    // Card body (expanded)
    html += '<div class="ffstraining-card-body">';
    html += '<div class="ffstraining-card-content">';

    // Determine if this item has any own content
    var hasOwnContent = item.description || item.image
      || (item.memoryItems && item.memoryItems.length > 0)
      || (item.steps && item.steps.length > 0)
      || item.tableFile
      || (item.equipment && item.equipment.length > 0)
      || item.instructorNotes || item.criteria
      || (item.documents && item.documents.length > 0)
      || (item.references && item.references.length > 0);

    if (hasOwnContent) {

      // 1. Description
      if (item.description) {
        html += '<div class="ffstraining-description">' + renderInlineBadges(escapeHtml(item.description)) + '</div>';
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
          html += '<li class="ffstraining-memory-item">' + renderInlineBadges(escapeHtml(item.memoryItems[m])) + '</li>';
        }
        html += '</ul></div>';
      }

      // 4. Steps (FP-style)
      if (item.steps && item.steps.length > 0) {
        html += '<div class="ffstraining-steps">';
        html += '<div class="ffstraining-steps-title">Порядок действий</div>';
        html += '<ol class="ffstraining-steps-list">';
        for (var s = 0; s < item.steps.length; s++) {
          html += '<li class="ffstraining-step">' + renderInlineBadges(escapeHtml(item.steps[s])) + '</li>';
        }
        html += '</ol></div>';
      }

      // 5. Table File (FP-style)
      if (item.tableFile) {
        html += '<div class="ffstraining-table-wrap ffstraining-table-file" data-table-src="' + escapeAttr(item.tableFile) + '">';
        html += '<div class="ffstraining-table-loading">Загрузка таблицы…</div>';
        html += '</div>';
      }

      // 6. Equipment
      if (item.equipment && item.equipment.length > 0) {
        html += '<div class="ffstraining-equipment">';
        html += '<div class="ffstraining-equipment-title">Оборудование</div>';
        html += '<ul class="ffstraining-equipment-list">';
        for (var e = 0; e < item.equipment.length; e++) {
          html += '<li>' + escapeHtml(item.equipment[e]) + '</li>';
        }
        html += '</ul>';
        html += '</div>';
      }

      // 7. Instructor notes
      if (item.instructorNotes) {
        html += '<div class="ffstraining-notes">';
        html += '<div class="ffstraining-notes-title">' + window.ICONS['comments'] + ' Указания инструктора</div>';
        html += '<div class="ffstraining-notes-text">' + renderInlineBadges(escapeHtml(item.instructorNotes)) + '</div>';
        html += '</div>';
      }

      // 8. Completion criteria
      if (item.criteria) {
        html += '<div class="ffstraining-criteria">';
        html += '<div class="ffstraining-criteria-title">' + window.ICONS['check-circle'] + ' Критерии завершения</div>';
        html += '<div class="ffstraining-criteria-text">' + escapeHtml(item.criteria) + '</div>';
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
            html += '<span class="ffstraining-ref-text">' + escapeHtml(doc.title) + '</span>';
            html += '<span class="ffstraining-ref-page">стр.&nbsp;' + docPage + '</span>';
            html += '</li>';
          }
        }

        if (hasRefs) {
          for (var r = 0; r < item.references.length; r++) {
            var ref = item.references[r];
            var refText = (typeof ref === 'string') ? ref : (ref.text || '');
            html += '<li class="ffstraining-ref">' + renderInlineBadges(escapeHtml(refText)) + '</li>';
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
    var typeLabel = TYPE_LABELS[item.type] || '';
    var typeMatch = typeLabel.toLowerCase().indexOf(q) >= 0 || (item.type || '').toLowerCase().indexOf(q) >= 0;
    var refCodeMatch = (item.refCode || '').toLowerCase().indexOf(q) >= 0;

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

    return titleMatch || aircraftMatch || descMatch || typeMatch || refCodeMatch || memoryMatch || stepsMatch || docMatch;
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

  function countLeaves(items) {
    var count = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].children && items[i].children.length > 0) {
        count += countLeaves(items[i].children);
      } else {
        count++;
      }
    }
    return count;
  }

  /* ─── Event binding ─── */

  function bindSearchInput(container) {
    var input = container.querySelector('.ffstraining-search-input');
    if (input && !input.dataset.delegated) {
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
      input.dataset.delegated = 'true';
    }
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */

  function init() {
    var container = document.getElementById('ffstrainingContainer');
    if (!container) {
      console.error('Контейнер ffstrainingContainer не найден!');
      return;
    }

    // Делегирование: вешать ровно ОДИН раз
    if (!container.dataset.delegated) {
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
      container.dataset.delegated = 'true';
    }

    // Сброс фильтра при повторном входе
    _filter = '';

    // Если данные закэшированы — сразу рендер
    if (_data) {
      renderAll();
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
      })
      .catch(function(err) {
        app.showError(container, 'Не удалось загрузить тренировки');
        console.error('ffstraining fetch error:', err);
      });
  }

  /* ═══════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════ */

  function getTypeBadgeModifier(type) {
    switch (type) {
      case 'Recurrent':    return 'badge--normal';
      case 'Type Rating':  return 'badge--abnormal';
      case 'Special':      return 'badge--emergency';
      case 'Proficiency':  return 'badge--success';
      default:             return 'badge--neutral';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
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
     REGISTER
     ═══════════════════════════════════════════ */

  window.ModuleRegistry.register('ffstraining', {
    title:        'FFS Training',
    icon:         'monitor',
    init:          init,
    renderHeader:  renderHeader
  });

})();
