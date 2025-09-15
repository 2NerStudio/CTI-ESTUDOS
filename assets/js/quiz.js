/* assets/js/quiz.js
   Motor de questões: carrega JSONs, renderiza cartões, confere respostas,
   mostra explicação e salva progresso (via AppStorage).
   Uso rápido:
     CTIQuiz.loadAndStart({
       container: '#quiz-root',
       urls: ['/dados/questoes/portugues.json'],
       limit: 10,
       shuffleQuestions: true,
       shuffleAlternatives: true,
       persistKey: 'quiz:demo-portugues'
     });
*/
(function (w, d) {
  'use strict';

  const DEFAULTS = {
    container: '#quiz-root',
    data: null,         // array de questões (opcional se usar urls)
    urls: null,         // array de URLs para carregar JSON
    limit: null,        // limitar nº de questões
    shuffleQuestions: true,
    shuffleAlternatives: true,
    persistKey: null,   // ex.: 'quiz:demo'
    showExplainOnCheck: true
  };

  function $(sel, root = d) { return root.querySelector(sel); }
  function $all(sel, root = d) { return Array.from(root.querySelectorAll(sel)); }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function uniqById(list) {
    const seen = new Set();
    return list.filter(q => {
      if (!q || !q.id) return false;
      if (seen.has(q.id)) return false;
      seen.add(q.id);
      return true;
    });
  }

  function normalizeQuestion(q) {
    // Garante estrutura de alternativas como array [{key, text, isCorrect}]
    const alts = [];
    if (q.alternativas && typeof q.alternativas === 'object') {
      for (const k of Object.keys(q.alternativas)) {
        alts.push({
          key: k,
          text: String(q.alternativas[k] ?? ''),
          isCorrect: (k === q.correta)
        });
      }
    }
    return {
      id: q.id,
      disciplina: q.disciplina,
      area: q.area || null,
      tema: q.tema || null,
      habilidade: q.habilidade || null,
      nivel: q.nivel || null,
      ano: q.ano || null,
      fonte: q.fonte || null,
      enunciado: String(q.enunciado || ''),
      alternativas: alts,
      correta: q.correta,
      explicacao: String(q.explicacao || ''),
      midia: q.midia || null,
      tags: q.tags || []
    };
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) throw new Error(`Falha ao carregar ${url}: ${res.status}`);
    return res.json();
  }

  class QuizApp {
    constructor(opts = {}) {
      this.opts = { ...DEFAULTS, ...opts };
      this.$root = typeof this.opts.container === 'string' ? $(this.opts.container) : this.opts.container;
      if (!this.$root) throw new Error('CTIQuiz: container não encontrado.');
      this.state = {
        started: false,
        finished: false,
        index: 0,
        questions: [],
        answers: {}, // id -> { selectedKey, isCorrect, time }
        startTime: null,
        questionStart: null
      };
      this.persistKey = this.opts.persistKey;
    }

    async init() {
      let items = [];
      if (Array.isArray(this.opts.data)) {
        items = this.opts.data;
      } else if (Array.isArray(this.opts.urls) && this.opts.urls.length) {
        const arrays = await Promise.all(this.opts.urls.map(u => fetchJSON(u)));
        items = arrays.flat();
      } else {
        throw new Error('CTIQuiz: informe data[] ou urls[].');
      }

      // Normalizar, deduplicar, opcional embaralhar e limitar
      let questions = uniqById(items).map(normalizeQuestion);

      if (this.opts.shuffleAlternatives) {
        questions = questions.map(q => ({ ...q, alternativas: shuffle(q.alternativas) }));
      }
      if (this.opts.shuffleQuestions) {
        questions = shuffle(questions);
      }
      if (typeof this.opts.limit === 'number' && this.opts.limit > 0) {
        questions = questions.slice(0, this.opts.limit);
      }

      this.state.questions = questions;

      // Tentar carregar progresso salvo
      if (this.persistKey && w.AppStorage) {
        const saved = AppStorage.get(this.persistKey);
        if (saved && saved.questions && Array.isArray(saved.questions) && saved.questions.length) {
          // Se o conjunto salvo é o mesmo (mesmos ids e ordem), retomar
          const sameSet = saved.questions.length === questions.length &&
            saved.questions.every((id, i) => id === questions[i].id);
          if (sameSet) {
            this.state.index = Math.min(saved.index || 0, questions.length - 1);
            this.state.answers = saved.answers || {};
          } else {
            // Conjunto mudou, descartar progresso incompatível
            AppStorage.remove(this.persistKey);
          }
        }
      }

      this.renderShell();
    }

    renderShell() {
      this.$root.innerHTML = `
        <div class="card" id="quiz-card">
          <div class="quiz-head">
            <div class="quiz-meta">
              <span class="pill" id="quiz-count"></span>
              <span class="pill" id="quiz-discipline"></span>
              <button class="btn btn--outline" id="btn-restart" type="button" style="margin-left:auto;">Reiniciar</button>
            </div>
            <h2 id="quiz-title" class="h4">Praticar questões</h2>
          </div>

          <div id="quiz-body"></div>

          <div class="quiz-controls">
            <button class="btn btn--outline" id="btn-prev" type="button">← Anterior</button>
            <button class="btn btn--outline" id="btn-skip" type="button">Pular</button>
            <button class="btn btn--primary" id="btn-check" type="button">Conferir</button>
            <button class="btn btn--secondary" id="btn-next" type="button">Próxima →</button>
            <button class="btn btn--primary" id="btn-finish" type="button">Finalizar</button>
          </div>

          <div class="quiz-footer">
            <div id="quiz-progress" aria-live="polite" class="text-muted"></div>
          </div>
        </div>

        <div class="card card--soft" id="quiz-summary" hidden>
          <h3 class="h4">Resumo do desempenho</h3>
          <p id="quiz-score"></p>
          <div id="quiz-review"></div>
          <div class="btn-row">
            <button class="btn btn--primary" id="btn-review-errors" type="button">Rever erros</button>
            <button class="btn btn--outline" id="btn-new-session" type="button">Nova sessão</button>
            <button class="btn btn--ghost" id="btn-clear" type="button">Limpar progresso</button>
          </div>
        </div>
      `;

      this.$body = $('#quiz-body', this.$root);
      this.$count = $('#quiz-count', this.$root);
      this.$disc = $('#quiz-discipline', this.$root);
      this.$progress = $('#quiz-progress', this.$root);
      this.$summary = $('#quiz-summary', this.$root);
      this.$score = $('#quiz-score', this.$root);
      this.$review = $('#quiz-review', this.$root);

      // Eventos
      $('#btn-prev', this.$root).addEventListener('click', () => this.prev());
      $('#btn-next', this.$root).addEventListener('click', () => this.next());
      $('#btn-skip', this.$root).addEventListener('click', () => this.skip());
      $('#btn-check', this.$root).addEventListener('click', () => this.check());
      $('#btn-finish', this.$root).addEventListener('click', () => this.finish());
      $('#btn-restart', this.$root).addEventListener('click', () => this.restartConfirm());
      $('#btn-review-errors', this.$root).addEventListener('click', () => this.reviewErrors());
      $('#btn-new-session', this.$root).addEventListener('click', () => this.newSession());
      $('#btn-clear', this.$root).addEventListener('click', () => this.clearProgress());

      this.start();
    }

    start() {
      this.state.started = true;
      this.state.finished = false;
      this.state.startTime = Date.now();
      this.state.questionStart = Date.now();
      this.render();
      this.updateMeta();
      this.persist();
    }

    updateMeta() {
      const total = this.state.questions.length;
      const i = this.state.index + 1;
      this.$count.textContent = `Questão ${i} de ${total}`;
      const q = this.state.questions[this.state.index] || {};
      const disc = q.disciplina ? q.disciplina[0].toUpperCase() + q.disciplina.slice(1) : '—';
      this.$disc.textContent = disc;
      this.$disc.style.display = q.disciplina ? 'inline-flex' : 'none';

      const answered = Object.keys(this.state.answers).length;
      this.$progress.textContent = `${answered}/${total} respondidas`;
    }

    render() {
      const q = this.state.questions[this.state.index];
      if (!q) return;
      const saved = this.state.answers[q.id] || null;

      const mediaHTML = q.midia && q.midia.tipo === 'imagem'
        ? `<figure class="media"><img src="${q.midia.src}" alt="${q.midia.alt || ''}" loading="lazy"/><figcaption>${q.midia.credito || ''}</figcaption></figure>`
        : '';

      const altsHTML = q.alternativas.map((alt, idx) => {
        const inputId = `alt-${this.state.index}-${alt.key}`;
        const checked = saved && saved.selectedKey === alt.key ? 'checked' : '';
        return `
          <li class="alt-item">
            <input type="radio" name="alts" id="${inputId}" value="${alt.key}" ${checked} />
            <label for="${inputId}" class="alt-label"><strong>${alt.key})</strong> ${alt.text}</label>
          </li>
        `;
      }).join('');

      this.$body.innerHTML = `
        <article class="question">
          <div class="question-head">
            <p class="text-muted">${q.disciplina || ''} ${q.area ? '• ' + q.area : ''} ${q.tema ? '• ' + q.tema : ''}</p>
            <h3 class="h4" id="q-enunciado">${q.enunciado}</h3>
            ${mediaHTML}
          </div>
          <form id="form-alts" class="alts" role="radiogroup" aria-labelledby="q-enunciado">
            <ul class="list list--clean alt-list">
              ${altsHTML}
            </ul>
          </form>
          <div id="feedback" class="feedback" aria-live="polite" role="status"></div>
          <details id="explicacao" ${saved && saved.isChecked ? '' : 'hidden'}>
            <summary>Ver explicação</summary>
            <p>${q.explicacao || 'Sem explicação cadastrada.'}</p>
          </details>
        </article>
      `;

      // Se já conferida, pintar corretas/erradas
      if (saved && saved.isChecked) {
        this.paintCorrection(q, saved.selectedKey);
      }

      this.updateMeta();
      this.state.questionStart = Date.now();
    }

    getSelectedKey() {
      const $selected = $('#form-alts input[type="radio"]:checked', this.$root);
      return $selected ? $selected.value : null;
    }

    check() {
      const q = this.state.questions[this.state.index];
      if (!q) return;

      const selectedKey = this.getSelectedKey();
      const feedback = $('#feedback', this.$root);

      if (!selectedKey) {
        feedback.textContent = 'Selecione uma alternativa para conferir.';
        return;
      }

      const isCorrect = (selectedKey === q.correta);
      feedback.textContent = isCorrect ? 'Correta! ✅' : `Incorreta. ❌ Resposta: ${q.correta}.`;
      $('#explicacao', this.$root).hidden = !this.opts.showExplainOnCheck ? true : false;

      // Salvar resposta
      const timeSpent = Date.now() - (this.state.questionStart || Date.now());
      this.state.answers[q.id] = {
        selectedKey,
        isCorrect,
        isChecked: true,
        time: timeSpent
      };

      this.paintCorrection(q, selectedKey);
      this.persist();
      this.updateMeta();
    }

    paintCorrection(q, selectedKey) {
      const items = $all('.alt-item', this.$root);
      for (const li of items) {
        const input = $('input', li);
        const key = input.value;
        li.classList.remove('is-correct', 'is-wrong', 'is-selected');
        input.disabled = true;
        if (key === selectedKey) li.classList.add('is-selected');
        if (key === q.correta) li.classList.add('is-correct');
        if (key === selectedKey && key !== q.correta) li.classList.add('is-wrong');
      }
    }

    next() {
      const i = this.state.index;
      if (i < this.state.questions.length - 1) {
        this.state.index++;
        this.render();
        this.persist();
      }
    }

    prev() {
      const i = this.state.index;
      if (i > 0) {
        this.state.index--;
        this.render();
        this.persist();
      }
    }

    skip() {
      // apenas avança sem checar
      this.next();
    }

    finish() {
      this.state.finished = true;
      const total = this.state.questions.length;
      const answered = Object.keys(this.state.answers).length;
      const correct = Object.values(this.state.answers).filter(a => a.isCorrect).length;
      const pct = total ? Math.round((correct / total) * 100) : 0;

      this.$score.textContent = `Você acertou ${correct} de ${total} (${pct}%). Respondidas: ${answered}.`;
      this.$review.innerHTML = this.renderReview();

      this.$summary.hidden = false;
      this.$root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      this.persist();
    }

    renderReview() {
      const rows = this.state.questions.map((q, idx) => {
        const ans = this.state.answers[q.id];
        const status = ans ? (ans.isCorrect ? '✅' : '❌') : '—';
        const sel = ans && ans.selectedKey ? ans.selectedKey : '—';
        return `
          <div class="card" style="margin-top:.5rem;">
            <div style="display:flex;gap:.5rem;align-items:center;justify-content:space-between;">
              <div><strong>Q${idx + 1}</strong> ${status} • ${q.disciplina || ''} ${q.tema ? '• ' + q.tema : ''}</div>
              <div class="text-muted">Marcada: ${sel} • Correta: ${q.correta}</div>
            </div>
            <p class="text-muted" style="margin-top:.25rem;">${q.enunciado}</p>
            ${q.explicacao ? `<details style="margin-top:.25rem;"><summary>Explicação</summary><p>${q.explicacao}</p></details>` : ''}
            <div class="btn-row" style="margin-top:.5rem;">
              <button class="btn btn--outline btn-go" data-index="${idx}">Ir para esta</button>
            </div>
          </div>
        `;
      }).join('');

      // Delegar navegação pelos botões "Ir para esta"
      setTimeout(() => {
        $all('.btn-go', this.$root).forEach(btn => {
          btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'), 10);
            this.$summary.hidden = true;
            this.state.index = idx;
            this.render();
            this.persist();
          });
        });
      }, 0);

      return rows;
    }

    reviewErrors() {
      // Pula para a primeira incorreta
      const firstWrongIdx = this.state.questions.findIndex(q => {
        const a = this.state.answers[q.id];
        return a && a.isChecked && !a.isCorrect;
      });
      if (firstWrongIdx >= 0) {
        this.$summary.hidden = true;
        this.state.index = firstWrongIdx;
        this.render();
        this.persist();
      }
    }

    newSession() {
      // Mantém o mesmo conjunto e embaralhamento, apenas zera respostas
      this.state.answers = {};
      this.state.index = 0;
      this.state.finished = false;
      this.$summary.hidden = true;
      this.render();
      this.persist();
    }

    restartConfirm() {
      if (confirm('Reiniciar a sessão e embaralhar novamente as questões?')) {
        this.restart();
      }
    }

    restart() {
      // Reembaralha e reinicia totalmente
      let qs = this.state.questions.slice();
      if (this.opts.shuffleQuestions) qs = shuffle(qs);
      if (this.opts.shuffleAlternatives) {
        qs = qs.map(q => ({ ...q, alternativas: shuffle(q.alternativas) }));
      }
      this.state.questions = qs;
      this.state.answers = {};
      this.state.index = 0;
      this.state.finished = false;
      this.$summary.hidden = true;
      this.render();
      this.persist(true);
    }

    clearProgress() {
      if (!this.persistKey) return;
      if (confirm('Apagar progresso salvo desta atividade?')) {
        AppStorage.remove(this.persistKey);
        alert('Progresso apagado.');
      }
    }

    persist(force = false) {
      if (!this.persistKey || !w.AppStorage) return;
      try {
        const toSave = {
          questions: this.state.questions.map(q => q.id),
          index: this.state.index,
          answers: this.state.answers,
          finished: this.state.finished,
          savedAt: Date.now()
        };
        AppStorage.set(this.persistKey, toSave);
      } catch (e) {
        if (force) console.warn('Persistência indisponível.');
      }
    }
  }

  // API pública
  const CTIQuiz = {
    // Carrega JSONs e inicia
    async loadAndStart(options) {
      const app = new QuizApp(options);
      await app.init();
      return app;
    },
    // Inicia com dados já carregados
    async startWithData(data, options) {
      const app = new QuizApp({ ...options, data });
      await app.init();
      return app;
    }
  };

  w.CTIQuiz = CTIQuiz;
})(window, document);