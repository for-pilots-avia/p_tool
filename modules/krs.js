/* modules/krs.js — Stub (WIP) */

function initKRS() {
  var container = document.getElementById('krsContainer');
  if (!container) return;

  var left   = document.getElementById('headerLeft');
  var center = document.getElementById('headerCenter');
  var right  = document.getElementById('headerRight');
  if (left) {
    left.innerHTML = '<button class="icon-btn" aria-label="Назад">'
      + window.ICONS['arrow-left'] + '</button>';
    left.onclick = function() { app.navigateTo('main'); };
  }
  if (center) center.innerHTML = '<div class="hc-default">Указания КРС</div>';
  if (right)  { right.innerHTML = ''; right.onclick = null; }

  container.innerHTML = '<div class="module-container" style="padding-top:16px;padding-bottom:32px;">'
    + '<div class="ct-empty-state">'
    + window.ICONS['file-text']
    + '<div class="ct-empty-title">Указания КРС</div>'
    + '<div class="ct-empty-text">Контрольные руководства и указания. Модуль в разработке.</div>'
    + '</div></div>';
}
