/* ═══════════════════════════════════════════
   Pilot's Tool — modules/flightprocedures/index.js
   Модуль «Лётные процедуры» — заглушка
   ═══════════════════════════════════════════ */

(function() {
  'use strict';

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

    center.innerHTML = '<div class="hc-default">Лётные процедуры</div>';

    right.innerHTML = '';
    right.onclick = null;
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */

  function init() {
    var container = document.getElementById('flightproceduresContainer');
    if (!container) { console.error('Контейнер flightproceduresContainer не найден!'); return; }

    container.innerHTML = '<div class="module-container" style="padding-top:16px;padding-bottom:32px;">'
      + '<div class="ct-empty-state">'
      + '<div class="ct-empty-icon">' + (window.ICONS['plane-takeoff'] || '') + '</div>'
      + '<div class="ct-empty-title">Лётные процедуры</div>'
      + '<div class="ct-empty-text">Модуль в разработке. Здесь будут доступны стандартные процедуры по этапам полёта.</div>'
      + '</div></div>';
  }

  /* ═══════════════════════════════════════════
     REGISTER
     ═══════════════════════════════════════════ */

  window.ModuleRegistry.register('flightprocedures', {
    title:       'Лётные процедуры',
    icon:        'plane-takeoff',
    init:        init,
    renderHeader: renderHeader
  });

})();
