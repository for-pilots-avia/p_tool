/* ═══════════════════════════════════════════
   Pilot's Tool — modules/faq/index.js
   Модуль «FAQ»
   ═══════════════════════════════════════════ */

(function() {
  'use strict';

  var _data = null;

  /* ═══════════════════════════════════════════
     HEADER
     ═══════════════════════════════════════════ */

  function renderHeader() {
    var left   = document.getElementById('headerLeft');
    var center = document.getElementById('headerCenter');
    var right  = document.getElementById('headerRight');
    if (!left || !center || !right) return;

    left.innerHTML = '<button class="icon-btn" aria-label="Меню">'
      + window.ICONS['menu'] + '</button>';
    left.onclick = function() { app.toggleMenu(); };

    center.innerHTML = '<div class="hc-module">FAQ</div>';

    right.innerHTML = '';
    right.onclick = null;
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */

  function init(params) {
    // params — всегда объект (контракт MODULE_CONTRACT §5)
    var container = document.getElementById('faqContainer');
    if (!container) { console.error('Контейнер faqContainer не найден!'); return; }

    /* Делегирование: init() вызывается строго один раз (контракт MODULE_CONTRACT §5) */
    container.addEventListener('click', function(e) {
      var pill = e.target.closest('.faq-toc-pill');
      if (pill) {
        var sectionId = pill.dataset.section;
        if (sectionId) scrollToSection(sectionId);
        return;
      }
    });

    if (_data) {
      renderAll();
      return;
    }

    app.showSkeleton(container, 'list');

    fetch('modules/faq/data/faq.json')
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        _data = data;
        renderAll();
      })
      .catch(function(err) {
        app.showError(container, 'Не удалось загрузить данные');
        console.error('faq fetch error:', err);
      });
  }

  /* ═══════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════ */

  function renderAll() {
    var container = document.getElementById('faqContainer');
    if (!container || !_data) return;

    var html = '<div class="module-container">';

    // TOC pills
    html += '<div class="faq-toc"><div class="faq-toc-inner">';
    if (_data.sections) {
      for (var i = 0; i < _data.sections.length; i++) {
        var s = _data.sections[i];
        html += '<button class="faq-toc-pill' + (i === 0 ? ' faq-toc-pill--active' : '') + '" data-section="' + s.id + '">' + s.title + '</button>';
      }
    }
    if (_data.links && _data.links.length > 0) {
      html += '<button class="faq-toc-pill" data-section="faq-links">Полезные ссылки</button>';
    }
    html += '</div></div>';

    // Sections
    if (_data.sections) {
      for (var j = 0; j < _data.sections.length; j++) {
        var sec = _data.sections[j];
        html += '<section id="' + sec.id + '" class="faq-section">';
        html += '<h2 class="faq-section-title">' + sec.title + '</h2>';
        var paragraphs = sec.content.split('\n\n');
        for (var k = 0; k < paragraphs.length; k++) {
          html += '<p class="faq-paragraph">' + paragraphs[k] + '</p>';
        }
        /* Install URL link */
        if (sec.url) {
          html += '<a href="' + sec.url + '" target="_blank" rel="noopener noreferrer" class="faq-install-url">';
          html += '<span class="faq-install-url-label">Открыть сайт приложения</span>';
          html += '<span class="faq-install-url-icon">' + (window.ICONS['external-link'] || '') + '</span>';
          html += '</a>';
        }
        /* Contact links */
        if (sec.contactLinks && sec.contactLinks.length > 0) {
          html += '<div class="faq-contacts-grid">';
          for (var c = 0; c < sec.contactLinks.length; c++) {
            var cl = sec.contactLinks[c];
            html += '<a href="' + cl.url + '" target="_blank" rel="noopener noreferrer" class="faq-contact-card">';
            html += '<div class="faq-contact-icon">' + (window.ICONS[cl.icon] || '') + '</div>';
            html += '<div class="faq-contact-content">';
            html += '<span class="faq-contact-label">' + cl.label + '</span>';
            html += '<span class="faq-contact-type">' + (cl.type === 'email' ? 'Электронная почта' : 'Telegram') + '</span>';
            html += '</div></a>';
          }
          html += '</div>';
        }
        html += '</section>';
      }
    }

    // Links
    if (_data.links && _data.links.length > 0) {
      html += '<section id="faq-links" class="faq-section">';
      html += '<h2 class="faq-section-title">Полезные ссылки</h2>';
      html += '<div class="faq-links-grid">';
      for (var l = 0; l < _data.links.length; l++) {
        var link = _data.links[l];
        html += '<a href="' + link.url + '" target="_blank" rel="noopener noreferrer" class="faq-link-card">';
        html += '<div class="faq-link-icon">' + (window.ICONS['external-link'] || '') + '</div>';
        html += '<div class="faq-link-content">';
        html += '<span class="faq-link-label">' + link.label + '</span>';
        if (link.desc) html += '<span class="faq-link-desc">' + link.desc + '</span>';
        html += '</div></a>';
      }
      html += '</div></section>';
    }

    html += '</div>';
    app.hideSkeleton(container, html);
  }

  /* ═══════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════ */

  function scrollToSection(id) {
    /* Update active pill */
    var ct = document.getElementById('faqContainer');
    if (ct) {
      var pills = ct.querySelectorAll('.faq-toc-pill');
      for (var p = 0; p < pills.length; p++) {
        pills[p].classList.remove('faq-toc-pill--active');
        if (pills[p].dataset.section === id) {
          pills[p].classList.add('faq-toc-pill--active');
        }
      }
    }
    var el = document.getElementById(id);
    if (el) {
      var headerOffset = 56 + 52 + 16;
      var y = el.getBoundingClientRect().top + window.pageYOffset - headerOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  }

  /* ═══════════════════════════════════════════
     REGISTER
     ═══════════════════════════════════════════ */

  window.ModuleRegistry.register('faq', {
    title:        'FAQ',
    icon:         'help-circle',
    init:          init,
    renderHeader:  renderHeader
  });

})();
