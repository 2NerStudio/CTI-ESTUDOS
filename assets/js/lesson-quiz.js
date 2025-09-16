(function (w, d) {
  'use strict';

  const HUMANAS_URL = '/dados/questoes/humanas.json';
  const HIST_KEY = 'simulado:cti2026:history';

  function $(sel, root = d) { return root.querySelector(sel); }

  async function fetchJSON(url) {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) throw new Error('Falha ao carregar ' + url);
    return res.json();
  }

  function slug(s) {
    return (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g,'');
  }

  function filterByTema(data, { area, tema, nivel }) {
    return data.filter(q => 
      (q.disciplina === 'humanas') &&
      ((q.area || '').toLowerCase() === (area || '').toLowerCase()) &&
      (!tema || (q.tema || '').toLowerCase() === tema.toLowerCase()) &&
      (!nivel || (q.nivel || '').toLowerCase() === nivel.toLowerCase())
    );
  }

  function toHistoryPayload(app, mode) {
    const qs = app.state.questions || [];
    const ans = app.state.answers || {};
    const total = qs.length;
    const correct = qs.filter(q => ans[q.id] && ans[q.id].isCorrect).length;
    const answered = Object.keys(ans).length;
    const pct = total ? Math.round((correct / total) * 100) : 0;
    const items = qs.map(q => {
      const a = ans[q.id] || {};
      return {
        id: q.id,
        disciplina: q.disciplina,
        area: q.area || null,
        tema: q.tema || null,
        correct: !!a.isCorrect,
        time: typeof a.time === 'number' ? a.time : null
      };
    });
    const started = app.state.startTime || Date.now();
    const durationSeconds = Math.max(1, Math.round((Date.now() - started) / 1000));
    return {
      id: 'sess-les-' + Date.now(),
      timestamp: Date.now(),
      mode: mode || 'aula',
      total,
      correct,
      pct,
      durationSeconds,
      items,
      questions: qs.map(q => q.id)
    };
  }

  function pushHistory(payload) {
    if (!w.AppStorage) return;
    const hist = w.AppStorage.get(HIST_KEY) || [];
    hist.unshift(payload);
    w.AppStorage.set(HIST_KEY, hist);
  }

  async function mountLessonPractice(opts) {
    const rootSel = opts.root || '#lesson-quiz';
    const $root = typeof rootSel === 'string' ? $(rootSel) : rootSel;
    if (!$root) { console.warn('lesson-quiz: container não encontrado', rootSel); return; }

    const tema = opts.tema;
    const area = opts.area || 'geografia';
    const nivel = opts.nivel || null;

    $root.innerHTML = `
      <div class="card">
        <div style="display:flex; gap:.5rem; align-items:center; flex-wrap:wrap;">
          <strong>Pratique este tema</strong>
          <span class="chip">${area} • ${tema}</span>
          <div class="btn-row" style="margin-left:auto;">
            <button class="btn btn--primary" id="les-btn-10">10 questões</button>
            <button class="btn btn--outline" id="les-btn-20">20 questões</button>
            <a class="btn btn--ghost" id="les-link-adp" href="/simulados/adaptativo.html?disc=humanas&area=${encodeURIComponent(area)}&tema=${encodeURIComponent(tema)}&add=20&start=1" target="_blank">Adaptativo (20)</a>
          </div>
        </div>
        <div id="les-out" style="margin-top:.75rem;"></div>
      </div>
    `;

    async function start(limit) {
      const all = await fetchJSON(HUMANAS_URL);
      const filtered = filterByTema(all, { area, tema, nivel });
      if (!filtered.length) {
        $('#les-out', $root).innerHTML = `<div class="card card--soft">Ainda não há questões para “${tema}”.</div>`;
        return;
      }
      const subset = filtered.slice().sort(() => Math.random() - 0.5).slice(0, limit || 10);
      $('#les-out', $root).innerHTML = '';
      const key = opts.persistKey || `quiz:les:${slug(area)}:${slug(tema)}:v1`;
      const mode = `aula:${slug(area)}:${slug(tema)}`;

      if (!w.CTIQuiz || typeof w.CTIQuiz.startWithData !== 'function') {
        console.error('CTIQuiz não está disponível.');
        return;
      }

      const app = await w.CTIQuiz.startWithData(subset, {
        container: '#les-out',
        limit: subset.length,
        shuffleAlternatives: true,
        shuffleQuestions: true,
        persistKey: key,
        showExplainOnCheck: true,
        onFinish(appRef) {
          const payload = toHistoryPayload(appRef, mode);
          pushHistory(payload);
        }
      });

      if (w.CTICollections && typeof w.CTICollections.mount === 'function') {
        w.CTICollections.mount(app);
      }
    }

    $('#les-btn-10', $root).addEventListener('click', () => start(10));
    $('#les-btn-20', $root).addEventListener('click', () => start(20));
  }

  w.CTILessonQuiz = { mount: mountLessonPractice };
})(window, document);
