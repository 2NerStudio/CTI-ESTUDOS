/* assets/js/search.js — Busca 2.0
   - Fuzzy match (levenshtein) para tokens >= 4 letras
   - Sugestões em tempo real (títulos/tags)
   - Histórico de pesquisas (local) e ranking por cliques
   - Atalhos: "/" foca, Enter abre 1º, Ctrl/Cmd+Enter abre 1º em nova aba
*/
(function (w, d) {
  'use strict';

  const INDEX_URL = '/dados/pesquisa/index.json';
  const K_HISTORY = 'search:history';
  const K_RANKS   = 'search:ranks';

  // Helpers
  function $(sel, root = d) { return root.querySelector(sel); }
  function $all(sel, root = d) { return Array.from(root.querySelectorAll(sel)); }

  function norm(str) {
    return (str || '')
      .toString()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }
  function tokenize(q) {
    return norm(q).split(/\s+/).filter(t => t && t.length >= 2);
  }
  function escHtml(s) {
    return (s || '').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function highlight(text, tokens) {
    if (!text || !tokens || !tokens.length) return escHtml(text);
    let out = escHtml(text);
    for (const tk of tokens) {
      const rx = new RegExp('(' + tk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');

      out = out.replace(rx, '<mark>$1</mark>');
    }
    return out;
  }

  // Levenshtein básico
  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (m === 0) return n; if (n === 0) return m;
    const dp = Array(n + 1).fill(0).map((_, i) => i);
    for (let i = 1; i <= m; i++) {
      let prev = dp[0]; dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
        prev = tmp;
      }
    }
    return dp[n];
  }

  // Storage helpers
  function getHistory() { return (w.AppStorage && AppStorage.get(K_HISTORY)) || []; }
  function setHistory(arr) { if (w.AppStorage) AppStorage.set(K_HISTORY, arr || []); }
  function pushHistory(q) {
    const hist = getHistory().filter(x => x.toLowerCase() !== q.toLowerCase());
    hist.unshift(q); if (hist.length > 10) hist.pop();
    setHistory(hist);
  }
  function getRanks() { return (w.AppStorage && AppStorage.get(K_RANKS)) || {}; }
  function bumpRank(url) {
    if (!w.AppStorage) return;
    const ranks = getRanks();
    ranks[url] = (ranks[url] || 0) + 1;
    AppStorage.set(K_RANKS, ranks);
  }
  function getRankBoost(url) {
    const r = getRanks()[url] || 0;
    return 3 * Math.log(1 + r); // peso suave
  }

  // Score
  function scoreEntry(entry, tokens) {
    if (!tokens.length) return getRankBoost(entry.url);
    const title = norm(entry.titulo);
    const desc  = norm(entry.descricao || '');
    const tags  = (entry.tags || []).map(norm);
    const cat   = norm(entry.categoria || '');
    const disc  = norm(entry.disciplina || '');
    const hay   = [title, desc, tags.join(' '), cat, disc].join(' ');

    let s = 0;
    for (const tk of tokens) {
      if (title.includes(tk)) s += 10;
      else if (hay.includes(tk)) s += 6;
      else if (tk.length >= 4) {
        // fuzzy check (contra título e tags)
        const pool = title.split(/\s+/).concat(tags);
        let min = Infinity;
        for (const w of pool) {
          if (!w) continue;
          const dist = levenshtein(w, tk);
          if (dist < min) min = dist;
          if (min === 0) break;
        }
        if (min <= 1) s += 5;
        else if (min === 2) s += 3;
      }
      // leve incentivo por match de disciplina/categoria
      if (disc && disc.includes(tk)) s += 2;
      if (cat && cat.includes(tk)) s += 1;
    }
    s += getRankBoost(entry.url);
    return s;
  }

  function matchesFilters(entry, filters) {
    if (filters.categorias && filters.categorias.length) {
      if (!filters.categorias.includes(entry.categoria)) return false;
    }
    if (filters.disciplina) {
      if ((entry.disciplina || '').toLowerCase() !== filters.disciplina.toLowerCase()) return false;
    }
    return true;
  }

  function parseQuery() {
    const p = new URLSearchParams(location.search);
    return {
      q: p.get('q') || '',
      cat: (p.get('cat') || '').split(',').filter(Boolean),
      disc: p.get('disc') || ''
    };
  }
  function updateURL(q, categorias, disc) {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (categorias && categorias.length) p.set('cat', categorias.join(','));
    if (disc) p.set('disc', disc);
    const url = location.pathname + '?' + p.toString();
    history.replaceState(null, '', url);
  }

  async function initSearch() {
    const $q = $('#search-input');
    const $cat = $all('input[name="cat"]');
    const $disc = $('#f-disciplina');
    const $res = $('#results');
    const $count = $('#results-count');
    const $time = $('#results-time');
    const $sug = $('#search-suggest');
    const $hist = $('#history-list');

    let index = [];
    try {
      const t0 = performance.now();
      const res = await fetch(INDEX_URL, { credentials: 'same-origin', cache: 'no-store' });
      index = await res.json();
      const t1 = performance.now();
      $time.textContent = `Índice carregado em ${(t1 - t0).toFixed(0)} ms`;
    } catch (e) {
      $res.innerHTML = `<div class="card card--soft">Não foi possível carregar o índice de busca.</div>`;
      return;
    }

    // Campos auxiliares
    const discs = Array.from(new Set(index.map(x => x.disciplina).filter(Boolean))).sort();
    $disc.innerHTML = `<option value="">Todas</option>` + discs.map(d => `<option value="${d}">${d}</option>`).join('');

    const params = parseQuery();
    $q.value = params.q;
    if (params.cat && params.cat.length) $cat.forEach(ch => ch.checked = params.cat.includes(ch.value));
    if (params.disc) $disc.value = params.disc;

    // Histórico inicial
    renderHistory();

    function renderHistory() {
      const hist = getHistory();
      if (!hist.length) { $hist.innerHTML = `<span class="chip text-muted">Sem histórico</span>`; return; }
      $hist.innerHTML = hist.map(h => `<button class="chip btn-chip" data-q="${escHtml(h)}">${escHtml(h)}</button>`).join(' ');
      $all('.btn-chip', $hist).forEach(b => b.addEventListener('click', () => { $q.value = b.getAttribute('data-q'); run(); $q.focus(); }));
    }

    function renderSuggestions(query) {
      const qn = norm(query);
      if (!qn || qn.length < 2) { $sug.innerHTML = ''; $sug.hidden = true; return; }
      // Sugerir a partir de títulos/tags que contenham o substring
      const pool = index
        .map(e => ({ label: e.titulo, source: 'título', url: e.url, tags: (e.tags||[]).join(' ') }))
        .concat(index.flatMap(e => (e.tags||[]).map(tg => ({ label: tg, source: 'tag', url: e.url, tags: '' }))));
      const seen = new Set();
      const list = [];
      for (const p of pool) {
        const ln = norm(p.label);
        if (ln.includes(qn) && !seen.has(ln)) {
          seen.add(ln);
          list.push(p);
          if (list.length >= 6) break;
        }
      }
      if (!list.length) { $sug.innerHTML = ''; $sug.hidden = true; return; }
      $sug.hidden = false;
      $sug.innerHTML = `
        <div class="card card--soft">
          <ul class="list">
            ${list.map(it => `<li><button class="btn btn--ghost sug-item" data-label="${escHtml(it.label)}">${escHtml(it.label)}</button> <span class="text-muted">(${it.source})</span></li>`).join('')}
          </ul>
        </div>`;
      $all('.sug-item', $sug).forEach(b => b.addEventListener('click', () => { $q.value = b.getAttribute('data-label'); run(); $q.focus(); }));
    }

    function attachResultClicks() {
      $all('.res-link', $res).forEach(a => {
        a.addEventListener('click', () => {
          const url = a.getAttribute('href');
          bumpRank(url);
        });
      });
    }

    function run(openFirstIfEnter = false, newTab = false) {
      const query = $q.value.trim();
      const tokens = tokenize(query);
      const categorias = $cat.filter(ch => ch.checked).map(ch => ch.value);
      const disc = $disc.value || '';

      updateURL(query, categorias, disc);
      renderSuggestions(query);

      const t0 = performance.now();

      // Filtrar e ranquear
      let results = index
        .filter(e => matchesFilters(e, { categorias, disciplina: disc }))
        .map(e => ({ e, s: scoreEntry(e, tokens) }));

      // Remover irrelevantes quando há tokens
      if (tokens.length) results = results.filter(r => r.s > 0);

      results.sort((a, b) => b.s - a.s || a.e.titulo.localeCompare(b.e.titulo));
      const t1 = performance.now();

      $time.textContent = `Encontrados em ${(t1 - t0).toFixed(0)} ms`;
      $count.textContent = `${results.length} resultado(s)`;

      if (!results.length) {
        $res.innerHTML = `<div class="card card--soft">Nenhum resultado. Tente remover filtros ou usar termos mais curtos.</div>`;
        return;
      }

      const tokensRaw = tokenize(query);
      const maxRender = 150;
      const toRender = results.slice(0, maxRender).map(r => r.e);

      // Abrir 1º com Enter se solicitado
      if (openFirstIfEnter) {
        pushHistory(query);
        if (newTab) window.open(toRender[0].url, '_blank');
        else window.location.href = toRender[0].url;
        return;
      }

      $res.innerHTML = toRender.map(r => `
        <article class="card">
          <h3 class="h4"><a href="${r.url}" class="res-link">${highlight(r.titulo, tokensRaw)}</a></h3>
          <p class="text-muted">${highlight(r.descricao || '', tokensRaw)}</p>
          <div class="text-muted">${r.categoria}${r.disciplina ? ' • ' + r.disciplina : ''}${r.tags && r.tags.length ? ' • ' + r.tags.slice(0,3).join(', ') : ''}</div>
        </article>
      `).join('');

      attachResultClicks();
    }

    // Eventos
    $q.addEventListener('input', () => {
      renderSuggestions($q.value);
      // não executa busca a cada tecla para evitar jitter — usuário dá Enter
    });
    $cat.forEach(ch => ch.addEventListener('change', () => run()));
    $disc.addEventListener('change', () => run());

    // Enter abre 1º resultado; Ctrl/Cmd+Enter abre em nova aba
    d.addEventListener('keydown', (ev) => {
      if (d.activeElement === $q) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          const newTab = ev.ctrlKey || ev.metaKey;
          pushHistory($q.value.trim());
          run(true, newTab);
        } else if (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
          // evita inserir a barra quando já está no input
          ev.preventDefault();
        }
      } else {
        // "/" foca o input
        if (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
          ev.preventDefault();
          $q.focus();
        }
      }
    });

    // Rodar inicialmente
    run();
    renderHistory();
  }

  w.CTISearch = { init: initSearch };
})(window, document);