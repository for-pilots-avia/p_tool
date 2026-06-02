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

    left.innerHTML = '<button class="icon-btn" aria-label="Назад">'
      + window.ICONS['arrow-left'] + '</button>';
    left.onclick = function() { app.navigateTo('main'); };

    center.innerHTML = '<div class="hc-module">FAQ</div>';

    right.innerHTML = '';
    right.onclick = null;
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */

  function init() {
    var container = document.getElementById('faqContainer');
    if (!container) { console.error('Контейнер faqContainer не найден!'); return; }

    if (!container.dataset.delegated) {
      container.addEventListener('click', function(e) {
        var pill = e.target.closest('.faq-toc-pill');
        if (pill) {
          var sectionId = pill.dataset.section;
          if (sectionId) scrollToSection(sectionId);
          return;
        }
      });
      container.dataset.delegated = 'true';
    }

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

    var html = '<div>';

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
