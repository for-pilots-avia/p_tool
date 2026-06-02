/* modules/flightprocedures.js — Stub (WIP) */

function initFlightProcedures() {
  var container = document.getElementById('flightproceduresContainer');
  if (!container) return;

  var left   = document.getElementById('headerLeft');
  var center = document.getElementById('headerCenter');
  var right  = document.getElementById('headerRight');
  if (left) {
    left.innerHTML = '<button class="icon-btn" aria-label="Назад">'
      + window.ICONS['arrow-left'] + '</button>';
    left.onclick = function() { app.navigateTo('main'); };
  }
  if (center) center.innerHTML = '<div class="hc-default">Лётные процедуры</div>';
  if (right)  { right.innerHTML = ''; right.onclick = null; }

  container.innerHTML = '<div class="module-container" style="padding-top:16px;padding-bottom:32px;">'
    + '<div class="ct-empty-state">'
    + window.ICONS.plane
    + '<div class="ct-empty-title">Лётные процедуры</div>'
    + '<div class="ct-empty-text">Сборник лётных процедур. Модуль в разработке.</div>'
    + '</div></div>';
}
