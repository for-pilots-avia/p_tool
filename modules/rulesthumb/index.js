/* ═══════════════════════════════════════════
   Pilot's Tool — modules/rulesthumb/index.js
   Модуль «Rules of Thumb»
   ═══════════════════════════════════════════ */

(function() {
  'use strict';

  /* ─── Приватное состояние ─── */
  var _data = null;
  var _filter = '';

  /* ═══════════════════════════════════════════
     CALCULATORS
     ═══════════════════════════════════════════ */

  var _calcs = {
    altPressure: {
      inputs: [
        { id: 'deltaPressure', label: 'ΔPressure', unit: 'mb' },
        { id: 'indicatedAlt', label: 'Indicated Alt', unit: 'ft' }
      ],
      compute: function(v) {
        var c = v.deltaPressure * 30;
        return [
          { label: 'Correction', value: c, unit: 'ft' },
          { label: 'True Altitude', value: v.indicatedAlt - c, unit: 'ft' }
        ];
      }
    },
    altTemp: {
      inputs: [
        { id: 'deltaISA', label: 'ΔISA', unit: '°C' },
        { id: 'altitude', label: 'Altitude', unit: 'ft' }
      ],
      compute: function(v) {
        var c = 4 * v.deltaISA * v.altitude / 1000;
        return [
          { label: 'Correction', value: Math.round(c), unit: 'ft' },
          { label: 'True Altitude', value: Math.round(v.altitude - c), unit: 'ft' }
        ];
      }
    },
    satFromTat: {
      inputs: [
        { id: 'tat', label: 'TAT', unit: '°C' },
        { id: 'mach', label: 'Mach', unit: '' }
      ],
      compute: function(v) {
        var sat = v.tat - 3 * Math.round(v.mach * 10);
        return [{ label: 'SAT', value: sat, unit: '°C' }];
      }
    },
    satFromTatHigh: {
      inputs: [
        { id: 'tat', label: 'TAT', unit: '°C' },
        { id: 'mach', label: 'Mach', unit: '' }
      ],
      compute: function(v) {
        var sat = v.tat - (100 * v.mach) - 50;
        return [{ label: 'SAT', value: Math.round(sat), unit: '°C' }];
      }
    },
    tasFromMach: {
      inputs: [
        { id: 'mach', label: 'Mach', unit: '' }
      ],
      compute: function(v) {
        var digit = Math.round(v.mach * 10);
        return [{ label: 'TAS', value: digit * 60, unit: 'kt' }];
      }
    },
    tasFromIas: {
      inputs: [
        { id: 'ias', label: 'IAS', unit: 'kt' },
        { id: 'fl', label: 'Flight Level', unit: '' }
      ],
      compute: function(v) {
        return [{ label: 'TAS', value: v.ias + v.fl / 2, unit: 'kt' }];
      }
    },
    gsFromMach: {
      inputs: [
        { id: 'mach', label: 'Mach', unit: '' }
      ],
      compute: function(v) {
        return [{ label: 'GS', value: (v.mach * 10).toFixed(1), unit: 'NM/min' }];
      }
    },
    gsFromDme: {
      inputs: [
        { id: 'distNm', label: 'Distance in 36 s', unit: 'NM' }
      ],
      compute: function(v) {
        return [{ label: 'GS', value: v.distNm * 10, unit: 'kt' }];
      }
    },
    tasFromIasAlt: {
      inputs: [
        { id: 'ias', label: 'IAS', unit: 'kt' },
        { id: 'alt', label: 'Altitude', unit: 'ft' }
      ],
      compute: function(v) {
        var tas = (v.ias * 0.02 * v.alt / 1000) + v.ias;
        return [{ label: 'TAS', value: Math.round(tas), unit: 'kt' }];
      }
    },
    levelOffLow: {
      inputs: [
        { id: 'rc', label: 'R/C', unit: 'ft/min' }
      ],
      compute: function(v) {
        return [{ label: 'Level-off Δ', value: v.rc / 10, unit: 'ft' }];
      }
    },
    levelOffHigh: {
      inputs: [
        { id: 'rc', label: 'R/C', unit: 'ft/min' }
      ],
      compute: function(v) {
        return [{ label: 'Level-off Δ', value: 2 * v.rc / 10, unit: 'ft' }];
      }
    },
    cruiseFL: {
      inputs: [
        { id: 'tripDist', label: 'Trip Distance', unit: 'NM' }
      ],
      compute: function(v) {
        return [{ label: 'Optimum FL', value: Math.round(v.tripDist), unit: '' }];
      }
    },
    vsRejoin: {
      inputs: [
        { id: 'deltaFt', label: 'Δ feet', unit: 'ft' }
      ],
      compute: function(v) {
        return [{ label: 'V/S', value: 2 * v.deltaFt, unit: 'ft/min' }];
      }
    },
    tod: {
      inputs: [
        { id: 'deltaFL', label: 'ΔFL', unit: '' }
      ],
      compute: function(v) {
        return [{ label: 'TOD', value: Math.round(v.deltaFL / 3), unit: 'NM' }];
      }
    },
    rdRequired: {
      inputs: [
        { id: 'speedNum', label: 'Speed Number', unit: '' },
        { id: 'altFt', label: 'Altitude to lose', unit: 'ft' },
        { id: 'distNm', label: 'Distance', unit: 'NM' }
      ],
      compute: function(v) {
        return [{ label: 'R/D', value: Math.round(v.speedNum * v.altFt / v.distNm), unit: 'ft/min' }];
      }
    },
    vsByBaHigh: {
      inputs: [
        { id: 'mach', label: 'Mach', unit: '' },
        { id: 'deltaBA', label: 'ΔBA', unit: '°' }
      ],
      compute: function(v) {
        return [{ label: 'R/D', value: Math.round(v.mach * 100 * v.deltaBA), unit: 'ft/min' }];
      }
    },
    vsByBaLow: {
      inputs: [
        { id: 'speedNum', label: 'Speed Number', unit: '' },
        { id: 'deltaBA', label: 'ΔBA', unit: '°' }
      ],
      compute: function(v) {
        return [{ label: 'R/D', value: v.speedNum * v.deltaBA, unit: 'ft/min' }];
      }
    },
    distForDescent: {
      inputs: [
        { id: 'speedNum', label: 'Speed Number', unit: '' },
        { id: 'altKft', label: 'Altitude', unit: '1 000 ft' },
        { id: 'rd', label: 'R/D', unit: 'ft/min' }
      ],
      compute: function(v) {
        return [{ label: 'Distance', value: Math.round(v.speedNum * v.altKft / v.rd), unit: 'NM' }];
      }
    },
    windCorr: {
      inputs: [
        { id: 'todNm', label: 'TOD', unit: 'NM' },
        { id: 'windKt', label: 'Wind component', unit: 'kt (+tail/−head)' }
      ],
      compute: function(v) {
        var corr = v.todNm * (1 + v.windKt / 400);
        return [{ label: 'Corrected TOD', value: Math.round(corr), unit: 'NM' }];
      }
    },
    rdForGlidePct: {
      inputs: [
        { id: 'gs', label: 'Ground Speed', unit: 'kt' },
        { id: 'glidePct', label: 'Glide %', unit: '%' }
      ],
      compute: function(v) {
        return [{ label: 'R/D', value: v.gs * v.glidePct, unit: 'ft/min' }];
      }
    },
    degToPercent: {
      inputs: [
        { id: 'degrees', label: 'Glide degrees', unit: '°' }
      ],
      compute: function(v) {
        return [{ label: 'Percent', value: (10 * v.degrees / 6).toFixed(1), unit: '%' }];
      }
    },
    rodQuick: {
      inputs: [
        { id: 'gs', label: 'Ground Speed', unit: 'kt' }
      ],
      compute: function(v) {
        return [{ label: 'RoD', value: v.gs * 5, unit: 'fpm' }];
      }
    },
    idleDescent: {
      inputs: [
        { id: 'altToLose', label: 'Altitude to lose', unit: 'ft' }
      ],
      compute: function(v) {
        return [{ label: 'Distance', value: Math.round(v.altToLose / 1000 * 3), unit: 'NM' }];
      }
    },
    driftMach: {
      inputs: [
        { id: 'xwind', label: 'X-wind', unit: 'kt' },
        { id: 'mach', label: 'Mach', unit: '' }
      ],
      compute: function(v) {
        return [{ label: 'Drift', value: (v.xwind / Math.round(v.mach * 10)).toFixed(1), unit: '°' }];
      }
    },
    driftTas: {
      inputs: [
        { id: 'xwind', label: 'X-wind', unit: 'kt' },
        { id: 'speedNum', label: 'Speed Number', unit: '' }
      ],
      compute: function(v) {
        return [{ label: 'Drift', value: (v.xwind / v.speedNum).toFixed(1), unit: '°' }];
      }
    },
    offTrack: {
      inputs: [
        { id: 'deltaDeg', label: 'Δ° off track', unit: '°' },
        { id: 'distNm', label: 'Distance to station', unit: 'NM' }
      ],
      compute: function(v) {
        return [{ label: 'Off-Track', value: (v.deltaDeg * v.distNm / 60).toFixed(1), unit: 'NM' }];
      }
    },
    slantDistance: {
      inputs: [
        { id: 'altitude', label: 'Altitude', unit: 'ft' }
      ],
      compute: function(v) {
        return [{ label: 'DME reading', value: (v.altitude / 6000).toFixed(1), unit: 'NM' }];
      }
    },
    interceptOutbound: {
      inputs: [
        { id: 'deltaTrack', label: 'ΔTrack', unit: '°' }
      ],
      compute: function(v) {
        return [{ label: 'Turn distance', value: (v.deltaTrack / 30).toFixed(1), unit: 'NM' }];
      }
    },
    interceptHeading: {
      inputs: [
        { id: 'deltaTrack', label: 'ΔTrack', unit: '°' }
      ],
      compute: function(v) {
        return [{ label: 'Attack angle', value: Math.round(v.deltaTrack / 3), unit: '°' }];
      }
    },
    interceptOffTrack: {
      inputs: [
        { id: 'offTrackDeg', label: 'Off-Track angle', unit: '°' }
      ],
      compute: function(v) {
        return [{ label: 'Attack angle', value: 3 * v.offTrackDeg, unit: '°' }];
      }
    },
    rollout: {
      inputs: [
        { id: 'bank', label: 'Bank angle', unit: '°' }
      ],
      compute: function(v) {
        return [{ label: 'ΔHdg to start rollout', value: (v.bank / 3).toFixed(0), unit: '°' }];
      }
    },
    bankSmall: {
      inputs: [
        { id: 'deltaHdg', label: 'ΔHeading', unit: '°' }
      ],
      compute: function(v) {
        return [{ label: 'Bank angle', value: v.deltaHdg, unit: '°' }];
      }
    },
    bankRateOne: {
      inputs: [
        { id: 'tas', label: 'TAS', unit: 'kt' }
      ],
      compute: function(v) {
        return [{ label: 'Bank angle', value: Math.round(v.tas / 10 + v.tas / 20), unit: '°' }];
      }
    },
    turnDiameter: {
      inputs: [
        { id: 'tas', label: 'TAS', unit: 'kt' }
      ],
      compute: function(v) {
        return [{ label: 'Turn diameter', value: (v.tas / 100).toFixed(1), unit: 'NM' }];
      }
    },
    baseTurnTime: {
      inputs: [
        { id: 'deltaTrack', label: 'ΔTrack', unit: '°' }
      ],
      compute: function(v) {
        return [{ label: 'Time', value: (36 / v.deltaTrack).toFixed(1), unit: 'min' }];
      }
    },
    rolloutAngle: {
      inputs: [
        { id: 'bankAngle', label: 'Bank angle', unit: '°' }
      ],
      compute: function(v) {
        return [{ label: 'Rollout angle', value: (v.bankAngle / 2).toFixed(0), unit: '°' }];
      }
    },
    rdIls: {
      inputs: [
        { id: 'gs', label: 'Ground Speed', unit: 'kt' }
      ],
      compute: function(v) {
        return [{ label: 'R/D', value: 5 * v.gs, unit: 'ft/min' }];
      }
    },
    visAtVdp: {
      inputs: [
        { id: 'mda', label: 'MDA', unit: 'ft' }
      ],
      compute: function(v) {
        return [{ label: 'Min visibility', value: 6 * v.mda, unit: 'm' }];
      }
    },
    rdGlideSlope: {
      inputs: [
        { id: 'gs', label: 'Ground Speed', unit: 'kt' }
      ],
      compute: function(v) {
        return [{ label: 'R/D', value: v.gs * 5, unit: 'fpm' }];
      }
    },
    distFromThreshold: {
      inputs: [
        { id: 'aglFt', label: 'AGL Height', unit: 'ft' }
      ],
      compute: function(v) {
        return [{ label: 'Distance', value: (v.aglFt / 300).toFixed(1), unit: 'NM' }];
      }
    },
    altCheck: {
      inputs: [
        { id: 'gsAngle', label: 'GS Angle', unit: '°' },
        { id: 'distNm', label: 'Distance', unit: 'NM' }
      ],
      compute: function(v) {
        return [{ label: 'Expected altitude', value: Math.round(v.gsAngle * 100 * v.distNm), unit: 'ft MSL' }];
      }
    },
    todQuick: {
      inputs: [
        { id: 'currentFL', label: 'Current FL', unit: '' },
        { id: 'targetFL', label: 'Target FL', unit: '' }
      ],
      compute: function(v) {
        return [{ label: 'TOD', value: (v.currentFL - v.targetFL) * 3, unit: 'NM' }];
      }
    },
    distFromGs: {
      inputs: [
        { id: 'gs', label: 'Ground Speed', unit: 'kt' }
      ],
      compute: function(v) {
        return [{ label: 'Distance in 6 min', value: v.gs / 10, unit: 'NM' }];
      }
    }
  };

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */

  function init(params) {
    var container = document.getElementById('rulesthumbContainer');
    if (!container) { console.error('Контейнер rulesthumbContainer не найден!'); return; }

    _filter = '';

    if (_data) { renderAll(); return; }

    app.showSkeleton(container, 'blocks');

    fetch('modules/rulesthumb/data/rules.json')
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        _data = data;
        renderAll();
      })
      .catch(function(err) {
        app.showError(container, 'Не удалось загрузить данные');
        console.error('rulesthumb fetch error:', err);
      });
  }

  /* ═══════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════ */

  function renderAll() {
    var container = document.getElementById('rulesthumbContainer');
    if (!container || !_data) return;

    var q = _filter.trim().toLowerCase();

    var html = '<div class="module-container">';

    html += '<div class="rt-warning">' + _data.warning + '</div>';

    /* Search bar — паттерн phonebook */
    html += '<div class="rt-search-bar">';
    html += '<div class="rt-search-input-wrap">';
    html += '<span class="rt-search-input-icon">' + window.ICONS.search + '</span>';
    html += '<input type="text" class="rt-search-input" placeholder="Поиск правила…"'
      + ' value="' + escapeAttr(_filter || '') + '">';
    html += '</div>';
    if (_filter) {
      html += '<button class="rt-search-clear" aria-label="Очистить">' + window.ICONS.x + '</button>';
    }
    html += '</div>';

    /* Filter categories */
    var filteredCats = [];
    var cats = _data.categories;
    for (var i = 0; i < cats.length; i++) {
      var cat = cats[i];
      if (!q) {
        filteredCats.push({ cat: cat, rules: cat.rules, tipCards: cat.tipCards, tables: cat.tables });
        continue;
      }
      var catTitleMatch = cat.title.toLowerCase().indexOf(q) >= 0
        || (cat.subtitle && cat.subtitle.toLowerCase().indexOf(q) >= 0);

      var matchedRules = cat.rules ? cat.rules.filter(function(r) {
        return catTitleMatch
          || (r.title && r.title.toLowerCase().indexOf(q) >= 0)
          || (r.formula && r.formula.toLowerCase().indexOf(q) >= 0)
          || (r.example && r.example.toLowerCase().indexOf(q) >= 0)
          || (r.tip && r.tip.toLowerCase().indexOf(q) >= 0)
          || (r.num && r.num.toLowerCase().indexOf(q) >= 0);
      }) : [];

      var matchedTips = cat.tipCards ? cat.tipCards.filter(function(t) {
        return catTitleMatch
          || (t.title && t.title.toLowerCase().indexOf(q) >= 0)
          || (t.rows && t.rows.some(function(row) {
            return (row.label && row.label.toLowerCase().indexOf(q) >= 0)
              || (row.value && row.value.toLowerCase().indexOf(q) >= 0);
          }))
          || (t.note && t.note.toLowerCase().indexOf(q) >= 0);
      }) : [];

      var matchedTables = cat.tables ? cat.tables.filter(function(t) {
        return catTitleMatch
          || (t.title && t.title.toLowerCase().indexOf(q) >= 0)
          || (t.formula && t.formula.toLowerCase().indexOf(q) >= 0);
      }) : [];

      if (catTitleMatch || matchedRules.length || matchedTips.length || matchedTables.length) {
        filteredCats.push({
          cat: cat,
          rules: catTitleMatch ? cat.rules : matchedRules,
          tipCards: catTitleMatch ? cat.tipCards : matchedTips,
          tables: catTitleMatch ? cat.tables : matchedTables
        });
      }
    }

    if (!filteredCats.length) {
      html += '<div class="rt-empty">';
      html += '<div class="rt-empty-icon">' + window.ICONS.search + '</div>';
      html += '<p class="rt-empty-text">Ничего не найдено</p>';
      html += '<p class="rt-empty-sub">Попробуйте изменить запрос</p>';
      html += '</div>';
    } else {
      for (var j = 0; j < filteredCats.length; j++) {
        html += renderCategory(filteredCats[j]);
      }
    }

    html += '<div class="rt-attribution">' + _data.attribution + '</div>';
    html += '</div>';

    app.hideSkeleton(container, html);

    initAccordionHandlers(container);
    initCalcHandlers(container);
    bindSearchInput();

    /* Clear button */
    var clearBtn = container.querySelector('.rt-search-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        _filter = '';
        renderAll();
        var inp = container.querySelector('.rt-search-input');
        if (inp) inp.focus();
      });
    }
  }

  /* ─── Search input binding (паттерн phonebook) ─── */
  function bindSearchInput() {
    var container = document.getElementById('rulesthumbContainer');
    if (!container) return;
    var input = container.querySelector('.rt-search-input');
    if (input) {
      input.addEventListener('input', function(e) {
        _filter = e.target.value;
        renderAll();
        var inp = container.querySelector('.rt-search-input');
        if (inp) {
          inp.focus();
          inp.setSelectionRange(_filter.length, _filter.length);
        }
      });
    }
  }

  function renderCategory(filtered) {
    var cat = filtered.cat;
    var html = '<div class="rt-accordion-item">';
    html += '<div class="rt-accordion-header" data-rt-cat="' + cat.id + '">';
    html += '<span class="rt-accordion-title">' + escapeHtml(cat.title);
    if (cat.subtitle) {
      html += ' <span class="rt-accordion-subtitle">— ' + escapeHtml(cat.subtitle) + '</span>';
    }
    html += '</span>';
    html += '<span class="rt-accordion-chevron">' + window.ICONS['chevron-down'] + '</span>';
    html += '</div>';
    html += '<div class="rt-accordion-body">';

    if (filtered.rules && filtered.rules.length) {
      html += '<div class="rt-rules-grid">';
      for (var i = 0; i < filtered.rules.length; i++) {
        html += renderRule(filtered.rules[i]);
      }
      html += '</div>';
    }

    if (filtered.tipCards && filtered.tipCards.length) {
      html += '<div class="rt-tips-grid">';
      for (var j = 0; j < filtered.tipCards.length; j++) {
        html += renderTipCard(filtered.tipCards[j]);
      }
      html += '</div>';
    }

    if (filtered.tables && filtered.tables.length) {
      for (var k = 0; k < filtered.tables.length; k++) {
        html += renderTable(filtered.tables[k]);
      }
    }

    if (cat.alert) {
      html += '<div class="rt-alert">⚠ <strong>Golden Rule:</strong> ' + escapeHtml(cat.alert) + '</div>';
    }

    if (cat.checklist) {
      html += renderChecklist(cat.checklist);
    }

    html += '</div></div>';
    return html;
  }

  function renderRule(rule) {
    var html = '<div class="rt-rule-card">';
    if (rule.num) {
      html += '<div class="rt-rule-num">' + escapeHtml(rule.num) + '</div>';
    }
    html += '<div class="rt-rule-title">' + escapeHtml(rule.title) + '</div>';

    if (rule.tip) {
      html += '<div class="rt-tip">💡 ' + escapeHtml(rule.tip) + '</div>';
    }

    if (rule.formula) {
      html += '<div class="rt-formula">' + escapeHtml(rule.formula) + '</div>';
    }

    if (rule.example) {
      html += '<div class="rt-example"><strong>Example:</strong> ' + escapeHtml(rule.example) + '</div>';
    }

    if (rule.table) {
      html += renderTable(rule.table);
    }

    if (rule.calcId && _calcs[rule.calcId]) {
      html += renderCalc(rule.calcId);
    }

    html += '</div>';
    return html;
  }

  function renderCalc(calcId) {
    var calc = _calcs[calcId];
    if (!calc) return '';

    var html = '<div class="rt-calc" data-calc-id="' + calcId + '">';
    html += '<button class="rt-calc-toggle">🧮 Calculate</button>';
    html += '<div class="rt-calc-body">';

    for (var i = 0; i < calc.inputs.length; i++) {
      var inp = calc.inputs[i];
      html += '<div class="rt-calc-input-row">';
      html += '<label class="rt-calc-label" for="rt-' + calcId + '-' + inp.id + '">' + escapeHtml(inp.label);
      if (inp.unit) html += ' <span class="rt-calc-unit">(' + escapeHtml(inp.unit) + ')</span>';
      html += '</label>';
      html += '<input type="number" class="rt-calc-field" id="rt-' + calcId + '-' + inp.id + '" data-calc-field="' + inp.id + '">';
      html += '</div>';
    }

    html += '<button class="rt-calc-btn" data-calc-run="' + calcId + '">Calculate</button>';
    html += '<div class="rt-calc-result" data-calc-result="' + calcId + '"></div>';
    html += '</div></div>';
    return html;
  }

  function renderTipCard(tipCard) {
    var html = '<div class="rt-tip-card">';
    html += '<div class="rt-tip-card-title">' + escapeHtml(tipCard.title) + '</div>';

    if (tipCard.rows && tipCard.rows.length > 0) {
      for (var i = 0; i < tipCard.rows.length; i++) {
        html += '<div class="rt-tip-row">';
        html += '<span class="rt-tip-label">' + escapeHtml(tipCard.rows[i].label) + '</span>';
        html += '<span class="rt-tip-value">' + escapeHtml(tipCard.rows[i].value) + '</span>';
        html += '</div>';
      }
    }

    if (tipCard.table) {
      html += renderTable(tipCard.table);
    }

    if (tipCard.note) {
      html += '<div class="rt-example">' + escapeHtml(tipCard.note) + '</div>';
    }

    if (tipCard.list) {
      html += '<ol class="rt-checklist-list">';
      for (var j = 0; j < tipCard.list.length; j++) {
        html += '<li>' + escapeHtml(tipCard.list[j]) + '</li>';
      }
      html += '</ol>';
    }

    html += '</div>';
    return html;
  }

  function renderTable(table) {
    var html = '<div class="rt-table-wrap">';
    html += '<div class="rt-table-title">' + escapeHtml(table.title) + '</div>';

    if (table.formula) {
      html += '<div class="rt-formula">' + escapeHtml(table.formula) + '</div>';
    }

    if (table.headers && table.rows) {
      html += '<table class="rt-table">';
      html += '<thead><tr>';
      for (var h = 0; h < table.headers.length; h++) {
        html += '<th>' + escapeHtml(table.headers[h]) + '</th>';
      }
      html += '</tr></thead><tbody>';
      for (var r = 0; r < table.rows.length; r++) {
        html += '<tr>';
        for (var c = 0; c < table.rows[r].length; c++) {
          html += '<td>' + escapeHtml(table.rows[r][c]) + '</td>';
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
    }

    html += '</div>';
    return html;
  }

  function renderChecklist(checklist) {
    var html = '<div class="rt-tip-card">';
    html += '<div class="rt-tip-card-title">' + escapeHtml(checklist.title) + '</div>';
    html += '<div class="rt-formula">';
    for (var i = 0; i < checklist.items.length; i++) {
      html += escapeHtml(checklist.items[i]) + '\n';
    }
    html += '</div></div>';
    return html;
  }

  /* ═══════════════════════════════════════════
     EVENT HANDLERS
     ═══════════════════════════════════════════ */

  function initAccordionHandlers(container) {
    container.addEventListener('click', function(e) {
      var header = e.target.closest('.rt-accordion-header');
      if (header) {
        var item = header.parentElement;
        item.classList.toggle('rt-accordion-open');
        return;
      }
    });
  }

  function initCalcHandlers(container) {
    container.addEventListener('click', function(e) {
      var toggleBtn = e.target.closest('.rt-calc-toggle');
      if (toggleBtn) {
        var calcEl = toggleBtn.parentElement;
        calcEl.classList.toggle('rt-calc-open');
        return;
      }

      var runBtn = e.target.closest('.rt-calc-btn');
      if (runBtn) {
        var calcId = runBtn.dataset.calcRun;
        runCalc(calcId);
        return;
      }
    });
  }

  function runCalc(calcId) {
    var calc = _calcs[calcId];
    if (!calc) return;

    var values = {};
    for (var i = 0; i < calc.inputs.length; i++) {
      var inp = calc.inputs[i];
      var el = document.getElementById('rt-' + calcId + '-' + inp.id);
      if (!el) return;
      var val = parseFloat(el.value);
      if (isNaN(val)) {
        showCalcResult(calcId, '<span class="rt-calc-error">Fill all fields</span>');
        return;
      }
      values[inp.id] = val;
    }

    var results = calc.compute(values);
    var html = '';
    for (var j = 0; j < results.length; j++) {
      html += '<div class="rt-calc-result-row">';
      html += '<span class="rt-calc-result-label">' + escapeHtml(results[j].label) + ':</span> ';
      html += '<span class="rt-calc-result-value">' + results[j].value;
      if (results[j].unit) html += ' ' + escapeHtml(results[j].unit);
      html += '</span></div>';
    }
    showCalcResult(calcId, html);
  }

  function showCalcResult(calcId, html) {
    var el = document.querySelector('[data-calc-result="' + calcId + '"]');
    if (el) el.innerHTML = html;
  }

  /* ═══════════════════════════════════════════
     UTILS
     ═══════════════════════════════════════════ */

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ═══════════════════════════════════════════
     REGISTER
     ═══════════════════════════════════════════ */

  window.ModuleRegistry.register('rulesthumb', {
    title:        'Rules of Thumb',
    icon:         'drafting-compass',
    init:          init
  });

})();
