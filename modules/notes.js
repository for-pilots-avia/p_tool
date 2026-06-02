/* modules/notes.js — Stub (WIP) */

function initNotes() {
  var container = document.getElementById('notesContainer');
  if (!container) return;

  var left   = document.getElementById('headerLeft');
  var center = document.getElementById('headerCenter');
  var right  = document.getElementById('headerRight');
  if (left) {
    left.innerHTML = '<button class="icon-btn" aria-label="Назад">'
      + window.ICONS['arrow-left'] + '</button>';
    left.onclick = function() { app.navigateTo('main'); };
  }
  if (center) center.innerHTML = '<div class="hc-default">Рукописные заметки</div>';
  if (right)  { right.innerHTML = ''; right.onclick = null; }

  container.innerHTML = '<div class="module-container" style="padding-top:16px;padding-bottom:32px;">'
    + '<div class="ct-empty-state">'
    + window.ICONS['edit-3']
    + '<div class="ct-empty-title">Рукописные заметки</div>'
    + '<div class="ct-empty-text">Рисование и заметки. Модуль в разработке.</div>'
    + '</div></div>';
}
