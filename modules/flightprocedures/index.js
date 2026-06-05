/* ═══════════════════════════════════════════
   Pilot's Tool — modules/flightprocedures/index.js
   Модуль «Лётные процедуры» (Unified FP + FFS)
   ═══════════════════════════════════════════ */

(function() {
  'use strict';

  /* ─── Приватное состояние ─── */
  var _data      = null;   // кэш загруженных данных
  var _filter    = '';     // текущий поисковый запрос
  var _htmlCache = {};     // кэш загруженных HTML-файлов для tableFile

  /* ─── Маппинги для бейджей ─── */
  var SEVERITY_LABELS = {
    'normal':    'Норм',
    'abnormal':  'Абнорм',
    'emergency': 'Авар',
    'success':   'ОК',
    'neutral':   'Инфо'
  };

  var SEVERITY_MAP = {
    'Recurrent':   'normal',
    'Type Rating': 'abnormal',
    'Special':     'emergency',
    'Proficiency': 'success'
  };

  var TYPE_LABELS = {
    'Recurrent':   'Повторная',
    'Type Rating': 'На тип',
    'Special':     'Спецподготовка',
    'Proficiency': 'Профессиональная'
  };

  var STATUS_LABELS = {
    'completed': 'Завершено',
    'pending':   'Предстоит',
    'overdue':   'Просрочено'
  };

  var BADGE_TYPES = ['normal', 'abnormal', 'emergency', 'success', 'neutral'];

  /* ─── Inline badge renderer ───
     Заменяет {{badge:TYPE}} и {{badge:TYPE:LABEL}}
     на HTML-элемент бейджа.
     Вызывается ПОСЛЕ escapeHtml().
  */
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

    center.innerHTML = '<div class="hc-module">Лётные процедуры</div>';

    right.innerHTML = '';
    right.onclick = null;
  }

  /* ═══════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════ */

  function renderAll() {
    var container = document.getElementById('flightproceduresContainer');
    if (!container || !_data) return;

    // Filter data recursively
    var q = _filter.trim().toLowerCase();
    var filtered = q ? filterItems(_data, q) : _data;

    // Group by category — free string, preserve JSON order of first appearance
    var categoryOrder = [];
    var grouped = {};
    for (var i = 0; i < filtered.length; i++) {
      var item = filtered[i];
      var cat = item.category || '';
      if (!grouped[cat]) {
        grouped[cat] = [];
        categoryOrder.push(cat);
      }
      grouped[cat].push(item);
    }

    var html = '';

    /* Search bar */
    html += '<div class="flightprocedures-search-bar">';
    html += '<div class="flightprocedures-search-input-wrap">';
    html += '<span class="flightprocedures-search-input-icon">' + window.ICONS.search + '</span>';
    html += '<input type="text" class="flightprocedures-search-input" placeholder="Поиск по процедурам…"'
      + ' value="' + escapeAttr(_filter || '') + '">';
    html += '</div>';
    if (_filter) {
      html += '<button class="flightprocedures-search-clear" aria-label="Очистить">' + window.ICONS.x + '</button>';
    }
    html += '</div>';

    if (filtered.length === 0 && q) {
      html += '<div class="flightprocedures-empty">';
      html += '<div class="flightprocedures-empty-icon">' + window.ICONS.search + '</div>';
      html += '<p class="flightprocedures-empty-text">Ничего не найдено</p>';
      html += '<p class="flightprocedures-empty-sub">Попробуйте изменить запрос</p>';
      html += '</div>';
    } else {
      for (var c = 0; c < categoryOrder.length; c++) {
        var catKey = categoryOrder[c];
        var items = grouped[catKey];
        if (!items || items.length === 0) continue;

        var label = catKey || 'Без категории';
        var isOpen = (c === 0);

        /* Section divider toggle */
        html += '<div class="list-divider flightprocedures-section-toggle' + (isOpen ? ' is-open' : '') + '" data-category="' + escapeAttr(catKey) + '">';
        html += '<span class="list-divider-label">' + escapeHtml(label) + '</span>';
        html += '<span class="ffs-section-count">' + countLeaves(items) + '</span>';
        html += '</div>';

        /* Section cards container */
        html += '<div class="flightprocedures-section-cards' + (isOpen ? ' open' : '') + '" data-category="' + escapeAttr(catKey) + '">';
        for (i = 0; i < items.length; i++) {
          html += renderItem(items[i], 1);
        }
        html += '</div>';
      }
    }

    app.hideSkeleton(container, html);

    bindSearchInput(container);
    loadTableFiles(container);

    var clearBtn = container.querySelector('.flightprocedures-search-clear');
    if (clearBtn && !clearBtn.dataset.bound) {
      clearBtn.dataset.bound = 'true';
      clearBtn.addEventListener('click', function() {
        _filter = '';
        renderAll();
        var inp = container.querySelector('.flightprocedures-search-input');
        if (inp) inp.focus();
      });
    }
  }

  /* ─── Рекурсивный рендер элемента (аккордеон любой глубины) ─── */
  function renderItem(item, depth) {
    var sev = item.severity || 'normal';
    var showHeaderBadge = item.headerBadge !== false;
    var hasChildren = item.children && item.children.length > 0;

    // Badge: use severity directly. If type is present (FFS-style), derive severity from SEVERITY_MAP
    if (item.type && !item.severity) {
      sev = SEVERITY_MAP[item.type] || 'neutral';
    }

    // Badge label: type label OR severity label
    var badgeClass = 'badge badge--' + sev;
    var badgeLabel = item.type ? (TYPE_LABELS[item.type] || item.type) : (SEVERITY_LABELS[sev] || sev);

    var html = '<div class="flightprocedures-card" data-depth="' + depth + '" data-id="' + escapeAttr(item.id || '') + '">';

    // Card header (accordion toggle)
    var headerCls = 'flightprocedures-card-header';
    if (!showHeaderBadge) headerCls += ' flightprocedures-card-header--no-badge';
    html += '<div class="' + headerCls + '">';
    if (showHeaderBadge) {
      html += '<span class="' + badgeClass + '">' + escapeHtml(badgeLabel) + '</span>';
    }
    html += '<div class="flightprocedures-card-info">';
    html += '<div class="flightprocedures-card-title">' + escapeHtml(item.title) + '</div>';

    // refCode (FP-style)
    if (item.refCode) {
      html += '<div class="flightprocedures-card-ref">' + escapeHtml(item.refCode) + '</div>';
    }

    // aircraft / duration (FFS-style)
    if (item.aircraft || item.duration) {
      html += '<div class="flightprocedures-card-meta">';
      if (item.aircraft) {
        html += '<span class="flightprocedures-card-aircraft">' + escapeHtml(item.aircraft) + '</span>';
      }
      if (item.aircraft && item.duration) {
        html += '<span class="flightprocedures-card-sep"> \u00B7 </span>';
      }
      if (item.duration) {
        html += '<span class="flightprocedures-card-duration">' + escapeHtml(item.duration) + '</span>';
      }
      html += '</div>';
    }

    // child count
    if (hasChildren) {
      html += '<span class="flightprocedures-card-child-count">' + item.children.length + '</span>';
    }
    html += '</div>'; // card-info

    // status (FFS-style)
    if (item.status) {
      var statusLabel = STATUS_LABELS[item.status] || item.status;
      html += '<span class="flightprocedures-status flightprocedures-status--' + item.status + '">' + escapeHtml(statusLabel) + '</span>';
    }

    html += '<span class="flightprocedures-card-chevron">' + window.ICONS['chevron-down'] + '</span>';
    html += '</div>'; // card-header

    // Card body (expanded)
    html += '<div class="flightprocedures-card-body">';
    html += '<div class="flightprocedures-card-content">';

    // Content fields (only for leaf or items with their own content)
    var hasOwnContent = item.description || item.image || (item.memoryItems && item.memoryItems.length > 0)
      || (item.steps && item.steps.length > 0) || item.tableFile
      || (item.equipment && item.equipment.length > 0)
      || item.instructorNotes || item.criteria
      || (item.documents && item.documents.length > 0) || (item.references && item.references.length > 0);

    if (hasOwnContent) {
      // 1. Description
      if (item.description) {
        html += '<div class="flightprocedures-description">' + renderInlineBadges(escapeHtml(item.description)) + '</div>';
      }

      // 2. Image
      if (item.image) {
        html += '<div class="flightprocedures-image-gallery">';
        html += '<img class="flightprocedures-image-thumb"'
          + ' src="' + escapeAttr(item.image) + '"'
          + ' data-full-src="' + escapeAttr(item.image) + '"'
          + ' alt="' + escapeAttr(item.title) + '"'
          + ' loading="lazy">';
        html += '</div>';
      }

      // 3. Memory items
      if (item.memoryItems && item.memoryItems.length > 0) {
        html += '<div class="flightprocedures-memory">';
        html += '<div class="flightprocedures-memory-title">'
          + window.ICONS['alert-triangle']
          + ' Memory Items</div>';
        html += '<ul class="flightprocedures-memory-list">';
        for (var m = 0; m < item.memoryItems.length; m++) {
          html += '<li class="flightprocedures-memory-item">' + renderInlineBadges(escapeHtml(item.memoryItems[m])) + '</li>';
        }
        html += '</ul>';
        html += '</div>';
      }

      // 4. Steps
      if (item.steps && item.steps.length > 0) {
        html += '<div class="flightprocedures-steps">';
        html += '<div class="flightprocedures-steps-title">Порядок действий</div>';
        html += '<ol class="flightprocedures-steps-list">';
        for (var s = 0; s < item.steps.length; s++) {
          html += '<li class="flightprocedures-step">' + renderInlineBadges(escapeHtml(item.steps[s])) + '</li>';
        }
        html += '</ol>';
        html += '</div>';
      }

      // 5. External table file
      if (item.tableFile) {
        html += '<div class="flightprocedures-table-wrap flightprocedures-table-file" data-table-src="' + escapeAttr(item.tableFile) + '">';
        html += '<div class="flightprocedures-table-loading">Загрузка таблицы…</div>';
        html += '</div>';
      }

      // 6. Equipment (FFS-style)
      if (item.equipment && item.equipment.length > 0) {
        html += '<div class="flightprocedures-equipment">';
        html += '<div class="flightprocedures-equipment-title">Оборудование</div>';
        html += '<ul class="flightprocedures-equipment-list">';
        for (var eq = 0; eq < item.equipment.length; eq++) {
          html += '<li>' + escapeHtml(item.equipment[eq]) + '</li>';
        }
        html += '</ul></div>';
      }

      // 7. Instructor notes (FFS-style)
      if (item.instructorNotes) {
        html += '<div class="flightprocedures-notes">';
        html += '<div class="flightprocedures-notes-title">' + window.ICONS['comments'] + ' Указания инструктора</div>';
        html += '<div class="flightprocedures-notes-text">' + renderInlineBadges(escapeHtml(item.instructorNotes)) + '</div>';
        html += '</div>';
      }

      // 8. Criteria (FFS-style)
      if (item.criteria) {
        html += '<div class="flightprocedures-criteria">';
        html += '<div class="flightprocedures-criteria-title">' + window.ICONS['check-circle'] + ' Критерии завершения</div>';
        html += '<div class="flightprocedures-criteria-text">' + escapeHtml(item.criteria) + '</div>';
        html += '</div>';
      }

      // 9. References + clickable document links
      var hasDocs = item.documents && item.documents.length > 0;
      var hasRefs = item.references && item.references.length > 0;

      if (hasDocs || hasRefs) {
        html += '<div class="flightprocedures-refs">';
        html += '<div class="flightprocedures-refs-title">Ссылки</div>';
        html += '<ul class="flightprocedures-refs-list">';

        if (hasDocs) {
          for (var d = 0; d < item.documents.length; d++) {
            var doc = item.documents[d];
            var docPage = doc.page || 1;
            html += '<li class="flightprocedures-ref flightprocedures-ref--link"'
              + ' data-pdf-src="' + escapeAttr(doc.src) + '"'
              + ' data-pdf-page="' + docPage + '"'
              + ' role="button" tabindex="0"'
              + ' aria-label="Открыть PDF, стр. ' + docPage + '">';
            html += '<span class="flightprocedures-ref-icon">' + (window.ICONS['file-text'] || '') + '</span>';
            html += '<span class="flightprocedures-ref-text">' + escapeHtml(doc.title) + '</span>';
            html += '<span class="flightprocedures-ref-page">стр.&nbsp;' + docPage + '</span>';
            html += '</li>';
          }
        }

        if (hasRefs) {
          for (var r = 0; r < item.references.length; r++) {
            var ref = item.references[r];
            var refText = (typeof ref === 'string') ? ref : (ref.text || '');
            html += '<li class="flightprocedures-ref">' + renderInlineBadges(escapeHtml(refText)) + '</li>';
          }
        }

        html += '</ul>';
        html += '</div>';
      }
    }

    // Nested children (recursive)
    if (hasChildren) {
      html += '<div class="flightprocedures-nested">';
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
    var refMatch = (item.refCode || '').toLowerCase().indexOf(q) >= 0;
    var descMatch = (item.description || '').toLowerCase().indexOf(q) >= 0;
    var catMatch = (item.category || '').toLowerCase().indexOf(q) >= 0;
    var memoryMatch = false;
    if (item.memoryItems) {
      for (var m = 0; m < item.memoryItems.length; m++) {
        if (item.memoryItems[m].toLowerCase().indexOf(q) >= 0) {
          memoryMatch = true; break;
        }
      }
    }
    var stepsMatch = false;
    if (item.steps) {
      for (var s = 0; s < item.steps.length; s++) {
        if (item.steps[s].toLowerCase().indexOf(q) >= 0) {
          stepsMatch = true; break;
        }
      }
    }
    var docMatch = false;
    if (item.documents) {
      for (var d = 0; d < item.documents.length; d++) {
        if (item.documents[d].title.toLowerCase().indexOf(q) >= 0) {
          docMatch = true; break;
        }
      }
    }
    // FFS-style keys
    var aircraftMatch = (item.aircraft || '').toLowerCase().indexOf(q) >= 0;
    var typeLabel = TYPE_LABELS[item.type] || '';
    var typeMatch = typeLabel.toLowerCase().indexOf(q) >= 0 || (item.type || '').toLowerCase().indexOf(q) >= 0;
    var statusLabel = STATUS_LABELS[item.status] || '';
    var statusMatch = statusLabel.toLowerCase().indexOf(q) >= 0 || (item.status || '').toLowerCase().indexOf(q) >= 0;
    return titleMatch || refMatch || descMatch || catMatch || memoryMatch || stepsMatch || docMatch || aircraftMatch || typeMatch || statusMatch;
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

  /* ─── Подсчёт листьев (для счётчика в секции) ─── */
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
    var input = container.querySelector('.flightprocedures-search-input');
    if (input && !input.dataset.delegated) {
      input.addEventListener('input', function(e) {
        _filter = e.target.value;
        renderAll();
        var inp = container.querySelector('.flightprocedures-search-input');
        if (inp) {
          inp.focus();
          inp.setSelectionRange(_filter.length, _filter.length);
        }
      });
      input.dataset.delegated = 'true';
    }
  }

  /* ─── Load external HTML table files ─── */
  function loadTableFiles(container) {
    var fileSlots = container.querySelectorAll('.flightprocedures-table-file');
    for (var i = 0; i < fileSlots.length; i++) {
      (function(slot) {
        var src = slot.dataset.tableSrc;
        if (!src) return;

        if (_htmlCache[src]) {
          slot.innerHTML = _htmlCache[src];
          return;
        }

        fetch(src)
          .then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
          })
          .then(function(html) {
            _htmlCache[src] = html;
            slot.innerHTML = html;
          })
          .catch(function() {
            slot.innerHTML = '<div class="flightprocedures-table-error">Не удалось загрузить таблицу</div>';
          });
      })(fileSlots[i]);
    }
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */

  function init() {
    var container = document.getElementById('flightproceduresContainer');
    if (!container) {
      console.error('Контейнер flightproceduresContainer не найден!');
      return;
    }

    // Делегирование: вешать ровно ОДИН раз
    if (!container.dataset.delegated) {
      container.addEventListener('click', function(e) {
        // Section divider toggle
        var sectionToggle = e.target.closest('.flightprocedures-section-toggle');
        if (sectionToggle) {
          var cat = sectionToggle.dataset.category;
          var cards = container.querySelector('.flightprocedures-section-cards[data-category="' + cat + '"]');
          if (cards) {
            cards.classList.toggle('open');
            sectionToggle.classList.toggle('is-open');
          }
          return;
        }

        // Card header toggle (works at any depth)
        var cardHeader = e.target.closest('.flightprocedures-card-header');
        if (cardHeader) {
          var card = cardHeader.closest('.flightprocedures-card');
          if (card) {
            card.classList.toggle('open');
          }
          return;
        }

        // Image click → PhotoSwipe
        var imgThumb = e.target.closest('.flightprocedures-image-thumb');
        if (imgThumb) {
          var gallery = imgThumb.closest('.flightprocedures-image-gallery');
          app.openPhotoSwipe(imgThumb, gallery);
          return;
        }

        // PDF reference click → openPDFModal (on specific page)
        var refLink = e.target.closest('.flightprocedures-ref--link');
        if (refLink) {
          var pdfSrc = refLink.dataset.pdfSrc;
          var pdfPage = parseInt(refLink.dataset.pdfPage, 10) || 1;
          if (pdfSrc) {
            app.openPDFModal(pdfSrc, pdfPage);
          }
          return;
        }
      });
      container.dataset.delegated = 'true';
    }

    _filter = '';

    if (_data) {
      renderAll();
      return;
    }

    app.showSkeleton(container, 'blocks');

    fetch('modules/flightprocedures/data/flightprocedures.json')
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        if (Array.isArray(data)) {
          _data = data;
        } else {
          _data = data.procedures || [];
        }
        renderAll();
      })
      .catch(function(err) {
        app.showError(container, 'Не удалось загрузить процедуры');
        console.error('flightprocedures fetch error:', err);
      });
  }

  /* ═══════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════ */

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

  window.ModuleRegistry.register('flightprocedures', {
    title:        'Лётные процедуры',
    icon:         'message-square',
    init:          init,
    renderHeader:  renderHeader
  });

})();
