/* ═══════════════════════════════════════════
   Pilot's Tool — modules/metbriefing/index.js
   Модуль «Метео брифинг» — заглушка
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

    center.innerHTML = '<div class="hc-default">Метео брифинг</div>';

    right.innerHTML = '';
    right.onclick = null;
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */

  function init() {
    var container = document.getElementById('metbriefingContainer');
    if (!container) { console.error('Контейнер metbriefingContainer не найден!'); return; }

    container.innerHTML = '<div class="module-container" style="padding-top:16px;padding-bottom:32px;">'
      + '<div class="ct-empty-state">'
      + '<div class="ct-empty-icon">' + (window.ICONS['cloud-lightning'] || '') + '</div>'
      + '<div class="ct-empty-title">Метео брифинг</div>'
      + '<div class="ct-empty-text">Модуль в разработке. Здесь будет метеорологическая информация и брифинг перед вылетом.</div>'
      + '</div></div>';
  }

  /* ═══════════════════════════════════════════
     REGISTER
     ═══════════════════════════════════════════ */

  window.ModuleRegistry.register('metbriefing', {
    title:       'Метео брифинг',
    icon:        'cloud-lightning',
    init:        init,
    renderHeader: renderHeader
  });

})();
