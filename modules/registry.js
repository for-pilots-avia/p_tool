/* ═══════════════════════════════════════════
   Pilot's Tool — Module Registry
   Central registry for all application modules.
   Each module registers itself via ModuleRegistry.register().
   ═══════════════════════════════════════════ */

window.ModuleRegistry = {
  _modules: {},
  _order: [],
  _loadedCss: {},   // id → true, чтобы не вставлять <link> дважды

  /**
   * Register a module.
   * @param {string} id — unique module id (e.g. 'worktime')
   * @param {object} module — module descriptor:
   *   {
   *     id:          string,       // same as key
   *     title:       string,       // display name for menu & header
   *     icon:        string,       // key in window.ICONS
   *     containerId: string,       // DOM id of the screen container
   *     screenId:    string,       // DOM id of the screen div
   *     init:        function(),   // called when navigating to this module
   *     renderHeader:function(),   // optional: custom header render
   *     destroy:     function(),   // optional: cleanup when leaving
   *   }
   */
  register: function(id, module) {
    if (!id || typeof id !== 'string') {
      console.error('ModuleRegistry.register: invalid id', id);
      return;
    }
    if (!module || typeof module !== 'object') {
      console.error('ModuleRegistry.register: invalid module for', id);
      return;
    }

    // Ensure module.id matches the key
    module.id = id;

    // Auto-derive screenId if not provided
    if (!module.screenId) {
      module.screenId = id + 'Screen';
    }

    // Auto-derive containerId if not provided
    if (!module.containerId) {
      module.containerId = id + 'Container';
    }

    this._modules[id] = module;
    this._order.push(id);
  },

  /**
   * Get a module descriptor by id.
   * @param {string} id
   * @returns {object|null}
   */
  get: function(id) {
    return this._modules[id] || null;
  },

  /**
   * Get all registered module ids in registration order.
   * @returns {string[]}
   */
  getIds: function() {
    return this._order.slice();
  },

  /**
   * Get all module descriptors in registration order.
   * @returns {object[]}
   */
  getAll: function() {
    var result = [];
    for (var i = 0; i < this._order.length; i++) {
      result.push(this._modules[this._order[i]]);
    }
    return result;
  },

  /**
   * Initialize a module (call its init() function).
   * Also ensures the module's CSS is loaded.
   * @param {string} id
   */
  init: function(id) {
    var mod = this.get(id);
    if (!mod) return;

    // Подгрузить CSS модуля, если ещё не загружен
    this.ensureCss(id);

    if (typeof mod.init === 'function') {
      mod.init();
    } else {
      // Fallback: show "in development" stub
      this._showStub(mod);
    }
  },

  /**
   * Render a module's header.
   * @param {string} id
   */
  renderHeader: function(id) {
    var mod = this.get(id);
    if (mod && typeof mod.renderHeader === 'function') {
      mod.renderHeader();
    } else if (mod) {
      this._renderDefaultHeader(mod);
    }
  },

  /**
   * Destroy a module (cleanup when leaving).
   * @param {string} id
   */
  destroy: function(id) {
    var mod = this.get(id);
    if (mod && typeof mod.destroy === 'function') {
      mod.destroy();
    }
  },

  /**
   * Ensure module CSS is loaded.
   * Injects <link> for modules/{id}/{id}.css if not already present.
   * @param {string} id
   */
  ensureCss: function(id) {
    if (this._loadedCss[id]) return;

    // Проверить, не был ли уже вставлен <link> ранее (например, из старого modules.css)
    var existing = document.querySelector('link[data-module-css="' + id + '"]');
    if (existing) {
      this._loadedCss[id] = true;
      return;
    }

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'modules/' + id + '/' + id + '.css';
    link.setAttribute('data-module-css', id);
    document.head.appendChild(link);

    this._loadedCss[id] = true;
  },

  /* ─── Internal helpers ─── */

  _renderDefaultHeader: function(mod) {
    var left   = document.getElementById('headerLeft');
    var center = document.getElementById('headerCenter');
    var right  = document.getElementById('headerRight');
    if (!left || !center || !right) return;

    left.innerHTML = '<button class="icon-btn" aria-label="Назад">'
      + window.ICONS['arrow-left'] + '</button>';
    left.onclick = function() { app.navigateTo('main'); };

    center.innerHTML = '<div class="hc-module">' + mod.title + '</div>';

    right.innerHTML = '';
    right.onclick = null;
  },

  _showStub: function(mod) {
    this._renderDefaultHeader(mod);

    var container = document.getElementById(mod.containerId);
    if (container) {
      container.innerHTML = '<div class="module-container" style="padding-top:16px;padding-bottom:32px;">'
        + '<div class="ct-empty-state">'
        + '<div class="ct-empty-title">' + mod.title + '</div>'
        + '<div class="ct-empty-text">Модуль в разработке</div>'
        + '</div></div>';
    }
  }
};
