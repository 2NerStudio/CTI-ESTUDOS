/* assets/js/simulado.pro.js
   Simulado Pro: paleta de questões, atalho de teclado, marcar/revisar, resumo por disciplina.
   Requer que CTIQuiz e CTISim estejam carregados. 
   Uso: após iniciar o app (CTIQuiz.startWithData), chame CTIPro.mount(app, selectors).
*/
(function (w, d) {
  'use strict';

  function $(sel, root = d) { return root.querySelector(sel); }
  function $all(sel, root = d) { return Array.from(root.querySelectorAll(sel)); }

  const DEFAULT_SEL = {
    sidebar: '#pro-sidebar',
    palette: '#pro-palette',
    summary: '#pro-summary',
    markBtn: '#pro-btn-mark',
    jumpBtn: '#pro-btn-jump'
  };

  function fmtDisc(s) { return s ? (s[0].toUpperCase() + s.slice(1)) : '—'; }

  function CTIProMount(app, selectors = {}) {
    const sel = { ...DEFAULT_SEL, ...selectors };
    const $side = $(sel.sidebar);
    const $pal = $(sel.palette);
    const $sum = $(sel.summary);
    const $btnMark = $(sel.markBtn);
    const $btnJump = $(sel.jumpBtn);

    if (!$side || !$pal || !$sum) {
      console.warn('CTIPro: sidebar ou seus elementos não encontrados. Verifique os seletores.');
      return;
    }

    // Helper: garantir registro (seen/flag)
    function ensureEntry(qId) {
      app.state.answers[qId] = app.state.answers[qId] || {};
      return app.state.answers[qId];
    }

    // Status por questão
    function getStatus(q, idx) {
      const ans = app.state.answers[q.id];
      const current = (idx === app.state.index);
      if (!ans) return { cls: 'st-notseen', label: 'não vista', current, marked: false };
      const marked = !!ans.flagged;
      if (ans.isChecked) {
        if (ans.isCorrect) return { cls: 'st-correct', label: 'correta', current, marked };
        return { cls: 'st-wrong', label: 'incorreta', current, marked };
      }
      // vista mas sem conferir
      return { cls: 'st-unanswered', label: 'não respondida', current, marked };
    }

    // Resumo por disciplina
    function buildSummary() {
      const agg = {};
      for (const q of app.state.questions) {
        const d = q.disciplina || '—';
        agg[d] = agg[d] || { total: 0, correct: 0, checked: 0 };
        agg[d].total++;
        const ans = app.state.answers[q.id];
        if (ans && ans.isChecked) {
          agg[d].checked++;
          if (ans.isCorrect) agg[d].correct++;
        }
      }
      $sum.innerHTML = Object.keys(agg).sort().map(disc => {
        const x = agg[disc];
        const pct = x.total ? Math.round((x.correct / x.total) * 100) : 0;
        return `
          <div class="sum-row">
            <strong>${fmtDisc(disc)}</strong>
            <span class="muted">${x.correct}/${x.total} (${pct}%)</span>
          </div>`;
      }).join('');
    }

    // Render paleta
    function buildPalette() {
      const items = app.state.questions.map((q, i) => {
        const st = getStatus(q, i);
        const marked = st.marked ? 'is-marked' : '';
        const current = st.current ? 'is-current' : '';
        const title = `${fmtDisc(q.disciplina)}${q.tema ? ' • ' + q.tema : ''} • ${st.label}`;
        return `
          <button type="button" class="pal-item ${st.cls} ${marked} ${current}" title="${title}" data-index="${i}">
            ${i + 1}
          </button>
        `;
      }).join('');
      $pal.innerHTML = items;

      // Navegar ao clicar
      $all('.pal-item', $pal).forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-index'), 10);
          app.state.index = idx;
          app.render();
        });
      });
    }

    function updateUI() {
      buildPalette();
      buildSummary();
    }

    // Marcar/desmarcar a questão atual para revisão
    function toggleMarkCurrent() {
      const q = app.state.questions[app.state.index];
      if (!q) return;
      const e = ensureEntry(q.id);
      e.flagged = !e.flagged;
      if (typeof app.persist === 'function') app.persist();
      updateUI();
    }

    // Ir para a primeira não respondida
    function jumpToFirstUnanswered() {
      const idx = app.state.questions.findIndex(q => {
        const a = app.state.answers[q.id];
        return !(a && a.isChecked);
      });
      if (idx >= 0) {
        app.state.index = idx;
        app.render();
      }
    }

    // Patches: marcar "vista" ao render e atualizar a paleta
    const origRender = app.render.bind(app);
    app.render = function () {
      const q = app.state.questions[app.state.index];
      if (q) {
        const entry = ensureEntry(q.id);
        if (!entry.seen) { entry.seen = true; if (typeof app.persist === 'function') app.persist(); }
      }
      origRender();
      updateUI();
    };

    // Patches úteis: após conferir/navegar, reflete na paleta
    ['check', 'next', 'prev', 'finish', 'restart'].forEach(method => {
      if (typeof app[method] === 'function') {
        const orig = app[method].bind(app);
        app[method] = function (...args) {
          const r = orig(...args);
          // pequeno atraso para o DOM do quiz atualizar
          setTimeout(updateUI, 0);
          return r;
        };
      }
    });

    // Botões
    if ($btnMark) $btnMark.addEventListener('click', toggleMarkCurrent);
    if ($btnJump) $btnJump.addEventListener('click', jumpToFirstUnanswered);

    // Atalhos de teclado
    function isTypingTarget(el) {
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || el.isContentEditable;
    }
    d.addEventListener('keydown', (ev) => {
      if (isTypingTarget(ev.target)) return;
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); app.prev(); }
      else if (ev.key === 'ArrowRight') { ev.preventDefault(); app.next(); }
      else if (ev.key.toLowerCase() === 'm') { ev.preventDefault(); toggleMarkCurrent(); }
      else if (ev.key.toLowerCase() === 'c') { ev.preventDefault(); app.check(); }
      else if (ev.key.toLowerCase() === 'f') { ev.preventDefault(); app.finish(); }
    });

    // Primeira montagem
    updateUI();
  }

  w.CTIPro = { mount: CTIProMount };
})(window, document);