/* ═══════════════════════════════════════════
   Pilot's Tool — modules/checkride/index.js
   Модуль «Checkride» — заглушка
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

    center.innerHTML = '<div class="hc-default">Checkride</div>';

    right.innerHTML = '';
    right.onclick = null;
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */

  function init() {
    var container = document.getElementById('checkrideContainer');
    if (!container) { console.error('Контейнер checkrideContainer не найден!'); return; }

    container.innerHTML = '<div class="module-container" style="padding-top:16px;padding-bottom:32px;">'
      + '<div class="ct-empty-state">'
      + '<div class="ct-empty-icon">' + (window.ICONS['badge-check'] || '') + '</div>'
      + '<div class="ct-empty-title">Checkride</div>'
      + '<div class="ct-empty-text">Модуль в разработке. Здесь будет подготовка и проверка знаний для checkride.</div>'
      + '</div></div>';
  }

  /* ═══════════════════════════════════════════
     REGISTER
     ═══════════════════════════════════════════ */

  window.ModuleRegistry.register('checkride', {
    title:       'Checkride',
    icon:        'badge-check',
    init:        init,
    renderHeader: renderHeader
  });

})();
