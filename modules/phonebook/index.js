/* ═══════════════════════════════════════════
   Pilot's Tool — modules/phonebook/index.js
   Модуль «Телефонный справочник»
   Данные загружаются из data/phonebook.json
   ═══════════════════════════════════════════ */

(function() {
  'use strict';

  /* ─── Приватное состояние ─── */
  var _data      = null;   // кэш загруженных данных
  var _filter    = '';

  /* ─── Pilot avatar icon ─── */
  var PILOT_ICON = '<svg width="24" height="24" viewBox="0 0 363 423" fill="none" xmlns="http://www.w3.org/2000/svg">'
    + '<g transform="translate(-184.35791,-213.72734)">'
    + '<path d="m 482.72752,328.2302 c -71.36104,35.0239 -146.86028,34.05803 -226.15625,0.3125 -2.8e-4,6.50813 0,13.52837 0,20.6875 0,62.48388 50.67237,113.125 113.15625,113.125 62.48388,0 113.125,-50.64112 113.125,-113.125 0,-6.04045 -0.0633,-14.25645 -0.125,-21 z" fill="currentColor"/>'
    + '<path d="m 225.85276,235.60872 c 76.09816,0 212.24708,0.71429 288.34524,0.71429 l -29.33647,44.64977 -228.29448,0 z" fill="currentColor"/>'
    + '<path d="m 255.56862,278.54471 c 76.09816,0 152.19632,0 228.29448,0 l 1.01015,40.40611 c -71.99509,35.55996 -148.21857,34.47383 -228.29448,0 z" fill="currentColor"/>'
    + '<path d="m 225.85276,235.60872 c 80.29578,-30.78256 216.12811,-27.74663 288.34524,0.71429 l -29.33647,44.64977 -228.29448,0 z" fill="currentColor"/>'
    + '<path d="m 184.35791,537.53895 107.07617,-47.47717 78.7919,146.47212 -185.86807,0 z" fill="currentColor"/>'
    + '<path d="m 547.4046,537.29402 -107.07617,-47.47717 -78.7919,146.47212 185.86807,0 z" fill="currentColor"/>'
    + '<path d="m 336.89094,470.86885 57.57869,0 -18.18274,45.45686 -21.2132,-10e-6 z" fill="currentColor"/>'
    + '<path d="m 336.38588,628.95773 57.57869,0 -18.18274,-109.09647 -21.2132,2e-5 z" fill="currentColor"/>'
    + '<path d="m 242.33925,582.96075 19.50421,12.69551 19.99181,-12.36998 25.11167,-0.65106 -45.10348,27.99524 -47.54152,-26.36761 z" fill="var(--color-bg-card)" stroke="currentColor" stroke-width="0.3"/>'
    + '<path d="m 334.614,242.56037 39.62979,12.64208 40.6205,-12.31793 51.02336,-0.64832 -91.64386,27.87744 -96.59762,-26.25665 z" fill="var(--color-bg-card)" stroke="currentColor" stroke-width="0.4"/>'
    + '<circle cx="374.624" cy="262.603" r="22.14" fill="var(--color-bg-card)" stroke="var(--color-bg-card)" stroke-width="1"/>'
    + '</g></svg>';

  /* ─── Helpers ─── */

  function isDivider(item) {
    return item && item.type === 'divider';
  }

  function formatPhoneNumber(tel) {
    var digits = tel.replace(/\D/g, '');
    if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
      return '+7 (' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) + '-' + digits.slice(7, 9) + '-' + digits.slice(9, 11);
    }
    return tel;
  }

  function phoneTypeLabel(type) {
    if (type === 'work') return 'раб.';
    if (type === 'home') return 'личн.';
    return '';
  }

  function phoneBadgeClass(type) {
    if (type === 'work') return 'pb-phone-badge pb-phone-badge--work';
    if (type === 'home') return 'pb-phone-badge pb-phone-badge--personal';
    return 'pb-phone-badge';
  }

  /* ═══════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════ */

  function renderAll() {
    var container = document.getElementById('phonebookContainer');
    if (!container || !_data) return;

    // Filter items
    var filtered = [];
    var q = _filter.trim().toLowerCase();
    for (var i = 0; i < _data.length; i++) {
      var item = _data[i];
      if (isDivider(item)) {
        if (!q) filtered.push(item); // keep dividers only when not searching
        continue;
      }
      if (!q) { filtered.push(item); continue; }
      var nameMatch = item.name.toLowerCase().indexOf(q) >= 0;
      var posMatch = item.position ? item.position.toLowerCase().indexOf(q) >= 0 : false;
      var emailMatch = item.email ? item.email.toLowerCase().indexOf(q) >= 0 : false;
      var phoneMatch = false;
      if (item.phones) {
        for (var p = 0; p < item.phones.length; p++) {
          if (item.phones[p].tel.indexOf(q) >= 0 || item.phones[p].display.toLowerCase().indexOf(q) >= 0) {
            phoneMatch = true; break;
          }
        }
      }
      if (nameMatch || posMatch || emailMatch || phoneMatch) {
        filtered.push(item);
      }
    }

    var hasContacts = false;
    for (var h = 0; h < filtered.length; h++) {
      if (!isDivider(filtered[h])) { hasContacts = true; break; }
    }

    var html = '<div class="module-container">';

    /* Search bar */
    html += '<div class="ct-search-bar">';
    html += '<div class="ct-search-input-wrap">';
    html += '<span class="ct-search-icon">' + window.ICONS.search + '</span>';
    html += '<input type="text" class="ct-search-input" placeholder="Поиск по имени, должности, телефону…"'
      + ' value="' + window.app.escapeAttr(_filter || '') + '">';
    if (_filter) {
      html += '<button class="ct-search-clear visible" aria-label="Очистить">' + window.ICONS.x + '</button>';
    }
    html += '</div>';
    html += '</div>';

    if (!hasContacts) {
      html += '<div class="pb-empty">';
      html += '<div class="pb-empty-icon">' + window.ICONS.search + '</div>';
      html += '<p class="pb-empty-text">Ничего не найдено</p>';
      html += '<p class="pb-empty-sub">Попробуйте изменить запрос</p>';
      html += '</div>';
    } else {
      html += '<div class="pb-list">';
      for (var j = 0; j < filtered.length; j++) {
        var entry = filtered[j];
        if (isDivider(entry)) {
          html += '<div class="pb-divider">';
          if (entry.label) {
            // §13 v6.0: поля с <b>/<i>/<br>/\n → renderRichText (sanitize + разрешённые теги + wrapLongWords)
            var divLabelAttr = window.app.langAttr(entry.label);
            var divLabelContent = window.app.renderRichText(entry.label);
            html += '<span class="pb-divider-label"' + divLabelAttr + '>' + divLabelContent + '</span>';
          }
          html += '</div>';
        } else {
          html += renderContactCard(entry);
        }
      }
      html += '</div>';
    }

    html += '</div>';
    app.hideSkeleton(container, html);

    // Bind search input
    bindSearchInput();

    // Bind clear button
    var clearBtn = container.querySelector('.ct-search-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        _filter = '';
        renderAll();
        var inp = container.querySelector('.ct-search-input');
        if (inp) inp.focus();
      });
    }
  }

  /* ─── Contact card HTML ─── */

  function renderContactCard(contact) {
    var html = '<div class="app-card pb-card">';
    html += '<div class="pb-card-inner">';

    // Avatar — pilot icon
    html += '<div class="pb-avatar">';
    html += PILOT_ICON;
    html += '</div>';

    // Info
    html += '<div class="pb-card-info">';
    var nameLang = window.app.detectLang(contact.name);
    var nameAttrStr = window.app.langAttr(contact.name);
    var nameContent = (nameLang === 'ru') ? window.app.wrapLongWords(contact.name, 8) : window.app.escapeHtml(contact.name);
    html += '<div class="pb-card-name"' + nameAttrStr + '>' + nameContent + '</div>';
    if (contact.position) {
      var posLang = window.app.detectLang(contact.position);
      var posAttrStr = window.app.langAttr(contact.position);
      var posContent = (posLang === 'ru') ? window.app.wrapLongWords(contact.position, 8) : window.app.escapeHtml(contact.position);
      html += '<div class="pb-card-position"' + posAttrStr + '>' + posContent + '</div>';
    }

    // Phones
    if (contact.phones && contact.phones.length > 0) {
      html += '<div class="pb-phones">';
      for (var i = 0; i < contact.phones.length; i++) {
        var phone = contact.phones[i];
        html += '<div class="pb-phone-row">';
        html += '<a href="tel:' + window.app.escapeAttr(phone.tel) + '" class="pb-phone-link">';
        html += '<span class="pb-phone-icon">' + window.ICONS.phone + '</span>';
        html += '<span class="pb-phone-number">' + window.app.escapeHtml(formatPhoneNumber(phone.tel)) + '</span>';
        if (phoneTypeLabel(phone.type)) {
          html += '<span class="' + phoneBadgeClass(phone.type) + '">' + phoneTypeLabel(phone.type) + '</span>';
        }
        html += '</a>';
        html += '<button class="pb-copy-btn" data-phone="' + window.app.escapeAttr(phone.tel) + '" aria-label="Скопировать номер">';
        html += window.ICONS['clipboard-check'] || window.ICONS.check;
        html += '</button>';
        html += '</div>';
      }
      html += '</div>';
    }

    // Email
    if (contact.email) {
      html += '<div class="pb-email-row">';
      html += '<a href="mailto:' + window.app.escapeAttr(contact.email) + '" class="pb-email-link">';
      html += '<span class="pb-email-icon">' + (window.ICONS['mail'] || '') + '</span>';
      html += '<span class="pb-email-text">' + window.app.escapeHtml(contact.email) + '</span>';
      html += '</a>';
      html += '<a href="mailto:' + window.app.escapeAttr(contact.email) + '" class="pb-mail-btn" aria-label="Написать письмо">';
      html += window.ICONS['mail'] || '';
      html += '</a>';
      html += '</div>';
    }

    html += '</div>'; // pb-card-info
    html += '</div>'; // pb-card-inner
    html += '</div>'; // pb-card
    return html;
  }

  /* ─── Event binding ─── */

  function bindSearchInput() {
    var container = document.getElementById('phonebookContainer');
    if (!container) return;
    var input = container.querySelector('.ct-search-input');
    if (input) {
      input.addEventListener('input', function(e) {
        _filter = e.target.value;
        renderAll();
        // Restore focus and cursor
        var inp = container.querySelector('.ct-search-input');
        if (inp) {
          inp.focus();
          inp.setSelectionRange(_filter.length, _filter.length);
        }
      });
    }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        app.showToast('Номер скопирован');
      }).catch(function() {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    app.showToast('Номер скопирован');
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */

  function init() {
    var container = document.getElementById('phonebookContainer');
    if (!container) { console.error('Контейнер phonebookContainer не найден!'); return; }
    container.setAttribute('lang', 'ru');

    // Делегирование: вешать ровно ОДИН раз
    // Делегирование: init() вызывается строго один раз (MODULE_CONTRACT §5)
    container.addEventListener('click', function(e) {
        // Copy button
        var copyBtn = e.target.closest('.pb-copy-btn');
        if (copyBtn) {
          e.preventDefault();
          e.stopPropagation();
          var tel = copyBtn.getAttribute('data-phone');
          if (tel) copyToClipboard(tel);
          return;
        }
        // Let tel: and mailto: links work natively
      });

    _filter = '';

    // Загрузка данных
    if (_data) {
      renderAll();
      return;
    }

    app.showSkeleton(container, 'list');

    fetch('modules/phonebook/data/phonebook.json')
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(json) {
        _data = json.contacts || [];
        renderAll();
      })
      .catch(function(err) {
        app.showError(container, 'Не удалось загрузить данные');
        console.error('phonebook fetch error:', err);
      });
  }

  /* ═══════════════════════════════════════════
     REGISTER MODULE
     ═══════════════════════════════════════════ */

  window.ModuleRegistry.register('phonebook', {
    title:       'Телефонный справочник',
    icon:        'phone',
    containerId: 'phonebookContainer',
    screenId:    'phonebookScreen',
    init:        init
  });

})();
