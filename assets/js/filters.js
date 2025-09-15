/* assets/js/filters.js
   Filtros simples para montar listas por disciplina/área/tema/nível.
   Integra com CTIQuiz.startWithData().
*/
(function (w, d) {
  'use strict';

  const BANKS = {
    portugues: '/dados/questoes/portugues.json',
    matematica: '/dados/questoes/matematica.json',
    humanas: '/dados/questoes/humanas.json',
    natureza: '/dados/questoes/natureza.json'
  };

  const STATE = {
    loaded: false,
    data: [],         // todas as questões (array)
    byDisc: {}        // agrupado por disciplina
  };

  function $(sel, root = d) { return root.querySelector(sel); }
  function $all(sel, root = d) { return Array.from(root.querySelectorAll(sel)); }

  async function fetchJSON(url) {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) throw new Error('Falha ao carregar ' + url);
    return res.json();
  }

  function groupBy(arr, key) {
    return arr.reduce((acc, x) => {
      const k = x[key] || '—';
      (acc[k] = acc[k] || []).push(x);
      return acc;
    }, {});
  }

  function unique(arr) {
    return Array.from(new Set(arr)).filter(Boolean).sort();
  }

  function slugFilters(f) {
    const parts = [
      f.disciplina || 'all',
      f.area || 'all',
      f.tema || 'all',
      f.nivel || 'all',
      f.quantidade || 'q'
    ];
    return 'sim:tema:' + parts.join(':');
  }

  function applyFilters(items, f) {
    let out = items.slice();
    if (f.disciplina) out = out.filter(q => q.disciplina === f.disciplina);
    if (f.area) out = out.filter(q => (q.area || '') === f.area);
    if (f.tema) out = out.filter(q => (q.tema || '') === f.tema);
    if (f.nivel) out = out.filter(q => (q.nivel || '') === f.nivel);
    // embaralhar
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    if (f.quantidade) out = out.slice(0, f.quantidade);
    return out;
  }

  async function loadBanks() {
    if (STATE.loaded) return STATE.data;
    const arrays = await Promise.all(Object.values(BANKS).map(fetchJSON));
    const data = arrays.flat();
    STATE.data = data;
    STATE.byDisc = groupBy(data, 'disciplina');
    STATE.loaded = true;
    return data;
  }

  function populateSelects(root) {
    const discSel = $('#f-disc', root);
    const areaSel = $('#f-area', root);
    const temaSel = $('#f-tema', root);
    const nivelSel = $('#f-nivel', root);

    // disciplinas
    const discs = unique(STATE.data.map(q => q.disciplina));
    discSel.innerHTML = `<option value="">Todas</option>` + discs.map(d => `<option value="${d}">${d[0].toUpperCase()+d.slice(1)}</option>`).join('');

    // níveis
    const niveis = unique(STATE.data.map(q => q.nivel));
    nivelSel.innerHTML = `<option value="">Todos</option>` + niveis.map(n => `<option value="${n}">${n}</option>`).join('');

    // atualizar áreas/temas quando mudar disciplina
    discSel.addEventListener('change', () => {
      const selDisc = discSel.value;
      const base = selDisc ? STATE.byDisc[selDisc] || [] : STATE.data;
      const areas = unique(base.map(q => q.area).filter(Boolean));
      areaSel.innerHTML = `<option value="">Todas</option>` + areas.map(a => `<option value="${a}">${a}</option>`).join('');
      temaSel.innerHTML = `<option value="">Todos</option>`;
    });

    // atualizar temas quando mudar área
    areaSel.addEventListener('change', () => {
      const selDisc = discSel.value;
      const selArea = areaSel.value;
      const base = STATE.data.filter(q => (!selDisc || q.disciplina === selDisc) && (!selArea || (q.area || '') === selArea));
      const temas = unique(base.map(q => q.tema).filter(Boolean));
      temaSel.innerHTML = `<option value="">Todos</option>` + temas.map(t => `<option value="${t}">${t}</option>`).join('');
    });
  }

  async function initFilters(rootSelector = '#f-root') {
    await loadBanks();
    const root = $(rootSelector);
    if (!root) return;

    populateSelects(root);

    // Form submit
    const form = $('#f-form', root);
    const outBox = $('#f-out', root);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = {
        disciplina: $('#f-disc', root).value || null,
        area: $('#f-area', root).value || null,
        tema: $('#f-tema', root).value || null,
        nivel: $('#f-nivel', root).value || null,
        quantidade: parseInt($('#f-qtd', root).value || '10', 10)
      };

      const filtered = applyFilters(STATE.data, f);
      if (!filtered.length) {
        outBox.innerHTML = `<div class="card card--soft">Nenhuma questão encontrada com esses filtros. Ajuste e tente novamente.</div>`;
        return;
      }

      outBox.innerHTML = '';
      CTIQuiz.startWithData(filtered, {
        container: '#f-out',
        limit: filtered.length,
        shuffleAlternatives: true,
        shuffleQuestions: false,
        persistKey: slugFilters(f),
        showExplainOnCheck: true
      });
    });

    // Botão limpar
    const btnClear = $('#f-clear', root);
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        form.reset();
        $('#f-out', root).innerHTML = `<div class="card card--soft">Escolha filtros e clique em “Iniciar”.</div>`;
      });
    }

    // Estado inicial
    $('#f-out', root).innerHTML = `<div class="card card--soft">Escolha filtros e clique em “Iniciar”.</div>`;
  }

  // Revisões rápidas a partir de conjuntos predefinidos
  async function initSets(rootSelector = '#sets-root', outSelector = '#sets-out') {
    await loadBanks();
    const root = $(rootSelector);
    const out = $(outSelector);
    if (!root || !out) return;

    // Carregar conjuntos
    let sets = [];
    try {
      sets = await fetchJSON('/dados/simulados/conjuntos-por-tema.json');
    } catch (e) {
      root.innerHTML = `<div class="card card--soft">Não foi possível carregar as listas de revisão.</div>`;
      return;
    }

    // Render
    root.innerHTML = `
      <div class="grid grid--3">
        ${sets.map(s => `
          <article class="card">
            <h3 class="h4">${s.titulo}</h3>
            <p class="text-muted">${s.descricao || ''}</p>
            <button class="btn btn--primary btn-play" data-id="${s.id}">Iniciar (${s.limite || 10} questões)</button>
          </article>
        `).join('')}
      </div>
    `;

    // Ação
    $all('.btn-play', root).forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const s = sets.find(x => x.id === id);
        if (!s) return;
        const f = s.filtros || {};
        const qtd = s.limite || 10;
        const filtered = applyFilters(STATE.data, { ...f, quantidade: qtd });
        if (!filtered.length) {
          out.innerHTML = `<div class="card card--soft">Não há questões suficientes para este conjunto ainda.</div>`;
          return;
        }
        out.innerHTML = '';
        CTIQuiz.startWithData(filtered, {
          container: outSelector,
          limit: filtered.length,
          shuffleAlternatives: true,
          shuffleQuestions: true,
          persistKey: slugFilters({ ...f, quantidade: qtd, set: id }),
          showExplainOnCheck: true
        });
      });
    });

    // Estado inicial
    out.innerHTML = `<div class="card card--soft">Escolha um conjunto para começar.</div>`;
  }

  // Expor API
  w.CTIFilters = { initFilters, initSets };
})(window, document);