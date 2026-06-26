/* ═══════════════════════════════════════════
   Pilot's Tool — modules/survey/index.js
   Модуль «Контрольный опрос» — проверка знаний
   ═══════════════════════════════════════════ */

(function() {
  'use strict';

  /* ─── Приватное состояние ─── */
  var _data      = null;   // загруженные вопросы из JSON
  var _mastered  = {};     // id вопроса → true (localStorage)
  var _expanded  = {};     // id категории → true
  var _openQ     = {};     // id вопроса → true (ответ раскрыт)
  var _searchQ   = '';     // поисковый запрос
  var _activeSection = 'line'; // активная секция: 'line' | 'ffs'

  var STORAGE_KEY = 'survey-mastered';

  /* ─── Совместимость JSON v1/v2 ─── */
  function getAllCategories() {
    if (!_data) return [];
    if (_data.line && _data.ffs) {
      return (_data.line.categories || []).concat(_data.ffs.categories || []);
    }
    return _data.categories || [];
  }
  function getActiveCategories() {
    if (!_data) return [];
    if (_data.line && _data.ffs) {
      return (_data[_activeSection] && _data[_activeSection].categories) || [];
    }
    return _data.categories || [];
  }

  /* ═══════════════════════════════════════════
     UTILITY: icon helper
     ═══════════════════════════════════════════ */
  function icon(name, size, extraClass) {
    var svg = (window.ICONS && window.ICONS[name]) || '';
    if (size) {
      if (/width="24"/.test(svg)) {
        svg = svg.replace(/width="24"/g, 'width="' + size + '"')
                 .replace(/height="24"/g, 'height="' + size + '"');
      } else if (/<svg/.test(svg)) {
        svg = svg.replace(/<svg/, '<svg width="' + size + '" height="' + size + '"');
      }
    }
    if (extraClass) {
      svg = svg.replace('<svg ', '<svg class="' + extraClass + '" ');
    }
    return svg;
  }

  /* ═══════════════════════════════════════════
     LOCALSTORAGE: mastered progress
     ═══════════════════════════════════════════ */
  function loadMastered() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored) _mastered = JSON.parse(stored);
    } catch(e) { _mastered = {}; }
  }

  function saveMastered() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_mastered));
    } catch(e) {}
  }

  function toggleMastered(qId) {
    if (_mastered[qId]) {
      delete _mastered[qId];
    } else {
      _mastered[qId] = true;
    }
    saveMastered();
  }

  /* ═══════════════════════════════════════════
     PROGRESS CALCULATION
     ═══════════════════════════════════════════ */
  function getCategoryProgress(cat) {
    var total = cat.questions.length;
    var done = 0;
    for (var i = 0; i < total; i++) {
      if (_mastered[cat.questions[i].id]) done++;
    }
    return { total: total, done: done, pct: total > 0 ? Math.round(done / total * 100) : 0 };
  }

  function getTotalProgress() {
    var total = 0;
    var done = 0;
    var allCats = getAllCategories();
    for (var c = 0; c < allCats.length; c++) {
      var cat = allCats[c];
      total += cat.questions.length;
      for (var q = 0; q < cat.questions.length; q++) {
        if (_mastered[cat.questions[q].id]) done++;
      }
    }
    return { total: total, done: done, pct: total > 0 ? Math.round(done / total * 100) : 0 };
  }

  /* ═══════════════════════════════════════════
     PROGRESS RING SVG
     ═══════════════════════════════════════════ */
  function renderProgressRing(pct, size) {
    var s = size || 48;
    var r = (s / 2) - 4;
    var circ = 2 * Math.PI * r;
    var offset = circ - (pct / 100) * circ;
    var strokeColor = pct === 100 ? 'var(--color-success)' : 'var(--color-primary)';
    return '<svg viewBox="0 0 ' + s + ' ' + s + '">' +
      '<circle class="survey-category-progress-bg" cx="' + (s/2) + '" cy="' + (s/2) + '" r="' + r + '" stroke-width="3"/>' +
      '<circle class="survey-category-progress-fill" cx="' + (s/2) + '" cy="' + (s/2) + '" r="' + r + '" ' +
        'stroke-width="3" stroke="' + strokeColor + '" ' +
        'stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '"/>' +
    '</svg>';
  }

  /* ═══════════════════════════════════════════
     RENDER: Full Content
     ═══════════════════════════════════════════ */
  /* ─── Task 47: Language detector for hyphens:auto ───
     Возвращает 'en' / 'ru' / '' в зависимости от соотношения латиницы и кириллицы.
     Пустая строка — нейтральный (родительский lang attr побеждает). */
  function detectLang(text) {
    if (!text) return '';
    var latin = (text.match(/[A-Za-z]/g) || []).length;
    var cyrillic = (text.match(/[\u0410-\u044F]/g) || []).length;
    if (latin > cyrillic && latin > 0) return 'en';
    if (cyrillic > 0 && cyrillic >= latin) return 'ru';
    return '';
  }
  function langAttr(text) {
    var l = detectLang(text);
    return l ? ' lang="' + l + '"' : '';
  }

  function renderAll() {
    var container = document.getElementById('surveyContainer');
    if (!container || !_data) return;

    var totalProg = getTotalProgress();
    var activeCats = getActiveCategories();
    var isV2 = !!(_data.line && _data.ffs);

    var html = '<div class="module-container" lang="ru">';

    /* ─── Section Tabs (LINE/FFS) — только для v2 ─── */
    if (isV2) {
      html += '<div class="survey-section-tabs">' +
        '<button class="survey-section-tab' + (_activeSection === 'line' ? ' active' : '') + '" data-survey-section="line" lang="en">LINE</button>' +
        '<button class="survey-section-tab' + (_activeSection === 'ffs' ? ' active' : '') + '" data-survey-section="ffs" lang="en">FFS</button>' +
      '</div>';
    }

    /* ─── Search ─── */
    html += '<div class="survey-search-wrap">' +
      '<span class="survey-search-icon">' + icon('search', 18) + '</span>' +
      '<input type="search" class="survey-search-input" id="surveySearchInput" placeholder="\u041F\u043E\u0438\u0441\u043A \u0432\u043E\u043F\u0440\u043E\u0441\u043E\u0432..." autocomplete="off">' +
    '</div>';

    /* ─── Overview Stats ─── */
    html += '<div class="survey-overview">' +
      '<div class="survey-stat-card">' +
        '<div class="survey-stat-value">' + activeCats.length + '</div>' +
        '<div class="survey-stat-label">\u0420\u0430\u0437\u0434\u0435\u043B\u043E\u0432</div>' +
      '</div>' +
      '<div class="survey-stat-card">' +
        '<div class="survey-stat-value">' + totalProg.total + '</div>' +
        '<div class="survey-stat-label">\u0412\u043E\u043F\u0440\u043E\u0441\u043E\u0432</div>' +
      '</div>' +
      '<div class="survey-stat-card">' +
        '<div class="survey-stat-value survey-stat-value--success">' + totalProg.done + '</div>' +
        '<div class="survey-stat-label">\u041E\u0442\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043E</div>' +
      '</div>' +
      '<div class="survey-stat-card">' +
        '<div class="survey-stat-value survey-stat-value--success">' + totalProg.pct + '%</div>' +
        '<div class="survey-stat-label">\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441</div>' +
      '</div>' +
    '</div>';

    /* ─── Categories ─── */
    html += '<div id="surveyCategories">';
    html += renderCategories();
    html += '</div>';

    html += '</div>';  // close .module-container

    app.hideSkeleton(container, html);

    /* ─── Bind search ─── */
    var searchInput = document.getElementById('surveySearchInput');
    if (searchInput) {
      if (_searchQ) searchInput.value = _searchQ;
      searchInput.addEventListener('input', function(e) {
        _searchQ = e.target.value.toLowerCase().trim();
        var catContainer = document.getElementById('surveyCategories');
        if (catContainer) {
          catContainer.innerHTML = renderCategories();
        }
      });
    }
  }

  /* ═══════════════════════════════════════════
     RENDER: Categories HTML
     ═══════════════════════════════════════════ */
  function renderCategories() {
    if (!_data) return '';

    var html = '';
    var hasAnyResult = false;
    var cats = getActiveCategories();

    for (var c = 0; c < cats.length; c++) {
      var cat = cats[c];
      var prog = getCategoryProgress(cat);
      var isExpanded = !!_expanded[cat.id];

      /* ─── Filter questions by search ─── */
      var filteredQuestions = [];
      for (var q = 0; q < cat.questions.length; q++) {
        var question = cat.questions[q];
        if (!_searchQ || question.q.toLowerCase().indexOf(_searchQ) !== -1 || question.a.toLowerCase().indexOf(_searchQ) !== -1) {
          filteredQuestions.push(question);
        }
      }

      if (_searchQ && filteredQuestions.length === 0) continue;
      hasAnyResult = true;

      /* ─── Auto-expand when searching ─── */
      var effectiveExpanded = _searchQ ? true : isExpanded;

      html += '<div class="survey-category' + (effectiveExpanded ? ' open' : '') + '" data-category="' + cat.id + '">';

      /* Header */
      html += '<div class="survey-category-header" data-cat-toggle="' + cat.id + '" role="button" tabindex="0" aria-expanded="' + effectiveExpanded + '">' +
        '<span class="survey-category-icon">' + icon(cat.icon || 'checklist', 20) + '</span>' +
        '<div class="survey-category-info">' +
          '<div class="survey-category-title"' + langAttr(cat.title) + '>' + cat.title + '</div>' +
          '<div class="survey-category-meta">' + prog.done + '/' + prog.total + ' \u043E\u0442\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043E' + (prog.pct === 100 ? ' \u2713' : '') + '</div>' +
        '</div>' +
        '<div class="survey-category-progress">' +
          renderProgressRing(prog.pct) +
          '<span class="survey-category-progress-text">' + prog.pct + '%</span>' +
        '</div>' +
        '<span class="survey-category-chevron">' + icon('chevron-down', 20) + '</span>' +
      '</div>';

      /* Questions */
      html += '<div class="survey-questions">';
      for (var fq = 0; fq < filteredQuestions.length; fq++) {
        var fqItem = filteredQuestions[fq];
        var isMastered = !!_mastered[fqItem.id];
        var isOpen = !!_openQ[fqItem.id];

        html += '<div class="survey-question' + (isMastered ? ' survey-question--mastered' : '') + (isOpen ? ' open' : '') + '" data-question="' + fqItem.id + '">';

        /* Question header */
        html += '<div class="survey-question-header" data-q-toggle="' + fqItem.id + '">' +
          '<span class="survey-question-checkbox" data-q-check="' + fqItem.id + '" role="checkbox" aria-checked="' + isMastered + '" aria-label="\u041E\u0442\u043C\u0435\u0442\u0438\u0442\u044C \u043A\u0430\u043A \u043E\u0442\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043D\u043E\u0435">' +
            icon('check-square', 14) +
          '</span>' +
          '<span class="survey-question-text"' + langAttr(fqItem.q) + '>' + fqItem.q + '</span>' +
          '<span class="survey-question-toggle">' + icon('chevron-down', 18) + '</span>' +
        '</div>';

        /* Question image — под header, не внутри flex-строки */
        if (fqItem.qimg) {
          html += '<img class="survey-question-img" src="modules/survey/data/' + fqItem.qimg + '" data-full-src="modules/survey/data/' + fqItem.qimg + '" data-survey-img="1" alt="\u0418\u043B\u043B\u044E\u0441\u0442\u0440\u0430\u0446\u0438\u044F">';
        }

        /* Answer */
        html += '<div class="survey-answer">' +
          '<div class="survey-answer-text"' + langAttr(fqItem.a) + '>' + fqItem.a + '</div>' +
          (fqItem.img ? '<img class="survey-answer-img" src="modules/survey/data/' + fqItem.img + '" data-full-src="modules/survey/data/' + fqItem.img + '" data-survey-img="1" alt="\u0418\u043B\u043B\u044E\u0441\u0442\u0440\u0430\u0446\u0438\u044F">' : '') +
          (fqItem.ref ? '<div class="survey-answer-ref"' + langAttr(fqItem.ref) + '>' + fqItem.ref + '</div>' : '') +
        '</div>';

        html += '</div>';
      }
      html += '</div>';

      html += '</div>';
    }

    if (_searchQ && !hasAnyResult) {
      html += '<div class="survey-no-results">' +
        icon('search', 40) +
        '<div>\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E</div>' +
      '</div>';
    }

    return html;
  }

  /* ═══════════════════════════════════════════
     HEADER: Вариант Б — гамбургер + заголовок + ⋮ (сброс)
     ═══════════════════════════════════════════ */
  function renderHeader() {
    var left   = document.getElementById('headerLeft');
    var center = document.getElementById('headerCenter');
    var right  = document.getElementById('headerRight');
    if (!left || !center || !right) return;

    left.innerHTML = '<button id="menuBtn" class="icon-btn" aria-label="Меню">'
      + window.ICONS.menu + '</button>';
    left.onclick = function() { app.toggleMenu(); };

    center.innerHTML = '<div class="hc-module">\u041A\u043E\u043D\u0442\u0440\u043E\u043B\u044C\u043D\u044B\u0439 \u043E\u043F\u0440\u043E\u0441</div>';

    right.innerHTML = '<button class="icon-btn" aria-label="\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F">'
      + icon('ellipsis-vertical', 20) + '</button>';
    right.onclick = function(e) {
      e.stopPropagation();
      toggleSurveyMenu();
    };
  }

  function toggleSurveyMenu() {
    var existing = document.getElementById('surveyDropdown');
    if (existing) { closeSurveyMenu(); return; }

    /* Full-screen overlay covering header too */
    var overlay = document.createElement('div');
    overlay.id = 'surveyOverlay';
    overlay.className = 'survey-overlay';
    document.body.appendChild(overlay);

    /* Click overlay → close menu */
    overlay.addEventListener('click', function() {
      closeSurveyMenu();
    });

    var rightBtn = document.querySelector('#headerRight .icon-btn');
    if (!rightBtn) return;

    var rect = rightBtn.getBoundingClientRect();
    var menu = document.createElement('div');
    menu.id = 'surveyDropdown';
    menu.className = 'survey-dropdown-menu';
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    menu.innerHTML = '<button class="survey-dropdown-item" data-survey-action="reset-progress">'
      + icon('trash', 16) + ' <span>\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441</span></button>';
    document.body.appendChild(menu);

    /* Click handler directly on dropdown — it's outside container so delegation doesn't work */
    menu.addEventListener('click', function(ev) {
      var dropItem = ev.target.closest('[data-survey-action]');
      if (dropItem) {
        var sAction = dropItem.dataset.surveyAction;
        if (sAction === 'reset-progress') {
          closeSurveyMenu();
          app.showConfirm('\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0432\u0435\u0441\u044C \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441?', function() {
            _mastered = {};
            _openQ = {};
            saveMastered();
            renderAll();
            app.showToast('\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0441\u0431\u0440\u043E\u0448\u0435\u043D');
          }, '\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C');
        }
      }
    });
  }

  function closeSurveyMenu() {
    var menu = document.getElementById('surveyDropdown');
    if (menu) menu.remove();
    var overlay = document.getElementById('surveyOverlay');
    if (overlay) overlay.remove();
  }

  function destroy() {
    closeSurveyMenu();
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */
  function init(params) {
    var container = document.getElementById('surveyContainer');
    if (!container) { console.error('\u041A\u043E\u043D\u0442\u0435\u0439\u043D\u0435\u0440 surveyContainer \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D!'); return; }

    /* Делегирование */
    container.addEventListener('click', function(e) {

        /* Клик по табу секции LINE/FFS */
        var sectionTab = e.target.closest('[data-survey-section]');
        if (sectionTab) {
          var section = sectionTab.getAttribute('data-survey-section');
          if (section !== _activeSection) {
            _activeSection = section;
            _searchQ = '';
            renderAll();
          }
          return;
        }

        /* Клик по чекбоксу вопроса → отметить/снять */
        var checkEl = e.target.closest('[data-q-check]');
        if (checkEl) {
          e.stopPropagation();
          var qId = checkEl.getAttribute('data-q-check');
          toggleMastered(qId);
          renderAll();
          return;
        }

        /* Клик по заголовку вопроса → раскрыть/скрыть ответ */
        var qToggle = e.target.closest('[data-q-toggle]');
        if (qToggle) {
          var qId2 = qToggle.getAttribute('data-q-toggle');
          if (_openQ[qId2]) {
            delete _openQ[qId2];
          } else {
            _openQ[qId2] = true;
          }
          /* Targeted update: just toggle the open class */
          var qEl = qToggle.closest('.survey-question');
          if (qEl) {
            if (_openQ[qId2]) {
              qEl.classList.add('open');
            } else {
              qEl.classList.remove('open');
            }
          }
          return;
        }

        /* Клик по картинке → PhotoSwipe */
        var surveyImg = e.target.closest('[data-survey-img]');
        if (surveyImg) {
          var sContainer = document.getElementById('surveyContainer');
          app.openPhotoSwipe(surveyImg, sContainer);
          return;
        }

        /* Клик по заголовку категории → раскрыть/скрыть */
        var catToggle = e.target.closest('[data-cat-toggle]');
        if (catToggle) {
          var catId = catToggle.getAttribute('data-cat-toggle');
          if (_expanded[catId]) {
            delete _expanded[catId];
          } else {
            _expanded[catId] = true;
          }
          /* Targeted update: just toggle the open class */
          var catEl = catToggle.closest('.survey-category');
          if (catEl) {
            if (_expanded[catId]) {
              catEl.classList.add('open');
              catToggle.setAttribute('aria-expanded', 'true');
            } else {
              catEl.classList.remove('open');
              catToggle.setAttribute('aria-expanded', 'false');
            }
          }
          return;
        }

    });

    /* Load mastered state */
    loadMastered();

    /* Load data */
    if (_data) {
      renderAll();
      return;
    }

    app.showSkeleton(container, 'blocks');

    fetch('modules/survey/data/survey.json')
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        _data = data;
        renderAll();
      })
      .catch(function(err) {
        app.showError(container, '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435');
        console.error('survey fetch error:', err);
      });
  }

  /* ═══════════════════════════════════════════
     REGISTER
     ═══════════════════════════════════════════ */

  window.ModuleRegistry.register('survey', {
    title:        '\u041A\u043E\u043D\u0442\u0440\u043E\u043B\u044C\u043D\u044B\u0439 \u043E\u043F\u0440\u043E\u0441',
    icon:         'clipboard-check',
    init:          init,
    renderHeader:  renderHeader,
    destroy:       destroy,
  });

})();
