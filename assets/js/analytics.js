/* assets/js/analytics.js
   Painel de Desempenho: consolida histórico de sessões, gráficos e recomendações.
   Requer AppStorage. Tudo local (sem libs).
*/
(function (w, d) {
  'use strict';
  const HIST_KEY = 'simulado:cti2026:history';
  const ADP_HIST_KEY = 'adaptive:history';

  function $(sel, root = d) { return root.querySelector(sel); }
  function $all(sel, root = d) { return Array.from(root.querySelectorAll(sel)); }

  function fmtDate(ts) {
    const dt = new Date(ts || Date.now());
    return dt.toLocaleString();
  }
  function fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = n => String(n).padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(ss)}`;
  }

  // Normaliza sessões do adaptativo para o mesmo "shape" dos simulados
  function normalizeAdaptiveSession(s) {
    if (!s) return s;
    const total = (s.total != null) ? s.total : (s.answered != null ? s.answered : 0);
    const durationSeconds = (s.durationSeconds != null)
      ? s.durationSeconds
      : (s.time != null ? (typeof s.time === 'number' ? Math.floor(s.time / 1000) : s.time) : 0);
    return {
      ...s,
      mode: s.mode || 'adaptativo',
      total,
      durationSeconds,
      items: s.items || [] // adaptativo normalmente não traz itens
    };
  }

  // Carrega e mescla histórico de simulados + adaptativo
  function loadHistory() {
    const sim = (w.AppStorage && AppStorage.get(HIST_KEY)) || [];
    const adpRaw = (w.AppStorage && AppStorage.get(ADP_HIST_KEY)) || [];
    const adp = adpRaw.map(normalizeAdaptiveSession);

    const all = sim.concat(adp);
    const seen = new Set();
    const merged = [];
    for (const x of all) {
      if (!x || !x.id) continue;
      if (seen.has(x.id)) continue;
      seen.add(x.id);
      merged.push(x);
    }
    merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return merged;
  }
  function saveHistory(hist) {
    if (w.AppStorage) AppStorage.set(HIST_KEY, hist || []);
  }

  // Agregações
  function aggregateHistory(hist) {
    const sessions = hist.slice().reverse(); // hist desc -> asc para evolução
    const byDisc = {}; // {disc:{total:0,correct:0}}
    const perTema = {}; // {tema:{total:0,correct:0}}
    let totalSessions = sessions.length;
    let totalAnswered = 0, totalCorrect = 0;
    let totalTime = 0;

    sessions.forEach(s => {
      totalTime += s.durationSeconds || 0;
      const items = s.items || [];
      if (items.length) {
        items.forEach(it => {
          totalAnswered++;
          totalCorrect += it.correct ? 1 : 0;
          const d = it.disciplina || '—';
          byDisc[d] = byDisc[d] || { total: 0, correct: 0 };
          byDisc[d].total += 1;
          if (it.correct) byDisc[d].correct += 1;

          const tema = it.tema || '(sem tema)';
          perTema[tema] = perTema[tema] || { total: 0, correct: 0 };
          perTema[tema].total += 1;
          if (it.correct) perTema[tema].correct += 1;
        });
      } else if (typeof s.answered === 'number') {
        // Sessões (ex.: adaptativo) sem itens detalhados
        totalAnswered += s.answered;
        totalCorrect += (s.correct || 0);
      }
    });

    // ordena temas por menor acerto
    const temasSorted = Object.keys(perTema).map(k => {
      const x = perTema[k], pct = x.total ? (x.correct / x.total) : 0;
      return { tema: k, ...x, pct };
    }).sort((a, b) => a.pct - b.pct);

    const evo = sessions.map((s, i) => {
      const tot = (s.total != null) ? s.total : (s.answered != null ? s.answered : ((s.items || []).length));
      const pct = (typeof s.pct === 'number')
        ? s.pct
        : (tot ? Math.round(((s.correct || 0) / tot) * 100) : 0);
      return { index: i + 1, pct, ts: s.timestamp };
    });

    return {
      totalSessions,
      totalAnswered,
      totalCorrect,
      totalTime,
      avgPct: totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : 0,
      byDisc,
      perTema: temasSorted,
      evolution: evo
    };
  }

  // Renderizadores de gráfico (Canvas)
  function drawBarChart(canvas, data, options = {}) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const labels = data.map(d => d.label);
    const values = data.map(d => d.value);

    if (!values.length) {
      // nada a desenhar
      return;
    }

    const max = Math.max(100, Math.ceil(Math.max(...values) / 10) * 10);

    const padL = 40, padB = 24, padT = 10, padR = 10;
    const cw = w - padL - padR, ch = h - padT - padB;
    const bw = (cw / values.length) * 0.7;
    const gap = (cw / values.length) * 0.3;

    // Eixos
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(padL, h - padB);
    ctx.lineTo(w - padR, h - padB);
    ctx.moveTo(padL, h - padB);
    ctx.lineTo(padL, padT);
    ctx.stroke();

    // Barras
    values.forEach((v, i) => {
      const x = padL + i * (bw + gap) + gap / 2;
      const y = padT + ch * (1 - v / max);
      const bh = ch * (v / max);
      ctx.fillStyle = options.color || '#0b5cd9';
      ctx.fillRect(x, y, bw, bh);

      // valor
      ctx.fillStyle = '#334155';
      ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto';
      ctx.textAlign = 'center';
      ctx.fillText(v + (options.suffix || ''), x + bw / 2, y - 4);
      // label
      ctx.save();
      ctx.translate(x + bw / 2, h - padB + 12);
      ctx.rotate(0);
      ctx.fillText(labels[i], 0, 10);
      ctx.restore();
    });
  }

  function drawLineChart(canvas, data, options = {}) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const max = 100;
    const padL = 40, padB = 24, padT = 10, padR = 10;
    const cw = w - padL - padR, ch = h - padT - padB;

    // Eixo
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(padL, h - padB);
    ctx.lineTo(w - padR, h - padB);
    ctx.moveTo(padL, h - padB);
    ctx.lineTo(padL, padT);
    ctx.stroke();

    if (!data.length) return;

    // Traçado
    ctx.strokeStyle = options.color || '#0b5cd9';
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((p, i) => {
      const x = padL + (cw / Math.max(1, data.length - 1)) * i;
      const y = padT + ch * (1 - p.pct / max);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      // ponto
      ctx.fillStyle = '#0b5cd9';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      // label
      ctx.fillStyle = '#334155';
      ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto';
      ctx.textAlign = 'center';
      ctx.fillText(p.pct + '%', x, y - 8);
    });
    ctx.stroke();
  }

  function renderList(container, rows) {
    container.innerHTML = rows.map(r => `
      <div class="card" style="margin:.4rem 0;">
        <div style="display:flex;justify-content:space-between;gap:.5rem;">
          <div><strong>${r.title}</strong></div>
          ${r.right || ''}
        </div>
        ${r.body || ''}
      </div>
    `).join('');
  }

  // Import/Export
  function exportJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = d.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || ('historico-' + Date.now() + '.json');
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function init() {
    const hist = loadHistory();
    const agg = aggregateHistory(hist);

    // Contadores
    $('#k-sessions').textContent = agg.totalSessions;
    $('#k-answered').textContent = agg.totalAnswered;
    $('#k-avg').textContent = agg.avgPct + '%';
    $('#k-time').textContent = fmtTime(agg.totalTime);

    // Evolução
    drawLineChart($('#ch-evol'), agg.evolution, { color: '#0b5cd9' });

    // Por disciplina (média %)
    const discData = Object.keys(agg.byDisc).sort().map(disc => {
      const x = agg.byDisc[disc];
      const v = x.total ? Math.round((x.correct / x.total) * 100) : 0;
      return { label: disc[0].toUpperCase() + disc.slice(1), value: v };
    });
    drawBarChart($('#ch-disc'), discData, { color: '#16a34a', suffix: '%' });

    // Temas a reforçar (5 piores com ao menos 5 tentativas)
    const worst = agg.perTema.filter(t => t.total >= 5).slice(0, 5);
    const $weak = $('#weak-list');
    if (worst.length) {
      $weak.innerHTML = worst.map(t => `
        <li>${t.tema}: <strong>${Math.round(t.pct * 100)}%</strong> (${t.correct}/${t.total})</li>
      `).join('');
    } else {
      $weak.innerHTML = `<li class="text-muted">Ainda não há temas com tentativas suficientes.</li>`;
    }

    // Tabela de sessões
    const $table = $('#sess-table');
    if (hist.length) {
      $table.innerHTML = `
        <table>
          <thead><tr><th>Data</th><th>Modo</th><th>Acerto</th><th>Tempo</th><th>Itens</th><th>Ações</th></tr></thead>
          <tbody>
            ${hist.map(s => {
              const tot = (s.total != null) ? s.total : (s.answered != null ? s.answered : ((s.items || []).length));
              const itCount = (s.items && s.items.length) ? s.items.length : tot;
              const pct = (typeof s.pct === 'number') ? s.pct : (tot ? Math.round(((s.correct || 0) / tot) * 100) : 0);
              return `
              <tr>
                <td>${fmtDate(s.timestamp)}</td>
                <td>${s.mode || '—'}</td>
                <td>${(s.correct || 0)}/${tot} (${pct}%)</td>
                <td>${fmtTime(s.durationSeconds)}</td>
                <td>${itCount}</td>
                <td><button class="btn btn--outline btn-details" data-id="${s.id}">Detalhes</button></td>
              </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
      $all('.btn-details', $table).forEach(b => {
        b.addEventListener('click', () => {
          const id = b.getAttribute('data-id');
          const s = hist.find(x => x.id === id);
          if (!s) return;
          const byTema = {};
          (s.items || []).forEach(it => {
            const k = it.tema || '(sem tema)';
            byTema[k] = byTema[k] || { total: 0, correct: 0 };
            byTema[k].total++;
            if (it.correct) byTema[k].correct++;
          });
          const detail = Object.keys(byTema).sort().map(k => {
            const x = byTema[k];
            const pct = x.total ? Math.round((x.correct / x.total) * 100) : 0;
            return `<li>${k}: ${x.correct}/${x.total} (${pct}%)</li>`;
          }).join('');
          const modal = $('#sess-detail');
          $('#sess-detail-body').innerHTML = `
            <p><strong>Data:</strong> ${fmtDate(s.timestamp)} • <strong>Acerto:</strong> ${typeof s.pct === 'number' ? s.pct : (s.total ? Math.round(((s.correct || 0)/s.total)*100) : 0)}% • <strong>Tempo:</strong> ${fmtTime(s.durationSeconds)}</p>
            <h4>Por tema</h4><ul class="list">${detail || '<li class="text-muted">Sem dados</li>'}</ul>
          `;
          modal.showModal();
        });
      });
    } else {
      $table.innerHTML = `<div class="card card--soft">Nenhuma sessão registrada ainda. Faça um <a href="/simulados/cti-completo.html">simulado</a> para ver seu desempenho.</div>`;
    }

    // Exportar/Importar/Limpar
    $('#btn-export')?.addEventListener('click', () => exportJSON(hist, 'historico-cti.json'));
    $('#btn-import')?.addEventListener('change', (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(reader.result);
          if (!Array.isArray(imported)) throw new Error('Formato inválido (esperado array)');
          // merge: mantém recentes no topo e evita duplicar ids
          const cur = loadHistory();
          const ids = new Set(cur.map(x => x.id));
          const merged = imported.filter(x => x && x.id && !ids.has(x.id)).concat(cur);
          saveHistory(merged);
          location.reload();
        } catch (e) {
          alert('Falha ao importar: ' + e.message);
        }
      };
      reader.readAsText(file);
    });
    $('#btn-clear')?.addEventListener('click', () => {
      if (confirm('Apagar TODO o histórico de sessões?')) {
        saveHistory([]);
        location.reload();
      }
    });
  }

  w.CTIAnalytics = { init };
})(window, document);