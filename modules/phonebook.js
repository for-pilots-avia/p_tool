/* ═══════════════════════════════════════════
   Pilot's Tool — modules/phonebook.js
   Модуль «Телефонный справочник»
   ═══════════════════════════════════════════ */

/* ─── Stub data ─── */
var _pbContacts = [
  { name: 'Диспетчерская',    position: 'ОПИ / Диспетчер',   phone: '+7 (495) 576-10-01' },
  { name: 'Иванов А.С.',      position: 'КВС / Инструктор',  phone: '+7 (916) 123-45-67' },
  { name: 'Петрова М.В.',     position: 'Ст. бортпроводник', phone: '+7 (926) 987-65-43' },
  { name: 'Служба безопасности', position: 'SB / Дежурный',  phone: '+7 (495) 576-20-02' }
];

/* ═══════════════════════════════════════════
   HEADER
   ═══════════════════════════════════════════ */

function pbRenderHeader() {
  var left   = document.getElementById('headerLeft');
  var center = document.getElementById('headerCenter');
  var right  = document.getElementById('headerRight');
  if (!left || !center || !right) return;

  left.innerHTML = '<button class="icon-btn" aria-label="Назад">'
    + window.ICONS['arrow-left'] + '</button>';
  left.onclick = function() { app.navigateTo('main'); };

  center.innerHTML = '<div class="hc-default">Телефонный справочник</div>';

  right.innerHTML = '';
  right.onclick = null;
}

/* ═══════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════ */

function pbRenderAll() {
  var container = document.getElementById('phonebookContainer');
  if (!container) return;

  var html = '<div class="module-container" style="padding-top:16px;padding-bottom:32px;">';

  /* Search input */
  html += '<div style="margin-bottom:16px;">';
  html += '<div style="position:relative;">';
  html += '<div style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--color-text-muted);display:flex;align-items:center;">'
    + window.ICONS.search + '</div>';
  html += '<input id="pbSearchInput" type="text" class="wt-field-input" placeholder="Поиск по имени или должности..."'
    + ' style="padding-left:40px;">';
  html += '</div>';
  html += '</div>';

  /* Contact cards */
  for (var i = 0; i < _pbContacts.length; i++) {
    var c = _pbContacts[i];
    html += '<div class="app-card contact-item" data-idx="' + i + '">';
    html += '<div style="display:flex;align-items:center;gap:12px;">';
    html += '<div style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;background:var(--color-primary-ghost);color:var(--color-primary);flex-shrink:0;">'
      + window.ICONS.phone + '</div>';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="font-size:var(--font-base);font-weight:600;color:var(--color-text-main);">' + c.name + '</div>';
    html += '<div style="font-size:var(--font-sm);color:var(--color-text-secondary);">' + c.position + '</div>';
    html += '</div>';
    html += '<a href="tel:' + c.phone.replace(/[\s()-]/g, '') + '" class="contact-phone" style="display:inline-flex;align-items:center;gap:6px;font-size:var(--font-sm);font-weight:600;color:var(--color-primary);text-decoration:none;flex-shrink:0;">'
      + window.ICONS.phone + ' ' + c.phone + '</a>';
    html += '</div>';
    html += '</div>';
  }

  html += '</div>';
  container.innerHTML = html;
}

/* ═══════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════ */

function initPhonebook() {
  var container = document.getElementById('phonebookContainer');
  if (!container) { console.error('Контейнер phonebookContainer не найден!'); return; }

  if (!container.dataset.delegated) {
    container.addEventListener('click', function(e) {
      if (e.target.closest('.contact-phone')) {
        /* Let the tel: link work natively */
        return;
      }
    });
    container.dataset.delegated = 'true';
  }

  pbRenderHeader();
  pbRenderAll();
}
