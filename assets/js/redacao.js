/* assets/js/redacao.js
   Editor de Redação: rascunhos + métricas avançadas (Parte 25)
*/
(function (w, d) {
  'use strict';

  function $(sel, root = d) { return root.querySelector(sel); }
  function $all(sel, root = d) { return Array.from(root.querySelectorAll(sel)); }

  // Stopwords PT (curta e suficiente para feedback)
  const STOP = new Set([
    'a','o','os','as','um','uma','uns','umas','de','da','do','das','dos','em','no','na','nos','nas',
    'por','para','com','sem','sob','sobre','entre','e','ou','mas','que','se','como','ser','está','estao','estão',
    'é','foi','era','são','cujo','cujos','cujas','também','muito','muita','muitos','muitas','já','ainda','pois',
    'num','numa','pela','pelo','pelas','pelos','ao','à','às','aos','lhe','lhes','me','te','seu','sua','seus','suas',
    'isso','isto','aquilo','este','esta','esse','essa','aquele','aquela','mesmo','mesma'
  ]);

  const CONNECTORS = {
    add: ['além disso','ademais','outrossim','também'],
    ctr: ['porém','contudo','entretanto','no entanto','embora','todavia'],
    cau: ['porque','visto que','uma vez que','pois (que)'],
    con: ['portanto','assim','logo','de modo que','consequentemente'],
    fin: ['em síntese','em suma','desse modo','conclui-se que','portanto']
  };

  function norm(str) {
    return (str||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  }

  function countBasic(text) {
    const t = (text || '').replace(/\r/g, '');
    const words = (t.trim().match(/\b[\p{L}\p{N}'’-]+\b/gu) || []).length;
    const chars = t.length;
    const paras = t.split(/\n{2,}|\r?\n/).filter(p => p.trim().length).length;
    const minutes = Math.max(1, Math.round(words / 180));
    return { words, chars, paras, minutes };
  }

  // Tokenização simples: somente palavras com letras/números (sem pontuação)
  function tokenize(text) {
    return (text.match(/\b[\p{L}\p{N}'’-]+\b/gu) || []).map(t => t.toLowerCase());
  }

  function splitSentences(text) {
    // ingênuo: divide por ., !, ? seguido de espaço/linha; mantém sentenças > 0
    return (text || '')
      .replace(/\s+/g, ' ')
      .split(/(?<=[\.!\?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  function syllablesPT(word) {
    // Heurística aproximada: grupos de vogais contam 1, ajusta ditongos comuns
    const w = norm(word).replace(/[^a-z]/g,'');
    if (!w) return 0;
    const matches = w.match(/[aeiouy]+/g) || [];
    let syl = matches.length;
    // ajuste final mudo (ex.: 'idade' -> e final conta)
    return Math.max(1, syl);
  }

  function computeReadabilityFleschPT(text) {
    const sentences = splitSentences(text);
    const wordsArr = tokenize(text).filter(w => /[a-zá-ú]/i.test(w));
    const words = wordsArr.length || 1;
    const sents = sentences.length || 1;
    let syl = 0;
    for (const w of wordsArr) syl += syllablesPT(w);
    const wps = words / sents;
    const spw = syl / words;
    // Fórmula Flesch adaptada (aprox para PT):
    // 248.835 - 1.015*(palavras/sentença) - 84.6*(sílabas/palavra)
    const score = Math.max(0, Math.min(100, Math.round(248.835 - 1.015 * wps - 84.6 * spw)));
    return { score, words, sents, syl, wps, spw };
  }

  function topRepeated(text, limit = 8) {
    const tokens = tokenize(text).map(norm)
      .filter(t => t.length >= 4 && !STOP.has(t));
    const count = {};
    tokens.forEach(t => count[t] = (count[t] || 0) + 1);
    const arr = Object.keys(count).map(k => ({ term: k, n: count[k] }))
      .filter(x => x.n >= 2)
      .sort((a, b) => b.n - a.n || a.term.localeCompare(b.term))
      .slice(0, limit);
    return arr;
  }

  function connectorsPresence(text) {
    const t = norm(text);
    const has = {};
    Object.keys(CONNECTORS).forEach(k => {
      has[k] = CONNECTORS[k].some(c => t.includes(norm(c)));
    });
    return has;
  }

  function variationTTR(text) {
    const tokens = tokenize(text).map(norm).filter(t => t.length >= 3);
    const total = tokens.length;
    const uniq = new Set(tokens).size;
    const ttr = total ? Math.round((uniq / total) * 100) : 0;
    return { total, uniq, ttr };
  }

  function computeAdvanced(text) {
    const sentences = splitSentences(text);
    const words = tokenize(text);
    const avgWPS = sentences.length ? Math.round((words.length / sentences.length) * 10) / 10 : 0;
    const long = sentences.filter(s => tokenize(s).length > 30).length;

    const rep = topRepeated(text, 8);
    const con = connectorsPresence(text);
    const ttr = variationTTR(text);
    const flesch = computeReadabilityFleschPT(text);

    return {
      sentences: sentences.length,
      avgWPS,
      long,
      ttr: ttr.ttr,
      repeated: rep,
      con,
      flesch: flesch.score
    };
  }

  function saveDraft(storeKey, draft) {
    const drafts = w.AppStorage ? (AppStorage.get(storeKey) || []) : [];
    const i = drafts.findIndex(x => x.title === draft.title);
    if (i >= 0) drafts[i] = draft; else drafts.unshift(draft);
    if (w.AppStorage) AppStorage.set(storeKey, drafts);
    return drafts;
  }
  function loadDrafts(storeKey) { return w.AppStorage ? (AppStorage.get(storeKey) || []) : []; }
  function removeDraft(storeKey, title) {
    const drafts = loadDrafts(storeKey).filter(x => x.title !== title);
    if (w.AppStorage) AppStorage.set(storeKey, drafts);
    return drafts;
  }

  function initEditor(opts) {
    const $title = $(opts.title);
    const $ta = $(opts.textarea);
    const $words = $(opts.stats.words);
    const $chars = $(opts.stats.chars);
    const $paras = $(opts.stats.paras);
    const $time = $(opts.stats.time);
    const $list = $(opts.list);
    const storeKey = opts.persistKey || 'redacao:editor';

    const msel = opts.metrics || {};
    const $mSent = $(msel.sentences), $mAvg = $(msel.avgWPS), $mLong = $(msel.longSentences);
    const $mTTR = $(msel.ttr), $mFlesch = $(msel.flesch);
    const $mGoalIn = $(msel.goalInput), $mGoalBar = $(msel.goalBar), $mGoalLabel = $(msel.goalLabel);
    const $mCon = msel.connectors || {};
    const $mRep = $(msel.repeatedList);

    function updateBasic() {
      const { words, chars, paras, minutes } = countBasic($ta.value);
      $words.textContent = `${words} palavras`;
      $chars.textContent = `${chars} caracteres`;
      $paras.textContent = `${paras} parágrafos`;
      $time.textContent = `${minutes} min leitura`;
      return words;
    }

    function updateAdvancedUI() {
      const adv = computeAdvanced($ta.value);

      if ($mSent) $mSent.textContent = adv.sentences;
      if ($mAvg) $mAvg.textContent = adv.avgWPS.toString();
      if ($mLong) $mLong.textContent = adv.long.toString();
      if ($mTTR) $mTTR.textContent = adv.ttr + '%';
      if ($mFlesch) $mFlesch.textContent = String(adv.flesch);

      if ($mCon.add) $($mCon.add).textContent = adv.con.add ? 'OK' : '—';
      if ($mCon.ctr) $($mCon.ctr).textContent = adv.con.ctr ? 'OK' : '—';
      if ($mCon.cau) $($mCon.cau).textContent = adv.con.cau ? 'OK' : '—';
      if ($mCon.con) $($mCon.con).textContent = adv.con.con ? 'OK' : '—';
      if ($mCon.fin) $($mCon.fin).textContent = adv.con.fin ? 'OK' : '—';

      if ($mRep) {
        if (!adv.repeated.length) $mRep.innerHTML = '<li class="text-muted">Sem repetições relevantes.</li>';
        else $mRep.innerHTML = adv.repeated.map(x => `<li>${x.term} — ${x.n}×</li>`).join('');
      }
    }

    function updateGoalBar() {
      const target = Math.max(100, Math.min(500, parseInt(($mGoalIn && $mGoalIn.value) || '200', 10)));
      const words = countBasic($ta.value).words;
      if ($mGoalLabel) $mGoalLabel.textContent = `${words}/${target}`;
      if ($mGoalBar) $mGoalBar.style.width = Math.min(100, Math.round((words / target) * 100)) + '%';
    }

    function renderList() {
      const drafts = loadDrafts(storeKey);
      if (!drafts.length) { $list.innerHTML = '<li class="text-muted">Nenhum rascunho salvo.</li>'; return; }
      $list.innerHTML = drafts.map(x => `
        <li>
          <div class="card" style="margin:.4rem 0; display:flex; align-items:center; justify-content:space-between; gap:.5rem;">
            <div><strong>${x.title || '(sem título)'}</strong><br/><span class="text-muted">${new Date(x.updatedAt).toLocaleString()}</span></div>
            <div class="btn-row">
              <button class="btn btn--outline btn-load" data-title="${encodeURIComponent(x.title)}">Carregar</button>
              <button class="btn btn--ghost btn-del" data-title="${encodeURIComponent(x.title)}">Excluir</button>
            </div>
          </div>
        </li>`).join('');
      $all('.btn-load', $list).forEach(b => b.addEventListener('click', () => {
        const t = decodeURIComponent(b.getAttribute('data-title'));
        const d = loadDrafts(storeKey).find(z => z.title === t);
        if (!d) return;
        $title.value = d.title;
        $ta.value = d.text;
        updateAll();
        $ta.focus();
      }));
      $all('.btn-del', $list).forEach(b => b.addEventListener('click', () => {
        const t = decodeURIComponent(b.getAttribute('data-title'));
        if (confirm(`Excluir o rascunho "${t}"?`)) { removeDraft(storeKey, t); renderList(); }
      }));
    }

    // Botões
    $(opts.buttons.insertSkeleton)?.addEventListener('click', () => {
      const skel =
`[Introdução] Em [contexto], discute-se [tema]. Defende-se que [tese].

[Desenvolvimento 1] Em primeiro lugar, [argumento 1], pois [explicação]. Ex.: [dado/fato].

[Desenvolvimento 2] Além disso, [argumento 2], visto que [explicação]. Ex.: [dado/fato].

[Conclusão] Portanto, [retomada da tese]. Para enfrentar o problema, é necessário [encaminhamento].`;
      $ta.value = ($ta.value ? $ta.value + '\n\n' : '') + skel;
      updateAll();
      $ta.focus();
    });

    $(opts.buttons.save)?.addEventListener('click', () => {
      const title = ($title.value || '').trim() || '(sem título)';
      const text = $ta.value || '';
      saveDraft(storeKey, { title, text, updatedAt: Date.now() });
      renderList();
      alert('Rascunho salvo!');
    });

    $(opts.buttons.new)?.addEventListener('click', () => {
      if ($ta.value.trim().length && !confirm('Descartar o texto atual?')) return;
      $title.value = '';
      $ta.value = '';
      updateAll();
      $title.focus();
    });

    $(opts.buttons.copy)?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($ta.value || ''); alert('Texto copiado!'); }
      catch { alert('Não foi possível copiar. Selecione e use Ctrl+C.'); }
    });

    $(opts.buttons.export)?.addEventListener('click', () => {
      const blob = new Blob([$ta.value || ''], { type: 'text/plain;charset=utf-8' });
      const a = d.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = ((($title.value || '').trim()) || 'rascunho') + '.txt';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    $(opts.buttons.clear)?.addEventListener('click', () => {
      if (confirm('Limpar texto atual?')) { $ta.value = ''; updateAll(); }
    });

    if ($mGoalIn) $mGoalIn.addEventListener('change', updateGoalBar);

    // Autosave leve
    let autosaveT = null;
    $ta.addEventListener('input', () => {
      updateAll();
      clearTimeout(autosaveT);
      autosaveT = setTimeout(() => {
        if (!$ta.value.trim()) return;
        const title = ($title.value || '').trim() || '(sem título)';
        saveDraft(storeKey, { title, text: $ta.value, updatedAt: Date.now() });
        renderList();
      }, 4000);
    });

    function updateAll() {
      updateBasic();
      updateAdvancedUI();
      updateGoalBar();
    }

    // Inicial
    updateAll();
    renderList();
  }

  function initChecklist(formSel, progressSel, key = 'redacao:checklist') {
    const $form = $(formSel);
    const $prog = $(progressSel);
    if (!$form) return;

    function getAll() { return Array.from($form.querySelectorAll('input[type="checkbox"]')); }
    function update() {
      const boxes = getAll();
      const total = boxes.length;
      const marked = boxes.filter(b => b.checked).length;
      $prog.textContent = `${marked}/${total} itens marcados`;
    }
    function save() {
      const boxes = getAll();
      const data = {};
      boxes.forEach(b => data[b.name] = !!b.checked);
      if (w.AppStorage) AppStorage.set(key, data);
    }
    function load() {
      const data = w.AppStorage ? AppStorage.get(key) : null;
      if (!data) return;
      getAll().forEach(b => { if (data[b.name] !== undefined) b.checked = !!data[b.name]; });
      update();
    }

    $form.addEventListener('change', () => { update(); save(); });
    $('#btn-chk-save')?.addEventListener('click', () => { save(); alert('Checklist salvo!'); });
    $('#btn-chk-clear')?.addEventListener('click', () => {
      if (!confirm('Limpar marcações?')) return;
      getAll().forEach(b => b.checked = false);
      save(); update();
    });

    load();
  }

  w.CTIRedacao = { initEditor, initChecklist };
})(window, document);