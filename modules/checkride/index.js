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

  /* ─── Данные регистрации пилота (сохраняются в памяти) ─── */
  var _pilotData = {
    fio: '',
    license: '',
    instructor: '',
    route: '',
    ac_number: '',
    flight_time: ''
  };

  var STORAGE_HISTORY = 'checkride_v8';
  var STORAGE_PILOT   = 'checkride_pilot';  // автосохранение полей регистрации

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
      localStorage.setItem(STORAGE_PILOT, JSON.stringify(_pilotData));
    } catch(e) {}
  }

  function loadPilotFromCache() {
    try {
      var raw = localStorage.getItem(STORAGE_PILOT);
      if (raw) {
        var saved = JSON.parse(raw);
        for (var key in _pilotData) {
          if (saved[key] !== undefined) _pilotData[key] = saved[key];
        }
      }
    } catch(e) {}
  }

  /** Прочитать значения из DOM-полей формы в _pilotData */
  function readPilotFromDOM() {
    var fields = ['fio', 'license', 'instructor', 'route', 'ac_number', 'flight_time'];
    fields.forEach(function(f) {
      var el = document.getElementById('cr_' + f);
      if (el) _pilotData[f] = el.value;
    });
  }

  /** Записать значения из _pilotData в DOM-поля формы */
  function writePilotToDOM() {
    var fields = ['fio', 'license', 'instructor', 'route', 'ac_number', 'flight_time'];
    fields.forEach(function(f) {
      var el = document.getElementById('cr_' + f);
      if (el) el.value = _pilotData[f] || '';
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

    left.innerHTML = '<button class="icon-btn" aria-label="\u041D\u0430\u0437\u0430\u0434">'
      + window.ICONS['arrow-left'] + '</button>';
    left.onclick = function() {
      if (_screen === 'test') {
        /* Вернуться к стартовому экрану с подтверждением */
        app.showConfirm('\u041F\u0440\u0435\u0440\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443?', function() {
          _screen = 'start';
          renderAll();
        }, '\u041F\u0440\u0435\u0440\u0432\u0430\u0442\u044C');
      } else if (_screen === 'report' || _screen === 'history') {
        _screen = 'start';
        renderAll();
      } else {
        app.navigateTo('main');
      }
    };

    var titles = {
      start: 'Checkride Rating',
      test: '\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430',
      report: '\u041E\u0442\u0447\u0451\u0442',
      history: '\u0418\u0441\u0442\u043E\u0440\u0438\u044F'
    };
    center.innerHTML = '<div class="hc-module">' + (titles[_screen] || 'Checkride') + '</div>';

    right.innerHTML = '';
    right.onclick = null;
  }

  /* ═══════════════════════════════════════════
     RENDER: All content
     ═══════════════════════════════════════════ */
  function renderAll() {
    var container = document.getElementById('checkrideContainer');
    if (!container) return;

    renderHeader();

    switch (_screen) {
      case 'start':   renderStartScreen(container); break;
      case 'test':    renderTestScreen(container); break;
      case 'report':  renderReportScreen(container); break;
      case 'history': renderHistoryScreen(container); break;
      default:        renderStartScreen(container);
    }
  }

  /* ═══════════════════════════════════════════
     SCREEN: START — Регистрация пилота
     ═══════════════════════════════════════════ */
  function renderStartScreen(container) {
    var html = '<div class="module-container checkride-start">';

    html += '<h2 class="checkride-start-title">\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044F \u043F\u0438\u043B\u043E\u0442\u0430</h2>';

    /* Mode selector */
    html += '<div class="checkride-mode-selector">'
      + '<button class="checkride-mode-btn' + (_currentMode === 'line' ? ' active' : '') + '" data-cr-mode="line">LINE</button>'
      + '<button class="checkride-mode-btn' + (_currentMode === 'ffs' ? ' active' : '') + '" data-cr-mode="ffs">FFS</button>'
    + '</div>';

    /* Input fields */
    html += '<div class="checkride-fields">';
    var fields = [
      { id: 'cr_fio',         ph: '\u0424\u0418\u041E \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u043C\u043E\u0433\u043E', val: _pilotData.fio },
      { id: 'cr_license',     ph: '\u041D\u043E\u043C\u0435\u0440 \u043B\u0438\u0446\u0435\u043D\u0437\u0438\u0438', val: _pilotData.license },
      { id: 'cr_instructor',  ph: '\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u044E\u0449\u0438\u0439 (\u0418\u043D\u0441\u0442\u0440\u0443\u043A\u0442\u043E\u0440)', val: _pilotData.instructor },
      { id: 'cr_route',       ph: '\u041C\u0430\u0440\u0448\u0440\u0443\u0442 (\u043E\u043F\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u043E)', val: _pilotData.route },
      { id: 'cr_ac_number',   ph: '\u041D\u043E\u043C\u0435\u0440 \u0412\u0421 (\u043E\u043F\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u043E)', val: _pilotData.ac_number },
      { id: 'cr_flight_time', ph: '\u041F\u043E\u043B\u0451\u0442\u043D\u043E\u0435 \u0432\u0440\u0435\u043C\u044F (\u043E\u043F\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u043E)', val: _pilotData.flight_time }
    ];
    for (var i = 0; i < fields.length; i++) {
      var escVal = (fields[i].val || '').replace(/"/g, '&quot;');
      html += '<input type="text" id="' + fields[i].id + '" class="checkride-input" placeholder="' + fields[i].ph + '" value="' + escVal + '">';
    }
    html += '</div>';

    /* Buttons */
    html += '<button class="checkride-main-btn" data-cr-action="start">'
      + icon('checklist', 18) + ' <span>\u041D\u0430\u0447\u0430\u0442\u044C \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443</span></button>';
    html += '<button class="checkride-secondary-btn" data-cr-action="history">'
      + icon('clock', 18) + ' <span>\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u0440\u043E\u0432\u0435\u0440\u043E\u043A</span></button>';

    html += '</div>';
    container.innerHTML = html;
  }

  /* ═══════════════════════════════════════════
     SCREEN: TEST — Чеклист проверки
     ═══════════════════════════════════════════ */
  function renderTestScreen(container) {
    if (!_data) return;
    var mainSection = _data.checklists[_sectionIndex];

    var html = '<div class="module-container checkride-test">';

    /* Section title */
    html += '<h2 class="checkride-section-title">' + mainSection.name + '</h2>';

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
      groups.forEach(function(group) {
        if (group.topitem) {
          html += '<h4 class="checkride-topitem">' + group.topitem + '</h4>';
        }

        group.items.forEach(function(item) {
          if (item.type === 'divider') {
            html += '<div class="checkride-divider">' + item.label + '</div>';
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

      /* Comment/Photo block */
      if (sec.subname !== '\u041A\u043E\u043C\u043F\u0435\u0442\u0435\u043D\u0446\u0438\u0438.') {
        html += '<div class="checkride-detail-item">'
          + '<b class="checkride-comment-label">\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0438:</b>'
          + '<textarea id="sec_n_' + _sectionIndex + '_' + secIdx + '" class="checkride-textarea" placeholder="\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043A\u0441\u0442...">' + (sec.note || '') + '</textarea>'
          + '<input type="file" accept="image/*" class="checkride-file-input" data-cr-file="' + _sectionIndex + '_' + secIdx + '">'
          + '<div id="sec_p_' + _sectionIndex + '_' + secIdx + '">'
          + (sec.img ? '<img src="' + sec.img + '" class="checkride-attached-img">' : '')
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
  }

  /* ═══════════════════════════════════════════
     SCREEN: REPORT — Отчёт по проверке
     ═══════════════════════════════════════════ */
  function renderReportScreen(container) {
    var html = '<div class="module-container checkride-report">';

    html += '<h2 class="checkride-report-main-title">\u041E\u0422\u0427\u0415\u0422 \u041F\u041E \u041F\u0420\u041E\u0412\u0415\u0420\u041A\u0415</h2>';

    /* Meta */
    html += '<div class="checkride-report-meta">'
      + '<p><b>\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u043C\u044B\u0439:</b> <span id="r_fio"></span></p>'
      + '<p><b>\u041B\u0438\u0446\u0435\u043D\u0437\u0438\u044F:</b> <span id="r_license"></span></p>'
      + '<p><b>\u0414\u0430\u0442\u0430:</b> <span id="r_date"></span></p>'
      + '<p><b>\u0420\u0435\u0436\u0438\u043C:</b> <span id="r_mode"></span></p>'
      + '<p><b>\u041C\u0430\u0440\u0448\u0440\u0443\u0442:</b> <span id="r_route"></span></p>'
      + '<p><b>\u041D\u043E\u043C\u0435\u0440 \u0412\u0421:</b> <span id="r_ac_number"></span></p>'
      + '<p><b>\u041F\u043E\u043B\u0451\u0442\u043D\u043E\u0435 \u0432\u0440\u0435\u043C\u044F:</b> <span id="r_flight_time"></span></p>'
    + '</div>';

    /* Ratings */
    html += '<div id="checkride-report-data"></div>';

    /* Competencies */
    html += '<div id="checkride-competencies"></div>';

    /* Signature */
    html += '<div class="checkride-signature-section">'
      + '<p><b>\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u044E\u0449\u0438\u0439:</b> <span id="r_instructor"></span></p>'
      + '<p><b>\u041F\u043E\u0434\u043F\u0438\u0441\u044C:</b></p>'
      + '<canvas id="checkride-signature" width="500" height="150"></canvas>'
    + '</div>';

    /* Action buttons */
    html += '<div class="checkride-report-actions">'
      + '<button class="checkride-main-btn" data-cr-action="export-pdf">'
        + icon('download', 18) + ' <span>\u041F\u0435\u0447\u0430\u0442\u044C / PDF</span></button>'
      + '<button class="checkride-secondary-btn" data-cr-action="send-email">'
        + icon('mail', 18) + ' <span>\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u043F\u043E \u043F\u043E\u0447\u0442\u0435</span></button>'
      + '<button class="checkride-secondary-btn" data-cr-action="go-start">'
        + icon('home', 18) + ' <span>\u041D\u0430 \u0433\u043B\u0430\u0432\u043D\u0443\u044E</span></button>'
    + '</div>';

    html += '</div>';
    container.innerHTML = html;

    /* Build report data */
    buildReport();
    initSignature();
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

    var html = '<div class="module-container checkride-history">';

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
          + '<b>' + h.fio + '</b> <small>(' + h.mode + ')</small><br>' + h.date
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
            if (item.type !== 'divider') item.ok = (item.type === 'radio') ? null : false;
          });
        });
      });
    });

    _sectionIndex = 0;
    _screen = 'test';
    renderAll();
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
            var cb = document.getElementById('c_' + item.id);
            if (cb) item.ok = cb.checked;
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
      var violations = 0;
      var hasPilotingSection = false;

      mainSec.sections.forEach(function(sec) {
        var groups = sec.groups || [{ items: sec.items || [] }];
        groups.forEach(function(g) { g.items.forEach(function(i) {
          if (i.type === 'radio') {
            hasPilotingSection = true;
            var score = i.ok ? (5 - i.options.indexOf(i.ok)) : 2;
            piloting.push(score < 2 ? 2 : score);
          } else if (i.type === 'checkbox' && sec.subname !== '\u041A\u043E\u043C\u043F\u0435\u0442\u0435\u043D\u0446\u0438\u0438.') {
            if (!i.ok) violations++;
          }
        }); });
      });

      var pRes = piloting.length ? (piloting.indexOf(2) !== -1 ? 2 : Math.round(piloting.reduce(function(a,b){return a+b;},0)/piloting.length)) : '-';

      var ratingLine = '<div class="checkride-rating-block"><b>' + mainSec.name + '</b>';
      if (hasPilotingSection) {
        ratingLine += ' | \u0422\u0435\u0445\u043D\u0438\u043A\u0430 \u043F\u0438\u043B\u043E\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F: <span class="checkride-score-val">' + pRes + '</span>';
      }
      ratingLine += ' | \u041D\u0430\u0440\u0443\u0448\u0435\u043D\u0438\u0439: <span class="checkride-score-val">' + violations + '</span></div>';
      reportHtml += ratingLine;
    });

    /* Competencies in summary */
    var competencies = calculateCompetencies();
    if (Object.keys(competencies).length > 0) {
      reportHtml += '<div class="checkride-competencies-rating-divider">';
      reportHtml += '<div class="checkride-competencies-rating-title">\u041A\u043E\u043C\u043F\u0435\u0442\u0435\u043D\u0446\u0438\u0438:</div>';
      for (var code in competencies) {
        reportHtml += '<div class="checkride-rating-block"><b>' + code + '</b>: <span class="checkride-score-val">' + competencies[code].score + '</span></div>';
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
          if (group.topitem) sHtml += '<h4 class="checkride-report-topitem">' + group.topitem + '</h4>';
          group.items.forEach(function(item) {
            if (item.type === 'divider') return;
            if (item.type === 'checkbox') {
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
            + (sec.img ? '<img src="' + sec.img + '" style="width:100%;max-width:200px;margin-top:10px;">' : '')
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
      compHtml += '<div class="checkride-report-section"><h3 class="checkride-report-subname">' + code + '</h3>';
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

    /* Meta fields — из _pilotData, НЕ из DOM */
    var metaFields = ['fio', 'license', 'instructor', 'route', 'ac_number', 'flight_time'];
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
          var canvas = document.createElement('canvas');
          var MAX_WIDTH = 800;
          var scale = MAX_WIDTH / img.width;
          canvas.width = MAX_WIDTH;
          canvas.height = img.height * scale;
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          _data.checklists[mainIdx].sections[secIdx].img = canvas.toDataURL('image/jpeg', 0.6);
          _screen = 'test';
          renderAll();
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
      fullData:    JSON.parse(JSON.stringify(_data))
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

    _data = h.fullData;
    _data.savedDate = h.date;
    _currentMode = h.mode;
    _screen = 'report';
    renderAll();

    /* Hide signature for viewed reports */
    var sigCanvas = document.getElementById('checkride-signature');
    if (sigCanvas) sigCanvas.style.display = 'none';
  }

  /* ═══════════════════════════════════════════
     CORE LOGIC: Signature canvas
     ═══════════════════════════════════════════ */
  function initSignature() {
    var canvas = document.getElementById('checkride-signature');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.display = 'block';
    var drawing = false;

    function getPos(e) {
      var rect = canvas.getBoundingClientRect();
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      var clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    canvas.onmousedown = canvas.ontouchstart = function(e) {
      drawing = true;
      ctx.beginPath();
      var p = getPos(e);
      ctx.moveTo(p.x, p.y);
    };
    canvas.onmousemove = canvas.ontouchmove = function(e) {
      if (!drawing) return;
      e.preventDefault();
      var p = getPos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    };
    canvas.onmouseup = canvas.ontouchend = function() { drawing = false; };
  }

  /* ═══════════════════════════════════════════
     CORE LOGIC: Export / Email
     ═══════════════════════════════════════════ */
  function exportPDF() { window.print(); }

  function sendEmail() {
    var fio        = _pilotData.fio;
    var license    = _pilotData.license;
    var instructor = _pilotData.instructor;
    var route      = _pilotData.route;
    var acNumber   = _pilotData.ac_number;
    var flightTime = _pilotData.flight_time;
    var date = '';
    var dateEl = document.getElementById('r_date');
    if (dateEl) date = dateEl.innerText;

    var body = '\u041E\u0422\u0427\u0415\u0422 \u041F\u041E \u041F\u0420\u041E\u0412\u0415\u0420\u041A\u0415\n\n'
      + '\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u043C\u044B\u0439: ' + fio + '\n'
      + '\u041B\u0438\u0446\u0435\u043D\u0437\u0438\u044F: ' + license + '\n'
      + '\u0414\u0430\u0442\u0430: ' + date + '\n'
      + '\u0420\u0435\u0436\u0438\u043C: ' + _currentMode.toUpperCase() + '\n';
    if (route) body += '\u041C\u0430\u0440\u0448\u0440\u0443\u0442: ' + route + '\n';
    if (acNumber) body += '\u041D\u043E\u043C\u0435\u0440 \u0412\u0421: ' + acNumber + '\n';
    if (flightTime) body += '\u041F\u043E\u043B\u0451\u0442\u043D\u043E\u0435 \u0432\u0440\u0435\u043C\u044F: ' + flightTime + '\n';
    body += '\n\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u044E\u0449\u0438\u0439: ' + instructor + '\n';

    var subject = 'CheckRide Report - ' + fio + ' (' + date + ')';
    window.location.href = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */
  function init() {
    var container = document.getElementById('checkrideContainer');
    if (!container) { console.error('checkrideContainer not found'); return; }

    /* Reset state on re-entry */
    _screen = 'start';
    _sectionIndex = 0;

    /* Загружаем сохранённые данные регистрации из localStorage */
    loadPilotFromCache();

    /* Event delegation: attach ONCE */
    if (!container.dataset.delegated) {
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
              break;
            case 'next':
              saveState();
              _sectionIndex++;
              _screen = 'test';
              renderAll();
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
            case 'go-start':
              _screen = 'start';
              renderAll();
              break;
            case 'clear-history':
              app.showConfirm('\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u043F\u0440\u043E\u0432\u0435\u0440\u043E\u043A?', function() {
                localStorage.removeItem(STORAGE_HISTORY);
                _screen = 'history';
                renderAll();
                app.showToast('\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043E\u0447\u0438\u0449\u0435\u043D\u0430');
              }, '\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C');
              break;
          }
          return;
        }

        /* View saved report */
        var viewBtn = e.target.closest('[data-cr-view]');
        if (viewBtn) {
          var idx = parseInt(viewBtn.dataset.crView, 10);
          viewSavedReport(idx);
          return;
        }

      });

      /* File input delegation */
      container.addEventListener('change', function(e) {
        var fileInput = e.target.closest('[data-cr-file]');
        if (fileInput) {
          var parts = fileInput.dataset.crFile.split('_');
          handleSectionFile(fileInput, parseInt(parts[0], 10), parseInt(parts[1], 10));
          return;
        }
      });

      /* Автосохранение полей формы при вводе */
      container.addEventListener('input', function(e) {
        var el = e.target;
        if (el.id && el.id.indexOf('cr_') === 0) {
          var field = el.id.replace('cr_', '');
          if (_pilotData.hasOwnProperty(field)) {
            _pilotData[field] = el.value;
            savePilotToCache();
          }
        }
      });

      container.dataset.delegated = 'true';
    }

    /* Load data if needed */
    var dataLoaded = (_dataLine && _dataFfs);
    if (dataLoaded) {
      renderAll();
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
        _dataLine = results[0];
        _dataFfs = results[1];
        renderAll();
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
    renderHeader:  renderHeader
  });

})();
