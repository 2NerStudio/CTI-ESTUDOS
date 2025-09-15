/* assets/js/collections.js
   Favoritos, notas e coleções personalizadas.
   - Plugin CTICollections.mount(app) adiciona toolbar (⭐ e 📝) em cada questão do quiz
   - Página /simulados/colecoes.html gerencia favoritos e coleções (criar/editar/treinar/export/import)
*/
(function (w, d) {
  'use strict';

  const KEYS = {
    favs: 'collections:favs',       // { [id]: { id, note?:string, starred:true, disciplina, area, tema } }
    lists: 'collections:lists'      // [ { id, title, items:[id], createdAt } ]
  };

  function $(sel, root = d) { return root.querySelector(sel); }
  function $all(sel, root = d) { return Array.from(root.querySelectorAll(sel)); }
  function uid() { return 'col-' + Math.random().toString(36).slice(2, 10); }

  function loadFavs() { return (w.AppStorage && AppStorage.get(KEYS.favs)) || {}; }
  function saveFavs(obj) { if (w.AppStorage) AppStorage.set(KEYS.favs, obj || {}); }
  function loadLists() { return (w.AppStorage && AppStorage.get(KEYS.lists)) || []; }
  function saveLists(arr) { if (w.AppStorage) AppStorage.set(KEYS.lists, arr || []); }

  function toggleStar(favs, q) {
    if (!q || !q.id) return favs;
    const cur = favs[q.id];
    if (cur && cur.starred) {
      delete favs[q.id];
    } else {
      favs[q.id] = { id: q.id, starred: true, note: (cur && cur.note) || '', disciplina: q.disciplina || '', area: q.area || '', tema: q.tema || '' };
    }
    saveFavs(favs);
    return favs;
  }
  function setNote(favs, qId, text) {
    favs[qId] = favs[qId] || { id: qId, starred: true };
    favs[qId].note = text || '';
    saveFavs(favs);
  }

  // Plugin de UI para o quiz
  function mount(app) {
    const favs = loadFavs();

    function renderToolbar() {
      // Inserir toolbar após feedback
      const q = app.state.questions[app.state.index];
      if (!q) return;
      const container = $('.question', app.$root || d) || $('#quiz-body', app.$root || d);
      if (!container) return;

      // remove toolbar antiga
      const old = $('#col-toolbar', container);
      if (old) old.remove();

      const starred = !!(favs[q.id] && favs[q.id].starred);
      const note = (favs[q.id] && favs[q.id].note) || '';

      const el = d.createElement('div');
      el.id = 'col-toolbar';
      el.className = 'card card--soft';
      el.style.marginTop = '.75rem';
      el.innerHTML = `
        <div style="display:flex; align-items:center; gap:.5rem; flex-wrap:wrap;">
          <button id="col-btn-star" class="btn ${starred ? 'btn--primary' : 'btn--outline'}" type="button">${starred ? '⭐ Favorita' : '☆ Favoritar'}</button>
          <button id="col-btn-note" class="btn btn--outline" type="button">📝 Nota</button>
          <div id="col-note-wrap" style="display:none; width:100%;">
            <label for="col-note" class="text-muted">Sua nota (salva automaticamente)</label>
            <textarea id="col-note" style="width:100%; min-height:90px; padding:.5rem; border:1px solid var(--border); border-radius:6px;">${note}</textarea>
          </div>
        </div>
      `;
      container.appendChild(el);

      // Ações
      $('#col-btn-star', el)?.addEventListener('click', () => {
        toggleStar(loadFavs(), q);
        renderToolbar();
      });
      $('#col-btn-note', el)?.addEventListener('click', () => {
        const wrap = $('#col-note-wrap', el);
        wrap.style.display = (wrap.style.display === 'none' || !wrap.style.display) ? 'block' : 'none';
        if (wrap.style.display === 'block') $('#col-note', el)?.focus();
      });
      $('#col-note', el)?.addEventListener('input', (ev) => {
        setNote(loadFavs(), q.id, ev.target.value);
      });
    }

    // patch methods to refresh toolbar
    ['render','check','next','prev','finish','restart'].forEach(m => {
      if (typeof app[m] === 'function') {
        const orig = app[m].bind(app);
        app[m] = function (...args) {
          const r = orig(...args);
          setTimeout(renderToolbar, 0);
          return r;
        };
      }
    });
    // first render
    setTimeout(renderToolbar, 0);
  }

  // Página de coleções
  async function initPage(selector = '#col-root') {
    const root = $(selector);
    if (!root) return;

    // Carregar bancos para materializar ids -> enunciados
    async function fetchJSON(url) {
      const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) throw new Error('Falha ao carregar ' + url);
      return res.json();
    }
    const BANKS = [
      '/dados/questoes/portugues.json',
      '/dados/questoes/matematica.json',
      '/dados/questoes/humanas.json',
      '/dados/questoes/natureza.json'
    ];
    const banks = (await Promise.all(BANKS.map(fetchJSON))).flat();
    const byId = {}; banks.forEach(q => byId[q.id] = q);

    const $favList = $('#col-favs');
    const $newTitle = $('#col-new-title');
    const $newFrom = $('#col-new-from'); // 'favs' | 'empty'
    const $btnCreate = $('#col-create');
    const $listBox = $('#col-lists');
    const $out = $('#col-out');

    function renderFavs() {
      const favs = loadFavs();
      const ids = Object.keys(favs);
      if (!ids.length) {
        $favList.innerHTML = '<li class="text-muted">Nenhuma favorita ainda. Use o botão ⭐ no simulado para favoritar.</li>';
        return;
      }
      $favList.innerHTML = ids.map(id => {
        const q = byId[id]; const meta = favs[id];
        const label = q ? (q.enunciado || id).slice(0, 90) : id;
        return `<li>
          <div class="card" style="margin:.35rem 0; display:flex; gap:.5rem; justify-content:space-between; align-items:center;">
            <div><strong>${id}</strong> — ${label}</div>
            <div class="btn-row">
              <button class="btn btn--outline btn-fav-note" data-id="${id}">📝 Nota</button>
              <button class="btn btn--ghost btn-fav-del" data-id="${id}">Remover</button>
            </div>
          </div>
        </li>`;
      }).join('');

      $all('.btn-fav-del', $favList).forEach(b => b.addEventListener('click', () => {
        const id = b.getAttribute('data-id'); const favs = loadFavs();
        delete favs[id]; saveFavs(favs); renderFavs();
      }));
      $all('.btn-fav-note', $favList).forEach(b => b.addEventListener('click', () => {
        const id = b.getAttribute('data-id'); const favs = loadFavs();
        const cur = (favs[id] && favs[id].note) || '';
        const text = prompt('Editar nota da questão '+id+':', cur);
        if (text !== null) { setNote(favs, id, text); renderFavs(); }
      }));
    }

    function renderLists() {
      const lists = loadLists();
      if (!lists.length) {
        $listBox.innerHTML = '<div class="card card--soft">Nenhuma coleção criada. Crie uma coleção abaixo.</div>';
        return;
      }
      $listBox.innerHTML = `
        <table>
          <thead><tr><th>Título</th><th>Itens</th><th>Criada em</th><th>Ações</th></tr></thead>
          <tbody>
            ${lists.map(l => `
              <tr>
                <td>${l.title}</td>
                <td>${l.items.length}</td>
                <td>${new Date(l.createdAt).toLocaleString()}</td>
                <td>
                  <button class="btn btn--outline btn-open" data-id="${l.id}">Abrir</button>
                  <button class="btn btn--ghost btn-edit" data-id="${l.id}">Editar</button>
                  <button class="btn btn--ghost btn-del" data-id="${l.id}">Excluir</button>
                  <button class="btn btn--primary btn-practice" data-id="${l.id}">Praticar</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      `;

      // Ações de coleção
      const open = id => {
        const l = loadLists().find(x => x.id === id); if (!l) return;
        $out.innerHTML = `
          <div class="card">
            <h3 class="h4">Coleção: ${l.title}</h3>
            <ul class="list">${l.items.map(it => {
              const q = byId[it]; const label = q ? (q.enunciado || it).slice(0, 110) : it;
              return `<li><strong>${it}</strong> — ${label}</li>`;
            }).join('')}</ul>
          </div>`;
        window.scrollTo({ top: $out.offsetTop - 60, behavior: 'smooth' });
      };

      $all('.btn-open', $listBox).forEach(b => b.addEventListener('click', () => open(b.getAttribute('data-id'))));

      $all('.btn-edit', $listBox).forEach(b => b.addEventListener('click', () => {
        const id = b.getAttribute('data-id');
        const lists = loadLists(); const idx = lists.findIndex(x => x.id === id);
        if (idx < 0) return;
        const curTitle = lists[idx].title;
        const title = prompt('Renomear coleção:', curTitle);
        if (title && title.trim()) { lists[idx].title = title.trim(); saveLists(lists); renderLists(); }
      }));

      $all('.btn-del', $listBox).forEach(b => b.addEventListener('click', () => {
        const id = b.getAttribute('data-id');
        if (!confirm('Excluir esta coleção?')) return;
        const lists = loadLists().filter(x => x.id !== id); saveLists(lists); renderLists();
      }));

      $all('.btn-practice', $listBox).forEach(b => b.addEventListener('click', async () => {
        const id = b.getAttribute('data-id');
        const list = loadLists().find(x => x.id === id); if (!list || !list.items.length) { alert('Coleção vazia.'); return; }
        const data = list.items.map(qid => byId[qid]).filter(Boolean);
        $out.innerHTML = '';
        const app = await w.CTIQuiz.startWithData(data, {
          container: '#col-out',
          limit: data.length,
          shuffleQuestions: true,
          shuffleAlternatives: true,
          persistKey: 'collections:session:'+id,
          showExplainOnCheck: true
        });
        // habilitar plugin de favoritos/notas também nessa prática
        if (w.CTICollections && typeof w.CTICollections.mount === 'function') w.CTICollections.mount(app);
      }));
    }

    // Criar coleção
    $('#col-create')?.addEventListener('click', () => {
      const title = ($newTitle.value || '').trim(); if (!title) { alert('Dê um nome à coleção.'); return; }
      const base = loadLists();
      let items = [];
      if ($newFrom.value === 'favs') {
        const favs = loadFavs(); items = Object.keys(favs);
      }
      base.unshift({ id: uid(), title, items, createdAt: Date.now() });
      saveLists(base);
      $newTitle.value = '';
      renderLists();
      alert('Coleção criada!');
    });

    // Exportar/Importar
    $('#col-export')?.addEventListener('click', () => {
      const payload = { favs: loadFavs(), lists: loadLists() };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = d.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'colecoes-favoritos.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $('#col-import')?.addEventListener('change', (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const payload = JSON.parse(reader.result);
          if (payload.favs) saveFavs(payload.favs);
          if (Array.isArray(payload.lists)) saveLists(payload.lists);
          renderFavs(); renderLists();
          alert('Dados importados!');
        } catch (e) { alert('Falha ao importar: ' + e.message); }
      };
      reader.readAsText(file);
    });

    renderFavs();
    renderLists();

    // se existir sessão em andamento de alguma coleção, nada a fazer aqui (persistKey cuida)
  }

  w.CTICollections = { mount, initPage };
})(window, document);