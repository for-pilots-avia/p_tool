/* ═══════════════════════════════════════════════════════════════
   QUIZ MODULE — Pilot's Tool
   Pluggable module for ModuleRegistry architecture

   Self-contained IIFE that:
   - Uses window.ICONS (main project icon system)
   - Registers via ModuleRegistry.register()
   - Header contract: direct DOM access to #headerLeft/Center/Right
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ───────────────────────────────────────────────────────────────
     ICONS — delegate to global window.ICONS (main project icon system)
     ─────────────────────────────────────────────────────────────── */
  function getIcons() { return window.ICONS || {}; }

  /** Apply size to SVG template (handles both with and without explicit w/h) */
  function svgSize(tpl, size) {
    /* Check the opening <svg …> tag for a standalone width attribute
       (space-prefixed so we skip stroke-width="…") */
    var svgOpen = tpl.match(/<svg[^>]*>/);
    if (svgOpen && /\swidth="\d+"/.test(svgOpen[0])) {
      return tpl
        .replace(/\swidth="\d+"/, ' width="' + size + '"')
        .replace(/\sheight="\d+"/, ' height="' + size + '"');
    }
    return tpl.replace(/<svg/, '<svg width="' + size + '" height="' + size + '"');
  }

  /** Get icon HTML (size controlled via CSS) */
  function ico(name) {
    return getIcons()[name] || '';
  }

  /** Get icon with custom size AND stroke-width */
  function icoCustom(name, size, sw) {
    var tpl = getIcons()[name];
    if (!tpl) return '';
    return svgSize(tpl, size)
      .replace(/stroke-width="2"/, 'stroke-width="' + sw + '"');
  }


  /* ═══════════════════════════════════════════════════════════════
     QUIZ STATE
     ═══════════════════════════════════════════════════════════════ */
  var LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

  var S = {
    screen: 'start',
    testData: null,
    customTests: [],
    selectedTest: '',
    shuffle: true,
    mode: 'train',
    examCount: 10,
    questions: [],
    idx: 0,
    score: 0,
    wrongQs: [],
    isFirstRun: true,
    answered: false,
    shuffledAnswers: [],
    isMulti: false,
    multiSelected: [],
    quizStartTime: 0,
    questionStartTime: 0,
    questionTimes: [],
    timerInterval: 0,
    inited: false
  };

  /* ── DOM helpers (internal screen visibility) ── */
  var show = function (el) { if (el) el.style.display = ''; };
  var hide = function (el) { if (el) el.style.display = 'none'; };

  /* ── Module container reference (set inside init) ── */
  var container = null;


  /* ═══════════════════════════════════════════════════════════════
     NAVIGATE HOME
     ═══════════════════════════════════════════════════════════════ */
  function navigateHome() {
    if (window.app && typeof window.app.navigateTo === 'function') {
      window.app.navigateTo('main');
    }
  }


  /* ───────────────────────────────────────────────────────────────
     HELPERS
     ─────────────────────────────────────────────────────────────── */
  function shuffleArr(arr) {
    var c = arr.slice();
    for (var i = c.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = c[i]; c[i] = c[j]; c[j] = tmp;
    }
    return c;
  }

  function getGrade(pct) {
    if (pct >= 90) return '5';
    if (pct >= 80) return '4';
    if (pct >= 70) return '3';
    return '2';
  }

  function fmtTime(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    var sec = s % 60;
    return m > 0 ? m + ':' + String(sec).padStart(2, '0') : sec + '\u0441';
  }


  /* ═══════════════════════════════════════════════════════════
     RESULTS HISTORY — localStorage
     ═══════════════════════════════════════════════════════════ */
  var HISTORY_KEY = 'nw_quiz_history';
  var CUSTOM_TESTS_KEY = 'nw_quiz_custom_tests';
  var LAST_SELECTED_KEY = 'nw_quiz_last_selected';
  var MAX_HISTORY = 20;

  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveHistory(items) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items)); } catch (e) { /* quota */ }
  }

  function pushResult(r) {
    var items = loadHistory();
    items.unshift(r);
    if (items.length > MAX_HISTORY) items.length = MAX_HISTORY;
    saveHistory(items);
  }

  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  }

  /* ── Custom tests persistence ── */
  function loadCustomTests() {
    try {
      var raw = localStorage.getItem(CUSTOM_TESTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveCustomTests() {
    try {
      /* Save only custom tests (skip built-in ones from fetch) */
      var toSave = S.customTests.filter(function (t) { return !t._builtin; });
      localStorage.setItem(CUSTOM_TESTS_KEY, JSON.stringify(toSave));
    } catch (e) { /* quota */ }
  }

  function addCustomTest(name, questions, isBuiltin) {
    if (S.customTests.find(function (c) { return c.name === name; })) return;
    var test = { name: name, questions: questions };
    if (isBuiltin) test._builtin = true;
    S.customTests.push(test);
    if (!isBuiltin) saveCustomTests();
  }

  function retryFromHistory(wrongQuestions) {
    var qs = JSON.parse(JSON.stringify(wrongQuestions));
    if (S.shuffle) qs = shuffleArr(qs);
    S.questions = qs;
    S.idx = 0;
    S.score = 0;
    S.wrongQs = [];
    S.isFirstRun = false;
    S.answered = false;
    startTimer();
    setScreen('quiz');
    renderQuestion();
  }

  function renderHistory() {
    var items = loadHistory();
    var historyContainer = container.querySelector('#historyContainer');
    if (!historyContainer) return;
    if (items.length === 0) { hide(historyContainer); return; }
    show(historyContainer);
    historyContainer.innerHTML = '';

    var title = document.createElement('div');
    title.className = 'history-title';
    title.innerHTML = ico('trophy') + ' \u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u044B'; /* Последние результаты */
    historyContainer.appendChild(title);

    var list = document.createElement('div');
    list.className = 'history-list';

    items.forEach(function (item) {
      var hasErrors = item.score < item.total && item.wrongQuestions && item.wrongQuestions.length > 0;
      var row = document.createElement('div');
      row.className = 'history-row' + (hasErrors ? ' history-row-clickable' : '');

      var gradeColor = Number(item.grade) >= 4 ? 'var(--color-success)' : Number(item.grade) >= 3 ? 'var(--color-warning)' : 'var(--color-danger)';
      var dateStr = new Date(item.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

      row.innerHTML =
        '<div class="history-grade" style="color:' + gradeColor + '">' + item.grade + '</div>' +
        '<div class="history-info">' +
          '<div class="history-test-name">' + item.testName + '</div>' +
          '<div class="history-meta">' +
            '<span style="color:var(--color-success);font-weight:600">' + item.score + '</span>/' + item.total +
            ' \u00B7 ' + item.pct + '%' +
            ' \u00B7 ' + fmtTime(item.time) +
            ' \u00B7 ' + dateStr +
          '</div>' +
        '</div>' +
        (hasErrors ? '<div class="history-retry-hint">' + ico('refresh-ccw') + '</div>' : '');

      if (hasErrors) {
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');
        row.setAttribute('aria-label', '\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C \u043E\u0448\u0438\u0431\u043A\u0438: ' + item.testName); /* Повторить ошибки */
        (function (wq) {
          row.addEventListener('click', function () { retryFromHistory(wq); });
          row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); retryFromHistory(wq); } });
        })(item.wrongQuestions);
      }

      list.appendChild(row);
    });

    historyContainer.appendChild(list);
  }


  /* ═══════════════════════════════════════════════════════════
     SETTINGS MODAL
     ═══════════════════════════════════════════════════════════ */
  function openSettings() {
    syncModalFromState();
    var overlay = container.querySelector('#settingsOverlay');
    if (overlay) overlay.classList.add('quiz-overlay-visible');
  }

  function closeSettings() {
    var overlay = container.querySelector('#settingsOverlay');
    if (overlay) overlay.classList.remove('quiz-overlay-visible');
  }

  function syncModalFromState() {
    var sel = container.querySelector('#modalTestSelector');
    rebuildSelector(sel);
    var toggle = container.querySelector('#modalShuffleToggle');
    if (toggle) toggle.checked = S.shuffle;
    /* Mode toggle sync */
    var modeTrain = container.querySelector('#modalModeTrain');
    var modeExam = container.querySelector('#modalModeExam');
    if (modeTrain) modeTrain.classList.toggle('quiz-mode-btn--active', S.mode === 'train');
    if (modeExam) modeExam.classList.toggle('quiz-mode-btn--active', S.mode === 'exam');
    /* Stop button visible only during quiz/result */
    var stopBtn = container.querySelector('#modalBtnStop');
    if (stopBtn) stopBtn.style.display = (S.screen === 'quiz' || S.screen === 'result') ? '' : 'none';
  }

  function rebuildSelector(sel) {
    if (!sel) return;
    sel.innerHTML = '';
    /* Все тесты (встроенные + пользовательские) — единый список. */
    /* Разделитель только если есть оба типа. */
    var hasBuiltin = S.customTests.some(function (t) { return t._builtin; });
    var hasUser = S.customTests.some(function (t) { return !t._builtin; });
    var needSeparator = hasBuiltin && hasUser;

    S.customTests.forEach(function (t) {
      if (needSeparator && !t._builtin) return; /* пользовательские — после разделителя */
      var o = document.createElement('option');
      o.value = t.name;
      o.textContent = t.name + ' (' + t.questions.length + ' \u0432\u043E\u043F\u0440.)';
      sel.appendChild(o);
    });

    if (needSeparator) {
      var sep = document.createElement('option');
      sep.disabled = true;
      sep.textContent = '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500';
      sel.appendChild(sep);
      S.customTests.forEach(function (t) {
        if (t._builtin) return;
        var o = document.createElement('option');
        o.value = t.name;
        o.textContent = t.name + ' (' + t.questions.length + ' \u0432\u043E\u043F\u0440.)';
        sel.appendChild(o);
      });
    }

    sel.value = S.selectedTest;
  }

  function syncMainFromState() {
    var custom = S.customTests.find(function (t) { return t.name === S.selectedTest; });
    var name = custom ? custom.name : '';
    var el = container.querySelector('#startTestName');
    if (el) el.textContent = name ? name : '';
  }

  function bindModalEvents() {
    var modalWrap = container.querySelector('#settingsOverlay');
    if (!modalWrap) return;

    modalWrap.addEventListener('click', function (e) {
      var target = e.target;

      /* Close button */
      if (target.closest('#modalClose')) { closeSettings(); return; }

      /* Overlay click (close) */
      if (target === modalWrap) { closeSettings(); return; }

      /* Mode toggle — Training (all questions) */
      if (target.closest('#modalModeTrain')) {
        S.mode = 'train';
        syncModalFromState();
        return;
      }

      /* Mode toggle — Testing (10 questions) */
      if (target.closest('#modalModeExam')) {
        S.mode = 'exam';
        syncModalFromState();
        return;
      }

      /* Stop test button — confirm before aborting.
         Сначала закрываем модалку настроек (z-index 9999/10000 перекрывает
         globalConfirmOverlay z-index 2100), затем показываем confirm. */
      if (target.closest('#modalBtnStop')) {
        closeSettings();
        if (window.app && typeof window.app.showConfirm === 'function') {
          window.app.showConfirm(
            '\u041F\u0440\u0435\u043A\u0440\u0430\u0442\u0438\u0442\u044C \u0442\u0435\u0441\u0442? \u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u0431\u0443\u0434\u0435\u0442 \u043F\u043E\u0442\u0435\u0440\u044F\u043D.',
            function () { goStart(); },
            '\u041F\u0440\u0435\u043A\u0440\u0430\u0442\u0438\u0442\u044C'
          );
        } else {
          goStart();
        }
        return;
      }

      /* Clear history button */
      if (target.closest('#modalBtnClearHistory')) { clearHistory(); return; }

      /* File input */
      var fileInput = target.closest('#modalFileInput');
      if (fileInput) {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            var parsed = JSON.parse(ev.target.result);
            if (!parsed.name || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
              if (window.app && typeof window.app.showToast === 'function') {
                window.app.showToast('\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u0444\u043E\u0440\u043C\u0430\u0442 JSON');
              }
              return;
            }
            addCustomTest(parsed.name, parsed.questions, false);
            S.selectedTest = parsed.name;
            syncModalFromState();
            syncMainFromState();
          } catch (err) {
            if (window.app && typeof window.app.showToast === 'function') {
              window.app.showToast('\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0430\u0440\u0441\u0438\u043D\u0433\u0430 JSON');
            }
          }
        };
        reader.readAsText(file);
        fileInput.value = '';
        return;
      }

      /* Shuffle toggle */
      var toggleEl = target.closest('#modalShuffleToggle');
      if (toggleEl) { S.shuffle = toggleEl.checked; return; }
    });

    /* Separate listener for select/toggle change events (not click) */
    var sel = container.querySelector('#modalTestSelector');
    if (sel) sel.addEventListener('change', function () {
      S.selectedTest = sel.value;
      var toggle = container.querySelector('#modalShuffleToggle');
      S.shuffle = toggle ? toggle.checked : true;
      try { localStorage.setItem(LAST_SELECTED_KEY, S.selectedTest); } catch (e) {}
      syncMainFromState();
      closeSettings();
    });

    var toggle = container.querySelector('#modalShuffleToggle');
    if (toggle) toggle.addEventListener('change', function () { S.shuffle = toggle.checked; });

    /* File input change event */
    var fileInput = container.querySelector('#modalFileInput');
    if (fileInput) fileInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var parsed = JSON.parse(ev.target.result);
          if (!parsed.name || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
            if (window.app && typeof window.app.showToast === 'function') {
              window.app.showToast('\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u0444\u043E\u0440\u043C\u0430\u0442 JSON');
            }
            return;
          }
          addCustomTest(parsed.name, parsed.questions, false);
          S.selectedTest = parsed.name;
          syncModalFromState();
          syncMainFromState();
        } catch (err) {
          if (window.app && typeof window.app.showToast === 'function') {
            window.app.showToast('\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0430\u0440\u0441\u0438\u043D\u0433\u0430 JSON');
          }
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }


  /* ═══════════════════════════════════════════════════════════
     LOAD DATA — fetch quiz-tests.json (manifest) → all listed JSON tests.
     Все тесты из manifest.tests → S.customTests с _builtin=true.
     S.selectedTest восстанавливается из localStorage (last used) или берётся
     первый из списка (тест по умолчанию при первом входе).
     ═══════════════════════════════════════════════════════════ */
  function loadData() {
    var loaderEl = container.querySelector('#loader');
    var errorEl = container.querySelector('#errorEl');
    var contentEl = container.querySelector('#startContent');
    show(loaderEl); hide(errorEl); hide(contentEl);

    fetch('modules/quiz/data/quiz-tests.json')
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to load quiz-tests.json');
        return res.json();
      })
      .catch(function () { return { tests: [] }; })
      .then(function (manifest) {
        var list = (manifest && Array.isArray(manifest.tests)) ? manifest.tests : [];
        return Promise.all(list.map(function (fname) {
          return fetch('modules/quiz/data/' + fname)
            .then(function (res) { if (!res.ok) return null; return res.json(); })
            .then(function (data) { return { file: fname, data: data }; })
            .catch(function () { return null; });
        }));
      })
      .then(function (results) {
        results.forEach(function (entry) {
          if (!entry || !entry.data) return;
          var data = entry.data;
          if (!data.name || !Array.isArray(data.questions) || data.questions.length === 0) return;
          addCustomTest(data.name, data.questions, true);
        });
        /* Load persisted custom tests from localStorage */
        var persisted = loadCustomTests();
        persisted.forEach(function (t) {
          addCustomTest(t.name, t.questions, false);
        });

        /* Восстановить последний выбранный тест ИЛИ взять первый из списка */
        var lastSel = null;
        try { lastSel = localStorage.getItem(LAST_SELECTED_KEY); } catch (e) {}
        var exists = lastSel && S.customTests.find(function (t) { return t.name === lastSel; });
        S.selectedTest = exists ? lastSel : (S.customTests[0] && S.customTests[0].name) || '';
        try { localStorage.setItem(LAST_SELECTED_KEY, S.selectedTest); } catch (e) {}

        hide(loaderEl); show(contentEl);
        syncModalFromState();
        syncMainFromState();
        renderHistory();
      })
      .catch(function (e) {
        console.error(e);
        hide(loaderEl); show(errorEl);
      });
  }


  /* ═══════════════════════════════════════════════════════════
     TIMER — updates #headerCenter directly
     ═══════════════════════════════════════════════════════════ */
  function startTimer() {
    S.quizStartTime = Date.now();
    S.questionStartTime = Date.now();
    S.questionTimes = [];
    clearInterval(S.timerInterval);
    S.timerInterval = window.setInterval(function () {
      updateTimerDisplay();
    }, 500);
  }

  function updateTimerDisplay() {
    var timerEl = container ? container.querySelector('#quizScreenTimer') : null;
    if (timerEl) timerEl.textContent = fmtTime(Date.now() - S.quizStartTime);
  }

  function stopTimer() {
    clearInterval(S.timerInterval);
  }

  function markQuestionTime() {
    S.questionTimes.push(Date.now() - S.questionStartTime);
    S.questionStartTime = Date.now();
  }


  /* ═══════════════════════════════════════════════════════════
     TIMELINE — uses shared #timeline element from main layout
     ═══════════════════════════════════════════════════════════ */
  function buildTimeline() {
    var timelineWrap = container.querySelector('#timeline');
    if (!timelineWrap) return;
    timelineWrap.innerHTML = '';
    var total = S.questions.length;
    for (var i = 0; i < total; i++) {
      if (i > 0) {
        var seg = document.createElement('div');
        seg.className = 'nw-timeline-seg';
        if (i < S.idx) {
          var prevOk = S.questionTimes[i - 1] !== undefined && !S.wrongQs.find(function (q) { return q.question === (S.questions[i - 1] || {}).question; });
          var prevFail = !!S.wrongQs.find(function (q) { return q.question === (S.questions[i - 1] || {}).question; });
          if (prevOk) seg.classList.add('tl-seg-correct');
          else if (prevFail) seg.classList.add('tl-seg-wrong');
        }
        timelineWrap.appendChild(seg);
      }
      var dot = document.createElement('div');
      dot.className = 'nw-timeline-dot';
      dot.textContent = String(i + 1);

      if (i < S.idx) {
        var isWrong = !!S.wrongQs.find(function (q) { return q.question === (S.questions[i] || {}).question; });
        dot.classList.add(isWrong ? 'tl-wrong' : 'tl-correct');
      } else if (i === S.idx) {
        dot.classList.add('tl-current');
      }
      timelineWrap.appendChild(dot);
    }
  }


  /* ═══════════════════════════════════════════════════════════
     PROGRESS — uses shared #progressFill element from main layout
     ═══════════════════════════════════════════════════════════ */
  function updateProgress() {
    var progressFill = container.querySelector('#progressFill');
    var total = S.questions.length;
    if (total === 0 || !progressFill) return;
    var pct = ((S.idx + (S.answered ? 1 : 0)) / total) * 100;
    progressFill.style.width = pct + '%';
  }


  /* ═══════════════════════════════════════════════════════════
     SCREEN NAV
     ═══════════════════════════════════════════════════════════ */
  function setScreen(name) {
    S.screen = name;
    var startScreen = container.querySelector('#quizStartScreen');
    var quizScreen = container.querySelector('#quizScreen');
    var resultScreen = container.querySelector('#resultScreen');
    var progressSection = container.querySelector('#progressSection');

    hide(startScreen); hide(quizScreen); hide(resultScreen);
    if (progressSection) hide(progressSection);

    if (name === 'start') {
      show(startScreen);
      stopTimer();
    } else if (name === 'quiz') {
      show(quizScreen);
      if (progressSection) show(progressSection);
    } else {
      show(resultScreen);
      stopTimer();
    }

    /* Update header via direct DOM access */
    renderHeader();
    window.scrollTo(0, 0);
  }


  /* ═══════════════════════════════════════════════════════════
     START QUIZ
     ═══════════════════════════════════════════════════════════ */
  function startQuiz() {
    var qs = [];
    var custom = S.customTests.find(function (t) { return t.name === S.selectedTest; });
    if (custom) qs = JSON.parse(JSON.stringify(custom.questions));
    if (qs.length === 0) return;

    /* Exam mode: limit to examCount random questions */
    if (S.mode === 'exam' && qs.length > S.examCount) {
      qs = shuffleArr(qs).slice(0, S.examCount);
    }

    S.questions = S.shuffle ? shuffleArr(qs) : qs;
    S.idx = 0;
    S.score = 0;
    S.wrongQs = [];
    S.isFirstRun = true;
    S.answered = false;

    startTimer();
    setScreen('quiz');
    renderQuestion();
  }

  function retryWrong() {
    var qs = JSON.parse(JSON.stringify(S.wrongQs));
    if (S.shuffle) qs = shuffleArr(qs);
    S.questions = qs;
    S.idx = 0;
    S.score = 0;
    S.wrongQs = [];
    S.isFirstRun = false;
    S.answered = false;

    startTimer();
    setScreen('quiz');
    renderQuestion();
  }

  function goStart() {
    stopTimer();
    S.isFirstRun = true;
    S.wrongQs = [];
    S.questions = [];
    S.questionTimes = [];
    setScreen('start');
    renderHistory();
  }


  /* ═══════════════════════════════════════════════════════════
     RENDER QUESTION
     ═══════════════════════════════════════════════════════════ */
  function renderQuestion() {
    var q = S.questions[S.idx];
    if (!q) { showResults(); return; }

    S.answered = false;
    S.questionStartTime = Date.now();

    /* Progress label */
    var quizProgressLabel = container.querySelector('#quizProgressLabel');
    var quizBadge = container.querySelector('#quizBadge');
    if (quizProgressLabel) quizProgressLabel.textContent = '\u0412\u043E\u043F\u0440\u043E\u0441 ' + (S.idx + 1) + ' \u0438\u0437 ' + S.questions.length; /* Вопрос ... из ... */
    if (quizBadge) {
      if (S.isFirstRun) {
        hide(quizBadge);
      } else {
        quizBadge.className = 'quiz-badge quiz-badge-danger';
        quizBadge.textContent = '\u041E\u0428\u0418\u0411\u041A\u0418'; /* ОШИБКИ */
        show(quizBadge);
      }
    }

    /* Question text — MODULE_CONTRACT §13: рендерим как HTML
       (\n → <br>, разрешённые теги <b>/<i> рендерятся как HTML) */
    var questionText = container.querySelector('#questionText');
    if (questionText) questionText.innerHTML = (q.question || '').replace(/\n/g, '<br>');

    /* Image */
    var questionImageWrap = container.querySelector('#questionImageWrap');
    var questionImage = container.querySelector('#questionImage');
    if (q.image && q.image.trim()) {
      hide(questionImageWrap);
      if (questionImage) {
        questionImage.onload = function () { show(questionImageWrap); };
        questionImage.onerror = function () { hide(questionImageWrap); };
        questionImage.src = q.image;
      }
    } else {
      if (questionImage) questionImage.src = '';
      hide(questionImageWrap);
    }

    /* Answers (shuffle) — multi-mode если correct — массив */
    var isMulti = Array.isArray(q.correct);
    S.isMulti = isMulti;
    S.multiSelected = [];
    var correctArr = isMulti ? q.correct : [q.correct];
    var mapped = q.answers.map(function (text, idx) {
      return { text: text, isCorrect: correctArr.indexOf(idx) >= 0 };
    });
    S.shuffledAnswers = shuffleArr(mapped);

    /* Multi-hint — показываем только в multi-режиме */
    var multiHint = container.querySelector('#multiHint');
    if (multiHint) multiHint.style.display = isMulti ? '' : 'none';

    var answersContainer = container.querySelector('#answersContainer');
    if (answersContainer) {
      answersContainer.innerHTML = '';
      S.shuffledAnswers.forEach(function (ans, idx) {
        var btn = document.createElement('button');
        btn.className = isMulti ? 'answer-btn answer-multi' : 'answer-btn';
        btn.innerHTML = '<span class="answer-letter">' + LETTERS[idx] + '</span><span>' + ans.text + '</span>';
        if (isMulti) {
          btn.addEventListener('click', function () { toggleMultiAnswer(idx, btn); });
        } else {
          btn.addEventListener('click', function () { handleAnswer(ans, idx, btn); });
        }
        answersContainer.appendChild(btn);
      });
    }

    /* Confirm button (multi-mode only) */
    var btnConfirmMulti = container.querySelector('#btnConfirmMulti');
    if (btnConfirmMulti) {
      btnConfirmMulti.style.display = isMulti ? '' : 'none';
      btnConfirmMulti.disabled = true;
    }

    /* Clear feedback */
    var feedbackLine = container.querySelector('#feedbackLine');
    if (feedbackLine) {
      feedbackLine.className = 'feedback-line';
      feedbackLine.textContent = '';
    }

    /* Timeline & Progress */
    buildTimeline();
    updateProgress();

    /* Update screen timer */
    updateTimerDisplay();

    /* Animate in */
    var quizScreen = container.querySelector('#quizScreen');
    if (quizScreen) {
      quizScreen.classList.remove('animate-fade-in');
      void quizScreen.offsetWidth;
      quizScreen.classList.add('animate-fade-in');
    }
  }


  /* ═══════════════════════════════════════════════════════════
     HANDLE ANSWER
     ═══════════════════════════════════════════════════════════ */
  function handleAnswer(ans, ansIdx, btn) {
    if (S.answered) return;
    S.answered = true;
    markQuestionTime();

    var answersContainer = container.querySelector('#answersContainer');
    var feedbackLine = container.querySelector('#feedbackLine');

    /* Disable all buttons */
    var btns = answersContainer.querySelectorAll('.answer-btn');
    btns.forEach(function (b, i) {
      b.disabled = true;
      var a = S.shuffledAnswers[i];
      if (a.isCorrect) {
        b.classList.add('answer-correct');
        var letterEl = b.querySelector('.answer-letter');
        if (letterEl) letterEl.innerHTML = icoCustom('check', 16, 2.5);
      }
      if (i === ansIdx && !ans.isCorrect) {
        b.classList.add('answer-wrong');
        var letterEl2 = b.querySelector('.answer-letter');
        if (letterEl2) letterEl2.innerHTML = icoCustom('x', 16, 2.5);
      }
    });

    /* Feedback */
    if (ans.isCorrect) {
      S.score++;
      if (feedbackLine) {
        feedbackLine.className = 'feedback-line feedback-correct';
        feedbackLine.innerHTML = icoCustom('check', 16, 2.5) + ' \u041F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u043E!'; /* Правильно! */
      }
    } else {
      var q = S.questions[S.idx];
      if (!S.wrongQs.find(function (x) { return x.question === q.question; })) S.wrongQs.push(q);
      if (feedbackLine) {
        feedbackLine.className = 'feedback-line feedback-wrong';
        feedbackLine.innerHTML = icoCustom('x', 16, 2.5) + ' \u041D\u0435\u0432\u0435\u0440\u043D\u043E'; /* Неверно */
      }
    }

    /* Update timeline & progress */
    buildTimeline();
    updateProgress();

    /* Next after delay */
    setTimeout(function () {
      S.idx++;
      if (S.idx < S.questions.length) {
        renderQuestion();
      } else {
        showResults();
      }
    }, 1300);
  }


  /* ═══════════════════════════════════════════════════════════
     TOGGLE MULTI ANSWER (multi-mode only)
     ═══════════════════════════════════════════════════════════ */
  function toggleMultiAnswer(idx, btn) {
    if (S.answered) return;
    var pos = S.multiSelected.indexOf(idx);
    if (pos >= 0) {
      S.multiSelected.splice(pos, 1);
      btn.classList.remove('answer-selected');
    } else {
      S.multiSelected.push(idx);
      btn.classList.add('answer-selected');
    }
    var btnConfirmMulti = container.querySelector('#btnConfirmMulti');
    if (btnConfirmMulti) btnConfirmMulti.disabled = S.multiSelected.length === 0;
  }


  /* ═══════════════════════════════════════════════════════════
     HANDLE MULTI CONFIRM (multi-mode only)
     ═══════════════════════════════════════════════════════════ */
  function handleMultiConfirm() {
    if (S.answered) return;
    S.answered = true;
    markQuestionTime();

    var answersContainer = container.querySelector('#answersContainer');
    var feedbackLine = container.querySelector('#feedbackLine');
    var btnConfirmMulti = container.querySelector('#btnConfirmMulti');
    if (btnConfirmMulti) btnConfirmMulti.disabled = true;

    var btns = answersContainer.querySelectorAll('.answer-btn');
    var selectedSet = S.multiSelected.slice();
    var allCorrectSelected = true;
    var noneWrongSelected = true;

    btns.forEach(function (b, i) {
      b.disabled = true;
      var a = S.shuffledAnswers[i];
      var isSelected = selectedSet.indexOf(i) >= 0;
      var letterEl = b.querySelector('.answer-letter');
      if (a.isCorrect && isSelected) {
        /* Верно выбран — зелёный */
        b.classList.add('answer-correct');
        b.classList.remove('answer-selected');
        if (letterEl) letterEl.innerHTML = icoCustom('check', 16, 2.5);
      } else if (!a.isCorrect && isSelected) {
        /* Неверно выбран — красный */
        b.classList.add('answer-wrong');
        b.classList.remove('answer-selected');
        if (letterEl) letterEl.innerHTML = icoCustom('x', 16, 2.5);
        noneWrongSelected = false;
      } else if (a.isCorrect && !isSelected) {
        /* Пропущен правильный — оранжевый */
        b.classList.add('answer-missed');
        if (letterEl) letterEl.innerHTML = icoCustom('check', 16, 2.5);
        allCorrectSelected = false;
      }
    });

    var fullyCorrect = allCorrectSelected && noneWrongSelected;

    if (fullyCorrect) {
      S.score++;
      if (feedbackLine) {
        feedbackLine.className = 'feedback-line feedback-correct';
        feedbackLine.innerHTML = icoCustom('check', 16, 2.5) + ' \u041F\u043E\u043B\u043D\u043E\u0441\u0442\u044C\u044E \u0432\u0435\u0440\u043D\u043E!'; /* Полностью верно! */
      }
    } else {
      var q = S.questions[S.idx];
      if (!S.wrongQs.find(function (x) { return x.question === q.question; })) S.wrongQs.push(q);
      if (feedbackLine) {
        feedbackLine.className = 'feedback-line feedback-wrong';
        feedbackLine.innerHTML = icoCustom('x', 16, 2.5) + ' \u041D\u0435\u0432\u0435\u0440\u043D\u043E'; /* Неверно */
      }
    }

    buildTimeline();
    updateProgress();

    /* Next after delay — 1.5с для multi (чуть больше времени на анализ) */
    setTimeout(function () {
      S.idx++;
      if (S.idx < S.questions.length) {
        renderQuestion();
      } else {
        showResults();
      }
    }, 1500);
  }


  /* ═══════════════════════════════════════════════════════════
     SHOW RESULTS
     ═══════════════════════════════════════════════════════════ */
  function showResults() {
    stopTimer();
    if (S.questionTimes.length < S.questions.length) {
      S.questionTimes.push(Date.now() - S.questionStartTime);
    }

    var total = S.questions.length;
    var pct = total > 0 ? Math.round((S.score / total) * 100) : 0;
    var grade = getGrade(pct);
    var totalTime = Date.now() - S.quizStartTime;
    var avgTime = total > 0 ? totalTime / total : 0;

    setScreen('result');

    var resultTitle = container.querySelector('#resultTitle');
    var gradeDisplay = container.querySelector('#gradeDisplay');
    var resultScoreInfo = container.querySelector('#resultScoreInfo');
    var resultMsg = container.querySelector('#resultMsg');
    var resultStatOk = container.querySelector('#resultStatOk');
    var resultStatFail = container.querySelector('#resultStatFail');
    var resultStatPct = container.querySelector('#resultStatPct');
    var resultTotalTime = container.querySelector('#resultTotalTime');
    var resultAvgTime = container.querySelector('#resultAvgTime');

    if (S.isFirstRun) {
      if (resultTitle) resultTitle.textContent = '\u0412\u0430\u0448\u0430 \u043E\u0446\u0435\u043D\u043A\u0430'; /* Ваша оценка */
      if (gradeDisplay) { gradeDisplay.textContent = grade; show(gradeDisplay); }
      if (resultScoreInfo) resultScoreInfo.textContent = '\u0412\u0435\u0440\u043D\u043E: ' + S.score + ' \u0438\u0437 ' + total + ' (' + pct + '%)'; /* Верно: ... из ... (...%) */
    } else {
      if (resultTitle) resultTitle.textContent = '\u0420\u0430\u0431\u043E\u0442\u0430 \u043D\u0430\u0434 \u043E\u0448\u0438\u0431\u043A\u0430\u043C\u0438'; /* Работа над ошибками */
      if (gradeDisplay) hide(gradeDisplay);
      if (resultScoreInfo) resultScoreInfo.textContent = '\u0418\u0441\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E: ' + S.score + ' \u0438\u0437 ' + total; /* Исправлено: ... из ... */
    }

    if (resultMsg) {
      resultMsg.textContent = S.isFirstRun
        ? (S.wrongQs.length === 0
          ? '\u041E\u0442\u043B\u0438\u0447\u043D\u043E! \u041E\u0448\u0438\u0431\u043E\u043A \u043D\u0435\u0442!' /* Отлично! Ошибок нет! */
          : '\u041E\u0448\u0438\u0431\u043E\u043A: ' + S.wrongQs.length + '. \u041C\u043E\u0436\u043D\u043E \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C \u0438\u0445.') /* Ошибок: ... Можно повторить их. */
        : (S.wrongQs.length === 0
          ? '\u041F\u043E\u0437\u0434\u0440\u0430\u0432\u043B\u044F\u044E! \u0412\u0441\u0435 \u043E\u0448\u0438\u0431\u043A\u0438 \u0438\u0441\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u044B!' /* Поздравляю! Все ошибки исправлены! */
          : '\u041E\u0441\u0442\u0430\u043B\u043E\u0441\u044C \u043E\u0448\u0438\u0431\u043E\u043A: ' + S.wrongQs.length + '. \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437.'); /* Осталось ошибок: ... Повторите ещё раз. */
    }

    if (resultStatOk) resultStatOk.textContent = String(S.score);
    if (resultStatFail) resultStatFail.textContent = String(total - S.score);
    if (resultStatPct) resultStatPct.textContent = pct + '%';
    if (resultTotalTime) resultTotalTime.innerHTML = ico('clock') + ' ' + fmtTime(totalTime);
    if (resultAvgTime) resultAvgTime.textContent = '\u0421\u0440. ' + fmtTime(avgTime) + '/\u0432\u043E\u043F\u0440.'; /* Ср. .../вопр. */

    /* Work time bars */
    buildWorkTimeBars(total, totalTime);

    /* Buttons: two in one row — Повторить ошибки + Завершить тест */
    var btnRetryWrong = container.querySelector('#btnRetryWrong');
    var btnFinish = container.querySelector('#btnFinish');
    if (S.wrongQs.length > 0) {
      if (btnRetryWrong) {
        btnRetryWrong.innerHTML = ico('refresh-ccw') + ' \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C \u043E\u0448\u0438\u0431\u043A\u0438'; /* Повторить ошибки */
        btnRetryWrong.onclick = retryWrong;
        btnRetryWrong.style.display = '';
      }
    } else {
      if (btnRetryWrong) btnRetryWrong.style.display = 'none';
    }
    if (btnFinish) {
      btnFinish.innerHTML = '\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C \u0442\u0435\u0441\u0442'; /* Завершить тест */
      btnFinish.onclick = goStart;
    }

    var resultScreen = container.querySelector('#resultScreen');
    if (resultScreen) {
      resultScreen.classList.remove('animate-fade-in');
      void resultScreen.offsetWidth;
      resultScreen.classList.add('animate-fade-in');
    }

    /* Save result to history (first run only) */
    if (S.isFirstRun) {
      var testName = (S.customTests.find(function (t) { return t.name === S.selectedTest; }) || {}).name || '\u0422\u0435\u0441\u0442'; /* Тест */
      pushResult({
        testName: testName,
        date: Date.now(),
        score: S.score,
        total: total,
        pct: pct,
        grade: grade,
        time: totalTime,
        wrongQuestions: S.wrongQs.length > 0 ? JSON.parse(JSON.stringify(S.wrongQs)) : undefined
      });
    }
  }


  /* ═══════════════════════════════════════════════════════════
     WORK TIME BARS
     ═══════════════════════════════════════════════════════════ */
  function buildWorkTimeBars(total, totalTime) {
    var wtContainer = container.querySelector('#wtContainer');
    if (!wtContainer) return;
    wtContainer.innerHTML = '';
    var maxTime = Math.max.apply(null, S.questionTimes.concat([1]));

    for (var i = 0; i < total; i++) {
      var time = S.questionTimes[i] || 0;
      var pct = Math.min((time / maxTime) * 100, 100);
      var isWrong = !!S.wrongQs.find(function (q) { return q.question === (S.questions[i] || {}).question; });

      var card = document.createElement('div');
      card.className = 'wt-card';

      var row = document.createElement('div');
      row.className = 'wt-row';

      var label = document.createElement('span');
      label.className = 'wt-label';
      label.textContent = String(i + 1);

      var barTrack = document.createElement('div');
      barTrack.className = 'wt-bar-track';
      var barFill = document.createElement('div');
      barFill.className = 'wt-bar-fill ' + (isWrong ? 'wt-fail' : 'wt-ok');
      barFill.style.width = '0%';
      barTrack.appendChild(barFill);

      var timeLabel = document.createElement('span');
      timeLabel.className = 'wt-time';
      timeLabel.textContent = fmtTime(time);

      row.appendChild(label);
      row.appendChild(barTrack);
      row.appendChild(timeLabel);
      card.appendChild(row);
      wtContainer.appendChild(card);

      /* Animate bar fill with double rAF for transition */
      (function (fill, p) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            fill.style.width = p + '%';
          });
        });
      })(barFill, pct);
    }
  }


  /* ═══════════════════════════════════════════════════════════
     RENDER HEADER — direct DOM access per MODULE_CONTRACT
     ═══════════════════════════════════════════════════════════ */
  function getCurrentTestName() {
    var custom = S.customTests.find(function (t) { return t.name === S.selectedTest; });
    return custom ? custom.name : '';
  }

  function renderHeader() {
    var left   = document.getElementById('headerLeft');
    var center = document.getElementById('headerCenter');
    var right  = document.getElementById('headerRight');
    if (!left || !center || !right) return;

    var rightAction = openSettings;

    /* Left: menu button (hamburger) */
    left.innerHTML = '<button class="icon-btn" aria-label="Меню">' /* Меню */
      + (getIcons()['menu'] || '') + '</button>';
    left.onclick = function() { if (window.app && window.app.toggleMenu) window.app.toggleMenu(); };

    /* Center: test name during quiz/result, module name on start */
    var headerTitle = '\u0422\u0435\u0441\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435'; /* Тестирование */
    if (S.screen === 'quiz' || S.screen === 'result') {
      var tName = getCurrentTestName();
      if (tName) headerTitle = tName;
    }
    center.innerHTML = '<div class="hc-module">' + headerTitle + '</div>';

    /* Right: settings button */
    right.innerHTML = '<button class="icon-btn" aria-label="Настройки">' /* Настройки */
      + (getIcons()['ellipsis-vertical'] || '') + '</button>';
    right.onclick = rightAction;
  }


  /* ═══════════════════════════════════════════════════════════
     POPULATE STATIC ICONS
     ═══════════════════════════════════════════════════════════ */
  function populateIcons() {
    var startIcon = container.querySelector('#btnStartIcon');
    if (startIcon) startIcon.innerHTML = ico('play');
    var modalCloseIcon = container.querySelector('#modalClose');
    if (modalCloseIcon) modalCloseIcon.innerHTML = getIcons()['close'] || '';
    var uploadIcon = container.querySelector('#uploadIcon');
    if (uploadIcon) uploadIcon.innerHTML = ico('upload');
    var shuffleIcon = container.querySelector('#shuffleIcon');
    if (shuffleIcon) shuffleIcon.innerHTML = ico('shuffle');
    var trashIcon = container.querySelector('#trashIcon');
    if (trashIcon) trashIcon.innerHTML = ico('trash-2');
    var stopIcon = container.querySelector('#stopIcon');
    if (stopIcon) stopIcon.innerHTML = ico('x');
  }


  /* ───────────────────────────────────────────────────────────────
     RENDER FULL QUIZ HTML INTO CONTAINER
     ─────────────────────────────────────────────────────────────── */
  function renderHTML() {
    container.innerHTML =
      '<div class="module-container">' +

      '<!-- \u2550\u2550\u2550 START SCREEN \u2550\u2550\u2550 -->' +
      '<div id="quizStartScreen">' +
        '<div class="app-card animate-fade-in" style="text-align: center; margin-bottom: 16px">' +
          '<div style="font-size: var(--font-hero); font-family: var(--font-accent); line-height: 1.2; color: var(--color-primary)">' +
            '\u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0441\u0432\u043E\u0438 \u0437\u043D\u0430\u043D\u0438\u044F' + /* Проверьте свои знания */
          '</div>' +
          '<p id="startTestName" style="font-size: var(--font-md); color: var(--color-text-secondary); margin-top: 10px; font-weight: 600; letter-spacing: 0.01em"></p>' +
        '</div>' +
        '<div id="loader" class="app-card">' +
          '<div class="skeleton" style="height: 44px; border-radius: var(--border-radius-sm); margin-bottom: 8px"></div>' +
          '<div class="skeleton" style="height: 44px; border-radius: var(--border-radius-sm)"></div>' +
        '</div>' +
        '<div id="errorEl" class="app-card" style="display:none; text-align: center">' +
          '<p style="color: var(--color-danger); font-size: var(--font-base); margin: 0 0 12px 0">\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438</p>' + /* Ошибка загрузки */
          '<button id="btnRetryLoad" class="btn-primary">\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C</button>' + /* Повторить */
        '</div>' +
        '<div id="startContent" style="display:none">' +
          '<button id="btnStart" class="btn-primary" style="width: 100%; margin-top: 16px">' +
            '<span id="btnStartIcon" style="display: inline-flex; margin-right: 8px"></span>' +
            '\u041D\u0430\u0447\u0430\u0442\u044C \u0442\u0435\u0441\u0442' + /* Начать тест */
          '</button>' +
        '</div>' +
        '<div id="historyContainer" style="display:none"></div>' +
      '</div>' +

      '<!-- \u2550\u2550\u2550 QUIZ SCREEN \u2550\u2550\u2550 -->' +
      '<div id="quizScreen" style="display:none">' +
        '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px">' +
          '<span id="quizProgressLabel" style="font-size: var(--font-xs); font-weight: 700; color: var(--color-text-secondary); letter-spacing: 0.01em; text-transform: uppercase"></span>' +
          '<span id="quizBadge" class="quiz-badge quiz-badge-danger" style="display:none">\u041E\u0428\u0418\u0411\u041A\u0418</span>' + /* ОШИБКИ */
          '<span id="quizScreenTimer" class="quiz-screen-timer"></span>' +
        '</div>' +
        '<!-- Progress section with timeline -->' +
        '<div id="progressSection" class="quiz-progress-section" style="display:none">' +
          '<div id="timeline" class="quiz-timeline"></div>' +
          '<div class="quiz-progress-track">' +
            '<div id="progressFill" class="quiz-progress-fill"></div>' +
          '</div>' +
        '</div>' + /* ОШИБКИ */
        '<div class="app-card" style="border-left: 4px solid var(--color-primary)">' +
          '<h2 id="questionText" style="font-size: var(--font-lg); font-weight: 700; line-height: 1.4; margin: 0; color: var(--color-text-main); letter-spacing: -0.01em"></h2>' +
          '<div id="questionImageWrap" class="question-image-wrap" style="display:none">' +
            '<img id="questionImage" alt="\u0438\u043B\u043B\u044E\u0441\u0442\u0440\u0430\u0446\u0438\u044F">' + /* иллюстрация */
          '</div>' +
        '</div>' +
        '<div id="multiHint" class="multi-hint" style="display:none">\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0432\u0441\u0435 \u0432\u0435\u0440\u043D\u044B\u0435 \u043E\u0442\u0432\u0435\u0442\u044B</div>' + /* Выберите все верные ответы */
        '<div id="answersContainer" style="margin-top: 8px"></div>' +
        '<button id="btnConfirmMulti" class="btn-primary" style="display:none; width: 100%; margin-top: 12px">\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C</button>' + /* Подтвердить */
        '<div id="feedbackLine" class="feedback-line"></div>' +
      '</div>' +

      '<!-- \u2550\u2550\u2550 RESULT SCREEN \u2550\u2550\u2550 -->' +
      '<div id="resultScreen" style="display:none">' +
        '<div class="app-card" style="padding: 32px 20px; text-align: center">' +
          '<h2 id="resultTitle" style="font-size: var(--font-xl); font-weight: 700; margin: 0 0 4px 0; letter-spacing: -0.01em"></h2>' +
          '<div id="gradeDisplay" class="grade-display"></div>' +
          '<p id="resultScoreInfo" style="font-size: var(--font-md); color: var(--color-text-secondary); margin: 8px 0 0 0"></p>' +
        '</div>' +
        '<div id="resultMsg" class="result-msg-box"></div>' +
        '<div class="app-card" style="display: flex; justify-content: center; gap: 24px; padding: 16px 20px">' +
          '<div style="text-align: center">' +
            '<div id="resultStatOk" style="font-size: var(--font-xl); font-weight: 700; color: var(--color-success)"></div>' +
            '<div style="font-size: var(--font-xs); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.01em; margin-top: 2px">\u0412\u0435\u0440\u043D\u043E</div>' + /* Верно */
          '</div>' +
          '<div style="width: 1px; background: var(--color-border-subtle)"></div>' +
          '<div style="text-align: center">' +
            '<div id="resultStatFail" style="font-size: var(--font-xl); font-weight: 700; color: var(--color-danger)"></div>' +
            '<div style="font-size: var(--font-xs); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.01em; margin-top: 2px">\u041D\u0435\u0432\u0435\u0440\u043D\u043E</div>' + /* Неверно */
          '</div>' +
          '<div style="width: 1px; background: var(--color-border-subtle)"></div>' +
          '<div style="text-align: center">' +
            '<div id="resultStatPct" style="font-size: var(--font-xl); font-weight: 700; color: var(--color-primary)"></div>' +
            '<div style="font-size: var(--font-xs); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.01em; margin-top: 2px">\u041F\u0440\u043E\u0446\u0435\u043D\u0442</div>' + /* Процент */
          '</div>' +
        '</div>' +
        '<div class="app-card">' +
          '<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px">' +
            '<span id="resultTotalTime" style="font-size: var(--font-sm); color: var(--color-text-secondary); display: flex; align-items: center; gap: 4px"></span>' +
            '<span id="resultAvgTime" style="font-size: var(--font-sm); color: var(--color-text-muted)"></span>' +
          '</div>' +
        '</div>' +
        '<div id="wtContainer" class="app-card"></div>' +
        '<div class="quiz-result-btns">' +
          '<button id="btnRetryWrong" class="btn-outline" style="display: none"></button>' +
          '<button id="btnFinish" class="btn-primary"></button>' +
        '</div>' +
      '</div>' +

      '<!-- \u2550\u2550\u2550 SETTINGS MODAL \u2550\u2550\u2550 -->' +
      '<div id="settingsOverlay" class="quiz-overlay">' +
        '<div class="quiz-modal">' +
          '<div class="quiz-modal-handle"></div>' +
          '<div class="quiz-modal-header">' +
            '<h3>\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438</h3>' + /* Настройки */
            '<button id="modalClose" class="quiz-modal-close" aria-label="\u0417\u0430\u043A\u0440\u044B\u0442\u044C"></button>' + /* Закрыть */
          '</div>' +
          '<div class="quiz-modal-body">' +
            '<div class="quiz-modal-section">' +
              '<label for="modalTestSelector" style="font-size: var(--font-sm); font-weight: 600; color: var(--color-text-secondary); display: block; margin-bottom: 6px">\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u0435\u0441\u0442</label>' + /* Выберите тест */
              '<select id="modalTestSelector" class="quiz-select"></select>' +
            '</div>' +
            '<div class="quiz-mode-toggle-wrap quiz-modal-section">' +
              '<div class="quiz-mode-label">\u0420\u0415\u0416\u0418\u041C</div>' + /* РЕЖИМ */
              '<div class="quiz-mode-toggle">' +
                '<button id="modalModeTrain" type="button" class="quiz-mode-btn quiz-mode-btn--active">' +
                  '<span class="quiz-mode-name">\u0422\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430</span>' + /* Тренировка */
                  '<span class="quiz-mode-sub">\u0432\u0441\u0435 \u0432\u043E\u043F\u0440\u043E\u0441\u044B</span>' + /* все вопросы */
                '</button>' +
                '<button id="modalModeExam" type="button" class="quiz-mode-btn">' +
                  '<span class="quiz-mode-name">\u0422\u0435\u0441\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435</span>' + /* Тестирование */
                  '<span class="quiz-mode-sub">10 \u0432\u043E\u043F\u0440\u043E\u0441\u043E\u0432</span>' + /* 10 вопросов */
                '</button>' +
              '</div>' +
              '<div class="quiz-mode-divider"></div>' +
              '<div class="quiz-toggle-wrap quiz-toggle-wrap--inline">' +
                '<span class="quiz-toggle-label">' +
                  '<span id="shuffleIcon" style="display: inline-flex"></span>' +
                  '\u041F\u0435\u0440\u0435\u043C\u0435\u0448\u0430\u0442\u044C \u0432\u043E\u043F\u0440\u043E\u0441\u044B' + /* Перемешать вопросы */
                '</span>' +
                '<label class="quiz-switch">' +
                  '<input id="modalShuffleToggle" type="checkbox" checked>' +
                  '<span class="quiz-slider"></span>' +
                '</label>' +
              '</div>' +
            '</div>' +
            '<button id="modalBtnStop" class="btn-danger-outline quiz-modal-btn quiz-modal-section" style="display:none">' +
              '<span id="stopIcon" style="display: inline-flex; margin-right: 6px"></span>' +
              '\u041F\u0440\u0435\u043A\u0440\u0430\u0442\u0438\u0442\u044C \u0442\u0435\u0441\u0442' + /* Прекратить тест */
            '</button>' +
            '<label class="quiz-file-label quiz-modal-btn quiz-modal-section">' +
              '<span id="uploadIcon" style="display: inline-flex"></span>' +
              'Загрузить свой тест (JSON)' + /* Загрузить свой тест (JSON) */
              '<input id="modalFileInput" type="file" accept=".json" style="display: none">' +
            '</label>' +
            '<button id="modalBtnClearHistory" class="btn-outline quiz-modal-btn quiz-modal-btn-danger quiz-modal-section">' +
              '<span id="trashIcon" style="display: inline-flex; margin-right: 6px"></span>' +
              'Очистить результаты' + /* Очистить результаты */
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '</div>'; /* close .module-container */
  }


  /* ═══════════════════════════════════════════════════════════════
     MODULE CONTRACT IMPLEMENTATION — init / destroy
     ═══════════════════════════════════════════════════════════════ */

  function init() {
    container = document.getElementById('quizContainer');
    if (!container) {
      console.error('Quiz module: container #quizContainer not found');
      return;
    }

    /* Reset state on re-entry */
    stopTimer();
    S.screen = 'start';
    S.inited = false;

    /* Render HTML into container */
    renderHTML();

    /* Populate icons */
    populateIcons();

    /* Event delegation — init() called strictly once (MODULE_CONTRACT §5) */
    container.addEventListener('click', function (e) {
      var btnStart = e.target.closest('#btnStart');
      if (btnStart) { startQuiz(); return; }

      var btnQuizSettings = e.target.closest('#btnQuizSettings');
      if (btnQuizSettings) { openSettings(); return; }

      var btnRetryLoad = e.target.closest('#btnRetryLoad');
      if (btnRetryLoad) { loadData(); return; }

      var btnConfirmMulti = e.target.closest('#btnConfirmMulti');
      if (btnConfirmMulti) { handleMultiConfirm(); return; }
    });

    /* Bind other modal events (id-based, not delegation) */
    bindModalEvents();

    /* Load data */
    loadData();

    /* Set initial screen visibility (без renderHeader — он уже вызван navigateTo) */
    var startScreen = container.querySelector('#quizStartScreen');
    if (startScreen) show(startScreen);
    /* Контракт MODULE_CONTRACT §5: init() не вызывает renderHeader() —
       app.navigateTo() вызывает его автоматически до init() */

    S.inited = true;
  }

  function destroy() {
    stopTimer();
    S.inited = false;
  }


  /* ═══════════════════════════════════════════════════════════════
     REGISTER MODULE — ModuleRegistry contract (two-argument form)
     ═══════════════════════════════════════════════════════════════ */
  window.ModuleRegistry.register('quiz', {
    title:        '\u0422\u0435\u0441\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435', /* Тестирование */
    icon:         'graduation-cap',
    containerId:  'quizContainer',
    screenId:     'quizScreen',
    init:         init,
    renderHeader: renderHeader,
    destroy:      destroy
  });

})();
