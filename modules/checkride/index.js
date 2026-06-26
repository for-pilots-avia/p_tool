/* ═══════════════════════════════════════════
   Pilot's Tool — modules/checkride/index.js
   Модуль «Checkride Rating» — инспекционная проверка
   Адаптация CheckRide Rating V8 → Module Pattern
   ═══════════════════════════════════════════ */

(function() {
  'use strict';

  /* ─── Приватное состояние ─── */
  var _data         = null;   // загруженный чеклист (LINE или FFS)
  var _dataLine     = null;   // кэш LINE данных
  var _dataFfs      = null;   // кэш FFS данных
  var _currentMode  = 'line'; // 'line' | 'ffs'
  var _sectionIndex = 0;      // текущий этап проверки
  var _screen       = 'start'; // start | test | report | history
  var _saveStateTimer = null;   // debounce для автосохранения textarea
  var _viewingHistory = false;  // Task 41: true когда отчёт открыт из истории (readonly режим)

  /* ─── Swipe-навигация (touch) ─── */
  var _swipeStartX    = 0;
  var _swipeStartY    = 0;
  var _swipeTracking  = false;
  var SWIPE_THRESHOLD = 50;   // минимальная дистанция свайпа (px)

  /* ─── Данные регистрации пилота (сохраняются в памяти) ─── */
  var _pilotData = {
    fio: '',
    license: '',
    instructor: '',
    route: '',
    ac_number: '',
    flight_time: '',
    signature: null   // Task 41: подпись инструктора (data URL, сохраняется в истории)
  };

  var STORAGE_HISTORY = 'checkride_v8';
  var STORAGE_PILOT   = 'checkride_pilot';  // автосохранение полей регистрации
  var STORAGE_STATE  = 'checkride_state';   // кэш хода проверки

  /* ─── Маппинг кодов компетенций (fallback — основные берутся из JSON competencyDefs) ─── */
  var COMPETENCY_LABELS = {
    '\u041F\u041F':  '\u041F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0438\u0435 \u043F\u0440\u043E\u0446\u0435\u0434\u0443\u0440',
    '\u041D\u041A':  '\u041D\u0430\u0432\u0438\u0433\u0430\u0446\u0438\u044F \u0438 \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u044C',
    '\u0420\u0421':  '\u0420\u0430\u0434\u0438\u043E\u0441\u0432\u044F\u0437\u044C',
    'CRM': '\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0440\u0435\u0441\u0443\u0440\u0441\u0430\u043C\u0438 \u044D\u043A\u0438\u043F\u0430\u0436\u0430',
    '\u041A\u041E\u041C': '\u041A\u043E\u043C\u043C\u0443\u043D\u0438\u043A\u0430\u0446\u0438\u044F',
    '\u0410\u0423':  '\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0442\u0440\u0430\u0435\u043A\u0442\u043E\u0440\u0438\u0435\u0439 \u043F\u043E\u043B\u0435\u0442\u0430 \u0412\u0421, \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0437\u0430\u0446\u0438\u044F',
    '\u0420\u0423':  '\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0442\u0440\u0430\u0435\u043A\u0442\u043E\u0440\u0438\u0435\u0439 \u043F\u043E\u043B\u0435\u0442\u0430 \u0412\u0421',
    '\u041A\u0420':  '\u041B\u0438\u0434\u0435\u0440\u0441\u0442\u0432\u043E \u0438 \u043A\u043E\u043C\u0430\u043D\u0434\u043D\u0430\u044F \u0440\u0430\u0431\u043E\u0442\u0430',
    '\u041F\u0420':  '\u0420\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u0435 \u043F\u0440\u043E\u0431\u043B\u0435\u043C \u0438 \u043F\u0440\u0438\u043D\u044F\u0442\u0438\u0435 \u0440\u0435\u0448\u0435\u043D\u0438\u0439',
    '\u0421\u041E':  '\u0421\u0438\u0442\u0443\u0430\u0446\u0438\u043E\u043D\u043D\u0430\u044F \u043E\u0441\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u043D\u043E\u0441\u0442\u044C',
    '\u0423\u0420\u041D': '\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0440\u0430\u0431\u043E\u0447\u0435\u0439 \u043D\u0430\u0433\u0440\u0443\u0437\u043A\u043E\u0439'
  };

  /* Resolve competency label: prefer JSON competencyDefs, fallback to COMPETENCY_LABELS */
  function getCompetencyLabel(code) {
    if (_data && _data.competencyDefs && _data.competencyDefs[code]) {
      return _data.competencyDefs[code];
    }
    return COMPETENCY_LABELS[code] || code;
  }

  /* DRY: expand top-level `competencies` шапка into each stage's "Компетенции." groups.
     For each GRP with topitem but no items, find matching comp in `competencies` block,
     clone items with stage-prefixed IDs: {stageIdx}_{origId} — preserves per-stage state,
     calculation formula unchanged (aggregates across stages as before). */
  function expandCompetencies(data) {
    if (!data || !data.competencies || !data.checklists) return data;
    data.checklists.forEach(function(cl, stageIdx) {
      cl.sections.forEach(function(sec) {
        if (sec.subname !== '\u041A\u043E\u043C\u043F\u0435\u0442\u0435\u043D\u0446\u0438\u0438.') return;
        var groups = sec.groups || [];
        groups.forEach(function(gr) {
          if (gr.topitem && (!gr.items || gr.items.length === 0)) {
            for (var i = 0; i < data.competencies.length; i++) {
              if (data.competencies[i].code === gr.topitem) {
                gr.items = data.competencies[i].items.map(function(it) {
                  return { id: stageIdx + '_' + it.id, type: it.type, label: it.label };
                });
                break;
              }
            }
          }
        });
      });
    });
    return data;
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
     PILOT DATA: save / load from localStorage
     ═══════════════════════════════════════════ */
  function savePilotToCache() {
    try {
      // Task 41: НЕ сохраняем signature в автозаполнение пилота — она одноразовая,
      // для каждой новой проверки инструктор расписывается заново.
      var toSave = {};
      for (var k in _pilotData) {
        if (k !== 'signature') toSave[k] = _pilotData[k];
      }
      localStorage.setItem(STORAGE_PILOT, JSON.stringify(toSave));
    } catch(e) {}
  }

  function loadPilotFromCache() {
    try {
      var raw = localStorage.getItem(STORAGE_PILOT);
      if (raw) {
        var saved = JSON.parse(raw);
        for (var key in _pilotData) {
          // Task 41: НЕ восстанавливаем signature из автозаполнения
          if (key === 'signature') continue;
          if (saved[key] !== undefined) _pilotData[key] = saved[key];
        }
      }
    } catch(e) {}
  }

  /* ═══════════════════════════════════════════
     INSPECTION STATE: save / load / clear (localStorage)
     ═══════════════════════════════════════════ */
  function saveInspectionState() {
    if (_screen !== 'test') return;
    try {
      var state = {
        data: _data,
        sectionIndex: _sectionIndex,
        currentMode: _currentMode,
        screen: _screen
      };
      localStorage.setItem(STORAGE_STATE, JSON.stringify(state));
    } catch(e) {}  // quota exceeded — silently fail
  }

  function loadInspectionState() {
    try {
      var raw = localStorage.getItem(STORAGE_STATE);
      if (raw) {
        var state = JSON.parse(raw);
        if (state && state.screen === 'test' && state.data) {
          _data = state.data;
          _sectionIndex = state.sectionIndex || 0;
          _currentMode = state.currentMode || 'line';
          _screen = 'test';
        }
      }
    } catch(e) {}  // corrupted data — ignore
  }

  function clearInspectionState() {
    try {
      localStorage.removeItem(STORAGE_STATE);
    } catch(e) {}
  }

  /* One-time cleanup of orphaned localStorage keys.
     Task 12 (FFS DRY refactor): FFS IDs changed from c_Preflight_pf_4_1, c_Takeoff_and_Climb_pf_4_1
       → c_{stageIdx}_{origId} (e.g. c_0_pf_4_1). Old keys remained as orphans.
     Task 16 (LINE DRY refactor): LINE IDs changed from hardcoded c1..c12 (in stages "Компетенции.")
       → c_{stageIdx}_{compCode}_{N} (e.g. c_4_ПП_1, c_4_НК_1, c_4_РС_1, c_4_CRM_1) via expandCompetencies.
       Old c1..c12 keys remained as orphans.
     Both old key sets are cleaned up once per browser via flag in localStorage. */
  var STORAGE_LEGACY_CLEANED = 'checkride_legacy_v13_cleaned';

  function cleanupLegacyStateOnce() {
    try {
      if (localStorage.getItem(STORAGE_LEGACY_CLEANED)) return;
      var raw = localStorage.getItem(STORAGE_STATE);
      if (!raw) {
        localStorage.setItem(STORAGE_LEGACY_CLEANED, '1');
        return;
      }
      var state = JSON.parse(raw);
      if (!state || !state.data || !state.data.checklists) {
        localStorage.setItem(STORAGE_LEGACY_CLEANED, '1');
        return;
      }
      /* Walk all items across all stages, drop keys with old ID pattern
         (containing '_' followed by a letter, e.g. c_Preflight_*, c_Takeoff_and_Climb_*) */
      var allItems = [];
      state.data.checklists.forEach(function(cl) {
        cl.sections.forEach(function(sec) {
          (sec.groups || []).forEach(function(gr) {
            (gr.items || []).forEach(function(it) {
              if (it && it.id) allItems.push(it);
            });
          });
        });
      });
      allItems.forEach(function(it) {
        if (it.ok !== undefined && typeof it.id === 'string') {
          /* Legacy v16 LINE ID: c1, c2, ..., c12 (hardcoded, no underscore) */
          if (/^c\d+$/.test(it.id)) {
            it.ok = false;
            if (it.comment) delete it.comment;
          } else if (it.id.indexOf('_') !== -1) {
            /* Check rest after first underscore: */
            var rest = it.id.split('_').slice(1).join('_');
            /* New IDs: numeric stage prefix → rest starts with digit (0_pf_4_1, 4_ПП_1, etc.) */
            /* Old v11 IDs: rest starts with a letter (Preflight, Takeoff_and_Climb, Cruise, Approach, Landing, Postflight) */
            if (rest.length > 0 && /^[A-Za-z]/.test(rest)) {
              it.ok = false;
              if (it.comment) delete it.comment;
            }
          }
        }
      });
      /* If state still has 'test' screen but items are cleaned — keep state but resave */
      try {
        localStorage.setItem(STORAGE_STATE, JSON.stringify(state));
      } catch(e) {}
      localStorage.setItem(STORAGE_LEGACY_CLEANED, '1');
    } catch(e) {
      /* On any parse error — just mark cleaned to avoid retry storms */
      try { localStorage.setItem(STORAGE_LEGACY_CLEANED, '1'); } catch(e2) {}
    }
  }

  /** Debounce-сохранение: сохранить DOM→_data→localStorage с задержкой 500мс */
  function debouncedSaveInspectionState() {
    if (_saveStateTimer) clearTimeout(_saveStateTimer);
    _saveStateTimer = setTimeout(function() {
      saveState();
      saveInspectionState();
      _saveStateTimer = null;
    }, 500);
  }

  /** Прочитать значения из DOM-полей формы в _pilotData */
  function readPilotFromDOM() {
    var fields = ['fio', 'license', 'instructor', 'route', 'ac_number', 'flight_time'];
    fields.forEach(function(f) {
      var el = document.getElementById('cr_' + f);
      if (el) _pilotData[f] = el.value;
    });
  }

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

  /* ═══════════════════════════════════════════
     RENDER: All content
     ═══════════════════════════════════════════ */
  function renderContent() {
    var container = document.getElementById('checkrideContainer');
    if (!container) return;

    switch (_screen) {
      case 'start':   renderStartScreen(container); break;
      case 'test':    renderTestScreen(container); break;
      case 'report':  renderReportScreen(container); break;
      case 'history': renderHistoryScreen(container); break;
      default:        renderStartScreen(container);
    }
  }

  function renderAll() {
    renderContent();
  }

  /* ═══════════════════════════════════════════
     SCREEN: START — Регистрация пилота
     ═══════════════════════════════════════════ */
  function renderStartScreen(container) {
    var html = '<div class="module-container checkride-start" lang="ru">';

    html += '<h2 class="checkride-start-title">\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044F \u043F\u0438\u043B\u043E\u0442\u0430</h2>';

    /* Mode selector */
    html += '<div class="checkride-mode-selector">'
      + '<button class="checkride-mode-btn' + (_currentMode === 'line' ? ' active' : '') + '" data-cr-mode="line" lang="en">LINE</button>'
      + '<button class="checkride-mode-btn' + (_currentMode === 'ffs' ? ' active' : '') + '" data-cr-mode="ffs" lang="en">FFS</button>'
    + '</div>';

    /* Input fields */
    html += '<div class="checkride-fields">';
    var fields = [
      { id: 'cr_fio',         ph: '\u0424\u0418\u041E \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u043C\u043E\u0433\u043E', val: _pilotData.fio, ffs: true },
      { id: 'cr_license',     ph: '\u041D\u043E\u043C\u0435\u0440 \u043B\u0438\u0446\u0435\u043D\u0437\u0438\u0438', val: _pilotData.license, ffs: true },
      { id: 'cr_instructor',  ph: '\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u044E\u0449\u0438\u0439 (\u0418\u043D\u0441\u0442\u0440\u0443\u043A\u0442\u043E\u0440)', val: _pilotData.instructor, ffs: true },
      { id: 'cr_route',       ph: '\u041C\u0430\u0440\u0448\u0440\u0443\u0442 (\u043E\u043F\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u043E)', val: _pilotData.route, ffs: false },
      { id: 'cr_ac_number',   ph: '\u041D\u043E\u043C\u0435\u0440 \u0412\u0421 (\u043E\u043F\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u043E)', val: _pilotData.ac_number, ffs: false }
    ];
    for (var i = 0; i < fields.length; i++) {
      /* Для FFS — скрыть поля route, ac_number */
      if (_currentMode === 'ffs' && !fields[i].ffs) continue;
      var escVal = (fields[i].val || '').replace(/"/g, '&quot;');
      html += '<label class="checkride-label" for="' + fields[i].id + '">' + fields[i].ph + '</label>';
      html += '<input type="text" id="' + fields[i].id + '" class="checkride-input" placeholder="' + fields[i].ph + '" value="' + escVal + '">';
    }
    html += '</div>';

    /* Buttons — в одну строку: слева История, справа Начать */
    html += '<div class="checkride-start-actions">'
      + '<button class="checkride-secondary-btn" data-cr-action="history">'
        + icon('clock', 18) + ' <span>\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u0440\u043E\u0432\u0435\u0440\u043E\u043A</span></button>'
      + '<button class="checkride-main-btn" data-cr-action="start">'
        + icon('checklist', 18) + ' <span>\u041D\u0430\u0447\u0430\u0442\u044C \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443</span></button>'
      + '</div>';

    html += '</div>';
    container.innerHTML = html;
  }

  /* ═══════════════════════════════════════════
     Task 44: обновление кольца прогресса компетенции
     ═══════════════════════════════════════════ */
  function updateCompetencyRing(compCode) {
    var items = document.querySelector('#checkrideContainer .checkride-competency-items[data-competency="' + compCode + '"]');
    if (!items) return;
    var checkboxes = items.querySelectorAll('input[type="checkbox"]');
    var total = checkboxes.length;
    var checked = 0;
    for (var i = 0; i < checkboxes.length; i++) {
      if (checkboxes[i].checked) checked++;
    }
    var toggle = document.querySelector('#checkrideContainer .checkride-competency-toggle[data-competency="' + compCode + '"]');
    if (!toggle) return;
    var countEl = toggle.querySelector('.checkride-competency-count');
    if (!countEl) return;
    var fill = countEl.querySelector('.ring-fill');
    var text = countEl.querySelector('.ring-text');
    var circumference = 2 * Math.PI * 11;
    var progress = total > 0 ? checked / total : 0;
    var offset = circumference * (1 - progress);
    if (fill) fill.style.strokeDashoffset = offset;
    if (text) text.textContent = checked + '/' + total;
    countEl.setAttribute('data-checked', checked);
    countEl.setAttribute('data-total', total);
  }

  /* ═══════════════════════════════════════════
     SCREEN: TEST — Чеклист проверки
     ═══════════════════════════════════════════ */
  function renderTestScreen(container) {
    if (!_data) return;
    var mainSection = _data.checklists[_sectionIndex];

    var html = '<div class="module-container checkride-test" lang="ru">';

    /* Section title */
    html += '<h2 class="checkride-section-title"' + langAttr(mainSection.name) + '>' + mainSection.name + '</h2>';

    /* Progress indicator */
    html += '<div class="checkride-progress-bar">'
      + '<div class="checkride-progress-fill" style="width:' + Math.round((_sectionIndex + 1) / _data.checklists.length * 100) + '%"></div>'
    + '</div>';
    html += '<div class="checkride-progress-label">\u042D\u0442\u0430\u043F ' + (_sectionIndex + 1) + ' \u0438\u0437 ' + _data.checklists.length + '</div>';

    /* Checklist items */
    html += '<div class="checkride-items">';
    mainSection.sections.forEach(function(sec, secIdx) {
      html += '<h3 class="checkride-subname">' + sec.subname + '</h3>';

      var groups = sec.groups || [{ items: sec.items || [] }];

      /* Компетенции — аккордеон с list-divider (все закрыты по умолчанию) */
      if (sec.subname === '\u041A\u043E\u043C\u043F\u0435\u0442\u0435\u043D\u0446\u0438\u0438.') {
        groups.forEach(function(group) {
          var compCode = group.topitem || '\u041E\u0431\u0449\u0438\u0435';
          var compLabel = getCompetencyLabel(compCode);
          /* Legacy FFS topitem: "Применение процедур (ПП):" → извлечь код из скобок */
          if (compLabel === compCode && compCode !== '\u041E\u0431\u0449\u0438\u0435') {
            var bracketMatch = compCode.match(/\(([^)]+)\)/);
            if (bracketMatch) {
              var shortCode = bracketMatch[1];
              compCode = shortCode;
              compLabel = getCompetencyLabel(shortCode);
            }
          }
          var compCheckboxes = [];
          for (var ci = 0; ci < group.items.length; ci++) {
            if (group.items[ci].type === 'checkbox') compCheckboxes.push(group.items[ci]);
          }

          /* Task 44: считаем прогресс для кольца */
          var compChecked = 0;
          for (var ci2 = 0; ci2 < compCheckboxes.length; ci2++) {
            if (compCheckboxes[ci2].ok) compChecked++;
          }
          var compTotal = compCheckboxes.length;
          var compCircumference = 2 * Math.PI * 11; /* r=11 → 69.115 */
          var compOffset = compTotal > 0 ? compCircumference * (1 - compChecked / compTotal) : compCircumference;

          /* Заголовок-аккордеон (ЗАКРЫТ — нет is-open) */
          html += '<div class="list-divider checkride-competency-toggle" data-competency="' + compCode + '">';
          html += '<span class="list-divider-label">' + compCode + ' \u2014 ' + compLabel + '</span>';
          html += '<span class="checkride-competency-count" data-total="' + compTotal + '" data-checked="' + compChecked + '">'
            + '<svg class="checkride-progress-ring" viewBox="0 0 28 28" aria-hidden="true">'
            + '<circle class="ring-track" cx="14" cy="14" r="11" fill="none" stroke="var(--color-border)" stroke-width="2.5"/>'
            + '<circle class="ring-fill" cx="14" cy="14" r="11" fill="none" stroke="var(--color-danger)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="' + compCircumference + '" stroke-dashoffset="' + compOffset + '" transform="rotate(-90 14 14)"/>'
            + '</svg>'
            + '<span class="ring-text">' + compChecked + '/' + compTotal + '</span>'
            + '</span>';
          html += '<span class="checkride-competency-chevron">' + icon('chevron-down', 16) + '</span>';
          html += '</div>';

          /* Контейнер чекбоксов (ЗАКРЫТ — нет .open) */
          html += '<div class="checkride-competency-items" data-competency="' + compCode + '">';
          compCheckboxes.forEach(function(item) {
            html += '<label class="checkride-competency-check">'
              + '<input type="checkbox" id="c_' + item.id + '"' + (item.ok ? ' checked' : '') + '>'
              + '<span>' + item.label + '</span>'
            + '</label>';
          });
          html += '</div>';
        });
      } else {
        /* Обычные секции — без аккордеона */
        groups.forEach(function(group) {
          if (group.topitem) {
            html += '<h4 class="checkride-topitem">' + getCompetencyLabel(group.topitem) + '</h4>';
          }

          group.items.forEach(function(item) {
            if (item.type === 'divider') {
              html += '<div class="checkride-divider">' + item.label + '</div>';
            } else if (item.type === 'checkbox' && sec.subname === '\u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043D\u044B\u0435 \u043F\u0440\u043E\u0446\u0435\u0434\u0443\u0440\u044B.') {
              /* \u041E\u0446\u0435\u043D\u043E\u0447\u043D\u044B\u0439 dropdown \u0434\u043B\u044F \u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043D\u044B\u0435 \u043F\u0440\u043E\u0446\u0435\u0434\u0443\u0440\u044B */
              var gVal = (item.ok === false || item.ok === null || item.ok === undefined) ? '' : String(item.ok);
              html += '<div class="checkride-grade-item">'
                + '<span class="checkride-grade-label">' + item.label + '</span>'
                + '<select class="checkride-grade-select" data-cr-grade="' + item.id + '">'
                + '<option value=""' + (gVal === '' ? ' selected' : '') + '>\u2014</option>'
                + '<option value="2"' + (gVal === '2' ? ' selected' : '') + '>2</option>'
                + '<option value="3"' + (gVal === '3' ? ' selected' : '') + '>3</option>'
                + '<option value="4"' + (gVal === '4' ? ' selected' : '') + '>4</option>'
                + '<option value="5"' + (gVal === '5' ? ' selected' : '') + '>5</option>'
                + '<option value="na"' + (gVal === 'na' ? ' selected' : '') + '>\u2717 \u043D/\u043F</option>'
                + '</select>'
              + '</div>';
            } else if (item.type === 'checkbox') {
              html += '<div class="checkride-check-item">'
                + '<input type="checkbox" id="c_' + item.id + '"' + (item.ok ? ' checked' : '') + '>'
                + '<label for="c_' + item.id + '">' + item.label + '</label>'
              + '</div>';
            } else if (item.type === 'radio') {
              html += '<div class="checkride-radio-group">'
                + '<p class="checkride-radio-label"><b>' + item.label + '</b></p>';
              item.options.forEach(function(opt) {
                html += '<label class="checkride-radio-option">'
                  + '<input type="radio" name="r_' + item.id + '" value="' + opt + '"' + (item.ok === opt ? ' checked' : '') + '>'
                  + '<span>' + opt + '</span>'
                + '</label>';
              });
              html += '</div>';
            }
          });
        });
      }

      /* Comment/Photo block */
      if (sec.subname !== '\u041A\u043E\u043C\u043F\u0435\u0442\u0435\u043D\u0446\u0438\u0438.') {
        html += '<div class="checkride-detail-item">'
          + '<b class="checkride-comment-label">\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0438:</b>'
          + '<textarea id="sec_n_' + _sectionIndex + '_' + secIdx + '" class="checkride-textarea" placeholder="\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043A\u0441\u0442...">' + (sec.note || '') + '</textarea>'
          + '<div class="checkride-photo-row">'
          + '<input type="file" accept="image/*" capture="environment" class="checkride-file-input-hidden" data-cr-file="' + _sectionIndex + '_' + secIdx + '">'
          + '<button type="button" class="checkride-photo-btn" data-cr-photo="' + _sectionIndex + '_' + secIdx + '">'
          + icon('camera', 18) + ' <span>\u0424\u043E\u0442\u043E!</span></button>'
          + '</div>'
          + '<div id="sec_p_' + _sectionIndex + '_' + secIdx + '">'
          + (sec.img ? '<img src="' + sec.img + '" class="checkride-attached-img" data-cr-img-view="' + _sectionIndex + '_' + secIdx + '">' : '')
          + '</div>'
        + '</div>';
      }
    });
    html += '</div>';

    /* Navigation */
    html += '<div class="checkride-nav-controls">';
    if (_sectionIndex > 0) {
      html += '<button class="checkride-nav-btn" data-cr-action="prev">\u2190 \u041D\u0430\u0437\u0430\u0434</button>';
    }
    if (_sectionIndex < _data.checklists.length - 1) {
      html += '<button class="checkride-nav-btn" data-cr-action="next">\u0414\u0430\u043B\u0435\u0435 \u2192</button>';
    }
    if (_sectionIndex === _data.checklists.length - 1) {
      html += '<button class="checkride-finish-btn" data-cr-action="finish">'
        + icon('check-circle', 18) + ' <span>\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C</span></button>';
    }
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
    container.scrollTop = 0;
    /* Скролл экрана и окна вверх при навигации */
    var screen = document.getElementById('checkrideScreen');
    if (screen) screen.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  /* ═══════════════════════════════════════════
     SCREEN: REPORT — Отчёт по проверке
     ═══════════════════════════════════════════ */
  function renderReportScreen(container) {
    var html = '<div class="module-container checkride-report" lang="ru">';

    html += '<h2 class="checkride-report-main-title">\u041E\u0422\u0427\u0415\u0422 \u041F\u041E \u041F\u0420\u041E\u0412\u0415\u0420\u041A\u0415</h2>';

    /* Meta */
    html += '<div class="checkride-report-meta">'
      + '<p><b>\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u043C\u044B\u0439:</b> <span id="r_fio"></span></p>'
      + '<p><b>\u041B\u0438\u0446\u0435\u043D\u0437\u0438\u044F:</b> <span id="r_license"></span></p>'
      + '<p><b>\u0414\u0430\u0442\u0430:</b> <span id="r_date"></span></p>'
      + '<p><b>\u0420\u0435\u0436\u0438\u043C:</b> <span id="r_mode"></span></p>'
      + '<p><b>\u041C\u0430\u0440\u0448\u0440\u0443\u0442:</b> <span id="r_route"></span></p>'
      + '<p><b>\u041D\u043E\u043C\u0435\u0440 \u0412\u0421:</b> <span id="r_ac_number"></span></p>'
      + '<p><b>\u041F\u043E\u043B\u0451\u0442\u043D\u043E\u0435 \u0432\u0440\u0435\u043C\u044F:</b> <input type="text" id="r_flight_time" class="checkride-input checkride-report-input" placeholder="\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043F\u043E\u043B\u0451\u0442\u043D\u043E\u0435 \u0432\u0440\u0435\u043C\u044F" value="' + ((_pilotData.flight_time || '').replace(/"/g, '&quot;')) + '"></p>'
    + '</div>';

    /* Ratings */
    html += '<div id="checkride-report-data"></div>';

    /* Competencies */
    html += '<div id="checkride-competencies"></div>';

    /* Signature — Task 41: если открываем из истории и есть сохранённая подпись, показываем <img>.
       Иначе (новый отчёт) — пустой canvas для рисования. */
    var sigHtml = '<div class="checkride-signature-section">'
      + '<p><b>\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u044E\u0449\u0438\u0439:</b> <span id="r_instructor"></span></p>'
      + '<p><b>\u041F\u043E\u0434\u043F\u0438\u0441\u044C:</b></p>';
    if (_viewingHistory && _pilotData.signature) {
      sigHtml += '<img src="' + _pilotData.signature + '" class="checkride-signature-img" alt="\u041F\u043E\u0434\u043F\u0438\u0441\u044C \u0438\u043D\u0441\u0442\u0440\u0443\u043A\u0442\u043E\u0440\u0430">';
    } else {
      sigHtml += '<canvas id="checkride-signature"></canvas>';
    }
    sigHtml += '</div>';
    html += sigHtml;

    /* Action buttons — Печать+Отправить+Скопировать в одну строку, Новая проверка ниже */
    html += '<div class="checkride-report-actions">'
      + '<div class="checkride-report-row">'
        + '<button class="checkride-secondary-btn" data-cr-action="export-pdf">'
          + icon('download', 18) + ' <span>\u041F\u0435\u0447\u0430\u0442\u044C / PDF</span></button>'
        + '<button class="checkride-secondary-btn" data-cr-action="send-email">'
          + icon('mail', 18) + ' <span>\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u043F\u043E \u043F\u043E\u0447\u0442\u0435</span></button>'
        + '<button class="checkride-secondary-btn" data-cr-action="copy-report">'
          + icon('clipboard-check', 18) + ' <span>\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C</span></button>'
      + '</div>'
      + '<button class="checkride-main-btn" data-cr-action="go-start">'
        + icon('checklist', 18) + ' <span>\u041D\u043E\u0432\u0430\u044F \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430</span></button>'
    + '</div>';

    html += '</div>';
    container.innerHTML = html;

    /* Build report data */
    buildReport();
    initSignature();

    /* Scroll to top — как в renderTestScreen */
    container.scrollTop = 0;
    var screen = document.getElementById('checkrideScreen');
    if (screen) screen.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  /* ═══════════════════════════════════════════
     SCREEN: HISTORY — История проверок
     ═══════════════════════════════════════════ */
  function renderHistoryScreen(container) {
    var history = [];
    try {
      var raw = localStorage.getItem(STORAGE_HISTORY);
      if (raw) history = JSON.parse(raw);
    } catch(e) { history = []; }

    var html = '<div class="module-container checkride-history" lang="ru">';

    html += '<h2 class="checkride-history-title">\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u0440\u043E\u0432\u0435\u0440\u043E\u043A</h2>';

    if (history.length === 0) {
      html += '<div class="checkride-history-empty">'
        + icon('clock', 40)
        + '<div>\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u0443\u0441\u0442\u0430</div>'
      + '</div>';
    } else {
      html += '<div class="checkride-history-list">';
      for (var i = 0; i < history.length; i++) {
        var h = history[i];
        html += '<div class="checkride-history-card" data-cr-view="' + i + '">'
          + '<div class="checkride-history-info"><b>' + h.fio + '</b> <small>(' + h.mode + ')</small><br>' + h.date + '</div>'
          + '<button class="checkride-history-delete" data-cr-delete="' + i + '" aria-label="\u0423\u0434\u0430\u043B\u0438\u0442\u044C">' + icon('trash', 16) + '</button>'
        + '</div>';
      }
      html += '</div>';
    }

    html += '<button class="checkride-danger-btn" data-cr-action="clear-history">\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E</button>';
    html += '<button class="checkride-secondary-btn" data-cr-action="go-start">\u041D\u0430\u0437\u0430\u0434</button>';

    html += '</div>';
    container.innerHTML = html;
  }

  /* ═══════════════════════════════════════════
     CORE LOGIC: Start inspection
     ═══════════════════════════════════════════ */
  function startInspection() {
    /* 1. Сохраняем данные из DOM в _pilotData ДО смены экрана */
    readPilotFromDOM();

    /* 2. Валидация */
    if (!_pilotData.fio || !_pilotData.instructor) {
      app.showToast('\u0417\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0435 \u0424\u0418\u041E \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u043C\u043E\u0433\u043E \u0438 \u0418\u043D\u0441\u0442\u0440\u0443\u043A\u0442\u043E\u0440\u0430');
      return;
    }

    var dataToUse = _currentMode === 'ffs' ? _dataFfs : _dataLine;
    if (!dataToUse) {
      app.showToast('\u0414\u0430\u043D\u043D\u044B\u0435 \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u044B');
      return;
    }

    /* 3. Сохраняем в localStorage для автозаполнения при следующем входе */
    savePilotToCache();

    /* Task 41: сброс флага истории и подписи — новая проверка, старая подпись недействительна */
    _viewingHistory = false;
    _pilotData.signature = null;

    /* 4. Deep clone */
    _data = JSON.parse(JSON.stringify(dataToUse));

    /* 5. Initialize state */
    _data.checklists.forEach(function(mainSec) {
      mainSec.sections.forEach(function(sec) {
        sec.note = '';
        sec.img = null;
        var groups = sec.groups || [{ items: sec.items || [] }];
        groups.forEach(function(group) {
          group.items.forEach(function(item) {
            if (item.type !== 'divider') item.ok = (item.type === 'radio') ? null : (sec.subname === '\u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043D\u044B\u0435 \u043F\u0440\u043E\u0446\u0435\u0434\u0443\u0440\u044B.' ? '' : false);
          });
        });
      });
    });

    _sectionIndex = 0;
    _screen = 'test';
    renderAll();
    saveInspectionState();
  }

  /* ═══════════════════════════════════════════
     CORE LOGIC: Save state from DOM
     ═══════════════════════════════════════════ */
  function saveState() {
    if (!_data) return;
    var mainSection = _data.checklists[_sectionIndex];
    mainSection.sections.forEach(function(sec, secIdx) {
      var groups = sec.groups || [{ items: sec.items || [] }];
      groups.forEach(function(group) {
        group.items.forEach(function(item) {
          if (item.type === 'checkbox') {
            var gradeSel = document.querySelector('[data-cr-grade="' + item.id + '"]');
            if (gradeSel) {
              item.ok = gradeSel.value || '';
            } else {
              var cb = document.getElementById('c_' + item.id);
              if (cb) item.ok = cb.checked;
            }
          } else if (item.type === 'radio') {
            var selected = document.querySelector('input[name="r_' + item.id + '"]:checked');
            item.ok = selected ? selected.value : null;
          }
        });
      });
      var nt = document.getElementById('sec_n_' + _sectionIndex + '_' + secIdx);
      if (nt) sec.note = nt.value;
    });
  }

  /* ═══════════════════════════════════════════
     CORE LOGIC: Competency calculation
     ═══════════════════════════════════════════ */
  function calculateCompetencies() {
    var competencyMap = {};

    _data.checklists.forEach(function(mainSec) {
      mainSec.sections.forEach(function(sec) {
        if (sec.subname !== '\u041A\u043E\u043C\u043F\u0435\u0442\u0435\u043D\u0446\u0438\u0438.') return;

        var groups = sec.groups || [{ items: sec.items || [] }];
        groups.forEach(function(group) {
          var compCode = group.topitem || '\u041E\u0431\u0449\u0438\u0435';
          /* FFS topitem: извлечь код из скобок для консистентности */
          var bracketMatch = compCode.match(/\(([^)]+)\)/);
          if (bracketMatch) compCode = bracketMatch[1];
          if (!competencyMap[compCode]) {
            competencyMap[compCode] = { total: 0, checked: 0, items: [] };
          }
          group.items.forEach(function(item) {
            if (item.type !== 'checkbox') return;
            competencyMap[compCode].total++;
            if (item.ok) competencyMap[compCode].checked++;

            var existingItem = null;
            for (var k = 0; k < competencyMap[compCode].items.length; k++) {
              if (competencyMap[compCode].items[k].label === item.label) { existingItem = competencyMap[compCode].items[k]; break; }
            }
            if (!existingItem) {
              competencyMap[compCode].items.push({ label: item.label, checked: item.ok ? 1 : 0, count: 1 });
            } else {
              existingItem.count++;
              if (item.ok) existingItem.checked++;
            }
          });
        });
      });
    });

    var competencyScores = {};
    for (var code in competencyMap) {
      var total = competencyMap[code].total;
      var checked = competencyMap[code].checked;
      var percent = total > 0 ? (checked / total) * 100 : 0;
      var score = 2;
      if (percent >= 70) score = 5;
      else if (percent >= 50) score = 4;
      else if (percent >= 25) score = 3;
      competencyScores[code] = { score: score, percent: percent, items: competencyMap[code].items };
    }

    return competencyScores;
  }

  /* ═══════════════════════════════════════════
     CORE LOGIC: Calculate ratings
     ═══════════════════════════════════════════ */
  function calculateRatings() {
    var reportHtml = '<div class="checkride-rating-summary"><h3>\u0421\u0432\u043E\u0434\u043D\u0430\u044F \u043E\u0446\u0435\u043D\u043A\u0430</h3>';

    _data.checklists.forEach(function(mainSec) {
      var piloting = [];
      var hasPilotingSection = false;
      var gradeValues = [];

      mainSec.sections.forEach(function(sec) {
        var groups = sec.groups || [{ items: sec.items || [] }];
        groups.forEach(function(g) { g.items.forEach(function(i) {
          if (i.type === 'radio') {
            hasPilotingSection = true;
            var score = i.ok ? (5 - i.options.indexOf(i.ok)) : 2;
            piloting.push(score < 2 ? 2 : score);
          } else if (i.type === 'checkbox' && sec.subname !== '\u041A\u043E\u043C\u043F\u0435\u0442\u0435\u043D\u0446\u0438\u0438.') {
            if (sec.subname === '\u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043D\u044B\u0435 \u043F\u0440\u043E\u0446\u0435\u0434\u0443\u0440\u044B.') {
              /* \u041E\u0446\u0435\u043D\u043A\u0438 2-5 \u0443\u0447\u0430\u0442\u0441\u044F \u0432 \u0441\u0440\u0435\u0434\u043D\u0435\u043C, na/\u043D\u0435 \u043E\u0446\u0435\u043D\u043E\u043A\u043E \u2014 \u043D\u0435 \u0443\u0447\u0438\u0442\u044B\u0432\u0430\u044E\u0442\u0441\u044F */
              if (i.ok === '2' || i.ok === '3' || i.ok === '4' || i.ok === '5') {
                gradeValues.push(parseInt(i.ok, 10));
              }
            }
          }
        }); });
      });

      var pRes = piloting.length ? (piloting.indexOf(2) !== -1 ? 2 : Math.round(piloting.reduce(function(a,b){return a+b;},0)/piloting.length)) : '-';
      var gRes = gradeValues.length ? Math.round(gradeValues.reduce(function(a,b){return a+b;},0)/gradeValues.length) : '-';

      var ratingLine = '<div class="checkride-rating-block"><b>' + mainSec.name + '</b>';
      if (hasPilotingSection) {
        ratingLine += ' | \u0422\u0435\u0445\u043D\u0438\u043A\u0430 \u043F\u0438\u043B\u043E\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F: <span class="checkride-score-val">' + pRes + '</span>';
      }
      if (gradeValues.length) {
        ratingLine += ' | \u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043D\u044B\u0435 \u043F\u0440\u043E\u0446\u0435\u0434\u0443\u0440\u044B: <span class="checkride-score-val">' + gRes + '</span>';
      }
      ratingLine += '</div>';
      reportHtml += ratingLine;
    });

    /* Competencies in summary */
    var competencies = calculateCompetencies();
    if (Object.keys(competencies).length > 0) {
      reportHtml += '<div class="checkride-competencies-rating-divider">';
      reportHtml += '<div class="checkride-competencies-rating-title">\u041A\u043E\u043C\u043F\u0435\u0442\u0435\u043D\u0446\u0438\u0438:</div>';
      for (var code in competencies) {
        var cLabel = getCompetencyLabel(code);
        reportHtml += '<div class="checkride-rating-block"><b>' + code + '</b> — ' + cLabel + ': <span class="checkride-score-val">' + competencies[code].score + '</span></div>';
      }
      reportHtml += '</div>';
    }

    return reportHtml + '</div>';
  }

  /* ═══════════════════════════════════════════
     CORE LOGIC: Build report
     ═══════════════════════════════════════════ */
  function buildReport() {
    var dataEl = document.getElementById('checkride-report-data');
    if (!dataEl) return;

    dataEl.innerHTML = calculateRatings();

    _data.checklists.forEach(function(mainSec) {
      dataEl.innerHTML += '<h2 class="checkride-report-main-title">' + mainSec.name + '</h2>';

      mainSec.sections.forEach(function(sec) {
        if (sec.subname === '\u041A\u043E\u043C\u043F\u0435\u0442\u0435\u043D\u0446\u0438\u0438.') return;

        var sHtml = '<div class="checkride-report-section"><h3 class="checkride-report-subname">' + sec.subname + '</h3>';
        var groups = sec.groups || [{ items: sec.items || [] }];
        groups.forEach(function(group) {
          if (group.topitem) sHtml += '<h4 class="checkride-report-topitem">' + getCompetencyLabel(group.topitem) + '</h4>';
          group.items.forEach(function(item) {
            if (item.type === 'divider') return;
            if (item.type === 'checkbox' && sec.subname === '\u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043D\u044B\u0435 \u043F\u0440\u043E\u0446\u0435\u0434\u0443\u0440\u044B.') {
              /* \u041E\u0442\u0447\u0451\u0442: \u043E\u0446\u0435\u043D\u043A\u0430 \u0432\u043C\u0435\u0441\u0442\u043E OK/\u041D\u0430\u0440\u0443\u0448\u0435\u043D\u0438\u0435 */
              var gVal = (item.ok === false || item.ok === null || item.ok === undefined) ? '' : String(item.ok);
              var gradeRes = '';
              if (gVal === '2' || gVal === '3' || gVal === '4' || gVal === '5') {
                gradeRes = '<span class="checkride-score-val">\u041E\u0446\u0435\u043D\u043A\u0430: ' + gVal + '</span>';
              } else if (gVal === 'na') {
                gradeRes = '<span class="checkride-grade-na">\u2717 \u043D\u0435 \u043F\u0440\u0438\u043C\u0435\u043D\u044F\u0435\u0442\u0441\u044F</span>';
              } else {
                gradeRes = '<span class="checkride-grade-na">\u2014 \u043D\u0435 \u043E\u0446\u0435\u043D\u0435\u043D\u043E</span>';
              }
              sHtml += '<div class="checkride-report-item-row"><p>' + item.label + '</p><div class="checkride-flex-row">' + gradeRes + '</div></div>';
            } else if (item.type === 'checkbox') {
              var res = item.ok
                ? '<span class="checkride-icon-ok">\u2713 OK</span>'
                : '<span class="checkride-icon-fail">\u2717 \u041D\u0430\u0440\u0443\u0448\u0435\u043D\u0438\u0435</span>';
              sHtml += '<div class="checkride-report-item-row"><p>' + item.label + '</p><div class="checkride-flex-row">' + res + '</div></div>';
            } else if (item.type === 'radio') {
              var scoreValue = item.ok || '2 (\u043D/\u0434)';
              var scoreIndex = item.ok ? item.options.indexOf(item.ok) : -1;
              var actualScore = scoreIndex >= 0 ? (5 - scoreIndex) : 2;
              sHtml += '<div class="checkride-report-item-row checkride-report-radio-item">'
                + '<p style="font-weight:600">' + item.label + '</p>'
                + '<div style="padding-left:15px"><b>\u041E\u0446\u0435\u043D\u043A\u0430:</b> ' + actualScore + ' - ' + scoreValue + '</div>'
              + '</div>';
            }
          });
        });
        if (sec.note || sec.img) {
          sHtml += '<div class="checkride-report-comment">'
            + (sec.note ? '<p><b>\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439:</b> ' + sec.note + '</p>' : '')
            + (sec.img ? '<img src="' + sec.img + '" data-full-src="' + sec.img + '" class="checkride-report-img" data-cr-report-img="1" style="max-width:200px;width:100%;height:auto;margin-top:10px;cursor:pointer;border-radius:var(--border-radius-xs);">' : '')
          + '</div>';
        }
        dataEl.innerHTML += sHtml + '</div>';
      });
    });

    /* Detailed competencies */
    var competencies = calculateCompetencies();
    var compHtml = '<div class="checkride-competencies-divider">';
    compHtml += '<h2 class="checkride-competencies-title">\u041A\u043E\u043C\u043F\u0435\u0442\u0435\u043D\u0446\u0438\u0438:</h2>';
    for (var code in competencies) {
      var items = competencies[code].items;
      compHtml += '<div class="checkride-report-section"><h3 class="checkride-report-subname">' + code + ' \u2014 ' + getCompetencyLabel(code) + '</h3>';
      items.forEach(function(item) {
        var percent = item.count > 0 ? (item.checked / item.count) * 100 : 0;
        var score = 2;
        if (percent >= 70) score = 5;
        else if (percent >= 50) score = 4;
        else if (percent >= 25) score = 3;
        var prefix = '';
        var colorClass = '';
        if (score === 5) prefix = '\u0412\u0441\u0435\u0433\u0434\u0430';
        else if (score === 4) prefix = '\u0420\u0435\u0433\u0443\u043B\u044F\u0440\u043D\u043E';
        else if (score === 3) { prefix = '\u0418\u043D\u043E\u0433\u0434\u0430'; colorClass = 'checkride-comp-yellow'; }
        else { prefix = '\u0420\u0435\u0434\u043A\u043E'; colorClass = 'checkride-comp-red'; }
        var labelText = item.label.charAt(0).toLowerCase() + item.label.slice(1);
        compHtml += '<div class="checkride-competency-item ' + colorClass + '">- ' + prefix + ' ' + labelText + '</div>';
      });
      compHtml += '</div>';
    }
    compHtml += '</div>';
    var compEl = document.getElementById('checkride-competencies');
    if (compEl) compEl.innerHTML = compHtml;

    /* Meta fields — из _pilotData, НЕ из DOM (кроме flight_time — это input) */
    var metaFields = ['fio', 'license', 'instructor', 'route', 'ac_number'];
    metaFields.forEach(function(f) {
      var target = document.getElementById('r_' + f);
      if (target) target.innerText = _pilotData[f] || '-';
    });
    var dateEl = document.getElementById('r_date');
    if (dateEl) dateEl.innerText = (_data && _data.savedDate) ? _data.savedDate : new Date().toLocaleString();
    var modeEl = document.getElementById('r_mode');
    if (modeEl) modeEl.innerText = _currentMode.toUpperCase();
  }

  /* ═══════════════════════════════════════════
     CORE LOGIC: File handling
     ═══════════════════════════════════════════ */
  function handleSectionFile(input, mainIdx, secIdx) {
    if (input.files && input.files[0]) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var img = new Image();
        img.src = e.target.result;
        img.onload = function() {
          // Task 41: НЕ апскейлим маленькие изображения — иначе они становятся размытыми.
          // Если исходная ширина <= MAX_WIDTH — сохраняем как есть (только JPEG-компрессия).
          // Если больше — масштабируем к MAX_WIDTH с сохранением пропорций.
          var MAX_WIDTH = 800;
          var targetW, targetH;
          if (img.width <= MAX_WIDTH) {
            targetW = img.width;
            targetH = img.height;
          } else {
            var scale = MAX_WIDTH / img.width;
            targetW = MAX_WIDTH;
            targetH = Math.round(img.height * scale);
          }
          var canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          canvas.getContext('2d').drawImage(img, 0, 0, targetW, targetH);
          _data.checklists[mainIdx].sections[secIdx].img = canvas.toDataURL('image/jpeg', 0.6);
          _screen = 'test';
          renderAll();
          saveInspectionState();
        };
      };
      reader.readAsDataURL(input.files[0]);
    }
  }

  /* ═══════════════════════════════════════════
     CORE LOGIC: Finish inspection
     ═══════════════════════════════════════════ */
  function finishInspection() {
    saveState();
    _screen = 'report';
    renderAll();
    saveToLocalStorage();
    clearInspectionState();
  }

  /* Task 41: извлечение подписи из canvas в data URL.
     Вызывается из обработчика "go-start" ПОСЛЕ того, как пользователь нарисовал
     подпись на экране отчёта. Возвращает null если canvas пустой или не найден. */
  function extractSignatureDataUrl() {
    var canvas = document.getElementById('checkride-signature');
    if (!canvas) return null;
    try {
      // Проверяем что canvas не пустой: ищем любой непрозрачный пиксель
      var ctx = canvas.getContext('2d');
      if (!ctx) return null;
      var w = canvas.width, h = canvas.height;
      if (!w || !h) return null;
      var data;
      try { data = ctx.getImageData(0, 0, w, h).data; } catch(e) { return null; }
      var hasInk = false;
      for (var i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) { hasInk = true; break; }
      }
      if (!hasInk) return null;
      return canvas.toDataURL('image/png');
    } catch(e) { return null; }
  }

  /* Task 41: обновляет signature в последней записи истории (history[0]).
     Вызывается из обработчика "go-start" после извлечения подписи из canvas. */
  function updateSignatureInHistory(signatureDataUrl) {
    try {
      var raw = localStorage.getItem(STORAGE_HISTORY);
      if (!raw) return;
      var history = JSON.parse(raw);
      if (history.length === 0) return;
      history[0].signature = signatureDataUrl;
      localStorage.setItem(STORAGE_HISTORY, JSON.stringify(history));
    } catch(e) {}
  }

  /* ═══════════════════════════════════════════
     CORE LOGIC: Save to localStorage
     ═══════════════════════════════════════════ */
  function saveToLocalStorage() {
    var entry = {
      fio:         _pilotData.fio,
      license:     _pilotData.license,
      instructor:  _pilotData.instructor,
      route:       _pilotData.route,
      ac_number:   _pilotData.ac_number,
      flight_time: _pilotData.flight_time,
      date:        new Date().toLocaleString(),
      mode:        _currentMode,
      fullData:    JSON.parse(JSON.stringify(_data)),
      signature:   null  // Task 41: подпись обновляется в history[0] через updateSignatureInHistory()
                         // при уходе с экрана отчёта (extractSignatureDataUrl из canvas).
    };

    var history = [];
    try {
      var raw = localStorage.getItem(STORAGE_HISTORY);
      if (raw) history = JSON.parse(raw);
    } catch(e) { history = []; }

    history.unshift(entry);
    try {
      localStorage.setItem(STORAGE_HISTORY, JSON.stringify(history.slice(0, 10)));
    } catch(e) {}
  }

  /* ═══════════════════════════════════════════
     CORE LOGIC: View saved report
     ═══════════════════════════════════════════ */
  function viewSavedReport(i) {
    var history = [];
    try {
      var raw = localStorage.getItem(STORAGE_HISTORY);
      if (raw) history = JSON.parse(raw);
    } catch(e) { return; }

    if (!history[i]) return;
    var h = history[i];

    /* Восстанавливаем данные пилота из записи истории */
    _pilotData.fio         = h.fio || '';
    _pilotData.license     = h.license || '';
    _pilotData.instructor  = h.instructor || '';
    _pilotData.route       = h.route || '';
    _pilotData.ac_number   = h.ac_number || '';
    _pilotData.flight_time = h.flight_time || '';
    _pilotData.signature   = h.signature || null;  // Task 41: восстанавливаем подпись

    _data = h.fullData;
    _data.savedDate = h.date;
    _currentMode = h.mode;
    _screen = 'report';
    _viewingHistory = true;  // Task 41: флаг просмотра истории
    renderAll();
  }

  /* ═══════════════════════════════════════════
     CORE LOGIC: Signature canvas
     ═══════════════════════════════════════════ */
  function initSignature() {
    var canvas = document.getElementById('checkride-signature');
    if (!canvas) return;

    /* Динамический размер canvas — исправление для Samsung и мобильных */
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var cssW = rect.width || canvas.offsetWidth || 300;
    var cssH = 150;
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width  = cssW + 'px';
    canvas.style.height = cssH + 'px';

    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    canvas.style.display = 'block';
    var drawing = false;

    function getStrokeColor() {
      return document.body.classList.contains('dark-theme') ? '#ffffff' : '#000000';
    }

    function getPos(e) {
      var r = canvas.getBoundingClientRect();
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      var clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: clientX - r.left, y: clientY - r.top };
    }

    canvas.onmousedown = canvas.ontouchstart = function(e) {
      e.preventDefault();
      drawing = true;
      ctx.strokeStyle = getStrokeColor();
      ctx.beginPath();
      var p = getPos(e);
      ctx.moveTo(p.x, p.y);
    };
    canvas.onmousemove = canvas.ontouchmove = function(e) {
      if (!drawing) return;
      e.preventDefault();
      ctx.strokeStyle = getStrokeColor();
      var p = getPos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    };
    canvas.onmouseup = canvas.ontouchend = canvas.ontouchcancel = function() { drawing = false; };
  }

  /* ═══════════════════════════════════════════
     CORE LOGIC: Export / Email
     ═══════════════════════════════════════════ */
  function exportPDF() { window.print(); }

  /* ═══════════════════════════════════════════
     CORE LOGIC: Build full report text (for copy + email body)
     ═══════════════════════════════════════════ */
  function buildReportText() {
    var fio        = _pilotData.fio;
    var license    = _pilotData.license;
    var instructor = _pilotData.instructor;
    var route      = _pilotData.route;
    var acNumber   = _pilotData.ac_number;
    var flightTime = _pilotData.flight_time;
    var date = '';
    var dateEl = document.getElementById('r_date');
    if (dateEl) date = dateEl.innerText;

    var lines = [];
    lines.push('ОТЧЕТ ПО ПРОВЕРКЕ');
    lines.push('=================');
    lines.push('');
    lines.push('Проверяемый: ' + fio);
    lines.push('Лицензия: ' + license);
    lines.push('Дата: ' + date);
    lines.push('Режим: ' + _currentMode.toUpperCase());
    if (route)      lines.push('Маршрут: ' + route);
    if (acNumber)   lines.push('Номер ВС: ' + acNumber);
    if (flightTime) lines.push('Полётное время: ' + flightTime);
    lines.push('Проверяющий: ' + instructor);
    lines.push('');

    if (_data && _data.checklists) {
      _data.checklists.forEach(function(mainSec) {
        lines.push('');
        lines.push('### ' + mainSec.name + ' ###');
        mainSec.sections.forEach(function(sec) {
          if (sec.subname === 'Компетенции.') return;
          lines.push('');
          lines.push('— ' + sec.subname + ' —');
          var groups = sec.groups || [{ items: sec.items || [] }];
          groups.forEach(function(group) {
            if (group.topitem) lines.push('  [' + getCompetencyLabel(group.topitem) + ']');
            group.items.forEach(function(item) {
              if (item.type === 'divider') return;
              var label = item.label || '';
              if (item.type === 'checkbox' && sec.subname === 'Стандартные процедуры.') {
                var gv = (item.ok === false || item.ok === null || item.ok === undefined) ? '' : String(item.ok);
                var gLabel = gv === 'na' ? 'н/п' : (gv || '—');
                lines.push('  • ' + label + ' — оценка: ' + gLabel);
              } else if (item.type === 'checkbox') {
                lines.push('  ' + (item.ok ? '[x]' : '[ ]') + ' ' + label);
              } else if (item.type === 'radio') {
                lines.push('  • ' + label + ' — оценка: ' + (item.ok || 'не указано'));
              }
            });
          });
          if (sec.note) {
            lines.push('  Комментарий: ' + sec.note);
          }
        });
      });

      // Компетенции в конце
      var competencies = calculateCompetencies();
      if (Object.keys(competencies).length > 0) {
        lines.push('');
        lines.push('=== КОМПЕТЕНЦИИ ===');
        for (var code in competencies) {
          lines.push(code + ' — ' + getCompetencyLabel(code) + ': оценка ' + competencies[code].score
            + ' (' + Math.round(competencies[code].percent) + '%)');
        }
      }
    }

    return lines.join('\n');
  }

  /* ═══════════════════════════════════════════
     CORE LOGIC: Copy full report to clipboard
     ═══════════════════════════════════════════ */
  function copyReport() {
    var text = buildReportText();
    function onSuccess() {
      app.showToast('Отчёт скопирован в буфер обмена');
    }
    function onFail() {
      app.showToast('Не удалось скопировать отчёт');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess, function() {
        // Фолбэк на старый execCommand
        if (legacyCopyText(text)) onSuccess(); else onFail();
      });
    } else if (legacyCopyText(text)) {
      onSuccess();
    } else {
      onFail();
    }
  }

  function legacyCopyText(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.setAttribute('readonly', '');
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch(e) { return false; }
  }

  /* ═══════════════════════════════════════════
     CORE LOGIC: Send email — 3-level degradation (Task 41)
       Level 1: navigator.share with files (mobile ShareSheet, .txt attachment)
       Level 2: navigator.share without files (text only)
       Level 3: clipboard + mailto: short body (full text in clipboard)
     ═══════════════════════════════════════════ */
  function sendEmail() {
    var fio = _pilotData.fio;
    var date = '';
    var dateEl = document.getElementById('r_date');
    if (dateEl) date = dateEl.innerText;

    var fullText = buildReportText();
    var subject = 'CheckRide Report - ' + fio + ' (' + date + ')';

    // Level 1: navigator.share с файлами (мобильный ShareSheet)
    if (navigator.canShare && navigator.canShare({ files: [] })) {
      try {
        var blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
        var file = new File([blob], 'checkride_report_' + Date.now() + '.txt', { type: 'text/plain;charset=utf-8' });
        var shareData = {
          title: subject,
          text: 'Отчёт по проверке — ' + fio + ' (' + date + ')\n\nПолный текст в прикреплённом файле.',
          files: [file]
        };
        navigator.share(shareData).then(function() {
          app.showToast('Отчёт отправлен через ShareSheet');
        }).catch(function(err) {
          if (err && err.name === 'AbortError') return; // пользователь отменил
          // Фолбэк на Level 2
          shareTextOnly(subject, fullText, fio, date);
        });
        return;
      } catch(e) { /* пробуем Level 2 */ }
    }

    // Level 2: navigator.share без файлов (только текст)
    if (navigator.share) {
      shareTextOnly(subject, fullText, fio, date);
      return;
    }

    // Level 3: clipboard + короткий mailto
    clipboardAndMailto(subject, fullText, fio, date);
  }

  function shareTextOnly(subject, fullText, fio, date) {
    navigator.share({
      title: subject,
      text: fullText
    }).then(function() {
      app.showToast('Отчёт отправлен через ShareSheet');
    }).catch(function(err) {
      if (err && err.name === 'AbortError') return;
      clipboardAndMailto(subject, fullText, fio, date);
    });
  }

  function clipboardAndMailto(subject, fullText, fio, date) {
    // Кладём полный текст в буфер обмена
    var copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(fullText).then(function() { copied = true; }, function() {});
    }
    if (!copied) copied = legacyCopyText(fullText);

    // Короткий mailto — только метаданные, тело < 500 символов (избегаем CSP-блокировки в Yandex Mail)
    var shortBody = 'ОТЧЕТ ПО ПРОВЕРКЕ\n\n'
      + 'Проверяемый: ' + fio + '\n'
      + 'Дата: ' + date + '\n'
      + 'Режим: ' + _currentMode.toUpperCase() + '\n'
      + 'Проверяющий: ' + _pilotData.instructor + '\n\n'
      + '--- Полный текст отчёта ' + (copied ? 'скопирован в буфер обмена.' : 'не поместился в тело письма.') + ' ---';
    window.location.href = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(shortBody);
    app.showToast(copied ? 'Полный отчёт в буфере. Открыт почтовый клиент с метаданными.' : 'Открыт почтовый клиент с метаданными.');
  }

  /* ═══════════════════════════════════════════
     HEADER — аналогично survey/metbriefing (§5 renderHeader обязателен)
     ═══════════════════════════════════════════ */
  function renderHeader() {
    var left   = document.getElementById('headerLeft');
    var center = document.getElementById('headerCenter');
    var right  = document.getElementById('headerRight');
    if (!left || !center || !right) return;

    left.innerHTML = '<button id="menuBtn" class="icon-btn" aria-label="\u041C\u0435\u043D\u044E">'
      + window.ICONS.menu + '</button>';
    left.onclick = function() { app.toggleMenu(); };

    center.innerHTML = '<div class="hc-module">Checkride</div>';

    right.innerHTML = '';
    right.onclick = null;
  }

  /* ═══════════════════════════════════════════
     DESTROY — очистка таймера автосохранения (§5 cleanup)
     ═══════════════════════════════════════════ */
  function destroy() {
    if (_saveStateTimer) {
      clearTimeout(_saveStateTimer);
      _saveStateTimer = null;
    }
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */
  function init(params) {
    var container = document.getElementById('checkrideContainer');
    if (!container) { console.error('checkrideContainer not found'); return; }

    /* init() вызывается один раз (registry guard) — состояние модуля сохраняется между переходами */
    _screen = 'start';
    _sectionIndex = 0;

    /* Загружаем сохранённые данные регистрации из localStorage */
    loadPilotFromCache();

    /* Восстанавливаем ход проверки из localStorage (перезагрузка страницы) */
    loadInspectionState();

    /* One-time cleanup of orphaned localStorage keys (Task 12 legacy FFS DRY refactor) */
    cleanupLegacyStateOnce();

    /* Event delegation */
    container.addEventListener('click', function(e) {

        /* Mode selector */
        var modeBtn = e.target.closest('[data-cr-mode]');
        if (modeBtn) {
          _currentMode = modeBtn.dataset.crMode;
          _screen = 'start';
          renderAll();
          return;
        }

        /* Action buttons */
        var actionBtn = e.target.closest('[data-cr-action]');
        if (actionBtn) {
          var action = actionBtn.dataset.crAction;
          switch (action) {
            case 'start':
              startInspection();
              break;
            case 'prev':
              saveState();
              _sectionIndex--;
              _screen = 'test';
              renderAll();
              saveInspectionState();
              break;
            case 'next':
              saveState();
              _sectionIndex++;
              _screen = 'test';
              renderAll();
              saveInspectionState();
              break;
            case 'finish':
              finishInspection();
              break;
            case 'history':
              _screen = 'history';
              renderAll();
              break;
            case 'export-pdf':
              exportPDF();
              break;
            case 'send-email':
              sendEmail();
              break;
            case 'copy-report':
              copyReport();
              break;
            case 'go-start':
              // Task 41: извлекаем подпись инструктора из canvas ДО смены экрана.
              // Canvas существует только на свежем отчёте (не при просмотре из истории).
              // Сохраняем в историю (history[0]) для последующего просмотра.
              if (!_viewingHistory) {
                var sig = extractSignatureDataUrl();
                if (sig) updateSignatureInHistory(sig);
                _pilotData.signature = sig;
              }
              _screen = 'start';
              _viewingHistory = false;
              renderAll();
              clearInspectionState();
              break;
            case 'clear-history':
              app.showConfirm('\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u043F\u0440\u043E\u0432\u0435\u0440\u043E\u043A?', function() {
                localStorage.removeItem(STORAGE_HISTORY);
                /* Также очистить кэш хода проверки (state) — модуль возвращается к стартовому экрану */
                clearInspectionState();
                _data = null;
                _sectionIndex = 0;
                _screen = 'start';
                renderAll();
                app.showToast('\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043E\u0447\u0438\u0449\u0435\u043D\u0430');
              }, '\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C');
              break;
          }
          return;
        }

        /* Delete single history item */
        var deleteBtn = e.target.closest('[data-cr-delete]');
        if (deleteBtn) {
          var delIdx = parseInt(deleteBtn.dataset.crDelete, 10);
          app.showConfirm('\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u044D\u0442\u0443 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443?', function() {
            var hist = [];
            try { var rawH = localStorage.getItem(STORAGE_HISTORY); if (rawH) hist = JSON.parse(rawH); } catch(e) {}
            hist.splice(delIdx, 1);
            try { localStorage.setItem(STORAGE_HISTORY, JSON.stringify(hist)); } catch(e) {}
            renderAll();
            app.showToast('\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0430');
          }, '\u0423\u0434\u0430\u043B\u0438\u0442\u044C');
          return;
        }

        /* View saved report */
        var viewBtn = e.target.closest('[data-cr-view]');
        if (viewBtn) {
          var idx = parseInt(viewBtn.dataset.crView, 10);
          viewSavedReport(idx);
          return;
        }

        /* Фото! button → trigger hidden file input */
        var photoBtn = e.target.closest('[data-cr-photo]');
        if (photoBtn) {
          var photoKey = photoBtn.dataset.crPhoto;
          var fileInput = document.querySelector('[data-cr-file="' + photoKey + '"]');
          if (fileInput) fileInput.click();
          return;
        }

        /* Click on attached image → open in PhotoSwipe */
        var imgView = e.target.closest('[data-cr-img-view]');
        if (imgView) {
          app.openPhotoSwipe(imgView);
          return;
        }

        /* Click on report image → open in PhotoSwipe */
        var reportImg = e.target.closest('[data-cr-report-img]');
        if (reportImg) {
          var container = document.getElementById('checkrideContainer');
          app.openPhotoSwipe(reportImg, container);
          return;
        }

        /* Competency accordion toggle */
        var compToggle = e.target.closest('.checkride-competency-toggle');
        if (compToggle) {
          var comp = compToggle.dataset.competency;
          var items = document.querySelector('#checkrideContainer .checkride-competency-items[data-competency="' + comp + '"]');
          if (items) {
            items.classList.toggle('open');
            compToggle.classList.toggle('is-open');
          }
          return;
        }

      });

      /* File input / Checkbox / Radio delegation */
      container.addEventListener('change', function(e) {
        var fileInput = e.target.closest('[data-cr-file]');
        if (fileInput) {
          var parts = fileInput.dataset.crFile.split('_');
          handleSectionFile(fileInput, parseInt(parts[0], 10), parseInt(parts[1], 10));
          return;
        }
        /* Checkbox / Radio → немедленное сохранение в кеш */
        if (_screen === 'test' && (e.target.type === 'checkbox' || e.target.type === 'radio' || e.target.classList.contains('checkride-grade-select'))) {
          saveState();
          saveInspectionState();
          /* Task 44: обновить красное кольцо прогресса компетенции */
          var compItems = e.target.closest('.checkride-competency-items');
          if (compItems && compItems.dataset.competency) {
            updateCompetencyRing(compItems.dataset.competency);
          }
        }
      });

      /* Автосохранение полей формы и комментариев при вводе */
      container.addEventListener('input', function(e) {
        var el = e.target;
        /* Поля формы регистрации */
        if (el.id && el.id.indexOf('cr_') === 0) {
          var field = el.id.replace('cr_', '');
          if (_pilotData.hasOwnProperty(field)) {
            _pilotData[field] = el.value;
            savePilotToCache();
          }
        }
        /* Поле полётного времени в отчёте */
        if (el.id === 'r_flight_time') {
          _pilotData.flight_time = el.value;
          savePilotToCache();
        }
        /* Комментарии в тесте → debounce-сохранение в кеш */
        if (_screen === 'test' && el.classList.contains('checkride-textarea')) {
          debouncedSaveInspectionState();
        }
      });

      /* ─── Swipe-навигация на экране теста ─── */
      container.addEventListener('touchstart', function(e) {
        if (_screen !== 'test' || !_data) return;
        var t = e.touches[0];
        _swipeStartX = t.clientX;
        _swipeStartY = t.clientY;
        _swipeTracking = true;
      }, { passive: true });

      container.addEventListener('touchmove', function(e) {
        if (!_swipeTracking) return;
        /* Отмена если вертикальный скролл преобладает */
        var t = e.touches[0];
        var dx = Math.abs(t.clientX - _swipeStartX);
        var dy = Math.abs(t.clientY - _swipeStartY);
        if (dy > dx) {
          _swipeTracking = false;
        }
      }, { passive: true });

      container.addEventListener('touchend', function(e) {
        if (!_swipeTracking || _screen !== 'test' || !_data) {
          _swipeTracking = false;
          return;
        }
        _swipeTracking = false;
        var t = e.changedTouches[0];
        var dx = t.clientX - _swipeStartX;
        var adx = Math.abs(dx);
        if (adx < SWIPE_THRESHOLD) return;

        saveState();
        if (dx < 0 && _sectionIndex < _data.checklists.length - 1) {
          /* Свайп влево → Далее */
          _sectionIndex++;
          renderAll();
          saveInspectionState();
        } else if (dx > 0 && _sectionIndex > 0) {
          /* Свайп вправо → Назад */
          _sectionIndex--;
          renderAll();
          saveInspectionState();
        }
      }, { passive: true });

    /* Load data if needed */
    var dataLoaded = (_dataLine && _dataFfs);
    if (dataLoaded) {
      renderContent();
      return;
    }

    app.showSkeleton(container, 'blocks');

    var linePromise = fetch('modules/checkride/data/line.json')
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });

    var ffsPromise = fetch('modules/checkride/data/ffs.json')
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function() { return null; }); /* FFS data is optional */

    Promise.all([linePromise, ffsPromise])
      .then(function(results) {
        _dataLine = expandCompetencies(results[0]);
        _dataFfs = expandCompetencies(results[1]);
        renderContent();
      })
      .catch(function(err) {
        app.showError(container, '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435');
        console.error('checkride fetch error:', err);
      });
  }

  /* ═══════════════════════════════════════════
     REGISTER
     ═══════════════════════════════════════════ */

  window.ModuleRegistry.register('checkride', {
    title:        'Checkride',
    icon:         'badge-check',
    init:          init,
    renderHeader:  renderHeader,
    destroy:       destroy
  });

})();
