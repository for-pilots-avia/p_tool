/* ═══════════════════════════════════════════
   Pilot's Tool — modules/worktime/index.js
   Модуль «Рабочее время»
   ═══════════════════════════════════════════ */
(function() {
  'use strict';

  /* ─── State (module-scoped, NOT window) ─── */
  var _wtSegments  = [];
  var _wtSettings  = {};
  var _wtFinalized = false;
  var _wtSheetMode  = 'settings'; // 'settings' | 'segment'
  var _wtEditSegmentIdx = -1;     // -1 = new, >=0 = edit index
  var _wtSegmentJustSaved = false; // prevent double-save on auto-close
  var _wtAddingShift = 1;          // 1 = adding to shift 1, 2 = to shift 2 (split mode)

  var WT_DEFAULT_SETTINGS = {
    pilotExtra:  0,
    cabinExtra:  0,
    extension:   0,
    restType:    'nonbase',
    reportTime:  '',
    tzOffset:    3,
    postflight1: 30,
    postflight2: 30,
    splitMode:   false,
    reportTime2: ''
  };

  /* ─── FTL расчёты ─── */

  // Время хранится в UTC. Местное время = UTC + tzOffset×60.
  // День = 06:01–21:59, Ночь = 22:00–06:00 (по местному времени).
  function wtIsNight(reportMinutes, tzOffset) {
    var tz = (typeof tzOffset === 'number') ? tzOffset : 0;
    var local = ((reportMinutes + tz * 60) % 1440 + 1440) % 1440;
    return local >= 1320 || local <= 360;
  }

  function wtGetLandingsFromSegments(segments) {
    var count = segments.length;
    if (count <= 2) return '1-2';
    return '3-4';
  }

  function wtGetMaxDuty(extra, landings, night) {
    var base;
    if (extra === 0) {
      if (landings === '1-2') { base = night ? 11 * 60 : 12 * 60; }
      else                    { base = night ? 10 * 60 : 10 * 60 + 30; }
    } else if (extra === 1) {
      base = (landings === '1-2') ? 13 * 60 : 12 * 60;
    } else {
      base = (landings === '1-2') ? 16 * 60 : 14 * 60;
    }
    return base;
  }

  function wtCalcRest(workedMinutes, restType) {
    var h = workedMinutes / 60;
    if (restType === 'base') {
      if (h <= 12) return 12;
      if (h <= 14) return 14;
      return 18;
    } else {
      if (h <= 12) return 10;
      if (h <= 14) return 12;
      return 16;
    }
  }

  function wtDiffTime(startMin, endMin) {
    if (endMin < startMin) endMin += 1440;
    return endMin - startMin;
  }

  function wtCalcResults(segments, settings) {
    var report = wtParseTime(settings.reportTime);
    // Для расчёта: если сегментов 0 — считаем как 1 (для landings)
    var effectiveSegments = segments.length > 0 ? segments : [{engineStart: 0, engineStop: 0, takeoff: 0, landing: 0, flightTime: 0, airTime: 0}];
    if (report === null) return null;

    var landings  = wtGetLandingsFromSegments(segments.length > 0 ? segments : []);
    var night     = wtIsNight(report, settings.tzOffset || 0);
    var pilotMax  = wtGetMaxDuty(settings.pilotExtra, landings, night)
                    + settings.extension * 60;
    var cabinMax  = wtGetMaxDuty(settings.cabinExtra,  landings, night)
                    + settings.extension * 60;

    if (segments.length === 0) {
      return {
        night: night, pilotMax: pilotMax, cabinMax: cabinMax,
        duty: 0, shiftEnd: report,
        restHours: wtCalcRest(0, settings.restType), restEnd: report,
        totalFlight: 0, totalAir: 0,
        warnings: [], landings: landings
      };
    }

    // ─── Раздельный режим (splitMode) ───
    if (settings.splitMode) {
      var report2 = wtParseTime(settings.reportTime2);
      var segs1 = segments.filter(function(s) { return !s.shift || s.shift === 1; });
      var segs2 = segments.filter(function(s) { return s.shift === 2; });

      var r1 = wtCalcSingleShift(segs1, report, settings, night, pilotMax, cabinMax, landings, 'смены 1', settings.postflight1 || 0);
      var r2 = (report2 !== null && segs2.length > 0)
        ? wtCalcSingleShift(segs2, report2, settings, night, pilotMax, cabinMax, landings, 'смены 2', settings.postflight2 || 0)
        : null;

      var duty1 = r1 ? r1.duty : 0;
      var duty2 = r2 ? r2.duty : 0;
      var duty  = duty1 + duty2;

      var warnings = [];
      if (r1) warnings = warnings.concat(r1.warnings);
      if (r2) warnings = warnings.concat(r2.warnings);
      // Суммарное превышение
      if (duty > pilotMax) {
        warnings.push('ЛЭ (итого): превышение макс. рабочего времени ('
          + wtFmtMin(duty) + ' > ' + wtFmtMin(pilotMax) + ')');
      }
      if (duty > cabinMax) {
        warnings.push('КЭ (итого): превышение макс. рабочего времени ('
          + wtFmtMin(duty) + ' > ' + wtFmtMin(cabinMax) + ')');
      }

      var restHours = wtCalcRest(duty, settings.restType);
      var shiftEnd  = (report2 !== null && r2) ? (report2 + duty2) % 1440 : (report + duty1) % 1440;
      var restEnd   = (report + duty + restHours * 60) % 1440;

      var totalFlight = (r1 ? r1.totalFlight : 0) + (r2 ? r2.totalFlight : 0);
      var totalAir    = (r1 ? r1.totalAir    : 0) + (r2 ? r2.totalAir    : 0);

      return {
        night: night, pilotMax: pilotMax, cabinMax: cabinMax,
        duty: duty, duty1: duty1, duty2: duty2,
        shift1End: (report + duty1) % 1440,
        shift2End: shiftEnd,
        shiftEnd: shiftEnd,
        restHours: restHours, restEnd: restEnd,
        totalFlight: totalFlight, totalAir: totalAir,
        warnings: warnings, landings: landings,
        splitMode: true
      };
    }

    // ─── Обычный режим ───
    var r = wtCalcSingleShift(segments, report, settings, night, pilotMax, cabinMax, landings, '');
    return r;
  }

  // Расчёт одной смены (общий для обычного и раздельного режима)
  // postflightMin — значение послеполётных работ для этой смены (postflight1/postflight2)
  function wtCalcSingleShift(segs, report, settings, night, pilotMax, cabinMax, landings, label, postflightMin) {
    var pf = (typeof postflightMin === 'number') ? postflightMin : (settings.postflight1 || 0);
    if (segs.length === 0) {
      return {
        night: night, pilotMax: pilotMax, cabinMax: cabinMax,
        duty: 0, dutyToStop: 0, shiftEnd: report,
        restHours: wtCalcRest(0, settings.restType), restEnd: report,
        totalFlight: 0, totalAir: 0,
        warnings: [], landings: landings
      };
    }

    var lastStop   = segs[segs.length - 1].engineStop;
    var dutyToStop = wtDiffTime(report, lastStop);
    var duty       = dutyToStop + pf;
    var shiftEnd   = (report + duty) % 1440;
    var restHours  = wtCalcRest(duty, settings.restType);
    var restEnd    = (report + duty + restHours * 60) % 1440;

    var totalFlight = 0;
    var totalAir    = 0;
    for (var i = 0; i < segs.length; i++) {
      totalFlight += segs[i].flightTime;
      totalAir    += segs[i].airTime;
    }

    var warnings = [];
    var firstStart = segs[0].engineStart;
    if (wtDiffTime(report, firstStart) < 60) {
      warnings.push('Менее 1 ч от явки до запуска двигателей' + (label ? ' (' + label + ')' : ''));
    }
    if (duty > pilotMax) {
      warnings.push('ЛЭ' + (label ? ' (' + label + ')' : '') + ': превышение макс. рабочего времени ('
        + wtFmtMin(duty) + ' > ' + wtFmtMin(pilotMax) + ')');
    }
    if (duty > cabinMax) {
      warnings.push('КЭ' + (label ? ' (' + label + ')' : '') + ': превышение макс. рабочего времени ('
        + wtFmtMin(duty) + ' > ' + wtFmtMin(cabinMax) + ')');
    }
    if (pf > 60) {
      warnings.push('Послеполётные работы > 60 мин — проверьте нормативы');
    }

    return {
      night: night, pilotMax: pilotMax, cabinMax: cabinMax,
      duty: duty, dutyToStop: dutyToStop, shiftEnd: shiftEnd,
      restHours: restHours, restEnd: restEnd,
      totalFlight: totalFlight, totalAir: totalAir,
      warnings: warnings, landings: landings
    };
  }

  /* ─── Формат времени ─── */

  function wtParseTime(str) {
    if (!str) return null;
    var parts = str.split(':');
    if (parts.length !== 2) return null;
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }

  function wtFormatTime(minutes) {
    var norm = ((minutes % 1440) + 1440) % 1440;
    var h = Math.floor(norm / 60);
    var m = norm % 60;
    return (h < 10 ? '0' + h : '' + h) + ':' + (m < 10 ? '0' + m : '' + m);
  }

  function wtFmtMin(totalMinutes) {
    var h = Math.floor(totalMinutes / 60);
    var m = totalMinutes % 60;
    var mm = m < 10 ? '0' + m : '' + m;
    return h + ' ч ' + mm + ' мин';
  }

  /* ─── localStorage ─── */

  function wtLoadSettings() {
    try {
      var raw = localStorage.getItem('wt_settings_v2');
      var saved = raw ? JSON.parse(raw) : {};
      var result = {};
      var keys = Object.keys(WT_DEFAULT_SETTINGS);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        result[k] = (saved && saved[k] !== undefined) ? saved[k] : WT_DEFAULT_SETTINGS[k];
      }
      // Миграция: старое поле postflight → postflight1 (если postflight1 не задан)
      if (saved && saved.postflight !== undefined && (result.postflight1 === undefined || result.postflight1 === WT_DEFAULT_SETTINGS.postflight1)) {
        result.postflight1 = saved.postflight;
      }
      return result;
    } catch (e) { return JSON.parse(JSON.stringify(WT_DEFAULT_SETTINGS)); }
  }

  function wtSaveSettings(settings) {
    try { localStorage.setItem('wt_settings_v2', JSON.stringify(settings)); } catch (e) {}
  }

  function wtLoadSegments() {
    try {
      var raw = localStorage.getItem('wt_segments_v2');
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function wtSaveSegments(segments) {
    try { localStorage.setItem('wt_segments_v2', JSON.stringify(segments)); } catch (e) {}
  }

  function wtLoadFinalized() {
    try {
      var raw = localStorage.getItem('wt_finalized_v2');
      return raw === 'true';
    } catch (e) { return false; }
  }

  function wtSaveFinalized(val) {
    try { localStorage.setItem('wt_finalized_v2', val ? 'true' : 'false'); } catch (e) {}
  }

  /* ─── Хедер ─── */

  function wtRenderHeader() {
    var left   = document.getElementById('headerLeft');
    var center = document.getElementById('headerCenter');
    var right  = document.getElementById('headerRight');
    if (!left || !center || !right) return;

    left.innerHTML = '<button id="menuBtn" class="icon-btn" aria-label="Меню">'
      + window.ICONS.menu + '</button>';
    left.onclick = function() { app.toggleMenu(); };

    center.innerHTML = '<div class="hc-module">Рабочее время</div>';

    // Ellipsis-vertical menu with "Очистить рейс"
    right.innerHTML = '<button class="icon-btn" id="wtHeaderMenuBtn" aria-label="Меню">'
      + window.ICONS['ellipsis-vertical'] + '</button>';
    right.onclick = null;

    var headerMenuBtn = document.getElementById('wtHeaderMenuBtn');
    if (headerMenuBtn) {
      headerMenuBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        wtToggleHeaderMenu();
      });
    }
  }

  /* ─── Рендер экрана ─── */

  function wtRenderAll() {
    var container = document.getElementById('worktimeContainer');
    if (!container) return;

    var landings = wtGetLandingsFromSegments(_wtSegments);
    // results считается если finalized ИЛИ splitMode ИЛИ есть сегменты
    // (в обычном режиме с сегментами — нужен dutyToStop для inline-итогов и для таймлайна)
    var results = (_wtFinalized || _wtSettings.splitMode || _wtSegments.length > 0)
                  ? wtCalcResults(_wtSegments, _wtSettings) : null;
    var night   = wtIsNight(wtParseTime(_wtSettings.reportTime) || 0, _wtSettings.tzOffset || 0);

    var pilotMax = wtGetMaxDuty(_wtSettings.pilotExtra, landings, night)
                   + _wtSettings.extension * 60;
    var cabinMax = wtGetMaxDuty(_wtSettings.cabinExtra, landings, night)
                   + _wtSettings.extension * 60;

    var reportMin = wtParseTime(_wtSettings.reportTime);

    var html = '<div class="module-container">';
    html += wtRenderDutyCard(results, night, pilotMax, cabinMax, reportMin, landings);
    html += wtRenderSegmentsCard(results);
    // Task 49 #5: до finalize — только блок «Нарушения:» (если есть), после finalize — полная карточка Итоги рейса
    if (_wtFinalized && results) {
      html += wtRenderResultsCard(results);
    } else if (!_wtFinalized && results && results.warnings.length > 0) {
      html += wtRenderWarningsOnly(results);
    }
    html += '</div>';
    container.innerHTML = html;
  }

  /* ─── Карточка «Нормы рабочего времени» ─── */

  function wtRenderDutyCard(results, night, pilotMax, cabinMax, reportMin, landings) {
    var actualDuty = (results && _wtFinalized) ? results.duty : 0;

    var html = '<div class="app-card wt-card--duty wt-relative">';
    html += '<div class="app-card-header">';
    html += '<div class="wt-flex-center-gap">';
    html += '<div class="wt-card-icon wt-card-icon--duty">' + window.ICONS.clock + '</div>';
    html += '<h2 class="ct-heading-md">Нормы рабочего времени</h2>';
    html += '</div>';
    if (night) {
      html += '<span class="badge-danger wt-badge-flex">'
        + window.ICONS.moon + ' Ночь</span>';
    }
    html += '</div>';

    html += '<div class="wt-duty-grid">';

    // В раздельном режиме показываем только «Максимум» (без «Окончание»)
    var hideEnd = !!_wtSettings.splitMode;

    // ЛЭ
    html += '<div class="wt-sub-card">';
    html += '<div class="wt-sub-card-label">' + window.ICONS.plane + ' Лётный экипаж (ЛЭ)</div>';
    html += '<div class="wt-flex-between-baseline">';
    html += '<div><span class="wt-label-xs">Максимум</span>';
    html += '<div class="ct-mono-time wt-value-bold">' + wtFmtMin(pilotMax) + '</div></div>';
    if (!hideEnd) {
      html += '<div class="wt-text-right"><span class="wt-label-xs">Окончание</span>';
      var pilotEnd = reportMin !== null ? wtFormatTime(reportMin + pilotMax) : '--:--';
      html += '<div class="ct-mono-time wt-value-bold">' + pilotEnd + '</div></div>';
    }
    html += '</div>';
    if (_wtFinalized && actualDuty > 0) {
      html += wtRenderProgressBar(actualDuty, pilotMax, 'ЛЭ');
    }
    html += '</div>';

    // КЭ
    html += '<div class="wt-sub-card">';
    html += '<div class="wt-sub-card-label">' + window.ICONS.users + ' Кабинный экипаж (КЭ)</div>';
    html += '<div class="wt-flex-between-baseline">';
    html += '<div><span class="wt-label-xs">Максимум</span>';
    html += '<div class="ct-mono-time wt-value-bold">' + wtFmtMin(cabinMax) + '</div></div>';
    if (!hideEnd) {
      html += '<div class="wt-text-right"><span class="wt-label-xs">Окончание</span>';
      var cabinEnd = reportMin !== null ? wtFormatTime(reportMin + cabinMax) : '--:--';
      html += '<div class="ct-mono-time wt-value-bold">' + cabinEnd + '</div></div>';
    }
    html += '</div>';
    if (_wtFinalized && actualDuty > 0) {
      html += wtRenderProgressBar(actualDuty, cabinMax, 'КЭ');
    }
    html += '</div>';

    html += '</div>';

    // Info-row — compact, uses wt-info-row / wt-info-item classes
    html += '<div class="wt-info-row">';
    // Task 49 #2: порядок — сначала Явка, потом иконка времени суток
    html += '<span class="wt-info-item">'
      + window.ICONS.clock + ' <strong>Явка:</strong>'
      + '<span class="ct-mono-time">' + (_wtSettings.reportTime || '--:--') + '</span></span>';
    // Статус дня/ночи — только иконка в бейдже (Task 48 #2: текст убран, достаточно иконки)
    var dayNightIcon  = night ? window.ICONS.moon : window.ICONS.sun;
    var dayNightBadge = night ? 'badge-danger' : 'badge-ok';
    html += '<span class="wt-info-item">'
      + '<span class="' + dayNightBadge + '">' + dayNightIcon + '</span></span>';
    if (_wtSettings.splitMode) {
      // В раздельном режиме — бейдж «Разделенная полетная смена» вместо «Посадки»
      html += '<span class="wt-info-item">'
        + window.ICONS.split + ' <span class="wt-split-badge">Разделенная полетная смена</span></span>';
    } else {
      html += '<span class="wt-info-item">'
        + window.ICONS['plane-landing'] + ' <strong>Посадки:</strong>'
        + '<span class="ct-mono-time">' + (landings === '1-2' ? '1–2' : '3–4') + '</span></span>';
    }
    if (_wtSettings.extension > 0) {
      html += '<span class="wt-info-item">'
        + window.ICONS.timer + ' <strong>КВС:</strong> +' + _wtSettings.extension + ' ч</span>';
    }
    html += '</div>';

    // Settings button + report-time reminder — bottom of the card
    var reportIsDefault = (_wtSettings.reportTime === WT_DEFAULT_SETTINGS.reportTime);
    html += '<div class="wt-mt-sm">';
    if (reportIsDefault) {
      html += '<button class="wt-report-btn" id="wtFlightSettingsBtn" aria-label="Ввести время явки">'
        + window.ICONS.settings + ' Нажмите чтобы ввести время явки</button>';
    } else {
      html += '<button class="wt-report-btn wt-report-btn--set" id="wtFlightSettingsBtn" aria-label="Изменить данные рейса">'
        + window.ICONS.settings + ' Изменить данные рейса</button>';
    }
    html += '</div>';

    html += '</div>';
    return html;
  }

  /* ─── Прогресс-бар ─── */

  function wtRenderProgressBar(actual, max, label) {
    var pct     = Math.min(Math.round((actual / max) * 100), 100);
    var exceeded = actual > max;
    var warning  = !exceeded && pct > 85;
    var fillClass = exceeded ? 'wt-progress-bar-fill--danger'
                  : warning  ? 'wt-progress-bar-fill--warning'
                  :             'wt-progress-bar-fill--ok';
    var dotClass  = exceeded ? 'wt-status-dot--danger' : 'wt-status-dot--ok';

    return '<div class="wt-mt-md">'
      + '<div class="wt-progress-header">'
      + '<span class="ct-heading-sm wt-text-xs-normal">' + label + '</span>'
      + '<span class="wt-status-dot ' + dotClass + '"></span>'
      + '</div>'
      + '<div class="wt-progress-bar">'
      + '<div class="wt-progress-bar-fill ' + fillClass + '" style="--fill:' + pct + '%"></div>'
      + '</div>'
      + '<div class="wt-progress-label">'
      + '<span>' + wtFmtMin(actual) + '</span>'
      + '<span>макс. ' + wtFmtMin(max) + '</span>'
      + '</div>'
      + '</div>';
  }

  /* ─── Карточка «Сегменты полёта» ─── */

  function wtRenderSegmentsCard(results) {
    var splitMode = !!_wtSettings.splitMode;
    var html = '<div class="app-card wt-card--segments">';
    html += '<div class="app-card-header">';
    html += '<div class="wt-flex-center-gap">';
    html += '<div class="wt-card-icon wt-card-icon--segments">' + window.ICONS.plane + '</div>';
    html += '<h2 class="ct-heading-md">' + (splitMode ? 'Смены (раздельный режим)' : 'Сегменты полёта') + '</h2>';
    html += '</div>';
    // Plus icon — скрыт после завершения. В splitMode скрыт также после ввода
    // сегмента смены 2 (каждая смена = ровно 1 сегмент — добавление недоступно).
    var _segs2Count = _wtSegments.filter(function(s) { return s.shift === 2; }).length;
    var _hidePlus = _wtFinalized || (splitMode && _segs2Count >= 1);
    if (!_hidePlus) {
      html += '<button class="wt-ghost-icon-btn" id="wtAddSegmentBtn" aria-label="Добавить сегмент">'
        + window.ICONS.plus + '</button>';
    }
    html += '</div>';

    if (splitMode) {
      // ─── Раздельный режим: блок Смены 1 (locked) + divider + блок Смены 2 ───
      var segs1 = _wtSegments.filter(function(s) { return !s.shift || s.shift === 1; });
      var segs2 = _wtSegments.filter(function(s) { return s.shift === 2; });
      var duty1 = results && results.duty1 !== undefined ? results.duty1 : 0;
      var duty2 = results && results.duty2 !== undefined ? results.duty2 : 0;

      // Таймлайн (оба смены видны на одной шкале; маркер «Конец сегмента»
      // = engineStop1 + postflight1 позиционируется внутри wtRenderTimeline)
      if (segs1.length > 0) {
        html += wtRenderTimeline(_wtSegments, results, true);
      }

      // Смена 1 (locked)
      html += '<div class="wt-shift-block wt-shift-block--1">';
      html += '<div class="wt-shift-title">'
        + '<span class="wt-shift-lock">' + window.ICONS['check-circle'] + '</span>'
        + '<span>Смена 1 закрыта</span>'
        + '<span class="wt-shift-duty-label">рабочее время: <strong class="ct-mono-time">' + wtFmtMin(duty1) + '</strong></span>'
        + '</div>';
      if (segs1.length === 0) {
        html += '<div class="ct-empty-text wt-py-sm">Нет сегментов</div>';
      } else {
        for (var i1 = 0; i1 < segs1.length; i1++) {
          var origIdx1 = _wtSegments.indexOf(segs1[i1]);
          html += wtRenderSegmentCard(segs1[i1], origIdx1, true);
        }
      }
      html += '</div>';

      // Divider
      html += '<div class="wt-shift-divider"></div>';

      // Смена 2
      html += '<div class="wt-shift-block wt-shift-block--2">';
      html += '<div class="wt-shift-title">'
        + '<span>Смена 2</span>'
        + (segs2.length > 0 ? '<span class="wt-shift-duty-label">рабочее время: <strong class="ct-mono-time">' + wtFmtMin(duty2) + '</strong></span>' : '')
        + '</div>';

      if (segs2.length === 0) {
        if (!_wtSettings.reportTime2) {
          html += '<div class="ct-empty-state">'
            + '<div class="ct-empty-title">Укажите время явки 2</div>'
            + '<div class="ct-empty-text">Откройте «Данные рейса» и введите время явки для смены 2, затем нажмите + для добавления сегмента.</div>'
            + '</div>';
        }
      } else {
        for (var i2 = 0; i2 < segs2.length; i2++) {
          var origIdx2 = _wtSegments.indexOf(segs2[i2]);
          html += wtRenderSegmentCard(segs2[i2], origIdx2, _wtFinalized);
        }
      }

      /* ── Информация по отдыху между сменами (Смена 2, только splitMode) ──
       *  Показывается когда duty1>0 (есть сегмент смены 1) и задано reportTime2.
       *  Промежуток = от конца смены 1 (shift1End = engineStop1 + postflight1)
       *                до явки перед 2-й сменой (reportTime2).
       *  • > 6 ч                     → «Необходим медицинский контроль!»
       *  • ≥ 10 ч (внебазовый) /
       *    ≥ 12 ч (базовый)          → «Время отдыха соблюдено! Это не разделенная полетная смена.»
       *  Заменяет прежнее «Нажмите + вверху карточки…» (Task 28).
       */
      if (duty1 > 0 && results && results.shift1End !== undefined) {
        var _report2Min = wtParseTime(_wtSettings.reportTime2);
        if (_report2Min !== null) {
          var restGapMin = wtDiffTime(results.shift1End, _report2Min);
          var restGapH   = restGapMin / 60;
          var minRestH   = (_wtSettings.restType === 'base') ? 12 : 10;
          var restLines = [];
          if (restGapH > 6) {
            restLines.push({ icon: window.ICONS['alert-triangle'], color: 'var(--color-danger)',
              text: 'Необходим медицинский контроль!' });
          }
          if (restGapH >= minRestH) {
            restLines.push({ icon: window.ICONS['check-circle'], color: 'var(--color-success)',
              text: 'Время отдыха соблюдено! Это не разделенная полетная смена.' });
          }
          if (restLines.length > 0) {
            html += '<div class="wt-rest-info">';
            for (var ri = 0; ri < restLines.length; ri++) {
              var rl = restLines[ri];
              html += '<div class="wt-rest-line" style="--rest-color:' + rl.color + ';">'
                + '<span class="wt-rest-icon">' + rl.icon + '</span>'
                + '<span>' + rl.text + '</span></div>';
            }
            html += '</div>';
          }
        }
      }
      html += '</div>';

      // Total stats — только до завершения рейса (после — карточка «Итоги рейса»)
      if (!_wtFinalized && _wtSegments.length > 0) {
        // Полётное/Лётное — только за смену 2 (если есть), иначе за смену 1.
        // Общий итог за обе смены — только в карточке «Итоги рейса».
        var segsForTotals = segs2.length > 0 ? segs2 : segs1;
        var totalFlight = 0;
        var totalAir    = 0;
        for (var k = 0; k < segsForTotals.length; k++) {
          totalFlight += segsForTotals[k].flightTime;
          totalAir    += segsForTotals[k].airTime;
        }
        var duty1Val = (results && results.duty1 !== undefined) ? results.duty1 : 0;
        var duty2Val = (results && results.duty2 !== undefined) ? results.duty2 : 0;
        var segs2Count = _wtSegments.filter(function(s) { return s.shift === 2; }).length;
        html += '<div class="wt-total-stats wt-total-stats--center">'
          + '<span><strong>Итого:</strong></span>'
          + '<span>Полётное <strong class="ct-mono-time">' + wtFmtMin(totalFlight) + '</strong></span>'
          + '<span class="wt-separator">|</span>'
          + '<span>Лётное <strong class="ct-mono-time">' + wtFmtMin(totalAir) + '</strong></span>'
          + '<span class="wt-separator">|</span>';
        if (segs2Count > 0) {
          // Сегмент смены 2 добавлен — показываем рабочее за обе смены + итого
          html += '<span>Раб. смены 1 <strong class="ct-mono-time">' + wtFmtMin(duty1Val) + '</strong></span>'
            + '<span class="wt-separator">|</span>'
            + '<span>Раб. смены 2 <strong class="ct-mono-time">' + wtFmtMin(duty2Val) + '</strong></span>'
            + '<span class="wt-separator">|</span>'
            + '<span>Итого рабочее <strong class="ct-mono-time">' + wtFmtMin(duty1Val + duty2Val) + '</strong></span>';
        } else {
          // Смены 2 ещё нет — показываем рабочее смены 1 и остаток до максимума
          var landingsSpl = wtGetLandingsFromSegments(_wtSegments);
          var nightSpl = wtIsNight(wtParseTime(_wtSettings.reportTime) || 0, _wtSettings.tzOffset || 0);
          var pilotMaxSpl = wtGetMaxDuty(_wtSettings.pilotExtra || 0, landingsSpl, nightSpl)
                          + (_wtSettings.extension || 0) * 60;
          var remainVal = pilotMaxSpl - duty1Val;
          if (remainVal < 0) remainVal = 0;
          html += '<span>Раб. смены 1 <strong class="ct-mono-time">' + wtFmtMin(duty1Val) + '</strong></span>'
            + '<span class="wt-separator">|</span>'
            + '<span>Осталось <strong class="ct-mono-time">' + wtFmtMin(remainVal) + '</strong></span>';
        }
        html += '</div>';
      }
    } else {
      // ─── Обычный режим ───
      if (_wtSegments.length === 0) {
        html += '<div class="ct-empty-state">'
          + '<div class="ct-empty-icon wt-opacity-muted">' + window.ICONS.routes + '</div>'
          + '<div class="ct-empty-title">Нет сегментов</div>'
          + '<div class="ct-empty-text">Нажмите + чтобы добавить первый сегмент полёта — запуск двигателей, взлёт, посадка, выключение.</div>'
          + '</div>';
      } else {
        html += wtRenderTimeline(_wtSegments, results);
        for (var i = 0; i < _wtSegments.length; i++) {
          html += wtRenderSegmentCard(_wtSegments[i], i, _wtFinalized);
        }
        // Inline-итоги — только до завершения рейса
        if (!_wtFinalized) {
          var totalFlight2 = 0;
          var totalAir2    = 0;
          for (var j = 0; j < _wtSegments.length; j++) {
            totalFlight2 += _wtSegments[j].flightTime;
            totalAir2    += _wtSegments[j].airTime;
          }
          // Рабочее время (до engineStop последнего сегмента, БЕЗ послеполётных работ)
          var dutyToStop2 = (results && results.dutyToStop !== undefined) ? results.dutyToStop : 0;
          html += '<div class="wt-total-stats wt-total-stats--center-no-mt">'
            + '<span><strong>Итого:</strong></span>'
            + '<span>Полётное <strong class="ct-mono-time">' + wtFmtMin(totalFlight2) + '</strong></span>'
            + '<span class="wt-separator">|</span>'
            + '<span>Лётное <strong class="ct-mono-time">' + wtFmtMin(totalAir2) + '</strong></span>'
            + '<span class="wt-separator">|</span>'
            + '<span>Рабочее <strong class="ct-mono-time">' + wtFmtMin(dutyToStop2) + '</strong></span>'
            + '</div>';
        }
      }
    }

    // Кнопки внизу: «Разделить смену» (только при 1 сегменте, не splitMode, не finalized) + «Завершить рейс»
    if (!_wtFinalized) {
      var showSplitBtn = (_wtSegments.length === 1 && !splitMode && !((_wtSettings.pilotExtra || 0) > 0 || (_wtSettings.cabinExtra || 0) > 0));
      html += '<div class="wt-card-actions">';
      if (showSplitBtn) {
        html += '<button class="wt-split-btn" id="wtSplitBtn">'
          + window.ICONS.split + ' Разделить смену</button>';
      }
      html += '<button class="btn-primary wt-btn-sm-compact" id="wtFinalizeBtn">'
        + window.ICONS.flag + ' Завершить рейс</button>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  /* ─── Timeline (динамическая шкала от явки до конца смены) ─── */

  function wtRenderTimeline(segments, results, isSplit) {
    var reportMin = wtParseTime(_wtSettings.reportTime);
    if (reportMin === null || segments.length === 0) return '';

    /* ── Длительность шкалы ──
     *  Обычный режим (не finalized):  от явки до engineStop посл. сегм. (БЕЗ postflight)
     *  Обычный режим (finalized):     results.duty (явка + весь duty = engineStop + postflight)
     *  Раздельный режим (и finalized, и не-finalized): от явки 1 до конца смены 2
     *    (если есть сегменты 2-й смены) — шкала ВКЛЮЧАЕТ rest-gap между сменами,
     *    чтобы обе смены оставались видны и после нажатия «Завершить рейс».
     *    Если явка 2 не задана → до конца смены 1.
     */
    var timelineDuration;
    var splitSegEnd = isSplit && !_wtFinalized; /* показывать «Конец сегмента» только до finalize */
    if (isSplit && results && results.duty1 !== undefined) {
      /* И finalized, И не-finalized — шкала от явки 1 до конца смены 2.
       * Если есть сегменты 2-й смены → до shift2End (= явка2 + duty2).
       * Если явка 2 задана, но сегментов 2-й ещё нет → до явки 2
       *   (чтобы был виден промежуток отдыха между сменами + маркер «Явка 2»).
       * Если явка 2 не задана → до конца смены 1.
       * ВАЖНО: после finalize шкала НЕ схлопывается в duty1+duty2 — иначе
       * сегменты 2-й смены (позиционируемые по абсолютному времени) уезжают
       * за 100% и становятся невидимыми. */
      var _r2min = wtParseTime(_wtSettings.reportTime2);
      var splitEnd;
      if (results.duty2 > 0 && results.shift2End !== undefined) {
        splitEnd = results.shift2End;
      } else if (_r2min !== null) {
        splitEnd = _r2min;
      } else {
        splitEnd = (reportMin + results.duty1) % 1440;
      }
      timelineDuration = wtDiffTime(reportMin, splitEnd);
    } else if (results && _wtFinalized) {
      timelineDuration = results.duty;
    } else {
      // Обычный режим, не finalized — шкала до engineStop (БЕЗ послеполётных работ)
      var lastStop = segments[segments.length - 1].engineStop;
      timelineDuration = wtDiffTime(reportMin, lastStop);
    }
    if (timelineDuration < 60) timelineDuration = 60; // минимум 1 ч
    var timelineEnd = reportMin + timelineDuration;

    /* ── Шаг сетки ── */
    var step;
    if (timelineDuration <= 180)       step = 30;
    else if (timelineDuration <= 420)  step = 60;
    else if (timelineDuration <= 900)  step = 120;
    else                               step = 180;

    /* ── Позиция относительно начала шкалы (поддержка перехода через полночь) ── */
    function timelineOffset(absMin) {
      var offset = absMin - reportMin;
      if (offset < 0) offset += 1440;
      return offset;
    }
    function timelinePct(absMin) {
      return (timelineOffset(absMin) / timelineDuration * 100);
    }

    /* ── Метка времени (без суффикса +1) ── */
    function fmtLabel(absMin) {
      var h = Math.floor(((absMin % 1440) + 1440) % 1440 / 60);
      var m = ((absMin % 1440) + 1440) % 1440 % 60;
      return (h < 10 ? '0' + h : '' + h) + ':' + (m < 10 ? '0' + m : '' + m);
    }

    var html = '<div class="wt-timeline-container">';

    /* ── Заголовок: метки сетки ── */
    html += '<div class="wt-timeline-header">';
    var gridMin = reportMin;
    var lastLabelPct = 0;
    while (gridMin < timelineEnd + 1) {
      var pct = timelinePct(gridMin);
      if (pct > 100.05) break;
      var clampedPct = Math.min(pct, 100);
      html += '<span class="wt-timeline-label-pos" style="--pct:' + clampedPct.toFixed(2) + '%;">'
        + fmtLabel(gridMin) + '</span>';
      lastLabelPct = clampedPct;
      gridMin += step;
    }
    // Метка «Конец» справа — если последняя метка сетки не у правого края (≥98%)
    if (lastLabelPct < 98) {
      html += '<span class="wt-timeline-label-end">'
        + fmtLabel(timelineEnd) + '</span>';
    }
    html += '</div>';

    /* ── Трек ── */
    html += '<div class="wt-timeline-track">';

    /* ── Линии сетки ── */
    var _gridPcts = [];          // collect drawn gridline positions
    gridMin = reportMin;
    while (gridMin < timelineEnd + 1) {
      var gPct = timelinePct(gridMin);
      if (gPct > 100.05) break;
      var gClamped = Math.min(gPct, 100);
      var isEdge = (gridMin === reportMin || gridMin >= timelineEnd);
      var isMidnight = (gridMin % 1440 === 0) && !isEdge;
      var gClass = 'wt-timeline-gridline';
      if (isMidnight) gClass += ' wt-timeline-gridline--midnight';
      if (isEdge) gClass += ' wt-timeline-gridline--edge';
      html += '<div class="' + gClass + '" style="--pct:' + gClamped.toFixed(2) + '%;"></div>';
      _gridPcts.push(gClamped);
      gridMin += step;
    }
    // Линия полуночи — может не совпасть с шагом сетки
    if (reportMin > 0) {
      var midnightOffset = (1440 - reportMin) % 1440;
      if (midnightOffset > 0 && midnightOffset < timelineDuration) {
        var midPct = (midnightOffset / timelineDuration * 100).toFixed(2);
        // Проверяем что ещё не рисовали на этом месте (±1% допуск)
        var _midNum = parseFloat(midPct);
        var _alreadyDrawn = _gridPcts.some(function(p){ return Math.abs(p - _midNum) < 1; });
        if (!_alreadyDrawn) {
          html += '<div class="wt-timeline-gridline wt-timeline-gridline--midnight" style="--pct:' + midPct + '%;"></div>';
        }
      }
    }

    /* ── Маркер «Время явки» (левый край шкалы) ── */
    html += '<div class="wt-timeline-marker wt-timeline-marker--report" style="--pct:0%;"'
      + ' title="Явка: ' + _wtSettings.reportTime + '"></div>';

    /* ── Маркер «Явка 2» (раздельный режим, до finalize) ──
     *  Позиционируется по проценту шкалы. Виден только когда задана явка 2,
     *  чтобы пользователь видел начало второй смены на графике. */
    if (isSplit && !_wtFinalized) {
      var _r2Min = wtParseTime(_wtSettings.reportTime2);
      if (_r2Min !== null) {
        var _r2Pct = Math.min(timelinePct(_r2Min), 100);
        html += '<div class="wt-timeline-marker wt-timeline-marker--report2" style="--pct:' + _r2Pct.toFixed(2) + '%;"'
          + ' title="Явка 2: ' + _wtSettings.reportTime2 + '"></div>';
      }
    }

    /* ── Сегменты и маркеры Запуск/Выключение ── */
    var COLORS = 5;
    for (var s = 0; s < segments.length; s++) {
      var seg = segments[s];
      var sPct  = timelinePct(seg.engineStart);
      var wPct  = Math.max(seg.flightTime / timelineDuration * 100, 0.3);
      var colorIdx = s % COLORS;
      var esPct = timelinePct(seg.engineStop);

      html += '<div class="wt-timeline-segment wt-segment-color-' + colorIdx + '"'
        + ' style="--pct:' + sPct.toFixed(3) + '%;--fill:' + wPct.toFixed(3) + '%;"'
        + ' title="Сег. ' + (s + 1) + ': ' + wtFormatTime(seg.engineStart) + '–' + wtFormatTime(seg.engineStop) + '">'
        + '</div>';
      // Task 48 #4: маркеры Запуск/Выключение убраны — инфо есть в карточках сегментов.
      // Цветные блоки сегментов (выше) показывают длительность полёта.
    }

    /* ── Маркер правого края — только в двух случаях:
     *   • split-режим до finalize  → «Конец сегмента» (фиолетовый, = явка1 + duty1)
     *     Позиционируется по проценту от шкалы (шкала может быть длиннее duty1,
     *     если уже есть сегменты 2-й смены — тогда маркер НЕ на 100%, а в точке
     *     конца смены 1).
     *   • после finalize (любой режим) → «Конец смены» (= report + duty, на 100%)
     *  В обычном режиме до finalize маркер НЕ рисуется — шкала заканчивается на engineStop
     *  последнего сегмента (маркер engine-stop уже отмечает эту точку).
     */
    if (splitSegEnd && results && results.duty1 !== undefined) {
      var seg1EndAbs = reportMin + results.duty1;
      var seg1EndMin = seg1EndAbs % 1440;
      var seg1EndPct = Math.min(timelinePct(seg1EndAbs), 100);
      html += '<div class="wt-timeline-marker wt-timeline-marker--seg-end" style="--pct:' + seg1EndPct.toFixed(2) + '%;"'
        + ' title="Конец сегмента: ' + wtFormatTime(seg1EndMin) + '"></div>';
    } else if (_wtFinalized) {
      var endMin = (reportMin + timelineDuration) % 1440;
      html += '<div class="wt-timeline-marker wt-timeline-marker--shift-end" style="--pct:100%;"'
        + ' title="Конец смены: ' + wtFormatTime(endMin) + '"></div>';
    }

    html += '</div>';
    html += '</div>';
    return html;
  }

  /* ─── Карточка сегмента ─── */

  function wtRenderSegmentCard(seg, idx, locked) {
    var colorIdx = idx % 5;
    var isLocked = locked || _wtFinalized;
    var lockedClass = isLocked ? ' wt-segment-card--locked' : '';
    var lockedAttr = locked ? ' data-locked="1"' : '';
    var html = '<div class="wt-segment-card' + lockedClass + '" data-idx="' + idx + '"' + lockedAttr + '>'
      + '<div class="wt-segment-info">'
      + '<div class="wt-seg-card-header">'
      + '<span class="wt-segment-color-' + colorIdx + ' wt-segment-color-dot"></span>'
      + '<strong class="ct-heading-md">Сегмент ' + (idx + 1) + '</strong>'
      + '</div>'
      + '<div class="wt-seg-card-times">'
      + '<span>Полётное: <strong class="ct-mono-time">' + wtFmtMin(seg.flightTime) + '</strong></span>'
      + '<span>Лётное: <strong class="ct-mono-time">' + wtFmtMin(seg.airTime) + '</strong></span>'
      + '</div>'
      + '<div class="wt-seg-card-flow">'
      + '<span class="ct-mono-time">' + wtFormatTime(seg.engineStart) + '</span>'
      + '<span>→</span>'
      + window.ICONS['plane-takeoff']
      + '<span class="ct-mono-time">' + wtFormatTime(seg.takeoff) + '</span>'
      + '<span>→</span>'
      + window.ICONS['plane-landing']
      + '<span class="ct-mono-time">' + wtFormatTime(seg.landing) + '</span>'
      + '<span>→</span>'
      + '<span class="ct-mono-time">' + wtFormatTime(seg.engineStop) + '</span>'
      + '</div>'
      + '</div>';
    if (!isLocked) {
      html += '<button class="wt-delete-segment" data-idx="' + idx + '" aria-label="Удалить сегмент ' + (idx + 1) + '">'
        + window.ICONS.trash + '</button>';
    }
    html += '</div>';
    return html;
  }

  /* ─── Карточка «Нарушения» (compact, до finalize) — Task 49 #5 ─── */

  function wtRenderWarningsOnly(results) {
    var html = '<div class="app-card wt-card--warnings-only">';
    html += '<div class="wt-warning-block wt-flex-col-gap">';
    html += '<div class="wt-warning-header">'
      + window.ICONS['alert-triangle'] + ' <strong>Нарушения:</strong></div>';
    for (var i = 0; i < results.warnings.length; i++) {
      html += '<div class="wt-indent">' + results.warnings[i] + '</div>';
    }
    html += '</div>';
    html += '</div>';
    return html;
  }

  /* ─── Карточка «Итоги рейса» ─── */

  function wtRenderResultsCard(results) {
    var allOk = results.warnings.length === 0;

    var html = '<div class="app-card wt-card--results' + (allOk ? ' wt-card--all-ok' : '') + '">';
    html += '<div class="app-card-header">';
    html += '<div class="wt-flex-center-gap">';
    html += '<div class="wt-card-icon wt-card-icon--results">' + window.ICONS.gauge + '</div>';
    html += '<h2 class="ct-heading-lg">Итоги рейса</h2>';
    html += '</div>';
    html += '<div class="wt-flex-center-gap-sm">';
    if (allOk) {
      html += '<span class="wt-checkmark-circle">' + window.ICONS['check-circle'] + '</span>';
    }
    html += '<button class="icon-btn wt-btn-share" id="wtShareBtn" aria-label="Поделиться">'
      + window.ICONS.share + '</button>';
    html += '</div>';
    html += '</div>';

    html += '<div class="wt-results-grid wt-results-border">';
    // Строка 1 — Рабочее время (полное) — на всю ширину
    var dutyLabel = results.splitMode ? 'Рабочее время (полное за обе смены)' : 'Фактическое рабочее время';
    html += wtResultItemFull(window.ICONS.timer, dutyLabel, wtFmtMin(results.duty));
    // Строка 2 — Полётное + Лётное (итог за обе смены)
    html += wtResultItem(window.ICONS.plane, 'Полётное время', wtFmtMin(results.totalFlight));
    html += wtResultItem(window.ICONS['circle-dot'], 'Лётное время', wtFmtMin(results.totalAir));
    // Строка 3 — Минимальный отдых + Окончание отдыха
    html += wtResultItem(window.ICONS.moon, 'Минимальный отдых', results.restHours + ' ч');
    html += wtResultItem(window.ICONS.clock, 'Окончание отдыха', wtFormatTime(results.restEnd));
    html += '</div>';

    if (!allOk) {
      html += '<div class="wt-warning-block wt-flex-col-gap">';
      html += '<div class="wt-warning-header">'
        + window.ICONS['alert-triangle'] + ' <strong>Нарушения:</strong></div>';
      for (var i = 0; i < results.warnings.length; i++) {
        html += '<div class="wt-indent">' + results.warnings[i] + '</div>';
      }
      html += '</div>';
    } else {
      html += '<div class="wt-ok-block wt-flex-center-gap">'
        + window.ICONS['check-circle'] + ' <span>Нарушений не обнаружено.</span></div>';
    }

    html += '</div>';
    return html;
  }

  function wtResultItem(icon, label, value) {
    return '<div class="wt-result-item">'
      + '<div class="wt-result-item-label">' + icon + ' ' + label + '</div>'
      + '<div class="wt-result-item-value">' + value + '</div>'
      + '</div>';
  }

  // Полноширинный пункт (занимает всю строку сетки)
  function wtResultItemFull(icon, label, value) {
    return '<div class="wt-result-item wt-span-full">'
      + '<div class="wt-result-item-label">' + icon + ' ' + label + '</div>'
      + '<div class="wt-result-item-value">' + value + '</div>'
      + '</div>';
  }

  /* ═══════════════════════════════════════════════════════════════
     Bottom-sheet: единый (контракт хоста — один sheet на всё)
     Режимы: 'settings' (данные рейса) | 'segment' (новый сегмент)
     ═══════════════════════════════════════════════════════════════ */

  function wtCloseSheet() {
    // Auto-save segment when closing in segment mode
    if (_wtSheetMode === 'segment' && !_wtSegmentJustSaved) {
      if (wtTryAutoSaveSegment()) {
        app.showToast('Сегмент сохранён');
        wtRenderAll();
      }
    }
    _wtSegmentJustSaved = false;
    _wtEditSegmentIdx = -1;

    var overlay = document.getElementById('wtSettingsOverlay');
    var sheet   = document.getElementById('wtSettingsSheet');
    if (overlay) overlay.classList.remove('open');
    if (sheet)   sheet.classList.remove('open');
  }

  function wtOpenFlightSettings() {
    _wtSheetMode = 'settings';
    var overlay  = document.getElementById('wtSettingsOverlay');
    var sheet    = document.getElementById('wtSettingsSheet');
    var closeBtn = document.getElementById('wtCloseSettingsBtn');
    var titleEl  = document.getElementById('wtSettingsTitle');
    var saveBtn  = document.getElementById('wtSaveSegmentBtn');
    var actionsEl = sheet ? sheet.querySelector('.wt-dialog-actions') : null;
    if (!overlay || !sheet) return;

    if (closeBtn) closeBtn.innerHTML = window.ICONS.x || window.ICONS.close;
    if (titleEl) titleEl.textContent = 'Данные рейса';
    if (saveBtn) saveBtn.textContent = 'Сохранить';
    if (actionsEl) actionsEl.style.display = 'none'; // Hide Save/Close — auto-save on change

    wtRenderFlightSettingsContent();

    overlay.classList.add('open');
    sheet.classList.add('open');
  }

  function wtCloseFlightSettings() {
    wtCloseSheet();
  }

  function wtRenderFlightSettingsContent() {
    var el = document.getElementById('wtSettingsContent');
    if (!el) return;

    var s = _wtSettings;
    el.innerHTML = ''
      + '<div class="wt-settings-groups">'

      + wtSettingsGroup(window.ICONS.plane, 'Лётный экипаж (ЛЭ)',
          '<label class="wt-field-label">Доп. члены</label>'
          + wtSelect('wtPilotExtra', [['0','Нет'],['1','+1 пилот'],['2','+2 пилота']], String(s.pilotExtra)))

      + wtSettingsGroup(window.ICONS.users, 'Кабинный экипаж (КЭ)',
          '<label class="wt-field-label">Доп. члены</label>'
          + wtSelect('wtCabinExtra', [['0','Нет'],['1','+1 бортпроводник'],['2','+2 бортпроводника']], String(s.cabinExtra)))

      + wtSettingsGroup(window.ICONS.timer, 'Продление КВС',
          '<label class="wt-field-label">Продление</label>'
          + wtSelect('wtExtension',
              (s.pilotExtra > 0 || s.cabinExtra > 0)
                ? [['0','Без продления'],['3','+3 часа']]
                : [['0','Без продления'],['2','+2 часа']],
              String(s.extension)))

      + wtSettingsGroup(window.ICONS.moon, 'Отдых',
          '<label class="wt-field-label">Тип отдыха</label>'
          + wtSelect('wtRestType', [['base','Базовый'],['nonbase','Внебазовый']], s.restType))

      + wtSettingsGroup(window.ICONS.clock, 'Начало смены',
          '<div class="wt-field-row">'
          + '<div class="wt-flex-fill">'
          + '<label class="wt-field-label">Явка (UTC, HH:MM)</label>'
          + '<input id="wtReportTime" type="time" class="wt-field-input" value="' + s.reportTime + '">'
          + '</div>'
          + '<div class="wt-field-tz">'
          + '<label class="wt-field-label">Час. пояс базирования</label>'
          + wtTzSelect('wtTzOffset', s.tzOffset)
          + '</div>'
          + '</div>')

      + (s.splitMode ? wtSettingsGroup(window.ICONS.split, 'Смена 2 (раздельная)',
          '<div class="wt-field-row">'
          + '<div class="wt-flex-fill">'
          + '<label class="wt-field-label">Явка 2 (UTC, HH:MM)</label>'
          + '<input id="wtReportTime2" type="time" class="wt-field-input" value="' + (s.reportTime2 || '') + '">'
          + '</div>'
          + '</div>') : '')

      + wtSettingsGroup(window.ICONS.timer, 'Послеполётные работы (мин)',
          '<div class="wt-field-row">'
          + '<div class="wt-flex-fill">'
          + '<label class="wt-field-label">Смена 1</label>'
          + wtSelect('wtPostflight1', [['10','10'],['20','20'],['30','30'],['40','40']], String(s.postflight1 || 30))
          + '</div>'
          + '<div class="wt-flex-fill">'
          + '<label class="wt-field-label">Смена 2</label>'
          + wtSelect('wtPostflight2', [['10','10'],['20','20'],['30','30'],['40','40']], String(s.postflight2 || 30))
          + '</div>'
          + '</div>')

      + '</div>'

      // Объединённая рамка-предупреждение: Посадки + UTC-info
      + '<div class="wt-settings-group wt-settings-group--info">'
      + '<div class="wt-settings-info-text">'
      + '<span class="wt-info-inline-icon wt-info-icon-adjust">' + window.ICONS['plane-landing'] + '</span>'
      + '<div class="wt-settings-info-content">'
      + '<div><strong>Посадки</strong> определяются автоматически по количеству сегментов.</div>'
      + '<div>Явка хранится в UTC. День/ночь рассчитывается по местному времени.</div>'
      + '<div>День/ночь и макс. рабочее время рассчитываются по Явке 1.</div>'
      + '</div>'
      + '</div>'
      + '</div>';
  }

  function wtTzSelect(id, selected) {
    var opts = [
      [0, 'UTC'], [2, 'UTC+2'], [3, 'UTC+3'], [4, 'UTC+4'],
      [5, 'UTC+5'], [6, 'UTC+6'], [7, 'UTC+7'], [8, 'UTC+8'],
      [9, 'UTC+9'], [10, 'UTC+10'], [11, 'UTC+11'], [12, 'UTC+12']
    ];
    var html = '<select id="' + id + '" class="wt-field-input">';
    for (var i = 0; i < opts.length; i++) {
      var val = String(opts[i][0]);
      html += '<option value="' + val + '"' + (val === String(selected) ? ' selected' : '') + '>' + opts[i][1] + '</option>';
    }
    html += '</select>';
    return html;
  }

  /* ═══════════════════════════════════════════════════════════════
     Bottom-sheet: режим «Добавить сегмент»
     Использует тот же sheet, что и настройки (контракт хоста)
     ═══════════════════════════════════════════════════════════════ */

  function wtOpenSegmentSheet(shift) {
    _wtSheetMode = 'segment';
    _wtEditSegmentIdx = -1;
    if (shift === 2) { _wtAddingShift = 2; } else { _wtAddingShift = 1; }
    var overlay  = document.getElementById('wtSettingsOverlay');
    var sheet    = document.getElementById('wtSettingsSheet');
    var closeBtn = document.getElementById('wtCloseSettingsBtn');
    var titleEl  = document.getElementById('wtSettingsTitle');
    var saveBtn  = document.getElementById('wtSaveSegmentBtn');
    var actionsEl = sheet ? sheet.querySelector('.wt-dialog-actions') : null;
    if (!overlay || !sheet) return;

    if (closeBtn) closeBtn.innerHTML = window.ICONS.x || window.ICONS.close;
    if (titleEl) titleEl.textContent = (shift === 2) ? 'Новый сегмент смены 2' : 'Новый сегмент';
    if (saveBtn) saveBtn.textContent = 'Сохранить сегмент';
    if (actionsEl) actionsEl.style.display = 'flex'; // Show Save Segment button

    wtRenderSegmentContent();

    overlay.classList.add('open');
    sheet.classList.add('open');
  }

  function wtCloseSegmentSheet() {
    wtCloseSheet();
  }

  /* ═══════════════════════════════════════════════════════════════
     Bottom-sheet: режим «Редактирование сегмента»
     Тот же sheet, с предзаполнением существующими временами
     ═══════════════════════════════════════════════════════════════ */

  function wtOpenEditSegmentSheet(idx) {
    if (idx < 0 || idx >= _wtSegments.length) return;
    _wtSheetMode = 'segment';
    _wtEditSegmentIdx = idx;
    var overlay  = document.getElementById('wtSettingsOverlay');
    var sheet    = document.getElementById('wtSettingsSheet');
    var closeBtn = document.getElementById('wtCloseSettingsBtn');
    var titleEl  = document.getElementById('wtSettingsTitle');
    var saveBtn  = document.getElementById('wtSaveSegmentBtn');
    var actionsEl = sheet ? sheet.querySelector('.wt-dialog-actions') : null;
    if (!overlay || !sheet) return;

    if (closeBtn) closeBtn.innerHTML = window.ICONS.x || window.ICONS.close;
    if (titleEl) titleEl.textContent = 'Редактирование сегмента';
    if (saveBtn) saveBtn.textContent = 'Сохранить';
    if (actionsEl) actionsEl.style.display = 'flex';

    wtRenderSegmentContent(_wtSegments[idx]);

    overlay.classList.add('open');
    sheet.classList.add('open');
  }

  function wtRenderSegmentContent(prefill) {
    var el = document.getElementById('wtSettingsContent');
    if (!el) return;

    var defaultStart, defaultTakeoff, defaultLanding, defaultStop;

    if (prefill) {
      // Edit mode: pre-fill with existing segment data
      defaultStart  = wtFormatTime(prefill.engineStart);
      defaultTakeoff = wtFormatTime(prefill.takeoff);
      defaultLanding = wtFormatTime(prefill.landing);
      defaultStop   = wtFormatTime(prefill.engineStop);
    } else {
      // Smart defaults: первый сегмент — явка + 60 мин (не менее 1 ч от явки до запуска)
      var report = wtParseTime(_wtSettings.reportTime);
      defaultStart = report !== null ? wtFormatTime((report + 60) % 1440) : '10:00';
      defaultTakeoff = report !== null ? wtFormatTime((report + 75) % 1440) : '10:30';
      // Task 48 #3: default duration 3ч→0ч (takeoff+120=landing, landing+15=stop)
      defaultLanding = report !== null ? wtFormatTime((report + 195) % 1440) : '12:45';
      defaultStop  = report !== null ? wtFormatTime((report + 210) % 1440) : '13:00';

      if (_wtAddingShift === 2 && _wtSettings.splitMode && _wtSettings.reportTime2) {
        // Smart defaults для сегмента смены 2: явка 2 + 60 мин как база
        var report2 = wtParseTime(_wtSettings.reportTime2);
        if (report2 !== null) {
          defaultStart   = wtFormatTime((report2 + 60) % 1440);
          defaultTakeoff = wtFormatTime((report2 + 75) % 1440);
          defaultLanding = wtFormatTime((report2 + 255) % 1440);
          defaultStop    = wtFormatTime((report2 + 270) % 1440);
        }
      } else if (_wtSegments.length > 0) {
        var lastSeg = _wtSegments[_wtSegments.length - 1];
        // Start 30 min after last engine stop
        var startMin = lastSeg.engineStop + 30;
        defaultStart = wtFormatTime(startMin % 1440);
        defaultTakeoff = wtFormatTime((startMin + 15) % 1440);
        // Task 48 #3: default duration 3ч→0ч для последующих сегментов
        defaultLanding = wtFormatTime((startMin + 135) % 1440);
        defaultStop  = wtFormatTime((startMin + 150) % 1440);
      }
    }

    el.innerHTML = ''
      + '<div class="wt-segment-inputs">'
      + wtTimeInput('wtEngineStart', 'Запуск двигателей', defaultStart)
      + wtTimeInput('wtTakeoff',     'Взлёт',             defaultTakeoff)
      + wtTimeInput('wtLanding',     'Посадка',           defaultLanding)
      + wtTimeInput('wtEngineStop',  'Выкл. двигателей',  defaultStop)
      + '</div>';
  }

  /* ─── Общие хелперы для рендера ─── */

  function wtSettingsGroup(icon, title, body) {
    return '<div class="wt-settings-group">'
      + '<div class="wt-settings-group-title">' + icon + ' ' + title + '</div>'
      + body
      + '</div>';
  }

  function wtSelect(id, options, selected) {
    var html = '<select id="' + id + '" class="wt-field-input">';
    for (var i = 0; i < options.length; i++) {
      var val  = options[i][0];
      var text = options[i][1];
      html += '<option value="' + val + '"' + (val === selected ? ' selected' : '') + '>' + text + '</option>';
    }
    html += '</select>';
    return html;
  }

  function wtTimeInput(id, label, placeholder) {
    return '<div><label class="wt-field-label">' + label + '</label>'
      // Task 48 #1: step="60" для iPad compatibility
      + '<input id="' + id + '" type="time" step="60" class="wt-field-input" value="' + placeholder + '">'
      + '</div>';
  }

  /* ─── Сохранение настроек рейса ─── */

  function wtVal(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  function wtSaveFlightSettings() {
    var pilotExtra = parseInt(wtVal('wtPilotExtra'), 10) || 0;
    var cabinExtra = parseInt(wtVal('wtCabinExtra'), 10) || 0;
    var extension  = parseInt(wtVal('wtExtension'), 10) || 0;
    // Task 32: сбросить продление если оно недопустимо при текущих доп. членах
    var _hasExtra = (pilotExtra > 0 || cabinExtra > 0);
    if (!_hasExtra && extension === 3) extension = 0;
    if (_hasExtra && extension === 2) extension = 0;
    var restType   = wtVal('wtRestType')   || 'nonbase';
    var reportTime = wtVal('wtReportTime') || '';
    var tzOffset   = parseInt(wtVal('wtTzOffset'), 10);
    if (isNaN(tzOffset)) tzOffset = 3;
    var postflight1 = parseInt(wtVal('wtPostflight1'), 10) || 30;
    var postflight2 = parseInt(wtVal('wtPostflight2'), 10) || 30;
    var reportTime2El = document.getElementById('wtReportTime2');
    var reportTime2 = reportTime2El ? reportTime2El.value : (_wtSettings.reportTime2 || '');

    _wtSettings = { pilotExtra: pilotExtra, cabinExtra: cabinExtra,
      extension: extension, restType: restType,
      reportTime: reportTime, tzOffset: tzOffset, postflight1: postflight1, postflight2: postflight2,
      splitMode: _wtSettings.splitMode || false, reportTime2: reportTime2 };
    wtSaveSettings(_wtSettings);

    wtCloseFlightSettings();
    app.showToast('Настройки сохранены');
    _wtFinalized = false;
    wtSaveFinalized(false);
    wtRenderAll();
  }

  /* ─── Auto-save on dropdown/input change (settings mode) ─── */

  function wtAutoSaveSetting() {
    var pilotExtra = parseInt(wtVal('wtPilotExtra'), 10) || 0;
    var cabinExtra = parseInt(wtVal('wtCabinExtra'), 10) || 0;
    var extension  = parseInt(wtVal('wtExtension'), 10) || 0;
    // Task 32: сбросить продление если оно недопустимо при текущих доп. членах
    var _hasExtra = (pilotExtra > 0 || cabinExtra > 0);
    if (!_hasExtra && extension === 3) extension = 0;
    if (_hasExtra && extension === 2) extension = 0;
    var restType   = wtVal('wtRestType')   || 'nonbase';
    var reportTime = wtVal('wtReportTime') || '';
    var tzOffset   = parseInt(wtVal('wtTzOffset'), 10);
    if (isNaN(tzOffset)) tzOffset = 3;
    var postflight1 = parseInt(wtVal('wtPostflight1'), 10) || 30;
    var postflight2 = parseInt(wtVal('wtPostflight2'), 10) || 30;
    var reportTime2El = document.getElementById('wtReportTime2');
    var reportTime2 = reportTime2El ? reportTime2El.value : (_wtSettings.reportTime2 || '');

    _wtSettings = { pilotExtra: pilotExtra, cabinExtra: cabinExtra,
      extension: extension, restType: restType,
      reportTime: reportTime, tzOffset: tzOffset, postflight1: postflight1, postflight2: postflight2,
      splitMode: _wtSettings.splitMode || false, reportTime2: reportTime2 };
    wtSaveSettings(_wtSettings);
    _wtFinalized = false;
    wtSaveFinalized(false);

    // Update main screen without closing the sheet (Task 28 убрал wtRenderFlightSettingsSummary)
    wtRenderAll();
    // Task 33: перерисовать содержимое sheet — обновить опции продления при смене доп. членов
    wtRenderFlightSettingsContent();
  }

  /* ─── Автосохранение сегмента при закрытии (тихое) ─── */

  function wtTryAutoSaveSegment() {
    var engineStart = wtParseTime(wtVal('wtEngineStart'));
    var takeoff     = wtParseTime(wtVal('wtTakeoff'));
    var landing     = wtParseTime(wtVal('wtLanding'));
    var engineStop  = wtParseTime(wtVal('wtEngineStop'));

    if (engineStart === null || takeoff === null || landing === null || engineStop === null) return false;

    var flightTime = wtDiffTime(engineStart, engineStop);
    var airTime    = wtDiffTime(takeoff, landing);

    if (flightTime <= 0 || airTime <= 0) return false;
    if (wtDiffTime(engineStart, takeoff) < 0) return false;
    if (wtDiffTime(takeoff, landing) < 0) return false;
    if (wtDiffTime(landing, engineStop) < 0) return false;

    // Валидация: не менее 1 ч от явки до запуска двигателей
    var _reportAuto = (_wtAddingShift === 2 && _wtSettings.splitMode)
      ? wtParseTime(_wtSettings.reportTime2)
      : wtParseTime(_wtSettings.reportTime);
    if (_reportAuto !== null && wtDiffTime(_reportAuto, engineStart) < 60) return false;

    if (wtCheckOverlap(engineStart, engineStop, _wtSegments, _wtEditSegmentIdx)) return false;

    // Валидация: сегмент 2 должен начинаться после engineStop сегмента 1
    if (_wtSettings.splitMode && _wtAddingShift === 2) {
      var segs1 = _wtSegments.filter(function(s) { return !s.shift || s.shift === 1; });
      if (segs1.length > 0) {
        var shift1End = segs1[segs1.length - 1].engineStop;
        if (wtDiffTime(shift1End, engineStart) < 0) return false;
      }
    }

    var segData = { engineStart: engineStart, takeoff: takeoff,
      landing: landing, engineStop: engineStop,
      flightTime: flightTime, airTime: airTime };
    if (_wtSettings.splitMode) {
      segData.shift = _wtAddingShift;
    }

    if (_wtEditSegmentIdx >= 0) {
      _wtSegments[_wtEditSegmentIdx] = segData;
    } else {
      _wtSegments.push(segData);
    }
    _wtEditSegmentIdx = -1;
    _wtAddingShift = 1;
    _wtFinalized = false;
    wtSaveSegments(_wtSegments);
    wtSaveFinalized(false);
    return true;
  }

  /* ─── Сохранение сегмента ─── */

  function wtSaveSegment() {
    var engineStart = wtParseTime(wtVal('wtEngineStart'));
    var takeoff     = wtParseTime(wtVal('wtTakeoff'));
    var landing     = wtParseTime(wtVal('wtLanding'));
    var engineStop  = wtParseTime(wtVal('wtEngineStop'));

    if (engineStart === null || takeoff === null || landing === null || engineStop === null) {
      app.showToast('Заполните все времена сегмента (ЧЧ:ММ)');
      return;
    }

    var flightTime = wtDiffTime(engineStart, engineStop);
    var airTime    = wtDiffTime(takeoff, landing);

    if (flightTime <= 0 || airTime <= 0) {
      app.showToast('Некорректный порядок времени');
      return;
    }
    if (wtDiffTime(engineStart, takeoff) < 0) {
      app.showToast('Взлёт не может быть раньше запуска двигателей');
      return;
    }
    if (wtDiffTime(takeoff, landing) < 0) {
      app.showToast('Посадка не может быть раньше взлёта');
      return;
    }
    if (wtDiffTime(landing, engineStop) < 0) {
      app.showToast('Выкл. двигателей не может быть раньше посадки');
      return;
    }

    // Task 48 #5: блокирующая валидация 1ч убрана — теперь non-blocking warning
    // в wtCalcSingleShift (строка 183), показывается в «Нарушения:»
    if (wtCheckOverlap(engineStart, engineStop, _wtSegments, _wtEditSegmentIdx)) {
      app.showToast('Сегмент пересекается по времени с существующим');
      return;
    }

    // Валидация: сегмент 2 должен начинаться после engineStop сегмента 1
    if (_wtSettings.splitMode && _wtAddingShift === 2) {
      var segs1 = _wtSegments.filter(function(s) { return !s.shift || s.shift === 1; });
      if (segs1.length > 0) {
        var shift1End = segs1[segs1.length - 1].engineStop;
        if (wtDiffTime(shift1End, engineStart) < 0) {
          app.showToast('Сегмент 2 должен начинаться после окончания смены 1');
          return;
        }
      }
    }

    var segData = { engineStart: engineStart, takeoff: takeoff,
      landing: landing, engineStop: engineStop,
      flightTime: flightTime, airTime: airTime };
    if (_wtSettings.splitMode) {
      segData.shift = _wtAddingShift;
    }

    if (_wtEditSegmentIdx >= 0) {
      _wtSegments[_wtEditSegmentIdx] = segData;
    } else {
      _wtSegments.push(segData);
    }
    _wtEditSegmentIdx = -1;
    _wtAddingShift = 1;
    _wtFinalized = false;
    wtSaveSegments(_wtSegments);
    wtSaveFinalized(false);

    _wtSegmentJustSaved = true;
    wtCloseSheet();
    app.showToast('Сегмент сохранён');
    wtRenderAll();
  }

  function wtCheckOverlap(newStart, newStop, segments, excludeIdx) {
    var ns = newStart;
    var ne = newStop < newStart ? newStop + 1440 : newStop;
    for (var i = 0; i < segments.length; i++) {
      if (i === excludeIdx) continue;
      var es = segments[i].engineStart;
      var ee = segments[i].engineStop < segments[i].engineStart
        ? segments[i].engineStop + 1440 : segments[i].engineStop;
      if (ns < ee && ne > es) return true;
    }
    return false;
  }

  /* ─── Удаление / Финализация ─── */

  function wtDeleteSegment(idx) {
    if (idx < 0 || idx >= _wtSegments.length) return;
    _wtSegments.splice(idx, 1);
    _wtFinalized = false;
    wtSaveSegments(_wtSegments);
    wtSaveFinalized(false);
    wtRenderAll();
  }

  function wtFinalize() {
    if (_wtSegments.length === 0) {
      app.showToast('Нет ни одного сегмента');
      return;
    }
    var reportMin = wtParseTime(_wtSettings.reportTime);
    if (reportMin === null) {
      app.showToast('Укажите время явки в настройках рейса');
      return;
    }
    if (_wtSettings.splitMode) {
      // Завершение возможно и без смены 2 (только по смене 1).
      // Явка 2 не обязательна если нет сегментов смены 2.
    }
    _wtFinalized = true;
    wtSaveFinalized(true);
    app.showToast('Расчёт завершён');
    wtRenderAll();
  }

  /* ─── Включить раздельный режим (splitMode) ─── */

  function wtSplitShift() {
    if (_wtSegments.length !== 1) {
      app.showToast('Разделение возможно только при одном сегменте');
      return;
    }
    // Проверка: для увеличенного состава экипажа разделение не применяется
    if ((_wtSettings.pilotExtra || 0) > 0 || (_wtSettings.cabinExtra || 0) > 0) {
      app.showToast('Для увеличенного состава экипажа разделение полетной смены не применяется!');
      return;
    }
    _wtSettings.splitMode = true;
    _wtSettings.reportTime2 = '';
    // Маркируем существующий сегмент как shift 1
    _wtSegments[0].shift = 1;
    _wtFinalized = false;
    wtSaveFinalized(false);
    wtSaveSettings(_wtSettings);
    wtSaveSegments(_wtSegments);
    app.showToast('Раздельный режим включён — укажите явку 2 в данных рейса');
    wtRenderAll();
  }

  /* ─── Share ─── */

  function wtShareResults() {
    var results = wtCalcResults(_wtSegments, _wtSettings);
    if (!results) return;

    var landings = wtGetLandingsFromSegments(_wtSegments);

    var lines = [
      '\u2708 РАСЧЁТ РАБОЧЕГО ВРЕМЕНИ ЭКИПАЖА',
      '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
      'Явка: ' + _wtSettings.reportTime,
      'Ночная смена: ' + (results.night ? 'Да' : 'Нет'),
      'Посадки: ' + (landings === '1-2' ? '1–2' : '3–4') + ' (авто, ' + _wtSegments.length + ' сегм.)',
      'Продление КВС: ' + (_wtSettings.extension > 0 ? '+' + _wtSettings.extension + ' ч' : 'Нет'),
      ''
    ];

    if (results.splitMode) {
      // ─── Раздельный режим ───
      var segs1 = _wtSegments.filter(function(s) { return !s.shift || s.shift === 1; });
      var segs2 = _wtSegments.filter(function(s) { return s.shift === 2; });

      lines.push('СМЕНА 1 (явка ' + _wtSettings.reportTime + '):');
      for (var i1 = 0; i1 < segs1.length; i1++) {
        var seg1 = segs1[i1];
        lines.push('  Сегмент: '
          + wtFormatTime(seg1.engineStart) + '–' + wtFormatTime(seg1.engineStop)
          + ' | Полётное: ' + wtFmtMin(seg1.flightTime)
          + ' | Лётное: ' + wtFmtMin(seg1.airTime));
      }
      lines.push('  Рабочее время смены 1: ' + wtFmtMin(results.duty1 || 0));
      lines.push('');

      lines.push('СМЕНА 2 (явка ' + _wtSettings.reportTime2 + '):');
      for (var i2 = 0; i2 < segs2.length; i2++) {
        var seg2 = segs2[i2];
        lines.push('  Сегмент: '
          + wtFormatTime(seg2.engineStart) + '–' + wtFormatTime(seg2.engineStop)
          + ' | Полётное: ' + wtFmtMin(seg2.flightTime)
          + ' | Лётное: ' + wtFmtMin(seg2.airTime));
      }
      lines.push('  Рабочее время смены 2: ' + wtFmtMin(results.duty2 || 0));
      lines.push('');

      lines.push('Итого рабочее время: ' + wtFmtMin(results.duty) + ' (смена 1 + смена 2)');
      lines.push('Полётное время: ' + wtFmtMin(results.totalFlight));
      lines.push('Лётное время: ' + wtFmtMin(results.totalAir));
      lines.push('Окончание смены 2: ' + wtFormatTime(results.shiftEnd));
      lines.push('Минимальный отдых: ' + results.restHours + ' ч');
      lines.push('Окончание отдыха: ' + wtFormatTime(results.restEnd));
    } else {
      // ─── Обычный режим ───
      for (var i = 0; i < _wtSegments.length; i++) {
        var seg = _wtSegments[i];
        lines.push('Сегмент ' + (i + 1) + ': '
          + wtFormatTime(seg.engineStart) + '–' + wtFormatTime(seg.engineStop)
          + ' | Полётное: ' + wtFmtMin(seg.flightTime)
          + ' | Лётное: ' + wtFmtMin(seg.airTime));
      }

      lines.push('');
      lines.push('Фактическое рабочее время: ' + wtFmtMin(results.duty));
      lines.push('Полётное время: ' + wtFmtMin(results.totalFlight));
      lines.push('Лётное время: ' + wtFmtMin(results.totalAir));
      lines.push('Окончание смены: ' + wtFormatTime(results.shiftEnd));
      lines.push('Минимальный отдых: ' + results.restHours + ' ч');
      lines.push('Окончание отдыха: ' + wtFormatTime(results.restEnd));
    }

    lines.push('');

    if (results.warnings.length > 0) {
      lines.push('\u26A0 НАРУШЕНИЯ FTL:');
      for (var j = 0; j < results.warnings.length; j++) {
        lines.push('  \u2022 ' + results.warnings[j]);
      }
    } else {
      lines.push('\u2705 Нарушений не обнаружено. Соответствие нормам FTL.');
    }

    lines.push('');
    lines.push("Pilot's Tool \u2014 Nordwind Airlines");

    var text = lines.join('\n');

    if (navigator.share) {
      navigator.share({ title: 'Расчёт рабочего времени', text: text })
        .catch(function() { wtCopyToClipboard(text); });
    } else {
      wtCopyToClipboard(text);
    }
  }

  function wtCopyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function() { app.showToast('Результаты скопированы'); })
        .catch(function() { app.showToast('Не удалось скопировать'); });
    } else {
      app.showToast('Не удалось скопировать');
    }
  }

  /* ─── Header dropdown menu ─── */

  var _wtMenuOpen = false;

  function wtToggleHeaderMenu() {
    if (_wtMenuOpen) {
      wtCloseHeaderMenu();
    } else {
      wtOpenHeaderMenu();
    }
  }

  function wtOpenHeaderMenu() {
    // Remove existing menu if any
    wtCloseHeaderMenu();

    var menu = document.createElement('div');
    menu.className = 'wt-header-menu';
    menu.id = 'wtHeaderMenu';
    menu.innerHTML = '<button class="wt-header-menu-item" data-action="reset">'
      + window.ICONS['rotate-ccw'] + ' Очистить рейс</button>';

    // Full-screen overlay — click closes the menu
    var backdrop = document.createElement('div');
    backdrop.id = 'wtHeaderMenuBackdrop';
    backdrop.className = 'wt-header-menu-backdrop';
    backdrop.addEventListener('click', function() { wtCloseHeaderMenu(); });

    document.body.appendChild(backdrop);
    document.body.appendChild(menu);
    _wtMenuOpen = true;

    // Position near the header right button
    var btn = document.getElementById('wtHeaderMenuBtn');
    if (btn) {
      var rect = btn.getBoundingClientRect();
      menu.style.top = (rect.bottom + 4) + 'px';
      menu.style.right = (window.innerWidth - rect.right) + 'px';
    }

    // Animate in
    requestAnimationFrame(function() {
      backdrop.classList.add('open');
      menu.classList.add('open');
    });

    // Click handler inside menu
    menu.addEventListener('click', function(e) {
      var item = e.target.closest('[data-action]');
      if (!item) return;
      if (item.dataset.action === 'reset') {
        wtCloseHeaderMenu();
        app.showConfirm(
          'Удалить все сегменты и сбросить расчёт?',
          function() { wtReset(); },
          'Очистить'
        );
      }
    });
  }

  function wtCloseHeaderMenu() {
    var menu = document.getElementById('wtHeaderMenu');
    var backdrop = document.getElementById('wtHeaderMenuBackdrop');
    if (menu) {
      menu.classList.remove('open');
    }
    if (backdrop) {
      backdrop.classList.remove('open');
    }
    setTimeout(function() {
      if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
      if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }, 200);
    _wtMenuOpen = false;
  }

  function wtReset() {
    _wtSegments  = [];
    _wtFinalized = false;
    _wtSettings  = JSON.parse(JSON.stringify(WT_DEFAULT_SETTINGS));
    wtSaveSegments(_wtSegments);
    wtSaveFinalized(false);
    wtSaveSettings(_wtSettings);
    app.showToast('Рейс очищен');
    wtRenderAll();
  }

  /* ─── Ensure bottom-sheet DOM exists ─── */

  function wtEnsureSheetDOM() {
    // If the host app already provides the sheet, skip creation
    if (document.getElementById('wtSettingsOverlay')) return;

    var overlay = document.createElement('div');
    overlay.id = 'wtSettingsOverlay';
    overlay.className = 'wt-settings-overlay';

    var sheet = document.createElement('div');
    sheet.id = 'wtSettingsSheet';
    sheet.className = 'wt-settings-sheet';
    sheet.innerHTML = ''
      + '<div class="wt-settings-header">'
      + '<h2 class="wt-settings-title" id="wtSettingsTitle">Данные рейса</h2>'
      + '<button class="icon-btn" id="wtCloseSettingsBtn" aria-label="Закрыть"></button>'
      + '</div>'
      + '<div id="wtSettingsContent" class="wt-settings-content"></div>'
      + '<div class="wt-dialog-actions wt-dialog-actions--center">'
      + '<button class="btn-primary" id="wtSaveSegmentBtn">Сохранить</button>'
      + '</div>';

    document.body.appendChild(overlay);
    document.body.appendChild(sheet);
  }

  /* ─── INIT ─── */

  function init() {
    var container = document.getElementById('worktimeContainer');
    if (!container) { console.error('Контейнер worktimeContainer не найден!'); return; }
    container.setAttribute('lang', 'ru');

    // Create bottom-sheet DOM if host app doesn't provide it
    wtEnsureSheetDOM();

    container.addEventListener('click', function(e) {
      var delBtn = e.target.closest('.wt-delete-segment');
      if (delBtn) {
        if (_wtFinalized) {
          app.showToast('Рейс завершён — удаление недоступно');
          return;
        }
        var idx = parseInt(delBtn.dataset.idx, 10);
        wtDeleteSegment(idx);
        return;
      }
      if (e.target.closest('#wtFinalizeBtn')) {
        wtFinalize();
        return;
      }
      // «Разделить смену» — только при 1 сегменте и не splitMode
      if (e.target.closest('#wtSplitBtn')) {
        wtSplitShift();
        return;
      }
      // «Добавить сегмент смены 2» — открывает segment sheet с shift=2
      if (e.target.closest('#wtAddSegment2Btn')) {
        if (_wtFinalized) {
          app.showToast('Рейс завершён — добавление недоступно');
          return;
        }
        wtOpenSegmentSheet(2);
        return;
      }
      // Gear icon in Duty card → open Flight Settings
      if (e.target.closest('#wtFlightSettingsBtn')) {
        wtOpenFlightSettings();
        return;
      }
      // Plus icon in Segments card → open Add Segment (в splitMode если смены 2 нет — для shift 2)
      if (e.target.closest('#wtAddSegmentBtn')) {
        if (_wtFinalized) {
          app.showToast('Рейс завершён — добавление недоступно');
          return;
        }
        // В раздельном режиме: если смены 2 ещё нет — добавляем в shift 2;
        // если уже есть сегмент смены 2 — добавление недоступно (1 смена = 1 сегмент)
        if (_wtSettings.splitMode) {
          var segs2Check = _wtSegments.filter(function(s) { return s.shift === 2; });
          if (segs2Check.length === 0) {
            if (!_wtSettings.reportTime2) {
              app.showToast('Сначала укажите время явки 2 в данных рейса');
              return;
            }
            wtOpenSegmentSheet(2);
            return;
          } else {
            app.showToast('Смена 2 уже содержит сегмент — добавление недоступно');
            return;
          }
        } else {
          // Обычный режим — проверяем что явка задана
          if (wtParseTime(_wtSettings.reportTime) === null) {
            app.showToast('Сначала введите время явки в данных рейса');
            return;
          }
        }
        wtOpenSegmentSheet();
        return;
      }
      // Segment card click → open Edit Segment (или toast если locked в splitMode)
      var segCard = e.target.closest('.wt-segment-card[data-idx]');
      if (segCard && !e.target.closest('.wt-delete-segment')) {
        if (segCard.dataset.locked === '1') {
          app.showToast('Сегмент заблокирован в раздельном режиме');
          return;
        }
        if (_wtFinalized) {
          app.showToast('Рейс завершён — редактирование недоступно');
          return;
        }
        var segIdx = parseInt(segCard.dataset.idx, 10);
        if (!isNaN(segIdx)) wtOpenEditSegmentSheet(segIdx);
        return;
      }
      if (e.target.closest('#wtShareBtn')) {
        wtShareResults();
        return;
      }
    });

    // Bottom-sheet overlay click → close
    var fsOverlay = document.getElementById('wtSettingsOverlay');
    if (fsOverlay) {
      fsOverlay.addEventListener('click', function(e) {
        if (e.target === fsOverlay) wtCloseSheet();
      });
    }

    // Bottom-sheet panel: unified click handler for both modes
    var fsSheet = document.getElementById('wtSettingsSheet');
    if (fsSheet) {
      fsSheet.addEventListener('click', function(e) {
        // Save button — dispatch by current sheet mode
        if (e.target.closest('#wtSaveSegmentBtn')) {
          if (_wtSheetMode === 'segment') { wtSaveSegment(); }
          else { wtAutoSaveSetting(); wtCloseSheet(); }
          return;
        }
        // Close button (X)
        if (e.target.closest('#wtCloseSettingsBtn')) {
          wtCloseSheet();
          return;
        }
      });
    }

    // Auto-save on change in settings mode (dropdowns, time, number inputs)
    if (fsSheet) {
      fsSheet.addEventListener('change', function() {
        if (_wtSheetMode === 'settings') {
          wtAutoSaveSetting();
        }
      });
    }

    _wtSettings  = wtLoadSettings();
    _wtSegments  = wtLoadSegments();
    _wtFinalized = wtLoadFinalized();

    wtRenderAll();
  }

  /* ─── Destroy ─── */

  function destroy() {
    wtCloseHeaderMenu();
    _wtMenuOpen = false;
  }

  /* ─── Регистрация в ModuleRegistry ─── */
  window.ModuleRegistry.register('worktime', {
    title:        'Рабочее время',
    icon:         'calendar-clock',
    init:          init,
    renderHeader:  wtRenderHeader,
    destroy:       destroy
  });

})();
