/* assets/js/redacao.js
   Funções para Redação: editor (contador/salvamento) e checklist.
*/
(function (w, d) {
  'use strict';

  function $(sel, root = d) { return root.querySelector(sel); }
  function $all(sel, root = d) { return Array.from(root.querySelectorAll(sel)); }

  function count(text) {
    const t = (text || '').replace(/\r/g, '');
    const words = (t.trim().match(/\b[\p{L}\p{N}'’-]+\b/gu) || []).length;
    const chars = t.length;
    const paras = t.split(/\n{2,}|\r?\n/).filter(p => p.trim().length).length;
    const minutes = Math.max(1, Math.round(words / 180));
    return { words, chars, paras, minutes };
  }

  function saveDraft(storeKey, draft) {
    const drafts = w.AppStorage ? (AppStorage.get(storeKey) || []) : [];
    // Atualiza se título já existe
    const i = drafts.findIndex(x => x.title === draft.title);
    if (i >= 0) drafts[i] = draft; else drafts.unshift(draft);
    if (w.AppStorage) AppStorage.set(storeKey, drafts);
    return drafts;
  }

  function loadDrafts(storeKey) {
    return w.AppStorage ? (AppStorage.get(storeKey) || []) : [];
  }

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

    function updateStats() {
      const { words, chars, paras, minutes } = count($ta.value);
      $words.textContent = `${words} palavras`;
      $chars.textContent = `${chars} caracteres`;
      $paras.textContent = `${paras} parágrafos`;
      $time.textContent = `${minutes} min leitura`;
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
        updateStats();
        $ta.focus();
      }));
      $all('.btn-del', $list).forEach(b => b.addEventListener('click', () => {
        const t = decodeURIComponent(b.getAttribute('data-title'));
        if (confirm(`Excluir o rascunho "${t}"?`)) {
          removeDraft(storeKey, t);
          renderList();
        }
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
      updateStats();
      $ta.focus();
    });

    $(opts.buttons.save)?.addEventListener('click', () => {
      const title = ($title.value || '').trim() || '(sem título)';
      const text = $ta.value || '';
      const drafts = saveDraft(storeKey, { title, text, updatedAt: Date.now() });
      renderList();
      alert('Rascunho salvo!');
    });

    $(opts.buttons.new)?.addEventListener('click', () => {
      if ($ta.value.trim().length && !confirm('Descartar o texto atual?')) return;
      $title.value = '';
      $ta.value = '';
      updateStats();
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
      if (confirm('Limpar texto atual?')) { $ta.value = ''; updateStats(); }
    });

    // Autosave raso (a cada 5s)
    let autosaveT = null;
    $ta.addEventListener('input', () => {
      updateStats();
      clearTimeout(autosaveT);
      autosaveT = setTimeout(() => {
        if (!$ta.value.trim()) return;
        const title = ($title.value || '').trim() || '(sem título)';
        saveDraft(storeKey, { title, text: $ta.value, updatedAt: Date.now() });
        renderList();
      }, 5000);
    });

    // Inicial
    updateStats();
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