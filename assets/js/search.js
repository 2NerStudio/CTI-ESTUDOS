/* assets/js/search.js
   Busca estática: carrega /dados/pesquisa/index.json, filtra por substring (case/acentos-insensível),
   aplica filtros e exibe resultados com destaque.
*/
(function (w, d) {
  'use strict';

  const INDEX_URL = '/dados/pesquisa/index.json';

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

  // Destaque aproximado: substitui tokens (sem acentos) no texto original (com acentos) via regex simples
  function highlight(text, tokens) {
    if (!text || !tokens || !tokens.length) return escHtml(text);
    let out = text;
    for (const tk of tokens) {
      const rx = new RegExp('(' + tk.replace(/[.*+?^${}()|[```\```/g, '\\$&') + ')', 'gi');
      // Substitui em uma versão normalizada e aplica ao original com fallback simples
      const normalized = norm(out);
      let idx = 0, result = '', m;
      while ((m = rx.exec(normalized)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        result += escHtml(out.slice(idx, start)) + '<mark>' + escHtml(out.slice(start, end)) + '</mark>';
        idx = end;
      }
      result += escHtml(out.slice(idx));
      out = result;
    }
    return out;
  }

  function scoreEntry(entry, tokens) {
    if (!tokens.length) return 0;
    const title = norm(entry.titulo);
    const desc  = norm(entry.descricao || '');
    const tags  = (entry.tags || []).map(norm);
    let s = 0;
    for (const tk of tokens) {
      if (title.includes(tk)) s += 5;
      if (desc.includes(tk)) s += 2;
      if (tags.some(t => t.includes(tk))) s += 3;
      if ((entry.disciplina || '').toLowerCase().includes(tk)) s += 1;
    }
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

    // Popular select de disciplina
    const discs = Array.from(new Set(index.map(x => x.disciplina).filter(Boolean))).sort();
    $disc.innerHTML = `<option value="">Todas</option>` + discs.map(d => `<option value="${d}">${d}</option>`).join('');

    // Aplicar parâmetros da URL
    const params = parseQuery();
    $q.value = params.q;
    if (params.cat && params.cat.length) {
      $cat.forEach(ch => { ch.checked = params.cat.includes(ch.value); });
    }
    if (params.disc) $disc.value = params.disc;

    function run() {
      const query = $q.value.trim();
      const tokens = tokenize(query);
      const categorias = $cat.filter(ch => ch.checked).map(ch => ch.value);
      const disc = $disc.value || '';

      updateURL(query, categorias, disc);

      const t0 = performance.now();
      let results = index
        .filter(e => {
          if (!tokens.length) return true; // sem query -> lista tudo (paginado abaixo)
          const full = norm(e.titulo + ' ' + (e.descricao || '') + ' ' + (e.tags || []).join(' ') + ' ' + (e.disciplina || '') + ' ' + (e.categoria || ''));
          return tokens.every(tk => full.includes(tk));
        })
        .filter(e => matchesFilters(e, { categorias, disciplina: disc }))
        .map(e => ({ e, s: scoreEntry(e, tokens) }))
        .sort((a, b) => b.s - a.s || a.e.titulo.localeCompare(b.e.titulo))
        .map(x => x.e);

      const t1 = performance.now();
      $time.textContent = `Encontrados em ${(t1 - t0).toFixed(0)} ms`;
      $count.textContent = `${results.length} resultado(s)`;

      if (!results.length) {
        $res.innerHTML = `<div class="card card--soft">Nenhum resultado. Tente palavras mais curtas ou remova filtros.</div>`;
        return;
      }

      // Limitar render a 100 itens para performance
      const maxRender = 100;
      if (results.length > maxRender) results = results.slice(0, maxRender);

      const tokensRaw = tokenize(query); // usando os mesmos
      $res.innerHTML = results.map(r => `
        <article class="card">
          <h3 class="h4"><a href="${r.url}">${highlight(r.titulo, tokensRaw)}</a></h3>
          <p class="text-muted">${highlight(r.descricao || '', tokensRaw)}</p>
          <div class="text-muted">${r.categoria}${r.disciplina ? ' • ' + r.disciplina : ''}${r.tags && r.tags.length ? ' • ' + r.tags.slice(0,3).join(', ') : ''}</div>
        </article>
      `).join('');
    }

    // Eventos
    $q.addEventListener('input', () => run());
    $cat.forEach(ch => ch.addEventListener('change', () => run()));
    $disc.addEventListener('change', () => run());

    // Rodar inicial
    run();
  }

  w.CTISearch = { init: initSearch };
})(window, document);