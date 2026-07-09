/* ═══════════════════════════════════════════
   Pilot's Tool — modules/flightprocedures/index.js
   Модуль «Лётные процедуры» (Unified FP + FFS)
   v3: симметричное дерево блоков, расширенный rich-text
   ═══════════════════════════════════════════ */

(function() {
  'use strict';

  /* ─── Идентификация модуля ─── */
  var MODULE_ID    = 'flightprocedures';
  var CSS_PREFIX   = 'flightprocedures';
  var CONTAINER_ID = 'flightproceduresContainer';
  var DATA_URL     = 'modules/flightprocedures/data/flightprocedures.json';

  /* ─── Приватное состояние ─── */
  var _data      = null;   // кэш загруженных данных
  var _filter    = '';     // текущий поисковый запрос
  var _htmlCache = {};     // кэш загруженных HTML-файлов для tableFile

  /* ─── Унифицированная палитра (5 цветов для badge и items) ───
     success   → синий     (#17a2b8)
     normal    → зелёный   (#28a745)
     abnormal  → оранжевый (#ffc107)
     emergency → красный   (#dc3545)
     info      → наследует родителя (прозрачный)
     Алиасы (aviation-термины) → canonical palette для backward-compat. */
  var PALETTES = ['success', 'normal', 'abnormal', 'emergency', 'info'];

  var PALETTE_ALIASES = {
    'neutral': 'info'
  };

  /* ─── Legacy [data-style] палитра для block-renderers (callout/note/caution/...) ───
     Используется только в blocks[] (backward-compat с v3).
     Не путать с PALETTES — это отдельная палитра для [data-style] атрибута. */
  var VALID_STYLES = ['neutral', 'info', 'success', 'warning', 'danger'];

  function resolvePalette(name) {
    if (!name) return 'info';
    if (PALETTE_ALIASES[name]) return PALETTE_ALIASES[name];
    if (PALETTES.indexOf(name) >= 0) return name;
    return 'info';
  }

  /* ─── Inline badge renderer ───
     Заменяет {{badge:PALETTE}} и {{badge:PALETTE:LABEL}}
     на HTML-элемент бейджа.
     LABEL проходит через renderRichText (может содержать <b>, {{link:...}}).
     Вызывается ПОСЛЕ экранирования, НО до renderInlineLinks.
  */
  function renderInlineBadges(text) {
    if (!text) return '';
    return text.replace(/\{\{badge:(\w+)(?::([^}]+))?\}\}/g, function(match, type, label) {
      var palette = resolvePalette(type);
      if (PALETTES.indexOf(palette) < 0) return match;
      var badgeLabel = label || palette;
      return '<span class="badge badge--' + palette + '">' + window.app.escapeHtml(badgeLabel) + '</span>';
    });
  }

  /* ═══════════════════════════════════════════
     RICH TEXT (расширенный парсер v3)
     ═══════════════════════════════════════════ */

  /* ─── Whitelist тегов и атрибутов ───
     Расширено для поддержки HTML-таблиц (colspan/rowspan),
     img (src/alt/width/height), a (href/title), span, div, p, hr.
     Атрибуты кроме перечисленных — удаляются (XSS-safe).
  */
  /* RICH_TEXT_TAGS — узкий whitelist для строковых полей JSON (MODULE_CONTRACT §13).
     Разрешены только базовые inline-теги. Таблицы/img/a обрабатываются через sanitizeHtml. */
  var RICH_TEXT_TAGS = {
    'b': true, 'i': true, 'em': true, 'strong': true, 'u': true, 's': true,
    'br': true, 'hr': true,
    'ul': true, 'ol': true, 'li': true,
    'sup': true, 'sub': true,
    'p': true
  };

  /* SANITIZER_TAGS — расширенный whitelist для HTML-файлов (tableFile) и inline tableHtml.
     Не подпадает под §13 (это не JSON-данные, это уже HTML). */
  var SANITIZER_TAGS = {
    'b': true, 'i': true, 'em': true, 'strong': true, 'u': true, 's': true,
    'br': true, 'hr': true,
    'ul': true, 'ol': true, 'li': true,
    'sup': true, 'sub': true,
    'p': true, 'span': true, 'div': true,
    'table': true, 'thead': true, 'tbody': true, 'tfoot': true,
    'tr': true, 'th': true, 'td': true,
    'col': true, 'colgroup': true, 'caption': true,
    'img': true, 'a': true,
    'figure': true, 'figcaption': true, 'blockquote': true
  };

  var ALLOWED_ATTRS = {
    'a':        ['href', 'title'],
    'img':      ['src', 'alt', 'width', 'height'],
    'td':       ['colspan', 'rowspan', 'style'],
    'th':       ['colspan', 'rowspan', 'style'],
    'table':    ['style'],
    'col':      ['span'],
    'colgroup': ['span']
  };

  /* void elements — самозакрывающиеся */
  var VOID_TAGS = { 'br': true, 'hr': true, 'img': true, 'col': true };

  /* escapeHtml/escapeAttr: прямой вызов window.app.* (MODULE_CONTRACT v5.3, алиасы запрещены) */

  /* ─── Парсер одного тега ───
     Возвращает {name, isClosing, isSelfClosing, attrStr} или null.
     attrStr — sanitized строка атрибутов (готовая для вставки в HTML).
  */
  function parseTag(tagBody) {
    var trimmed = tagBody.trim();
    if (!trimmed) return null;
    var isClosing = trimmed.charAt(0) === '/';
    if (isClosing) trimmed = trimmed.substring(1).trim();
    var isSelfClosing = trimmed.charAt(trimmed.length - 1) === '/';
    if (isSelfClosing) trimmed = trimmed.substring(0, trimmed.length - 1).trim();
    var spaceIdx = trimmed.search(/\s/);
    var name, attrPart;
    if (spaceIdx < 0) {
      name = trimmed.toLowerCase();
      attrPart = '';
    } else {
      name = trimmed.substring(0, spaceIdx).toLowerCase();
      attrPart = trimmed.substring(spaceIdx + 1).trim();
    }
    var allowedForTag = ALLOWED_ATTRS[name] || [];
    var attrStr = '';
    if (attrPart && allowedForTag.length) {
      var attrRegex = /(\w[\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
      var m;
      while ((m = attrRegex.exec(attrPart)) !== null) {
        var attrName = m[1].toLowerCase();
        var attrVal = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] || ''));
        if (allowedForTag.indexOf(attrName) < 0) continue;
        // блокируем javascript: в href/src
        if ((attrName === 'href' || attrName === 'src') && /^\s*javascript:/i.test(attrVal)) continue;
        attrStr += ' ' + attrName + '="' + window.app.escapeAttr(attrVal) + '"';
      }
      if (name === 'a' && /href=/.test(attrStr)) {
        attrStr += ' target="_blank" rel="noopener noreferrer"';
      }
    }
    return {
      name: name,
      isClosing: isClosing,
      isSelfClosing: isSelfClosing,
      attrStr: attrStr
    };
  }

  /* ─── Aliases для shared-утилит (MODULE_CONTRACT §7, §13 с v5.0) ───
     Модули ИСПОЛЬЗУЮТ app.*, НЕ дублируют.
     renderRichText теперь поддерживает {{badge:}} + {{link:}} (app.js v5.0).
     wrapLongEnglishWords — обёртка над app.wrapLongWords с защитой от
     модификации HTML-атрибутов (badge--abnormal → не должно оборачиваться). */
  function wrapLongEnglishWords(html) {
    if (!html) return '';
    var s = String(html);
    var parts = s.split(/(<[^>]+>)/);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].charAt(0) === '<') continue; /* HTML-тег — пропускаем */
      parts[i] = window.app.wrapLongWords(parts[i], 8);
    }
    return parts.join('');
  }

  /* langAttr: прямой вызов window.app.langAttr() (MODULE_CONTRACT v5.3, алиасы запрещены) */
  /* renderRichText: обёртка над app.renderRichText с защитой badge/link.
     app.renderRichText шаг 6 вызывает wrapLongWords(s,14) по всей строке,
     включая HTML-атрибуты → badge--abnormal (16) обёртывается в <span lang="en">.
     Поскольку app.js править запрещено (shell), защищаем на стороне модуля:
     1. Заменяем {{badge:...}} и {{link:...}} на короткие плейсхолдеры (\x01B0\x01)
     2. Вызываем app.renderRichText (не найдёт badge/link — не создаст HTML)
     3. Восстанавливаем badge/link HTML на место плейсхолдеров */
  var _badgeStore = [];
  var _linkStore = [];
  function _prepareRichText(html) {
    _badgeStore = [];
    _linkStore = [];
    var s = html;
    // Сохраняем badge-паттерны
    s = s.replace(/\{\{badge:(\w+)(?::([^}]+))?\}\}/g, function(match, type, label) {
      var palette = resolvePalette(type);
      if (PALETTES.indexOf(palette) < 0) return match;
      var badgeLabel = label || palette;
      var idx = _badgeStore.length;
      _badgeStore.push('<span class="badge badge--' + palette + '">' + window.app.escapeHtml(badgeLabel) + '</span>');
      return '\x01B' + idx + '\x01';
    });
    // Сохраняем link-паттерны
    s = s.replace(/\{\{link:([\w-]+):([\w-]+):([^}]+)\}\}/g, function(match, mod, id, lbl) {
      var idx = _linkStore.length;
      _linkStore.push('<span class="module-link" role="button" tabindex="0"'
        + ' data-module="' + mod + '" data-id="' + id + '">' + lbl + '</span>');
      return '\x01L' + idx + '\x01';
    });
    return s;
  }
  function _restoreRichText(html) {
    var s = html;
    for (var i = 0; i < _badgeStore.length; i++) {
      s = s.replace('\x01B' + i + '\x01', _badgeStore[i]);
    }
    for (var j = 0; j < _linkStore.length; j++) {
      s = s.replace('\x01L' + j + '\x01', _linkStore[j]);
    }
    return s;
  }
  /* renderRichText: прямой вызов через плейсхолдеры (MODULE_CONTRACT v5.3, алиасы запрещены) */
  function _renderRichText(html) {
    return _restoreRichText(window.app.renderRichText(_prepareRichText(html)));
  }

  /* _renderPlainText: plain-text рендер для полей без rich-text маркеров.
     escapeHtml + detectLang + wrapLongWords(8) per MODULE_CONTRACT §7 v5.7. */
  function _renderPlainText(text) {
    var t = String(text || '');
    var escaped = window.app.escapeHtml(t);
    return (window.app.detectLang(t) === 'ru')
      ? window.app.wrapLongWords(escaped, 8)
      : escaped;
  }

  /* ─── sanitizeHtml(html) ───
     Фильтрует уже-HTML контент (table files, inline tableHtml):
       - whitelist тегов + whitelist атрибутов
       - НЕ конвертирует \n → <br> (HTML уже размечен)
       - НЕ применяет бейджи/ссылки (это не plain text)
     Используется в fetchTableFile и renderBlockTable.
  */
  function sanitizeHtml(html) {
    if (html === null || html === undefined || html === '') return '';
    var s = String(html);
    var out = '';
    var i = 0;
    while (i < s.length) {
      var ch = s.charAt(i);
      if (ch === '<') {
        var close = s.indexOf('>', i);
        if (close < 0) { out += '&lt;'; i++; continue; }
        var tagBody = s.substring(i + 1, close);
        var parsed = parseTag(tagBody);
        if (parsed && SANITIZER_TAGS[parsed.name]) {
          if (parsed.isClosing) {
            if (!VOID_TAGS[parsed.name]) {
              out += '</' + parsed.name + '>';
            }
          } else {
            out += '<' + parsed.name + parsed.attrStr + '>';
          }
        } else {
          out += '&lt;' + tagBody + '&gt;';
        }
        i = close + 1;
      } else if (ch === '&') {
        var low5 = s.substring(i, i + 5).toLowerCase();
        var low4 = s.substring(i, i + 4).toLowerCase();
        var low6 = s.substring(i, i + 6).toLowerCase();
        if (low5 === '&amp;') { out += '&amp;'; i += 5; }
        else if (low4 === '&lt;') { out += '&lt;'; i += 4; }
        else if (low4 === '&gt;') { out += '&gt;'; i += 4; }
        else if (low6 === '&nbsp;') { out += '&nbsp;'; i += 6; }
        else if (low6 === '&quot;') { out += '&quot;'; i += 6; }
        else if (low5 === '&#39;') { out += '&#39;'; i += 5; }
        else { out += ch; i++; }
      } else {
        out += ch;
        i++;
      }
    }
    // C1 (v4.9.8): оборачиваем EN-слова ≥8 символов в <span lang="en">,
    // чтобы hyphens:auto с lang="ru" на контейнере мог применять EN словарь
    // переноса к ячейкам таблиц (инлайн b.content + внешние HTML-файлы).
    return wrapLongEnglishWords(out);
  }

  /* ─── Inline link renderer ───
     Заменяет {{link:MODULE:ID:LABEL}}
     на кликабельный элемент навигации между модулями.
     Вызывается ПОСЛЕ renderInlineBadges().
  */
  function renderInlineLinks(text) {
    if (!text) return '';
    return text.replace(/\{\{link:(\w+):([^:}]+):([^}]+)\}\}/g, function(match, mod, id, label) {
      return '<span class="module-link" role="button" tabindex="0"'
        + ' data-module="' + mod + '"'
        + ' data-id="' + id + '">'
        + label
        + '</span>';
    });
  }

  /* ─── Combined content renderer (legacy alias) ─── */
  function renderContent(text) {
    return _renderRichText(text);
  }

  /* ═══════════════════════════════════════════
     RESOURCE RESOLVERS
     ═══════════════════════════════════════════ */

  /* ─── resolveDataUrl(src) ───
     Резолвит путь к ресурсу:
       - абсолютный URL (http://, https://, //) → как есть
       - путь от корня public (/...) → как есть
       - "modules/..." → как есть (уже полный путь от public)
       - "docs/..." → "modules/docs/..." (общие медиафайлы)
       - простое имя файла → "modules/{MODULE_ID}/data/{filename}"
  */
  function resolveDataUrl(src) {
    if (!src) return '';
    var s = String(src).trim();
    if (!s) return '';
    if (/^(https?:)?\/\//i.test(s)) return s;
    if (s.charAt(0) === '/') return s;
    if (s.indexOf('modules/') === 0) return s;
    if (s.indexOf('docs/') === 0) return 'modules/' + s;
    return 'modules/' + MODULE_ID + '/data/' + s;
  }

  /* ─── fetchTableFile(src, callback) ───
     Загружает внешний HTML-файл таблицы, sanitize через renderRichText.
     callback(html) — принимает sanitized HTML или сообщение об ошибке.
  */
  function fetchTableFile(src, callback) {
    var url = resolveDataUrl(src);
    if (!url) { callback(''); return; }
    if (_htmlCache[url]) { callback(_htmlCache[url]); return; }
    fetch(url)
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function(html) {
        var sanitized = sanitizeHtml(html);
        _htmlCache[url] = sanitized;
        callback(sanitized);
      })
      .catch(function() {
        callback('<div class="' + CSS_PREFIX + '-table-error">Не удалось загрузить таблицу</div>');
      });
  }

  /* ═══════════════════════════════════════════
     BLOCK RENDERERS (универсальное дерево блоков)
     ═══════════════════════════════════════════ */

  function styleAttr(style) {
    if (!style) return '';
    var s = String(style).toLowerCase();
    if (VALID_STYLES.indexOf(s) >= 0) return ' data-style="' + s + '"';
    return '';
  }

  function styleOrDefault(style, defStyle) {
    var s = style || defStyle || 'neutral';
    s = String(s).toLowerCase();
    if (VALID_STYLES.indexOf(s) < 0) s = defStyle || 'neutral';
    return ' data-style="' + s + '"';
  }

  function renderBlock(block, ctx) {
    if (!block || typeof block !== 'object') return '';
    var type = block.type || 'text';
    var fn = BLOCK_RENDERERS[type];
    if (!fn) fn = BLOCK_RENDERERS['text'];
    return fn(block, ctx || {});
  }

  function renderBlocks(blocks, ctx) {
    if (!blocks || !blocks.length) return '';
    var html = '';
    for (var i = 0; i < blocks.length; i++) {
      html += renderBlock(blocks[i], ctx);
    }
    return html;
  }

  /* ─── Конкретные рендереры блоков ─── */

  function renderBlockText(b, ctx) {
    return '<div data-block="text"' + styleAttr(b.style) + window.app.langAttr(b.content) + '>'
      + _renderRichText(b.content)
      + '</div>';
  }

  function renderBlockHeading(b, ctx) {
    var lvl = b.level || 4;
    if (lvl < 2) lvl = 2;
    if (lvl > 6) lvl = 6;
    var content = b.content || b.title || '';
    return '<div data-block="heading" data-level="' + lvl + '"' + styleAttr(b.style) + '>'
      + '<h' + lvl + window.app.langAttr(content) + '>' + _renderRichText(content) + '</h' + lvl + '>'
      + '</div>';
  }

  function renderBlockProcedure(b, ctx) {
    var html = '<div data-block="procedure"' + styleAttr(b.style) + '>';
    if (b.action) html += '<span class="block-action"' + window.app.langAttr(b.action) + '>' + _renderRichText(b.action) + '</span>';
    if (b.action && b.result) html += '<span class="block-dots" aria-hidden="true"> … </span>';
    if (b.result) html += '<span class="block-result"' + window.app.langAttr(b.result) + '>' + _renderRichText(b.result) + '</span>';
    if (b.content) html += ' <span class="block-content"' + window.app.langAttr(b.content) + '>' + _renderRichText(b.content) + '</span>';
    html += '</div>';
    return html;
  }

  function renderBlockChecklist(b, ctx) {
    var html = '<div data-block="checklist"' + styleOrDefault(b.style, 'success') + '>';
    if (b.action) html += '<span class="block-action"' + window.app.langAttr(b.action) + '>' + _renderRichText(b.action) + '</span>';
    if (b.action && b.result) html += '<span class="block-dots" aria-hidden="true"> … </span>';
    if (b.result) html += '<span class="block-result"' + window.app.langAttr(b.result) + '>' + _renderRichText(b.result) + '</span>';
    if (b.content) html += ' <span class="block-content"' + window.app.langAttr(b.content) + '>' + _renderRichText(b.content) + '</span>';
    html += '</div>';
    return html;
  }

  function renderBlockCallout(b, ctx) {
    var html = '<div data-block="callout"' + styleOrDefault(b.style, 'info') + '>';
    if (b.label) html += '<span class="block-label"' + window.app.langAttr(b.label) + '>' + _renderRichText(b.label) + '</span>';
    html += '<span class="block-content"' + window.app.langAttr(b.content) + '>' + _renderRichText(b.content) + '</span>';
    html += '</div>';
    return html;
  }

  function renderBlockNote(b, ctx) {
    var nb = {
      type: 'callout',
      style: b.style || 'info',
      label: b.label || 'Note:',
      content: b.content
    };
    return renderBlockCallout(nb, ctx);
  }

  function renderBlockCaution(b, ctx) {
    var nb = {
      type: 'callout',
      style: b.style || 'warning',
      label: b.label || 'CAUTION:',
      content: b.content
    };
    return renderBlockCallout(nb, ctx);
  }

  function renderBlockWarning(b, ctx) {
    var nb = {
      type: 'callout',
      style: b.style || 'danger',
      label: b.label || 'WARNING:',
      content: b.content
    };
    return renderBlockCallout(nb, ctx);
  }

  function renderBlockVerify(b, ctx) {
    return '<div data-block="verify"' + styleOrDefault(b.style, 'neutral') + window.app.langAttr(b.content) + '>'
      + _renderRichText(b.content)
      + '</div>';
  }

  function renderBlockConditional(b, ctx) {
    var html = '<div data-block="conditional"' + styleOrDefault(b.style, 'warning') + window.app.langAttr(b.content) + '>'
      + _renderRichText(b.content)
      + '</div>';
    var nested = b.blocks || b.children;
    if (nested && nested.length) {
      html += '<div class="block-nested">' + renderBlocks(nested, ctx) + '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderBlockTailMarker(b, ctx) {
    return '<div data-block="tail-marker"' + styleOrDefault(b.style, 'neutral') + window.app.langAttr(b.content) + '>'
      + _renderRichText(b.content)
      + '</div>';
  }

  function renderBlockSubNote(b, ctx) {
    return '<div data-block="sub-note"' + styleOrDefault(b.style, 'neutral') + window.app.langAttr(b.content) + '>'
      + _renderRichText(b.content)
      + '</div>';
  }

  function renderBlockList(b, ctx, tag) {
    var style = styleOrDefault(b.style, 'neutral');
    var html = '<div data-block="' + (tag === 'ul' ? 'bullet-list' : 'numbered-list') + '"' + style + '>'
      + '<' + tag + '>';
    if (b.items) {
      for (var i = 0; i < b.items.length; i++) {
        var it = b.items[i];
        if (typeof it === 'string') {
          html += '<li' + window.app.langAttr(it) + '>' + _renderRichText(it) + '</li>';
        } else if (it && typeof it === 'object') {
          html += '<li>' + renderBlock(it, ctx) + '</li>';
        }
      }
    }
    html += '</' + tag + '></div>';
    return html;
  }

  function renderBlockBulletList(b, ctx) {
    return renderBlockList(b, ctx, 'ul');
  }

  function renderBlockNumberedList(b, ctx) {
    return renderBlockList(b, ctx, 'ol');
  }

  function renderBlockSeparator(b, ctx) {
    return '<div data-block="separator"><hr></div>';
  }

  function renderBlockImage(b, ctx) {
    // Нормализация входа:
    //   b.images (массив строк | массив объектов) → N миниатюр
    //   b.src (строка) → 1 миниатюра (legacy)
    var rawImgs = Array.isArray(b.images) ? b.images
                : (b.src ? [{ src: b.src, fullSrc: b.fullSrc, alt: b.alt || b.title }] : []);
    if (!rawImgs.length) return '';

    var floatAttr = b.float ? ' data-float="' + window.app.escapeAttr(b.float) + '"' : '';
    var html = '<div data-block="image"' + floatAttr + '>';
    html += '<div class="' + CSS_PREFIX + '-image-gallery" data-count="' + rawImgs.length + '">';
    for (var i = 0; i < rawImgs.length; i++) {
      var im = rawImgs[i];
      var isStr = typeof im === 'string';
      var src  = resolveDataUrl(isStr ? im : im.src);
      var full = isStr ? src : resolveDataUrl(im.fullSrc || im.src);
      var alt  = isStr ? (b.alt || '') : (im.alt || im.caption || im.title || b.alt || '');
      var caption = isStr ? '' : (im.caption || '');
      html += '<div class="image-item">';
      html += '<img class="' + CSS_PREFIX + '-image-thumb ct-img-dark-invert"'
        + ' src="' + window.app.escapeAttr(src) + '"'
        + ' data-full-src="' + window.app.escapeAttr(full) + '"'
        + ' alt="' + window.app.escapeAttr(alt) + '"'
        + ' loading="lazy">';
      if (caption) {
        html += '<figcaption class="block-image-item-caption"' + window.app.langAttr(caption) + '>' + window.app.escapeHtml(caption) + '</figcaption>';
      }
      html += '</div>';
    }
    html += '</div>';
    if (b.title) {
      html += '<div class="block-image-caption"' + window.app.langAttr(b.title) + '>' + _renderRichText(b.title) + '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderBlockPdfLink(b, ctx) {
    var file = (b.pdfRef && b.pdfRef.file) ? b.pdfRef.file : b.src;
    var page = (b.pdfRef && b.pdfRef.page) ? b.pdfRef.page : (b.page || 1);
    var label = (b.pdfRef && b.pdfRef.label) ? b.pdfRef.label : (b.title || 'Открыть PDF');
    var src = resolveDataUrl(file);
    return '<div data-block="pdf-link" data-style="info"'
      + ' class="' + CSS_PREFIX + '-ref ' + CSS_PREFIX + '-ref--link"'
      + ' data-pdf-src="' + window.app.escapeAttr(src) + '"'
      + ' data-pdf-page="' + page + '"'
      + ' role="button" tabindex="0"'
      + ' aria-label="Открыть PDF, стр. ' + page + '">'
      + '<span class="' + CSS_PREFIX + '-ref-icon">' + (window.ICONS['file-text'] || '') + '</span>'
      + '<span class="' + CSS_PREFIX + '-ref-text"' + window.app.langAttr(label) + '>' + _renderRichText(label) + '</span>'
      + '<span class="' + CSS_PREFIX + '-ref-page">стр.&nbsp;' + page + '</span>'
      + '</div>';
  }

  function renderBlockTable(b, ctx) {
    return '<div data-block="table"' + styleAttr(b.style)
      + ' class="' + CSS_PREFIX + '-table-wrap ' + CSS_PREFIX + '-table-inline">'
      + sanitizeHtml(b.content)
      + '</div>';
  }

  function renderBlockTableFile(b, ctx) {
    var src = b.src || '';
    return '<div data-block="table-file"' + styleAttr(b.style)
      + ' class="' + CSS_PREFIX + '-table-wrap ' + CSS_PREFIX + '-table-file"'
      + ' data-table-src="' + window.app.escapeAttr(src) + '">'
      + '<div class="' + CSS_PREFIX + '-table-loading">Загрузка таблицы…</div>'
      + '</div>';
  }

  function renderBlockAccordion(b, ctx) {
    var html = '<details data-block="accordion"' + styleAttr(b.style)
      + ' class="' + CSS_PREFIX + '-block-accordion">';
    html += '<summary' + window.app.langAttr(b.title) + '>' + _renderRichText(b.title) + '</summary>';
    html += '<div class="block-accordion-body">';
    if (b.content) {
      html += renderBlockText({ type: 'text', content: b.content, style: b.style }, ctx);
    }
    var nested = b.blocks || b.children;
    if (nested && nested.length) {
      html += renderBlocks(nested, ctx);
    }
    html += '</div></details>';
    return html;
  }

  function renderBlockCard(b, ctx) {
    var html = '<section data-block="card"' + styleAttr(b.style)
      + ' class="' + CSS_PREFIX + '-block-card">';
    if (b.title) {
      html += '<header class="block-card-title"' + window.app.langAttr(b.title) + '>' + _renderRichText(b.title) + '</header>';
    }
    html += '<div class="block-card-body">';
    if (b.content) {
      html += renderBlockText({ type: 'text', content: b.content, style: b.style }, ctx);
    }
    var nested = b.blocks || b.children;
    if (nested && nested.length) {
      html += renderBlocks(nested, ctx);
    }
    html += '</div></section>';
    return html;
  }

  function renderBlockSubSection(b, ctx) {
    var lvl = b.level || 4;
    if (lvl < 2) lvl = 2;
    if (lvl > 6) lvl = 6;
    var html = '<section data-block="sub-section"' + styleAttr(b.style) + '>';
    if (b.title) {
      html += '<h' + lvl + ' class="block-subsection-title"' + window.app.langAttr(b.title) + '>' + _renderRichText(b.title) + '</h' + lvl + '>';
    }
    if (b.content) {
      html += renderBlockText({ type: 'text', content: b.content, style: b.style }, ctx);
    }
    var nested = b.blocks || b.children;
    if (nested && nested.length) {
      html += renderBlocks(nested, ctx);
    }
    html += '</section>';
    return html;
  }

  /* ─── renderItemsBlock: унифицированный текстовый блок с палитрой ───
     Используется для {{items:PALETTE[:TITLE]}} в Variant B.
     content — строка ИЛИ массив (массив → join с \n).
     Текст проходит через renderRichText: \n → <br>, теги whitelist, {{badge:}}, {{link:}}.
     Никакого авто-<ul> — пользователь сам пишет •, - или что угодно. */
  function renderItemsBlock(palette, title, content) {
    palette = resolvePalette(palette);
    var text = '';
    if (Array.isArray(content)) {
      text = content.join('\n');
    } else if (content !== null && content !== undefined) {
      text = String(content);
    }
    var html = '<div class="items-block items-block--' + palette + '" data-palette="' + palette + '">';
    if (title) {
      html += '<div class="items-block-title"' + window.app.langAttr(title) + '>' + _renderRichText(title) + '</div>';
    }
    html += '<div class="items-block-content"' + window.app.langAttr(text) + '>' + _renderRichText(text) + '</div>';
    html += '</div>';
    return html;
  }

  function renderBlockReferenceList(b, ctx) {
    var items = b.items || [];
    var html = '<div data-block="reference-list"' + styleAttr(b.style)
      + ' class="' + CSS_PREFIX + '-refs">';
    html += '<div class="' + CSS_PREFIX + '-refs-title">Ссылки</div>';
    html += '<ul class="' + CSS_PREFIX + '-refs-list">';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (typeof it === 'string') {
        html += '<li class="' + CSS_PREFIX + '-ref">' + _renderRichText(it) + '</li>';
      } else if (it && (it.src || it.file)) {
        var file = it.file || it.src;
        var page = it.page || 1;
        var label = it.title || it.label || 'Открыть PDF';
        var src = resolveDataUrl(file);
        html += '<li class="' + CSS_PREFIX + '-ref ' + CSS_PREFIX + '-ref--link"'
          + ' data-pdf-src="' + window.app.escapeAttr(src) + '"'
          + ' data-pdf-page="' + page + '"'
          + ' role="button" tabindex="0"'
          + ' aria-label="Открыть PDF, стр. ' + page + '">'
          + '<span class="' + CSS_PREFIX + '-ref-icon">' + (window.ICONS['file-text'] || '') + '</span>'
          + '<span class="' + CSS_PREFIX + '-ref-text"' + window.app.langAttr(label) + '>' + _renderRichText(label) + '</span>'
          + '<span class="' + CSS_PREFIX + '-ref-page">стр.&nbsp;' + page + '</span>'
          + '</li>';
      } else if (it && it.text) {
        html += '<li class="' + CSS_PREFIX + '-ref">' + _renderRichText(it.text) + '</li>';
      } else if (it && it.href) {
        html += '<li class="' + CSS_PREFIX + '-ref">'
          + '<a href="' + window.app.escapeAttr(it.href) + '" target="_blank" rel="noopener noreferrer">'
          + _renderRichText(it.title || it.href)
          + '</a></li>';
      }
    }
    html += '</ul></div>';
    return html;
  }

  /* ─── Таблица рендереров ─── */
  var BLOCK_RENDERERS = {
    'text':           renderBlockText,
    'heading':        renderBlockHeading,
    'procedure':      renderBlockProcedure,
    'checklist':      renderBlockChecklist,
    'callout':        renderBlockCallout,
    'note':           renderBlockNote,
    'caution':        renderBlockCaution,
    'warning':        renderBlockWarning,
    'verify':         renderBlockVerify,
    'conditional':    renderBlockConditional,
    'tail-marker':    renderBlockTailMarker,
    'sub-note':       renderBlockSubNote,
    'bullet-list':    renderBlockBulletList,
    'numbered-list':  renderBlockNumberedList,
    'separator':      renderBlockSeparator,
    'image':          renderBlockImage,
    'pdf-link':       renderBlockPdfLink,
    'table':          renderBlockTable,
    'table-file':     renderBlockTableFile,
    'accordion':      renderBlockAccordion,
    'card':           renderBlockCard,
    'sub-section':    renderBlockSubSection,
    'reference-list': renderBlockReferenceList
  };

  /* ═══════════════════════════════════════════
     ITEM BODY RENDERER (Variant B — плоские ключи)
     ═══════════════════════════════════════════ */

  /* ─── renderItemBody(item, ctx) ───
     Итерирует Object.keys(item) в порядке записи.
     Порядок рендера = порядок ключей в JSON (ES2015+ гарантирует).
     children рендерится отдельно (всегда последним) — здесь пропускается.
     Поля id/title/refCode/duration/category — пропускаются (header/meta).
     Поддерживаемые ключи тела:
       {{items:PALETTE[:TITLE]}}  → items-block (фон + левая граница + текст)
       image                      → image-block (PhotoSwipe)
       tableFile                  → table-file-block (fetch + sanitize)
       documents                  → reference-list (PDF-ссылки)
       references                 → reference-list (текстовые ссылки)
       blocks                     → массив блоков (backward-compat с v3)
  */
  function renderItemBody(item, ctx) {
    var html = '';
    var keys = Object.keys(item);
    var itemsRegex = /^\{\{items:(\w+)(?::([^}]+))?\}\}$/;
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = item[key];
      if (val === null || val === undefined) continue;

      // 1. {{items:PALETTE[:TITLE]}} — items-блок
      var m = key.match(itemsRegex);
      if (m) {
        html += renderItemsBlock(m[1], m[2], val);
        continue;
      }

      // 2. image (строка | массив строк) или images (массив объектов)
      if ((key === 'image' || key === 'images') && val) {
        var imgBlock = Array.isArray(val)
          ? { images: val, alt: item.title || '' }
          : { src: val, alt: item.title || '' };
        html += renderBlockImage(imgBlock, ctx);
        continue;
      }

      // 3. tables (массив объектов {src}) — множественные HTML-таблицы
      if (key === 'tables' && val && val.length) {
        for (var t = 0; t < val.length; t++) {
          if (val[t] && val[t].src) {
            html += renderBlockTableFile({ src: val[t].src }, ctx);
          }
        }
        continue;
      }

      // 3b. tableFile (legacy backward-compat: одна строка-путь)
      if (key === 'tableFile' && val) {
        html += renderBlockTableFile({ src: val }, ctx);
        continue;
      }

      // 4. documents (PDF-ссылки)
      if (key === 'documents' && val && val.length) {
        var docRefs = [];
        for (var d = 0; d < val.length; d++) {
          var doc = val[d];
          if (doc && (doc.src || doc.file)) {
            docRefs.push({ src: doc.src || doc.file, page: doc.page || 1, title: doc.title || 'Открыть PDF' });
          }
        }
        if (docRefs.length) {
          html += renderBlockReferenceList({ items: docRefs }, ctx);
        }
        continue;
      }

      // 5. references (текстовые ссылки)
      if (key === 'references' && val && val.length) {
        var textRefs = [];
        for (var r = 0; r < val.length; r++) {
          var ref = val[r];
          if (typeof ref === 'string') {
            textRefs.push(ref);
          } else if (ref && ref.text) {
            textRefs.push({ text: ref.text });
          } else if (ref && ref.href) {
            textRefs.push({ href: ref.href, title: ref.title || ref.href });
          }
        }
        if (textRefs.length) {
          html += renderBlockReferenceList({ items: textRefs }, ctx);
        }
        continue;
      }

      // 6. blocks[] (backward-compat с v3 — явный массив блоков)
      if (key === 'blocks' && Array.isArray(val) && val.length) {
        html += renderBlocks(val, ctx);
        continue;
      }

      // 7. Пропускаемые ключи (header/meta/children)
      // id, title, refCode, duration, category, children, layout
    }
    return html;
  }

  /* ═══════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════ */

  function renderAll() {
    var container = document.getElementById(CONTAINER_ID);
    if (!container || !_data) return;

    // Filter data recursively
    var q = _filter.trim().toLowerCase();
    var filtered = q ? filterItems(_data, q) : _data;

    var html = '<div class="module-container">';

    /* Search bar — shared .ct-search-* (MODULE_CONTRACT §7, SHELL_CONTRACT §5 Блок В) */
    html += '<div class="ct-search-bar">';
    html += '<div class="ct-search-input-wrap">';
    html += '<span class="ct-search-icon">' + window.ICONS.search + '</span>';
    html += '<input type="text" class="ct-search-input" placeholder="Поиск по процедурам…"'
      + ' value="' + window.app.escapeAttr(_filter || '') + '">';
    if (_filter) {
      html += '<button class="ct-search-clear visible" aria-label="Очистить">' + window.ICONS.x + '</button>';
    } else {
      html += '<button class="ct-search-clear" aria-label="Очистить">' + window.ICONS.x + '</button>';
    }
    html += '</div>';
    html += '</div>';

    if (filtered.length === 0 && q) {
      html += '<div class="' + CSS_PREFIX + '-empty">';
      html += '<div class="' + CSS_PREFIX + '-empty-icon">' + window.ICONS.search + '</div>';
      html += '<p class="' + CSS_PREFIX + '-empty-text">Ничего не найдено</p>';
      html += '<p class="' + CSS_PREFIX + '-empty-sub">Попробуйте изменить запрос</p>';
      html += '</div>';
    } else {
      /* Flat list — top-level items рендерятся как depth=1 карточки.
         Section dividers убраны (поле category удалено из схемы). */
      for (var i = 0; i < filtered.length; i++) {
        html += renderItem(filtered[i], 1);
      }
    }

    html += '</div>';

    window.app.hideSkeleton(container, html);

    bindSearchInput(container);
    loadTableFiles(container);

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

  /* ─── Рекурсивный рендер элемента (аккордеон любой глубины) ─── */
  function renderItem(item, depth) {
    // Простой текстовый блок (без аккордеона) — для layout: "text"
    if (item.layout === 'text') {
      return renderTextBlock(item, depth);
    }
    // Сворачиваемый разделитель-группа — для layout: "divider"
    if (item.layout === 'divider') {
      return renderDividerList(item, depth);
    }
    var hasChildren = item.children && item.children.length > 0;

    // Layout-based modifier class (group/card/child) для chrome (border, bg).
    // Typography (font-size/weight) остаётся на data-depth.
    var layoutMod = '';
    if (item.layout === 'group' || item.layout === 'card' || item.layout === 'child') {
      layoutMod = ' ' + CSS_PREFIX + '-card--' + item.layout;
    }

    var html = '<div class="' + CSS_PREFIX + '-card' + layoutMod + '" data-depth="' + depth + '" data-id="' + window.app.escapeAttr(item.id || '') + '">';

    // Card header (accordion toggle) — без badge, только title/refCode/duration
    html += '<div class="' + CSS_PREFIX + '-card-header ' + CSS_PREFIX + '-card-header--no-badge">';
    html += '<div class="' + CSS_PREFIX + '-card-info">';
    html += '<div class="collapsible-title ' + CSS_PREFIX + '-card-title"' + window.app.langAttr(item.title) + '>' + _renderRichText(item.title) + '</div>';

    // refCode
    if (item.refCode) {
      html += '<div class="' + CSS_PREFIX + '-card-ref"' + window.app.langAttr(item.refCode) + '>' + _renderRichText(item.refCode) + '</div>';
    }

    // duration (FFS-style — оставлено)
    if (item.duration) {
      html += '<div class="' + CSS_PREFIX + '-card-meta">';
      html += '<span class="' + CSS_PREFIX + '-card-duration"' + window.app.langAttr(item.duration) + '>' + _renderRichText(item.duration) + '</span>';
      html += '</div>';
    }

    html += '</div>'; // card-info

    // child count (right before chevron)
    if (hasChildren) {
      html += '<span class="' + CSS_PREFIX + '-card-child-count">' + item.children.length + '</span>';
    }

    html += '<span class="' + CSS_PREFIX + '-card-chevron">' + window.ICONS['chevron-down'] + '</span>';
    html += '</div>'; // card-header

    // Card body (expanded)
    html += '<div class="' + CSS_PREFIX + '-card-body">';
    html += '<div class="' + CSS_PREFIX + '-card-content">';

    // Body: Variant B — итерация по ключам item ({{items:...}}, image, tableFile, documents, references, blocks)
    html += renderItemBody(item, { depth: depth });

    // Nested children (recursive accordion)
    if (hasChildren) {
      html += '<div class="' + CSS_PREFIX + '-nested">';
      for (var ch = 0; ch < item.children.length; ch++) {
        html += renderItem(item.children[ch], depth + 1);
      }
      html += '</div>';
    }

    html += '</div>'; // card-content
    html += '</div>'; // card-body
    html += '</div>'; // card

    return html;
  }

  /* ─── Текстовый блок (без аккордеона) — для layout: "text" ─── */
  function renderTextBlock(item, depth) {
    var html = '<div class="' + CSS_PREFIX + '-text-block" data-depth="' + depth + '" data-id="' + window.app.escapeAttr(item.id || '') + '">';

    if (item.title) {
      html += '<div class="' + CSS_PREFIX + '-text-block-title"' + window.app.langAttr(item.title) + '>' + _renderRichText(item.title) + '</div>';
    }

    // Body: Variant B
    html += renderItemBody(item, { depth: depth });

    // Вложенные дети (рекурсия — могут быть как аккордеонами, так и text-блоками)
    if (item.children && item.children.length > 0) {
      html += '<div class="' + CSS_PREFIX + '-nested">';
      for (var ch = 0; ch < item.children.length; ch++) {
        html += renderItem(item.children[ch], depth + 1);
      }
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  /* ─── Divider-List (data-driven сворачиваемая группа любой глубины) ───
     layout: "divider" → кликабельный заголовок + сворачиваемый контейнер.
     Заголовок берётся из item.title (редактируется в JSON).
     Стили: uppercase, var(--font-xs), чёрный (var(--color-text-main)).
     Weight по уровню: depth=1 (верхний) — жирный (700); depth≥2 — обычный (600).
     Справа: счётчик дочерних блоков + шеврон.
     При активном поиске (_filter) — авто-раскрытие, чтобы показать совпадения. */
  function renderDividerList(item, depth) {
    var hasChildren = item.children && item.children.length > 0;
    var isCollapsible = item.collapsible === true;

    // ── DIVIDER без {} → простой разделитель-лейбел с линией (неинтерактивный) ──
    // layout: "divider" + collapsible отсутствует/false = неинтерактивный разделитель.
    // Контракт: .list-divider — класс с осознанным дублированием (§7 L437, §5 L419).
    // Вариант A: линия только справа от лейбла.
    // Поля (ITEMS/DOC/...) под лейбелом НЕ рендерятся — для контента нужен { аккордеон.
    if (!isCollapsible) {
      var labelHtml = '<div class="list-divider"><span class="list-divider-label"' + window.app.langAttr(item.title) + '>'
        + _renderRichText(item.title || '') + '</span></div>';
      return labelHtml;
    }

    // ── DIVIDER с {} → аккордеон (collapsible: true) ──
    // Тело = renderItemBody(поля: ITEMS/DOC/TABLE/...) + children(карточки)
    var isOpen = item.open === true || (_filter.trim() !== '' && (hasChildren || isCollapsible));
    var id = window.app.escapeAttr(item.id || '');

    var html = '<div class="divider-list" data-depth="' + depth + '">';

    // Toggle (заголовок-аккордеон)
    html += '<div class="divider-list-toggle' + (isOpen ? ' is-open' : '') + '"'
      + ' data-id="' + id + '"'
      + ' role="button" tabindex="0"'
      + ' aria-expanded="' + (isOpen ? 'true' : 'false') + '">';
    html += '<span class="divider-list-label"' + window.app.langAttr(item.title || '') + '>' + _renderRichText(item.title || '') + '</span>';
    if (hasChildren) {
      html += '<span class="divider-list-count">' + item.children.length + '</span>';
    }
    html += '<span class="divider-list-chevron">' + window.ICONS['chevron-down'] + '</span>';
    html += '</div>';

    // Items (сворачиваемый контейнер — adjacent sibling)
    html += '<div class="divider-list-items' + (isOpen ? ' open' : '') + '" data-id="' + id + '">';
    // Поля (ITEMS/DOC/TABLE/...) — рендерим перед детьми
    var bodyHtml = renderItemBody(item, { depth: depth });
    if (bodyHtml) {
      html += '<div class="divider-list-body" data-depth="' + depth + '">' + bodyHtml + '</div>';
    }
    if (hasChildren) {
      for (var ch = 0; ch < item.children.length; ch++) {
        html += renderItem(item.children[ch], depth + 1);
      }
    }
    html += '</div>';

    html += '</div>';
    return html;
  }

  /* ─── Рекурсивная фильтрация ─── */
  function filterItems(items, q) {
    var result = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var match = itemMatches(item, q);
      var filteredChildren = (item.children) ? filterItems(item.children, q) : [];
      if (match || filteredChildren.length > 0) {
        var copy = shallowCopy(item);
        if (filteredChildren.length > 0) {
          copy.children = filteredChildren;
        }
        result.push(copy);
      }
    }
    return result;
  }

  function itemMatches(item, q) {
    // 1. Header fields
    if ((item.title || '').toLowerCase().indexOf(q) >= 0) return true;
    if ((item.refCode || '').toLowerCase().indexOf(q) >= 0) return true;
    if ((item.duration || '').toLowerCase().indexOf(q) >= 0) return true;

    // 2. Body fields — итерация по ключам (Variant B)
    var keys = Object.keys(item);
    var itemsRegex = /^\{\{items:(\w+)(?::([^}]+))?\}\}$/;
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = item[key];

      // {{items:...}} — поиск в title (из ключа) и в content (строка/массив)
      var m = key.match(itemsRegex);
      if (m) {
        if (m[2] && m[2].toLowerCase().indexOf(q) >= 0) return true;
        if (typeof val === 'string' && val.toLowerCase().indexOf(q) >= 0) return true;
        if (Array.isArray(val)) {
          for (var j = 0; j < val.length; j++) {
            if (typeof val[j] === 'string' && val[j].toLowerCase().indexOf(q) >= 0) return true;
          }
        }
        continue;
      }

      // documents
      if (key === 'documents' && val && val.length) {
        for (var d = 0; d < val.length; d++) {
          if (val[d] && val[d].title && val[d].title.toLowerCase().indexOf(q) >= 0) return true;
        }
        continue;
      }

      // references
      if (key === 'references' && val && val.length) {
        for (var r = 0; r < val.length; r++) {
          var ref = val[r];
          if (typeof ref === 'string' && ref.toLowerCase().indexOf(q) >= 0) return true;
          if (ref && ref.text && ref.text.toLowerCase().indexOf(q) >= 0) return true;
          if (ref && ref.title && ref.title.toLowerCase().indexOf(q) >= 0) return true;
        }
        continue;
      }

      // blocks[] (backward-compat)
      if (key === 'blocks' && Array.isArray(val)) {
        if (blocksContainText(val, q)) return true;
      }
    }
    return false;
  }

  /* ─── Рекурсивный поиск текста в blocks[] ─── */
  function blocksContainText(blocks, q) {
    if (!blocks || !blocks.length) return false;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (!b) continue;
      var fields = [b.title, b.content, b.action, b.result, b.label, b.alt];
      for (var f = 0; f < fields.length; f++) {
        if (fields[f] && String(fields[f]).toLowerCase().indexOf(q) >= 0) return true;
      }
      if (b.items) {
        for (var j = 0; j < b.items.length; j++) {
          var it = b.items[j];
          if (typeof it === 'string' && it.toLowerCase().indexOf(q) >= 0) return true;
          if (it && typeof it === 'object') {
            if (it.title && String(it.title).toLowerCase().indexOf(q) >= 0) return true;
            if (it.text && String(it.text).toLowerCase().indexOf(q) >= 0) return true;
          }
        }
      }
      var nested = b.blocks || b.children;
      if (nested && blocksContainText(nested, q)) return true;
    }
    return false;
  }

  function shallowCopy(obj) {
    var copy = {};
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        copy[key] = obj[key];
      }
    }
    return copy;
  }

  /* ─── Event binding ─── */

  function bindSearchInput(container) {
    var input = container.querySelector('.ct-search-input');
    if (input) {
      input.addEventListener('input', function(e) {
        _filter = e.target.value;
        renderAll();
        var inp = container.querySelector('.ct-search-input');
        if (inp) {
          inp.focus();
          inp.setSelectionRange(_filter.length, _filter.length);
        }
      });
    }
  }

  /* ─── Load external HTML table files ───
     Обрабатывает и legacy-слоты .{prefix}-table-file,
     и новые [data-block="table-file"]. Sanitize через renderRichText.
  */
  function loadTableFiles(container) {
    var fileSlots = container.querySelectorAll('[data-block="table-file"], .' + CSS_PREFIX + '-table-file');
    for (var i = 0; i < fileSlots.length; i++) {
      (function(slot) {
        var src = slot.dataset.tableSrc;
        if (!src) return;
        if (_htmlCache[src]) {
          slot.innerHTML = _htmlCache[src];
          return;
        }
        fetchTableFile(src, function(html) {
          slot.innerHTML = html;
        });
      })(fileSlots[i]);
    }
  }

  /* ─── Cross-module navigation: open item by ID ─── */
  function openAndScrollTo(id) {
    var container = document.getElementById(CONTAINER_ID);
    if (!container) return;
    var target = container.querySelector('[data-id="' + id + '"]');
    if (!target) return;

    // Open all ancestor cards and divider-lists
    var el = target.parentElement;
    while (el && el !== container) {
      if (el.classList.contains(CSS_PREFIX + '-card')) el.classList.add('open');
      if (el.classList.contains('divider-list-items')) {
        el.classList.add('open');
        var divId = el.dataset.id;
        var divToggle = container.querySelector('.divider-list-toggle[data-id="' + divId + '"]');
        if (divToggle) {
          divToggle.classList.add('is-open');
          divToggle.setAttribute('aria-expanded', 'true');
        }
      }
      el = el.parentElement;
    }
    target.classList.add('open');

    setTimeout(function() {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */

  function init(params) {
    var container = document.getElementById(CONTAINER_ID);
    if (!container) {
      console.error('Контейнер ' + CONTAINER_ID + ' не найден!');
      return;
    }

    // lang="ru" включает слоговые переносы (hyphens: auto) в заголовках аккордеонов (MODULE_CONTRACT §7)
    container.setAttribute('lang', 'ru');

    // params — всегда объект (пустой {} если навигация без параметров)

    // Делегирование: вешать ровно ОДИН раз (init вызывается строго один раз — §5)
    container.addEventListener('click', function(e) {
        // Divider-list toggle (data-driven сворачиваемая группа)
        var dividerToggle = e.target.closest('.divider-list-toggle');
        if (dividerToggle) {
          var divId = dividerToggle.dataset.id;
          var items = container.querySelector('.divider-list-items[data-id="' + divId + '"]');
          if (items) {
            items.classList.toggle('open');
            dividerToggle.classList.toggle('is-open');
            dividerToggle.setAttribute('aria-expanded',
              dividerToggle.classList.contains('is-open') ? 'true' : 'false');
          }
          return;
        }

        // Module link click → navigate to another module
        var moduleLink = e.target.closest('.module-link');
        if (moduleLink) {
          var targetModule = moduleLink.dataset.module;
          var targetId = moduleLink.dataset.id;
          if (targetModule) {
            window.app.navigateTo(targetModule, targetId ? { openId: targetId } : {});
          }
          return;
        }

        // Image click → PhotoSwipe (works for legacy + new [data-block="image"])
        var imgThumb = e.target.closest('.' + CSS_PREFIX + '-image-thumb');
        if (imgThumb) {
          var gallery = imgThumb.closest('.' + CSS_PREFIX + '-image-gallery');
          window.app.openPhotoSwipe(imgThumb, gallery);
          return;
        }

        // PDF reference click → openPDFModal (works for legacy + new [data-block="pdf-link"])
        var refLink = e.target.closest('.' + CSS_PREFIX + '-ref--link');
        if (refLink) {
          var pdfSrc = refLink.dataset.pdfSrc;
          var pdfPage = parseInt(refLink.dataset.pdfPage, 10) || 1;
          if (pdfSrc) {
            window.app.openPDFModal(pdfSrc, pdfPage);
          }
          return;
        }

        // Card header toggle (works at any depth)
        var cardHeader = e.target.closest('.' + CSS_PREFIX + '-card-header');
        if (cardHeader) {
          var card = cardHeader.closest('.' + CSS_PREFIX + '-card');
          if (card) {
            card.classList.toggle('open');
          }
          return;
        }
      });

    _filter = '';

    if (_data) {
      renderAll();
      if (params && params.openId) openAndScrollTo(params.openId);
      return;
    }

    window.app.showSkeleton(container, 'blocks');

    fetch(DATA_URL)
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        if (Array.isArray(data)) {
          _data = data;
        } else {
          _data = data.procedures || [];
        }
        renderAll();
        if (params && params.openId) openAndScrollTo(params.openId);
      })
      .catch(function(err) {
        window.app.showError(container, 'Не удалось загрузить процедуры');
        console.error(MODULE_ID + ' fetch error:', err);
      });
  }

  /* ═══════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════ */

  /* ═══════════════════════════════════════════
     REGISTER
     ═══════════════════════════════════════════ */

  window.ModuleRegistry.register('flightprocedures', {
    title:        'Лётные процедуры',
    icon:         'message-square',
    init:          init
  });

})();
