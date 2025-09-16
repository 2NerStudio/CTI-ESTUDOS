/* assets/js/simulado.js
   Monta o simulado CTI a partir do blueprint e bancos de questões.
   Integra com CTIQuiz (motor do quiz) e CountdownTimer (cronômetro).
*/
(function (w, d) {
  'use strict';

  const PATHS = {
    blueprint: '/dados/simulados/blueprint-cti-2026.json',
    bancos: {
      portugues: '/dados/questoes/portugues.json',
      matematica: '/dados/questoes/matematica.json',
      humanas: '/dados/questoes/humanas.json',
      natureza: '/dados/questoes/natureza.json'
    }
  };

  const KEYS = {
    quiz: 'simulado:cti2026:quiz',
    result: 'simulado:cti2026:result',
    timer: 'simulado:cti2026:timer',
    meta: 'simulado:cti2026:meta'
  };

  // util
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  async function getJSON(url) {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) throw new Error(`Falha ao carregar ${url}`);
    return res.json();
  }

  function filterBy(list, criteria = {}) {
    return list.filter(q => {
      for (const [k, v] of Object.entries(criteria)) {
        if (v == null) continue;
        if (q[k] !== v) return false;
      }
      return true;
    });
  }

  function pickSome(list, n, usedIds) {
    const pool = list.filter(q => !usedIds.has(q.id));
    const arr = shuffle(pool).slice(0, n);
    arr.forEach(q => usedIds.add(q.id));
    return arr;
  }

  function selectByRules(all, block, usedIds) {
    // all: todas questões da disciplina
    let picked = [];

    // Regras por tema ou área (min)
    if (Array.isArray(block.regras)) {
      for (const r of block.regras) {
        let subset = all;
        if (r.tema) subset = subset.filter(q => q.tema === r.tema);
        if (r.area) subset = subset.filter(q => q.area === r.area);
        const need = Math.max(0, r.min || 0);
        const got = pickSome(subset, need, usedIds);
        picked = picked.concat(got);
      }
    }

    // Completar até a quantidade desejada com a própria disciplina
    const desired = block.quantidade || 0;
    if (picked.length < desired) {
      const rest = pickSome(all, desired - picked.length, usedIds);
      picked = picked.concat(rest);
    }

    return picked;
  }

  function groupBy(arr, key) {
    return arr.reduce((acc, x) => {
      const k = x[key] || '—';
      (acc[k] = acc[k] || []).push(x);
      return acc;
    }, {});
  }

  // Monta a lista final de questões do simulado
  async function montarQuestoes() {
    const blueprint = await getJSON(PATHS.blueprint);
    const bancos = {
      portugues: await getJSON(PATHS.bancos.portugues),
      matematica: await getJSON(PATHS.bancos.matematica),
      humanas: await getJSON(PATHS.bancos.humanas),
      natureza: await getJSON(PATHS.bancos.natureza)
    };

    const used = new Set();
    let final = [];
    const avisos = [];

    for (const bloco of blueprint.blocos) {
      const disc = bloco.disciplina;
      const pool = (bancos[disc] || []).slice();
      const picked = selectByRules(pool, bloco, used);
      final = final.concat(picked);

      // Avisar se faltou questão para atingir a quantidade
      if (picked.length < (bloco.quantidade || 0)) {
        avisos.push(`Disciplina ${disc}: banco atual fornece ${picked.length} de ${bloco.quantidade} itens.`);
      }
    }

    // Persistir meta (para a UI mostrar avisos)
    if (w.AppStorage) {
      const meta = {
        expected: blueprint.blocos.map(b => ({ disciplina: b.disciplina, qtd: b.quantidade })),
        selectedCount: groupBy(final, 'disciplina'),
        avisos
      };
      AppStorage.set(KEYS.meta, meta);
    }

    return final;
  }
  
  if (w.CTICollections && typeof w.CTICollections.mount === 'function') {
  w.CTICollections.mount(app);
}

  // Salva resultado para a página de resultado
    function salvarResultado(app, remainingSeconds) {
    try {
        const qs = app.state.questions;
        const ans = app.state.answers;
        const total = qs.length;
        const correct = qs.filter(q => ans[q.id] && ans[q.id].isCorrect).length;
        const pct = total ? Math.round((correct / total) * 100) : 0;

        const porDisc = {};
        for (const q of qs) {
        const d = q.disciplina || '—';
        porDisc[d] = porDisc[d] || { total: 0, correct: 0 };
        porDisc[d].total += 1;
        if (ans[q.id] && ans[q.id].isCorrect) porDisc[d].correct += 1;
        }

        const erradas = qs
        .map((q, i) => ({ q, i }))
        .filter(({ q }) => !(ans[q.id] && ans[q.id].isCorrect))
        .map(({ q, i }) => ({
            index: i + 1,
            id: q.id,
            disciplina: q.disciplina,
            area: q.area || null,
            tema: q.tema || null,
            enunciado: q.enunciado,
            correta: q.correta,
            marcada: ans[q.id] ? ans[q.id].selectedKey : null,
            explicacao: q.explicacao || ''
        }));

        const duration = 16200; // 4h30
        const usado = duration - (typeof remainingSeconds === 'number' ? remainingSeconds : 0);

        // Itens detalhados (por questão) para analytics
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

        const payload = {
        id: 'sess-' + Date.now(),
        mode: 'cti-completo',
        timestamp: Date.now(),
        total,
        correct,
        pct,
        porDisciplina: porDisc,
        erradas,
        durationSeconds: usado,
        items,
        questions: qs.map(q => q.id)
        };

        if (w.AppStorage) {
        AppStorage.set(KEYS.result, payload);
        const histKey = 'simulado:cti2026:history';
        const hist = AppStorage.get(histKey) || [];
        hist.unshift(payload); // mais recente primeiro
        AppStorage.set(histKey, hist);
        }
    } catch (e) {
        console.warn('Erro ao salvar resultado/histórico:', e);
    }
    }

  // Exibe avisos de montagem (quando faltam itens no banco)
  function renderAvisos() {
    if (!w.AppStorage) return;
    const meta = AppStorage.get(KEYS.meta);
    const $box = d.querySelector('#sim-aviso');
    if (!$box) return;

    let html = '';
    if (meta && Array.isArray(meta.avisos) && meta.avisos.length) {
      html += `<div class="card card--soft" role="status" aria-live="polite">
        <strong>Aviso:</strong> banco inicial ainda pequeno. ${meta.avisos.join(' ')}
      </div>`;
    } else {
      html += `<div class="card card--soft text-muted">O modelo atual conta com aproximadamente 500 questões distintas.</div>`;
    }
    $box.innerHTML = html;
  }

  async function startSimulado() {
    try {
      renderAvisos();

      const questoes = await montarQuestoes();
      if (!Array.isArray(questoes) || !questoes.length) {
        d.querySelector('#quiz-root').innerHTML = `<div class="card card--soft">Não há questões suficientes no banco para montar o simulado.</div>`;
        return;
      }

      const app = await w.CTIQuiz.startWithData(questoes, {
        container: '#quiz-root',
        limit: questoes.length,
        shuffleQuestions: true,
        shuffleAlternatives: true,
        persistKey: KEYS.quiz,
        showExplainOnCheck: true
      });

            // Após criar o app
        if (w.CTIPro && typeof w.CTIPro.mount === 'function') {
        w.CTIPro.mount(app, {
            sidebar: '#pro-sidebar',
            palette: '#pro-palette',
            summary: '#pro-summary',
            markBtn: '#pro-btn-mark',
            jumpBtn: '#pro-btn-jump'
        });
        }

      // Timer
      const timer = new w.CountdownTimer({ duration: 16200, persistKey: KEYS.timer });
      timer.bindUI({ display: '#timer', start: '#btn-start', pause: '#btn-pause', reset: '#btn-reset' });
      timer.onFinish = () => {
        // Finaliza e salva resultado automaticamente
        const origFinish = app.finish.bind(app);
        origFinish();
        salvarResultado(app, timer.getRemaining());
        w.location.href = '/simulados/resultado.html';
      };

      // Patch do finish do quiz para salvar e ir ao resultado
      const origFinish = app.finish.bind(app);
      app.finish = function () {
        origFinish();
        salvarResultado(app, timer.getRemaining());
        w.location.href = '/simulados/resultado.html';
      };

      // Botão "Finalizar" geral
      const $btnFinishAll = d.querySelector('#btn-finish-all');
      if ($btnFinishAll) {
        $btnFinishAll.addEventListener('click', () => {
          app.finish();
        });
      }

      // Exibir avisos
      renderAvisos();

    } catch (e) {
      console.error(e);
      d.querySelector('#quiz-root').innerHTML = `<div class="card card--soft">Erro ao montar o simulado. Tente recarregar a página.</div>`;
    }
  }

  w.CTISim = { start: startSimulado, KEYS };
})(window, document);