/* ═══════════════════════════════════════════
   Pilot's Tool — modules/ffstraining/index.js
   Модуль «FFS Training» — заглушка
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

    center.innerHTML = '<div class="hc-default">FFS Training</div>';

    right.innerHTML = '';
    right.onclick = null;
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */

  function init() {
    var container = document.getElementById('ffstrainingContainer');
    if (!container) { console.error('Контейнер ffstrainingContainer не найден!'); return; }

    container.innerHTML = '<div class="module-container" style="padding-top:16px;padding-bottom:32px;">'
      + '<div class="ct-empty-state">'
      + '<div class="ct-empty-icon">' + (window.ICONS['monitor'] || '') + '</div>'
      + '<div class="ct-empty-title">FFS Training</div>'
      + '<div class="ct-empty-text">Модуль в разработке. Здесь будет тренировка на полном тренажёре (Full Flight Simulator).</div>'
      + '</div></div>';
  }

  /* ═══════════════════════════════════════════
     REGISTER
     ═══════════════════════════════════════════ */

  window.ModuleRegistry.register('ffstraining', {
    title:       'FFS Training',
    icon:        'monitor',
    init:        init,
    renderHeader: renderHeader
  });

})();
