/* assets/js/adaptive.js
   Prática Adaptativa (SRS estilo Leitner):
   - Deck local com itens (questões) e agendamento por "caixas"
   - Sessão diária: pega itens "vencidos" + adiciona novos (limitado por meta)
   - Integra com CTIQuiz: atualiza box/due na hora que o aluno confere a questão
   - Export/Import de deck/histórico
*/
(function (w, d) {
  'use strict';

  const BANKS = {
    portugues: '/dados/questoes/portugues.json',
    matematica: '/dados/questoes/matematica.json',
    humanas: '/dados/questoes/humanas.json',
    natureza: '/dados/questoes/natureza.json'
  };

  const KEYS = {
    deck: 'adaptive:deck',              // { items: {id:Item}, settings: {...} }
    session: 'adaptive:session',        // persistKey do CTIQuiz
    history: 'adaptive:history'         // [{id, timestamp, answered, correct, pct, time}]
  };

  // Intervalos de revisão por "box" (dias). Box 1..6
  const INTERVALS = { 1: 0, 2: 1, 3: 2, 4: 4, 5: 7, 6: 15 };

  function $(sel, root = d) { return root.querySelector(sel); }
  function $all(sel, root = d) { return Array.from(root.querySelectorAll(sel)); }
  function nowSec() { return Math.floor(Date.now() / 1000); }
  function addDays(tsSec, days) { return tsSec + days * 86400; }
  function uniq(arr, key = 'id') {
    const seen = new Set(), out = [];
    for (const x of arr) { if (!x || !x[key] || seen.has(x[key])) continue; seen.add(x[key]); out.push(x); }
    return out;
  }
  function groupBy(arr, key) {
    return arr.reduce((acc, x) => { const k = (x[key] || '—'); (acc[k] = acc[k] || []).push(x); return acc; }, {});
  }
  function fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = n => String(n).padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(ss)}`;
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) throw new Error('Falha ao carregar ' + url);
    return res.json();
  }

  async function loadBanks() {
    const arrays = await Promise.all(Object.values(BANKS).map(fetchJSON));
    return arrays.flat();
  }

  // Deck structure:
  // deck = {
  //   items: { [id]: { id, box, due, seen, streak, ease, addedTs, disciplina, area, tema } },
  //   settings: { dailyGoal, newPerDay, filtersDefault: {...} }
  // }
  function loadDeck() {
    return (w.AppStorage && AppStorage.get(KEYS.deck)) || {
      items: {},
      settings: { dailyGoal: 20, newPerDay: 10 }
    };
  }
  function saveDeck(deck) {
    if (w.AppStorage) AppStorage.set(KEYS.deck, deck);
  }
  function loadHistory() {
    return (w.AppStorage && AppStorage.get(KEYS.history)) || [];
  }
  function saveHistory(hist) {
    if (w.AppStorage) AppStorage.set(KEYS.history, hist);
  }

  function addItemsToDeck(deck, items, limit) {
    let added = 0, now = nowSec();
    for (const q of items) {
      if (limit && added >= limit) break;
      if (!q || !q.id) continue;
      if (deck.items[q.id]) continue;
      deck.items[q.id] = {
        id: q.id, box: 1, due: now, seen: 0, streak: 0, ease: 2.5, addedTs: now,
        disciplina: q.disciplina || '', area: q.area || '', tema: q.tema || ''
      };
      added++;
    }
    saveDeck(deck);
    return added;
  }

  function getDeckStats(deck) {
    const items = Object.values(deck.items);
    const byBox = items.reduce((acc, it) => { acc[it.box] = (acc[it.box] || 0) + 1; return acc; }, {});
    const dueNow = items.filter(it => it.due <= nowSec()).length;
    const total = items.length;
    return { total, dueNow, byBox };
  }

  function filterItems(items, f = {}) {
    return items.filter(q => {
      if (f.disciplina && q.disciplina !== f.disciplina) return false;
      if (f.area && (q.area || '') !== f.area) return false;
      if (f.tema && (q.tema || '') !== f.tema) return false;
      if (f.nivel && (q.nivel || '') !== f.nivel) return false;
      return true;
    });
  }

  function pickDueItems(deck, bankMap, limit) {
    // Pega itens do deck com due <= now
    const items = Object.values(deck.items)
      .filter(it => it.due <= nowSec())
      .sort((a, b) => (a.due - b.due) || (a.box - b.box) || (a.addedTs - b.addedTs))
      .slice(0, limit);
    return items.map(it => bankMap[it.id]).filter(Boolean);
  }

  function pickNewCandidates(deck, bank, filters, limit) {
    const pool = filterItems(bank, filters)
      .filter(q => !deck.items[q.id]);
    // Embaralhar simples
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, limit);
  }

  function scheduleOnAnswer(deck, qId, isCorrect, timeSpentMs) {
    const it = deck.items[qId];
    if (!it) return;
    it.seen++;
    it.lastTime = typeof timeSpentMs === 'number' ? Math.floor(timeSpentMs / 1000) : null;
    const today = nowSec();
    if (isCorrect) {
      it.box = Math.min(6, (it.box || 1) + 1);
      it.streak = (it.streak || 0) + 1;
      const days = INTERVALS[it.box] || 7;
      it.due = addDays(today, days);
    } else {
      it.box = Math.max(1, (it.box || 1) - 1);
      it.streak = 0;
      it.due = addDays(today, 1);
    }
  }

  // Integração com CTIQuiz: interceptar check/finish
  function mountOnApp(app, deck, sessionMeta) {
    // patch check
    if (typeof app.check === 'function') {
      const origCheck = app.check.bind(app);
      app.check = function () {
        const q = app.state.questions[app.state.index];
        origCheck();
        if (!q) return;
        const a = app.state.answers[q.id];
        if (!a || !('isChecked' in a)) return;
        // Atualiza agendamento
        scheduleOnAnswer(deck, q.id, !!a.isCorrect, a.time);
        saveDeck(deck);
        // Atualiza UI do painel adaptativo (se existir)
        const stat = getDeckStats(deck);
        const $s = d.getElementById('adp-stats');
        if ($s) $s.innerHTML = renderStatsHTML(stat);
      };
    }
    // patch finish para registrar histórico
    if (typeof app.finish === 'function') {
      const origFinish = app.finish.bind(app);
      app.finish = function () {
        origFinish();
        try {
          const qs = app.state.questions || [];
          const ans = app.state.answers || {};
          const answered = Object.keys(ans).filter(k => ans[k] && ans[k].isChecked).length;
          const correct = Object.keys(ans).filter(k => ans[k] && ans[k].isChecked && ans[k].isCorrect).length;
          const pct = answered ? Math.round((correct / answered) * 100) : 0;
          const hist = loadHistory();
          hist.unshift({
            id: 'adp-' + Date.now(),
            timestamp: Date.now(),
            mode: 'adaptativo',
            answered, correct, pct,
            durationSeconds: sessionMeta ? sessionMeta.duration || null : null
          });
          saveHistory(hist);
        } catch (e) { console.warn('Adaptive history error:', e); }
      };
    }
  }

  // Render
  function renderStatsHTML(stat) {
    const boxes = [1,2,3,4,5,6].map(b => `<span class="chip">B${b}: ${stat.byBox[b] || 0}</span>`).join(' ');
    return `
      <p><strong>Total:</strong> ${stat.total} itens • <strong>Vencidos hoje:</strong> ${stat.dueNow}</p>
      <div class="chips">${boxes}</div>
    `;
  }

  // UI principal
  async function initAdaptive(rootSelector = '#adp-root') {
    const root = $(rootSelector);
    if (!root) return;

    // Carregar bancos e deck
    const bank = await loadBanks();
    const deck = loadDeck();

    // Mapa por id para acesso rápido
    const bankMap = {};
    bank.forEach(q => bankMap[q.id] = q);

    // Popular selects (Disciplina/Área/Tema/Nível)
    const $disc = $('#adp-disc');
    const $area = $('#adp-area');
    const $tema = $('#adp-tema');
    const $nivel = $('#adp-nivel');
    const $addBtn = $('#adp-add');
    const $addQtd = $('#adp-add-qtd');
    const $goal = $('#adp-goal');
    const $newPer = $('#adp-newper');
    const $start = $('#adp-start');
    const $resume = $('#adp-resume');
    const $stats = $('#adp-stats');
    const $deckList = $('#adp-deck-list');

    const discs = Array.from(new Set(bank.map(q => q.disciplina).filter(Boolean))).sort();
    $disc.innerHTML = `<option value="">Todas</option>` + discs.map(d => `<option value="${d}">${d[0].toUpperCase()+d.slice(1)}</option>`).join('');
    $nivel.innerHTML = `<option value="">Todos</option>` + Array.from(new Set(bank.map(q => q.nivel).filter(Boolean))).sort().map(n => `<option value="${n}">${n}</option>`).join('');

    $disc.addEventListener('change', () => {
      const sel = $disc.value;
      const base = sel ? bank.filter(q => q.disciplina === sel) : bank;
      const areas = Array.from(new Set(base.map(q => q.area).filter(Boolean))).sort();
      $area.innerHTML = `<option value="">Todas</option>` + areas.map(a => `<option value="${a}">${a}</option>`).join('');
      $tema.innerHTML = `<option value="">Todos</option>`;
    });
    $area.addEventListener('change', () => {
      const selD = $disc.value, selA = $area.value;
      const base = bank.filter(q => (!selD || q.disciplina === selD) && (!selA || (q.area || '') === selA));
      const temas = Array.from(new Set(base.map(q => q.tema).filter(Boolean))).sort();
      $tema.innerHTML = `<option value="">Todos</option>` + temas.map(t => `<option value="${t}">${t}</option>`).join('');
    });

    // Config padrão
    $goal.value = deck.settings.dailyGoal || 20;
    $newPer.value = deck.settings.newPerDay || 10;

    $goal.addEventListener('change', () => {
      deck.settings.dailyGoal = Math.max(5, Math.min(100, parseInt($goal.value || '20', 10)));
      saveDeck(deck);
    });
    $newPer.addEventListener('change', () => {
      deck.settings.newPerDay = Math.max(0, Math.min(50, parseInt($newPer.value || '10', 10)));
      saveDeck(deck);
    });

    // Stats
    $stats.innerHTML = renderStatsHTML(getDeckStats(deck));

    // Listar deck (amostra)
    function renderDeckList() {
      const items = Object.values(deck.items);
      if (!items.length) {
        $deckList.innerHTML = `<div class="card card--soft">Seu deck está vazio. Adicione itens pelos filtros abaixo.</div>`;
        return;
      }
      // Top 10 por due asc
      const dueList = items.slice().sort((a,b)=>a.due-b.due).slice(0,10).map(it => {
        const q = bankMap[it.id] || {};
        return `<li><strong>Q:</strong> ${q.enunciado ? q.enunciado.slice(0,60)+'...' : it.id} • B${it.box} • due: ${new Date(it.due*1000).toLocaleDateString()} • ${q.disciplina||''} ${q.tema?'• '+q.tema:''}</li>`;
      }).join('');
      $deckList.innerHTML = `<ul class="list">${dueList}</ul>`;
    }
    renderDeckList();

    // Adicionar itens ao deck
    $addBtn.addEventListener('click', () => {
      const f = {
        disciplina: $disc.value || null,
        area: $area.value || null,
        tema: $tema.value || null,
        nivel: $nivel.value || null
      };
      const qtd = Math.max(1, Math.min(200, parseInt($addQtd.value || '20', 10)));
      const candidates = pickNewCandidates(deck, bank, f, qtd * 2); // pega mais e dedup
      const added = addItemsToDeck(deck, candidates, qtd);
      alert(`${added} item(ns) adicionados ao deck.`);
      $stats.innerHTML = renderStatsHTML(getDeckStats(deck));
      renderDeckList();
    });

    // Construir sessão (due + novos)
    async function startSession() {
      // Verificar se já existe sessão adaptativa em andamento
      const persisted = w.AppStorage ? AppStorage.get(KEYS.session) : null;
      if (persisted && persisted.questions && persisted.questions.length) {
        if (!confirm('Há uma sessão adaptativa em andamento. Deseja retomá-la?')) {
          // se escolher não retomar, apagamos e criamos nova
          AppStorage.remove(KEYS.session);
        } else {
          // apenas redireciona para retomar UI na própria página; CTIQuiz persist irá montar
        }
      }

      const goal = deck.settings.dailyGoal || 20;
      const newPer = deck.settings.newPerDay || 10;

      const dueQs = pickDueItems(deck, bankMap, goal);
      let selected = dueQs.slice();

      if (selected.length < goal && newPer > 0) {
        // completar com novos candidatos do filtro atual (ou sem filtro)
        const f = {
          disciplina: $disc.value || null,
          area: $area.value || null,
          tema: $tema.value || null,
          nivel: $nivel.value || null
        };
        const toAdd = Math.min(newPer, goal - selected.length);
        const candidates = pickNewCandidates(deck, bank, f, toAdd);
        // adicionar no deck
        addItemsToDeck(deck, candidates, toAdd);
        // também entram na sessão (imediatamente)
        selected = selected.concat(candidates);
      }

      if (!selected.length) {
        alert('Nada vencido hoje e sem novos itens para adicionar. Ajuste filtros ou meta.');
        return;
      }

      // Iniciar motor
      const app = await w.CTIQuiz.startWithData(selected, {
        container: '#adp-out',
        limit: selected.length,
        shuffleQuestions: false,
        shuffleAlternatives: true,
        persistKey: KEYS.session,
        showExplainOnCheck: true
      });

      // Montar integração (atualiza agendamento em cada conferência)
      mountOnApp(app, deck, { duration: null });

      // Atualizar UI
      $stats.innerHTML = renderStatsHTML(getDeckStats(deck));
    }

    // Retomar sessão (se houver persistência)
    function canResume() {
      const persisted = w.AppStorage ? AppStorage.get(KEYS.session) : null;
      return persisted && persisted.questions && persisted.questions.length;
    }

    if (canResume()) {
      $('#adp-resume-box').hidden = false;
      $resume.addEventListener('click', async () => {
        const persisted = AppStorage.get(KEYS.session);
        // Reconstruir dados e iniciar com CTIQuiz.startWithData usando ids (recarregar do deck)
        const ids = persisted.questions || [];
        const data = ids.map(id => bankMap[id]).filter(Boolean);
        const app = await w.CTIQuiz.startWithData(data, {
          container: '#adp-out',
          limit: data.length,
          shuffleQuestions: false,
          shuffleAlternatives: true,
          persistKey: KEYS.session,
          showExplainOnCheck: true
        });
        mountOnApp(app, deck, { duration: null });
      });
    }

    $start.addEventListener('click', startSession);

    // Export/Import/Reset
    $('#adp-export')?.addEventListener('click', () => {
      const payload = { deck, history: loadHistory() };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = d.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'deck-adaptativo.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    $('#adp-import')?.addEventListener('change', (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const payload = JSON.parse(reader.result);
          if (!payload.deck || !payload.deck.items) throw new Error('Arquivo inválido.');
          saveDeck(payload.deck);
          if (payload.history) saveHistory(payload.history);
          alert('Deck importado com sucesso!');
          location.reload();
        } catch (e) {
          alert('Falha ao importar: ' + e.message);
        }
      };
      reader.readAsText(file);
    });

    $('#adp-reset')?.addEventListener('click', () => {
      if (!confirm('Zerar TODO o deck adaptativo e histórico?')) return;
      if (w.AppStorage) {
        AppStorage.remove(KEYS.deck);
        AppStorage.remove(KEYS.session);
        AppStorage.remove(KEYS.history);
      }
      location.reload();
    });
  }

  w.CTIAdaptive = { init: initAdaptive };
})(window, document);