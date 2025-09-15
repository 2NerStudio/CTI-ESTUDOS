/* assets/js/timer.js
   Timer regressivo com pausa/retomada e persistência.
   Uso:
     const t = new CountdownTimer({ duration: 16200, persistKey: 'sim:cti2026:timer' });
     t.bindUI({ display: '#timer', start: '#btn-start', pause: '#btn-pause', reset: '#btn-reset' });
     t.onFinish = () => { ... };
*/
(function (w, d) {
  'use strict';

  function fmt(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(ss)}`;
  }

  class CountdownTimer {
    constructor(opts = {}) {
      this.duration = opts.duration || 16200; // 4h30
      this.persistKey = opts.persistKey || null;
      this.onTick = opts.onTick || null;
      this.onFinish = opts.onFinish || null;
      this._interval = null;

      // Estado
      this.state = {
        remaining: this.duration,
        running: false,
        lastStartTs: null
      };

      // Retomar estado salvo
      if (this.persistKey && w.AppStorage) {
        const saved = AppStorage.get(this.persistKey);
        if (saved && typeof saved.remaining === 'number') {
          this.state.remaining = saved.remaining;
          this.state.running = !!saved.running;
          this.state.lastStartTs = saved.lastStartTs || null;
          // Ajustar se estava rodando
          if (this.state.running && this.state.lastStartTs) {
            const elapsed = Math.floor((Date.now() - this.state.lastStartTs) / 1000);
            this.state.remaining = Math.max(0, this.state.remaining - elapsed);
          }
        }
      }
      this.persist();
    }

    bindUI(sel = {}) {
      this.$display = typeof sel.display === 'string' ? d.querySelector(sel.display) : sel.display;
      this.$start = typeof sel.start === 'string' ? d.querySelector(sel.start) : sel.start;
      this.$pause = typeof sel.pause === 'string' ? d.querySelector(sel.pause) : sel.pause;
      this.$reset = typeof sel.reset === 'string' ? d.querySelector(sel.reset) : sel.reset;

      if (this.$start) this.$start.addEventListener('click', () => this.start());
      if (this.$pause) this.$pause.addEventListener('click', () => this.pause());
      if (this.$reset) this.$reset.addEventListener('click', () => this.resetConfirm());

      this.updateUI();
    }

    updateUI() {
      if (this.$display) this.$display.textContent = fmt(this.state.remaining);
      if (this.$start) this.$start.disabled = this.state.running || this.state.remaining <= 0;
      if (this.$pause) this.$pause.disabled = !this.state.running;
      if (this.$reset) this.$reset.disabled = this.state.running;
      if (typeof this.onTick === 'function') this.onTick(this.state.remaining);
    }

    start() {
      if (this.state.running || this.state.remaining <= 0) return;
      this.state.running = true;
      this.state.lastStartTs = Date.now();
      this._interval = setInterval(() => this.tick(), 1000);
      this.persist();
      this.updateUI();
    }

    tick() {
      this.state.remaining = Math.max(0, this.state.remaining - 1);
      if (this.$display) this.$display.textContent = fmt(this.state.remaining);
      if (this.state.remaining <= 0) {
        this.stopInterval();
        this.state.running = false;
        this.persist();
        if (typeof this.onFinish === 'function') this.onFinish();
      }
      if (typeof this.onTick === 'function') this.onTick(this.state.remaining);
    }

    pause() {
      if (!this.state.running) return;
      this.stopInterval();
      this.state.running = false;
      // Recalcular remaining pela diferença
      if (this.state.lastStartTs) {
        const elapsed = Math.floor((Date.now() - this.state.lastStartTs) / 1000);
        this.state.remaining = Math.max(0, this.state.remaining - elapsed);
        this.state.lastStartTs = null;
      }
      this.persist();
      this.updateUI();
    }

    reset() {
      this.stopInterval();
      this.state.running = false;
      this.state.remaining = this.duration;
      this.state.lastStartTs = null;
      this.persist();
      this.updateUI();
    }

    resetConfirm() {
      if (confirm('Reiniciar o cronômetro para 4h30?')) this.reset();
    }

    stopInterval() {
      if (this._interval) {
        clearInterval(this._interval);
        this._interval = null;
      }
    }

    persist() {
      if (!this.persistKey || !w.AppStorage) return;
      AppStorage.set(this.persistKey, {
        remaining: this.state.remaining,
        running: this.state.running,
        lastStartTs: this.state.lastStartTs
      });
    }

    getRemaining() { return this.state.remaining; }
  }

  w.CountdownTimer = CountdownTimer;
})(window, document);