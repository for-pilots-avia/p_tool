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

  var WT_DEFAULT_SETTINGS = {
    pilotExtra:  0,
    cabinExtra:  0,
    extension:   0,
    restType:    'base',
    reportTime:  '09:00',
    postflight:  30
  };

  /* ─── FTL расчёты ─── */

  function wtIsNight(reportMinutes) {
    return reportMinutes >= 1140 || reportMinutes <= 179;
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
    var night     = wtIsNight(report);
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

    var lastStop     = segments[segments.length - 1].engineStop;
    var dutyToStop   = wtDiffTime(report, lastStop);
    var duty         = dutyToStop + (settings.postflight || 0);
    var shiftEnd     = (report + duty) % 1440;
    var restHours    = wtCalcRest(duty, settings.restType);
    var restEnd      = (report + duty + restHours * 60) % 1440;

    var totalFlight  = 0;
    var totalAir     = 0;
    for (var i = 0; i < segments.length; i++) {
      totalFlight += segments[i].flightTime;
      totalAir    += segments[i].airTime;
    }

    var warnings = [];
    var firstStart = segments[0].engineStart;
    if (wtDiffTime(report, firstStart) < 60) {
      warnings.push('Менее 1 ч от явки до запуска двигателей');
    }
    if (duty > pilotMax) {
      warnings.push('ЛЭ: превышение макс. рабочего времени ('
        + wtFmtMin(duty) + ' > ' + wtFmtMin(pilotMax) + ')');
    }
    if (duty > cabinMax) {
      warnings.push('КЭ: превышение макс. рабочего времени ('
        + wtFmtMin(duty) + ' > ' + wtFmtMin(cabinMax) + ')');
    }
    if ((settings.postflight || 0) > 60) {
      warnings.push('Послеполётные работы > 60 мин — проверьте нормативы');
    }

    return {
      night: night, pilotMax: pilotMax, cabinMax: cabinMax,
      duty: duty, shiftEnd: shiftEnd,
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

    left.innerHTML = '<button class="icon-btn" aria-label="Назад">'
      + window.ICONS['arrow-left'] + '</button>';
    left.onclick = function() { app.navigateTo('main'); };

    center.innerHTML = '<div class="hc-module">Рабочее время</div>';

    // Ellipsis-vertical menu with "Очистить рейс"
    right.innerHTML = '<button class="icon-btn" id="wtHeaderMenuBtn" aria-label="Меню">'
      + window.ICONS['ellipsis-vertical'] + '</button>';
    right.onclick = null;

    var headerMenuBtn = document.getElementById('wtHeaderMenuBtn');
    if (headerMenuBtn && !headerMenuBtn.dataset.bound) {
      headerMenuBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        wtToggleHeaderMenu();
      });
      headerMenuBtn.dataset.bound = 'true';
    }
  }

  /* ─── Рендер экрана ─── */

  function wtRenderAll() {
    var container = document.getElementById('worktimeContainer');
    if (!container) return;

    var landings = wtGetLandingsFromSegments(_wtSegments);
    var results = _wtFinalized ? wtCalcResults(_wtSegments, _wtSettings) : null;
    var night   = wtIsNight(wtParseTime(_wtSettings.reportTime) || 0);

    var pilotMax = wtGetMaxDuty(_wtSettings.pilotExtra, landings, night)
                   + _wtSettings.extension * 60;
    var cabinMax = wtGetMaxDuty(_wtSettings.cabinExtra, landings, night)
                   + _wtSettings.extension * 60;

    var reportMin = wtParseTime(_wtSettings.reportTime);

    var html = '<div>';
    html += wtRenderDutyCard(results, night, pilotMax, cabinMax, reportMin, landings);
    html += wtRenderSegmentsCard(results);
    if (_wtFinalized && results) {
      html += wtRenderResultsCard(results);
    }
    html += '</div>';
    container.innerHTML = html;
  }

  /* ─── Карточка «Нормы рабочего времени» ─── */

  function wtRenderDutyCard(results, night, pilotMax, cabinMax, reportMin, landings) {
    var actualDuty = (results && _wtFinalized) ? results.duty : 0;

    var html = '<div class="app-card wt-card--duty" style="position:relative;">';
    html += '<div class="app-card-header">';
    html += '<div style="display:flex;align-items:center;gap:10px;">';
    html += '<div class="wt-card-icon wt-card-icon--duty">' + window.ICONS.clock + '</div>';
    html += '<h2 class="ct-heading-md">Нормы рабочего времени</h2>';
    html += '</div>';
    if (night) {
      html += '<span class="badge-danger" style="display:flex;align-items:center;gap:4px;">'
        + window.ICONS.moon + ' Ночь</span>';
    }
    html += '</div>';

    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:12px;">';

    // ЛЭ
    html += '<div class="wt-sub-card">';
    html += '<div class="wt-sub-card-label">' + window.ICONS.plane + ' Лётный экипаж (ЛЭ)</div>';
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;">';
    html += '<div><span style="font-size:var(--font-xs);color:var(--color-text-muted);">Максимум</span>';
    html += '<div class="ct-mono-time" style="font-weight:700;font-size:var(--font-md);">' + wtFmtMin(pilotMax) + '</div></div>';
    html += '<div style="text-align:right;"><span style="font-size:var(--font-xs);color:var(--color-text-muted);">Окончание</span>';
    var pilotEnd = reportMin !== null ? wtFormatTime(reportMin + pilotMax) : '--:--';
    html += '<div class="ct-mono-time" style="font-weight:700;font-size:var(--font-md);">' + pilotEnd + '</div></div>';
    html += '</div>';
    if (_wtFinalized && actualDuty > 0) {
      html += wtRenderProgressBar(actualDuty, pilotMax, 'ЛЭ');
    }
    html += '</div>';

    // КЭ
    html += '<div class="wt-sub-card">';
    html += '<div class="wt-sub-card-label">' + window.ICONS.users + ' Кабинный экипаж (КЭ)</div>';
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;">';
    html += '<div><span style="font-size:var(--font-xs);color:var(--color-text-muted);">Максимум</span>';
    html += '<div class="ct-mono-time" style="font-weight:700;font-size:var(--font-md);">' + wtFmtMin(cabinMax) + '</div></div>';
    html += '<div style="text-align:right;"><span style="font-size:var(--font-xs);color:var(--color-text-muted);">Окончание</span>';
    var cabinEnd = reportMin !== null ? wtFormatTime(reportMin + cabinMax) : '--:--';
    html += '<div class="ct-mono-time" style="font-weight:700;font-size:var(--font-md);">' + cabinEnd + '</div></div>';
    html += '</div>';
    if (_wtFinalized && actualDuty > 0) {
      html += wtRenderProgressBar(actualDuty, cabinMax, 'КЭ');
    }
    html += '</div>';

    html += '</div>';

    // Info-row — compact, uses wt-info-row / wt-info-item classes
    html += '<div class="wt-info-row">';
    var nightIcon = night ? window.ICONS.moon : window.ICONS.sun;
    html += '<span class="wt-info-item">'
      + nightIcon + ' <strong>Ночная:</strong>'
      + '<span class="' + (night ? 'badge-danger' : 'badge-ok') + '">'
      + (night ? 'Да' : 'Нет') + '</span></span>';
    html += '<span class="wt-info-item">'
      + window.ICONS.clock + ' <strong>Явка:</strong>'
      + '<span class="ct-mono-time">' + _wtSettings.reportTime + '</span></span>';
    html += '<span class="wt-info-item">'
      + window.ICONS['plane-landing'] + ' <strong>Посадки:</strong>'
      + '<span class="ct-mono-time">' + (landings === '1-2' ? '1–2' : '3–4') + '</span></span>';
    if (_wtSettings.extension > 0) {
      html += '<span class="wt-info-item">'
        + window.ICONS.timer + ' <strong>КВС:</strong> +' + _wtSettings.extension + ' ч</span>';
    }
    html += '</div>';

    // Settings button + report-time reminder — bottom of the card, one line
    var reportIsDefault = (_wtSettings.reportTime === WT_DEFAULT_SETTINGS.reportTime);
    html += '<div style="display:flex;align-items:center;margin-top:8px;position:relative;">';
    if (reportIsDefault) {
      html += '<span style="font-size:var(--font-sm);color:var(--color-text-secondary);line-height:1.45;flex:1;text-align:center;">'
        + 'Нажмите ⚙ чтобы ввести время явки</span>';
    } else {
      html += '<span style="flex:1;"></span>';
    }
    html += '<button class="icon-btn wt-card-action-btn" id="wtFlightSettingsBtn" aria-label="Настройки рейса" style="position:absolute;right:0;">'
      + window.ICONS.settings + '</button>';
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

    return '<div style="margin-top:10px;">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">'
      + '<span class="ct-heading-sm" style="font-size:var(--font-xs);text-transform:none;letter-spacing:normal;">' + label + '</span>'
      + '<span class="wt-status-dot ' + dotClass + '"></span>'
      + '</div>'
      + '<div class="wt-progress-bar">'
      + '<div class="wt-progress-bar-fill ' + fillClass + '" style="width:' + pct + '%"></div>'
      + '</div>'
      + '<div class="wt-progress-label">'
      + '<span>' + wtFmtMin(actual) + '</span>'
      + '<span>макс. ' + wtFmtMin(max) + '</span>'
      + '</div>'
      + '</div>';
  }

  /* ─── Карточка «Сегменты полёта» ─── */

  function wtRenderSegmentsCard(results) {
    var html = '<div class="app-card wt-card--segments">';
    html += '<div class="app-card-header">';
    html += '<div style="display:flex;align-items:center;gap:10px;">';
    html += '<div class="wt-card-icon wt-card-icon--segments">' + window.ICONS.plane + '</div>';
    html += '<h2 class="ct-heading-md">Сегменты полёта</h2>';
    html += '</div>';
    // Plus icon — transparent, clickable in header
    html += '<button class="wt-ghost-icon-btn" id="wtAddSegmentBtn" aria-label="Добавить сегмент">'
      + window.ICONS.plus + '</button>';
    html += '</div>';

    if (_wtSegments.length === 0) {
      html += '<div class="ct-empty-state">'
        + '<div class="ct-empty-icon" style="opacity:0.4;">' + window.ICONS.routes + '</div>'
        + '<div class="ct-empty-title">Нет сегментов</div>'
        + '<div class="ct-empty-text">Нажмите + чтобы добавить первый сегмент полёта — запуск двигателей, взлёт, посадка, выключение.</div>'
        + '</div>';
    } else {
      html += wtRenderTimeline(_wtSegments);
      for (var i = 0; i < _wtSegments.length; i++) {
        html += wtRenderSegmentCard(_wtSegments[i], i);
      }
      var totalFlight = 0;
      var totalAir    = 0;
      for (var j = 0; j < _wtSegments.length; j++) {
        totalFlight += _wtSegments[j].flightTime;
        totalAir    += _wtSegments[j].airTime;
      }
      html += '<div class="wt-total-stats" style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap;">'
        + '<span><strong>Итого:</strong></span>'
        + '<span>Полётное <strong class="ct-mono-time">' + wtFmtMin(totalFlight) + '</strong></span>'
        + '<span style="color:var(--color-border);">|</span>'
        + '<span>Лётное <strong class="ct-mono-time">' + wtFmtMin(totalAir) + '</strong></span>'
        + '</div>';
    }

    // Complete flight button — hidden after finalization
    if (!_wtFinalized) {
      html += '<div style="display:flex;justify-content:flex-end;margin-top:8px;">';
      html += '<button class="btn-primary" id="wtFinalizeBtn" style="font-size:var(--font-xs);padding:6px 12px;min-height:36px;">'
        + window.ICONS.flag + ' Завершить рейс</button>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  /* ─── Timeline ─── */

  function wtRenderTimeline(segments) {
    var totalMin = 1440;
    var hourLabels = [0, 3, 6, 9, 12, 15, 18, 21];

    var html = '<div class="wt-timeline-container">';

    html += '<div class="wt-timeline-header">';
    for (var i = 0; i < hourLabels.length; i++) {
      html += '<span>' + (hourLabels[i] < 10 ? '0' + hourLabels[i] : hourLabels[i]) + ':00</span>';
    }
    html += '</div>';

    html += '<div class="wt-timeline-track">';

    var allHours = [0, 3, 6, 9, 12, 15, 18, 21, 24];
    for (var g = 0; g < allHours.length; g++) {
      var leftPct = (allHours[g] * 60 / totalMin * 100).toFixed(2);
      html += '<div class="wt-timeline-gridline" style="left:' + leftPct + '%;"></div>';
    }

    var COLORS = 5;
    for (var s = 0; s < segments.length; s++) {
      var seg = segments[s];
      var startPct  = (seg.engineStart / totalMin * 100).toFixed(3);
      var widthPct  = Math.max((seg.engineStop - seg.engineStart) / totalMin * 100, 0.3).toFixed(3);
      var toPct     = (seg.takeoff  / totalMin * 100).toFixed(3);
      var ldPct     = (seg.landing  / totalMin * 100).toFixed(3);
      var colorIdx  = s % COLORS;

      html += '<div class="wt-timeline-segment wt-segment-color-' + colorIdx + '"'
        + ' style="left:' + startPct + '%;width:' + widthPct + '%;"'
        + ' title="Сег. ' + (s + 1) + ': ' + wtFormatTime(seg.engineStart) + '–' + wtFormatTime(seg.engineStop) + '">'
        + '</div>';
      html += '<div class="wt-timeline-marker wt-timeline-marker--takeoff" style="left:' + toPct + '%;"'
        + ' title="Взлёт: ' + wtFormatTime(seg.takeoff) + '"></div>';
      html += '<div class="wt-timeline-marker wt-timeline-marker--landing" style="left:' + ldPct + '%;"'
        + ' title="Посадка: ' + wtFormatTime(seg.landing) + '"></div>';
    }

    html += '</div>';

    html += '<div style="display:flex;gap:16px;margin-top:8px;flex-wrap:wrap;">'
      + '<div style="display:flex;align-items:center;gap:4px;font-size:var(--font-xs);color:var(--color-text-muted);">'
      + '<div style="width:8px;height:8px;border-radius:50%;background:var(--color-success);border:1.5px solid var(--color-text-white);"></div> Взлёт</div>'
      + '<div style="display:flex;align-items:center;gap:4px;font-size:var(--font-xs);color:var(--color-text-muted);">'
      + '<div style="width:8px;height:8px;border-radius:50%;background:var(--color-warning);border:1.5px solid var(--color-text-white);"></div> Посадка</div>'
      + '</div>';

    html += '</div>';
    return html;
  }

  /* ─── Карточка сегмента ─── */

  function wtRenderSegmentCard(seg, idx) {
    var colorIdx = idx % 5;
    return '<div class="wt-segment-card">'
      + '<div class="wt-segment-info">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
      + '<span class="wt-segment-color-' + colorIdx + '" style="width:12px;height:12px;border-radius:3px;display:inline-block;flex-shrink:0;"></span>'
      + '<strong class="ct-heading-md">Сегмент ' + (idx + 1) + '</strong>'
      + '</div>'
      + '<div style="display:flex;gap:12px;flex-wrap:wrap;font-size:var(--font-sm);color:var(--color-text-secondary);">'
      + '<span>Полётное: <strong class="ct-mono-time">' + wtFmtMin(seg.flightTime) + '</strong></span>'
      + '<span>Лётное: <strong class="ct-mono-time">' + wtFmtMin(seg.airTime) + '</strong></span>'
      + '</div>'
      + '<div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:4px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">'
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
      + '</div>'
      + '<button class="wt-delete-segment" data-idx="' + idx + '" aria-label="Удалить сегмент ' + (idx + 1) + '">'
      + window.ICONS.trash + '</button>'
      + '</div>';
  }

  /* ─── Карточка «Итоги рейса» ─── */

  function wtRenderResultsCard(results) {
    var allOk = results.warnings.length === 0;

    var html = '<div class="app-card wt-card--results' + (allOk ? ' wt-card--all-ok' : '') + '">';
    html += '<div class="app-card-header">';
    html += '<div style="display:flex;align-items:center;gap:10px;">';
    html += '<div class="wt-card-icon wt-card-icon--results">' + window.ICONS.gauge + '</div>';
    html += '<h2 class="ct-heading-lg">Итоги рейса</h2>';
    html += '</div>';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    if (allOk) {
      html += '<span class="wt-checkmark-circle">' + window.ICONS['check-circle'] + '</span>';
    }
    html += '<button class="icon-btn" id="wtShareBtn" aria-label="Поделиться"'
      + ' style="color:var(--color-text-white);background:var(--color-primary-ghost);">'
      + window.ICONS.share + '</button>';
    html += '</div>';
    html += '</div>';

    html += '<div class="wt-results-grid" style="margin-bottom:16px;border:1px solid var(--color-border-subtle);border-radius:var(--border-radius-md);overflow:hidden;">';
    html += wtResultItem(window.ICONS.timer, 'Фактическое рабочее время', wtFmtMin(results.duty));
    html += wtResultItem(window.ICONS.plane, 'Полётное время', wtFmtMin(results.totalFlight));
    html += wtResultItem(window.ICONS['circle-dot'], 'Лётное время', wtFmtMin(results.totalAir));
    html += wtResultItem(window.ICONS.flag, 'Окончание смены', wtFormatTime(results.shiftEnd));
    html += wtResultItem(window.ICONS.moon, 'Минимальный отдых', results.restHours + ' ч');
    html += wtResultItem(window.ICONS.clock, 'Окончание отдыха', wtFormatTime(results.restEnd));
    html += '</div>';

    if (!allOk) {
      html += '<div class="wt-warning-block" style="display:flex;flex-direction:column;gap:6px;">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
        + window.ICONS['alert-triangle'] + ' <strong>Нарушения FTL</strong></div>';
      for (var i = 0; i < results.warnings.length; i++) {
        html += '<div style="padding-left:26px;">' + results.warnings[i] + '</div>';
      }
      html += '</div>';
    } else {
      html += '<div class="wt-ok-block" style="display:flex;align-items:center;gap:10px;">'
        + window.ICONS['check-circle'] + ' <span>Нарушений не обнаружено.</span></div>';
    }

    html += '<div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:12px;">'
      + '*Расчёт от явки до выключения двигателей последнего сегмента + послеполётные работы.</div>';

    html += '</div>';
    return html;
  }

  function wtResultItem(icon, label, value) {
    return '<div class="wt-result-item">'
      + '<div class="wt-result-item-label">' + icon + ' ' + label + '</div>'
      + '<div class="wt-result-item-value">' + value + '</div>'
      + '</div>';
  }

  /* ═══════════════════════════════════════════════════════════════
     Bottom-sheet: единый (контракт хоста — один sheet на всё)
     Режимы: 'settings' (данные рейса) | 'segment' (новый сегмент)
     ═══════════════════════════════════════════════════════════════ */

  function wtCloseSheet() {
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
    wtRenderFlightSettingsSummary();

    overlay.classList.add('open');
    sheet.classList.add('open');
  }

  function wtCloseFlightSettings() {
    wtCloseSheet();
  }

  function wtRenderFlightSettingsSummary() {
    var el = document.getElementById('wtSettingsSummary');
    if (!el) return;
    var landings = wtGetLandingsFromSegments(_wtSegments);
    el.innerHTML = ''
      + '<div class="wt-dialog-summary-item"><span class="wt-dialog-summary-label">Явка</span>'
      + '<span class="wt-dialog-summary-value">' + _wtSettings.reportTime + '</span></div>'
      + '<div class="wt-dialog-summary-item"><span class="wt-dialog-summary-label">Посадки</span>'
      + '<span class="wt-dialog-summary-value">' + (landings === '1-2' ? '1–2' : '3–4') + ' (авто)</span></div>'
      + '<div class="wt-dialog-summary-item"><span class="wt-dialog-summary-label">Отдых</span>'
      + '<span class="wt-dialog-summary-value">' + (_wtSettings.restType === 'base' ? 'База' : 'Внебаз.') + '</span></div>'
      + '<div class="wt-dialog-summary-item"><span class="wt-dialog-summary-label">Сегм.</span>'
      + '<span class="wt-dialog-summary-value">' + _wtSegments.length + '</span></div>';
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
          + wtSelect('wtExtension', [['0','Без продления'],['2','+2 часа'],['3','+3 часа']], String(s.extension)))

      + wtSettingsGroup(window.ICONS.moon, 'Отдых',
          '<label class="wt-field-label">Тип отдыха</label>'
          + wtSelect('wtRestType', [['base','Базовый'],['nonbase','Внебазовый']], s.restType))

      + wtSettingsGroup(window.ICONS.clock, 'Начало смены',
          '<label class="wt-field-label">Явка (HH:MM)</label>'
          + '<input id="wtReportTime" type="time" class="wt-field-input" value="' + s.reportTime + '">')

      + '</div>'

      + '<div style="margin-bottom:16px;">'
      + '<label class="wt-field-label">Послеполётные работы (мин)</label>'
      + '<input id="wtPostflight" type="number" inputmode="numeric" class="wt-field-input" style="max-width:140px;" value="' + s.postflight + '">'
      + '</div>'

      + '<div class="wt-settings-group" style="background:var(--color-badge-ok-bg);border-color:rgba(0,176,80,0.15);">'
      + '<div style="font-size:var(--font-sm);color:var(--color-badge-ok-text);display:flex;align-items:center;gap:8px;">'
      + '<span class="wt-info-inline-icon">' + window.ICONS['plane-landing'] + '</span>'
      + '<span><strong>Посадки</strong> определяются автоматически по количеству сегментов.</span></div></div>';
  }

  /* ═══════════════════════════════════════════════════════════════
     Bottom-sheet: режим «Добавить сегмент»
     Использует тот же sheet, что и настройки (контракт хоста)
     ═══════════════════════════════════════════════════════════════ */

  function wtOpenSegmentSheet() {
    _wtSheetMode = 'segment';
    var overlay  = document.getElementById('wtSettingsOverlay');
    var sheet    = document.getElementById('wtSettingsSheet');
    var closeBtn = document.getElementById('wtCloseSettingsBtn');
    var titleEl  = document.getElementById('wtSettingsTitle');
    var saveBtn  = document.getElementById('wtSaveSegmentBtn');
    var summaryEl = document.getElementById('wtSettingsSummary');
    var actionsEl = sheet ? sheet.querySelector('.wt-dialog-actions') : null;
    if (!overlay || !sheet) return;

    if (closeBtn) closeBtn.innerHTML = window.ICONS.x || window.ICONS.close;
    if (titleEl) titleEl.textContent = 'Новый сегмент';
    if (saveBtn) saveBtn.textContent = 'Сохранить сегмент';
    if (summaryEl) summaryEl.innerHTML = '';
    if (actionsEl) actionsEl.style.display = 'flex'; // Show Save Segment button

    wtRenderSegmentContent();

    overlay.classList.add('open');
    sheet.classList.add('open');
  }

  function wtCloseSegmentSheet() {
    wtCloseSheet();
  }

  function wtRenderSegmentContent() {
    var el = document.getElementById('wtSettingsContent');
    if (!el) return;

    // Smart defaults: if there are existing segments, start after the last one
    var defaultStart = '10:00';
    var defaultTakeoff = '10:30';
    var defaultLanding = '13:45';
    var defaultStop  = '14:00';

    if (_wtSegments.length > 0) {
      var lastSeg = _wtSegments[_wtSegments.length - 1];
      // Start 30 min after last engine stop
      var startMin = lastSeg.engineStop + 30;
      defaultStart = wtFormatTime(startMin % 1440);
      defaultTakeoff = wtFormatTime((startMin + 15) % 1440);
      defaultLanding = wtFormatTime((startMin + 195) % 1440);
      defaultStop  = wtFormatTime((startMin + 210) % 1440);
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
      + '<input id="' + id + '" type="time" class="wt-field-input" value="' + placeholder + '">'
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
    var restType   = wtVal('wtRestType')   || 'base';
    var reportTime = wtVal('wtReportTime') || '09:00';
    var postflight = parseInt(wtVal('wtPostflight'), 10) || 0;

    _wtSettings = { pilotExtra: pilotExtra, cabinExtra: cabinExtra,
      extension: extension, restType: restType,
      reportTime: reportTime, postflight: postflight };
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
    var restType   = wtVal('wtRestType')   || 'base';
    var reportTime = wtVal('wtReportTime') || '09:00';
    var postflight = parseInt(wtVal('wtPostflight'), 10) || 0;

    _wtSettings = { pilotExtra: pilotExtra, cabinExtra: cabinExtra,
      extension: extension, restType: restType,
      reportTime: reportTime, postflight: postflight };
    wtSaveSettings(_wtSettings);
    _wtFinalized = false;
    wtSaveFinalized(false);

    // Update summary and main screen without closing the sheet
    wtRenderFlightSettingsSummary();
    wtRenderAll();
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

    if (wtCheckOverlap(engineStart, engineStop, _wtSegments, -1)) {
      app.showToast('Сегмент пересекается по времени с существующим');
      return;
    }

    _wtSegments.push({ engineStart: engineStart, takeoff: takeoff,
      landing: landing, engineStop: engineStop,
      flightTime: flightTime, airTime: airTime });
    _wtFinalized = false;
    wtSaveSegments(_wtSegments);
    wtSaveFinalized(false);

    wtCloseSegmentSheet();
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
    _wtFinalized = true;
    wtSaveFinalized(true);
    app.showToast('Расчёт завершён');
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

    // Transparent overlay to catch outside clicks (no document.addEventListener)
    var backdrop = document.createElement('div');
    backdrop.id = 'wtHeaderMenuBackdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:998;';
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
    if (menu) {
      menu.classList.remove('open');
      setTimeout(function() {
        if (menu.parentNode) menu.parentNode.removeChild(menu);
      }, 200);
    }
    var backdrop = document.getElementById('wtHeaderMenuBackdrop');
    if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
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
      + '<div class="wt-dialog-summary" id="wtSettingsSummary"></div>'
      + '<div id="wtSettingsContent" class="wt-settings-content"></div>'
      + '<div class="wt-dialog-actions" style="justify-content:center;">'
      + '<button class="btn-primary" id="wtSaveSegmentBtn">Сохранить</button>'
      + '<button class="btn-outline" id="wtCloseSettingsBtn2">Закрыть</button>'
      + '</div>';

    document.body.appendChild(overlay);
    document.body.appendChild(sheet);
  }

  /* ─── INIT ─── */

  function init() {
    var container = document.getElementById('worktimeContainer');
    if (!container) { console.error('Контейнер worktimeContainer не найден!'); return; }

    // Create bottom-sheet DOM if host app doesn't provide it
    wtEnsureSheetDOM();

    if (!container.dataset.delegated) {
      container.addEventListener('click', function(e) {
        var delBtn = e.target.closest('.wt-delete-segment');
        if (delBtn) {
          var idx = parseInt(delBtn.dataset.idx, 10);
          wtDeleteSegment(idx);
          return;
        }
        if (e.target.closest('#wtFinalizeBtn')) {
          wtFinalize();
          return;
        }
        // Gear icon in Duty card → open Flight Settings
        if (e.target.closest('#wtFlightSettingsBtn')) {
          wtOpenFlightSettings();
          return;
        }
        // Plus icon in Segments card → open Add Segment
        if (e.target.closest('#wtAddSegmentBtn')) {
          wtOpenSegmentSheet();
          return;
        }
        if (e.target.closest('#wtShareBtn')) {
          wtShareResults();
          return;
        }
      });
      container.dataset.delegated = 'true';
    }

    // Bottom-sheet overlay click → close
    var fsOverlay = document.getElementById('wtSettingsOverlay');
    if (fsOverlay && !fsOverlay.dataset.delegated) {
      fsOverlay.addEventListener('click', function(e) {
        if (e.target === fsOverlay) wtCloseSheet();
      });
      fsOverlay.dataset.delegated = 'true';
    }

    // Bottom-sheet panel: unified click handler for both modes
    var fsSheet = document.getElementById('wtSettingsSheet');
    if (fsSheet && !fsSheet.dataset.delegated) {
      fsSheet.addEventListener('click', function(e) {
        // Save button — dispatch by current sheet mode
        if (e.target.closest('#wtSaveSegmentBtn')) {
          if (_wtSheetMode === 'segment') { wtSaveSegment(); }
          else { wtAutoSaveSetting(); wtCloseSheet(); }
          return;
        }
        // Close buttons
        if (e.target.closest('#wtCloseSettingsBtn') || e.target.closest('#wtCloseSettingsBtn2')) {
          wtCloseSheet();
          return;
        }
      });
      fsSheet.dataset.delegated = 'true';
    }

    // Auto-save on change in settings mode (dropdowns, time, number inputs)
    if (fsSheet && !fsSheet.dataset.changeDelegated) {
      fsSheet.addEventListener('change', function() {
        if (_wtSheetMode === 'settings') {
          wtAutoSaveSetting();
        }
      });
      fsSheet.dataset.changeDelegated = 'true';
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
