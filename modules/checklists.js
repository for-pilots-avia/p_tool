/* modules/checklists.js — Stub (WIP) */

function initChecklists() {
  var container = document.getElementById('checklistsContainer');
  if (!container) return;

  var left   = document.getElementById('headerLeft');
  var center = document.getElementById('headerCenter');
  var right  = document.getElementById('headerRight');
  if (left) {
    left.innerHTML = '<button class="icon-btn" aria-label="Назад">'
      + window.ICONS['arrow-left'] + '</button>';
    left.onclick = function() { app.navigateTo('main'); };
  }
  if (center) center.innerHTML = '<div class="hc-default">Чеклисты (SAFA / Customs)</div>';
  if (right)  { right.innerHTML = ''; right.onclick = null; }

  container.innerHTML = '<div class="module-container" style="padding-top:16px;padding-bottom:32px;">'
    + '<div class="ct-empty-state">'
    + window.ICONS.checklist
    + '<div class="ct-empty-title">Чеклисты</div>'
    + '<div class="ct-empty-text">SAFA и Customs чеклисты. Модуль в разработке.</div>'
    + '</div></div>';
}
