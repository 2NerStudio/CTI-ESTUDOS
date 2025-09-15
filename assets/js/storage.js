/* assets/js/storage.js
   Wrapper seguro para localStorage com namespace.
   Exemplo: AppStorage.set('quiz:demo', { ... })
*/
(function (w) {
  'use strict';

  const NS = 'cti2026:';
  let fallback = {}; // caso localStorage não esteja disponível

  function storageAvailable(type) {
    try {
      const storage = window[type];
      const test = '__storage_test__';
      storage.setItem(test, test);
      storage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  }

  const hasLocal = storageAvailable('localStorage');

  function key(k) {
    return NS + String(k);
  }

  function set(k, value) {
    try {
      const serialized = JSON.stringify(value);
      if (hasLocal) {
        localStorage.setItem(key(k), serialized);
      } else {
        fallback[key(k)] = serialized;
      }
      return true;
    } catch (err) {
      console.warn('AppStorage.set error:', err);
      return false;
    }
  }

  function get(k, defaultValue = null) {
    try {
      const raw = hasLocal ? localStorage.getItem(key(k)) : fallback[key(k)];
      if (!raw) return defaultValue;
      return JSON.parse(raw);
    } catch (err) {
      console.warn('AppStorage.get error:', err);
      return defaultValue;
    }
  }

  function remove(k) {
    try {
      if (hasLocal) {
        localStorage.removeItem(key(k));
      } else {
        delete fallback[key(k)];
      }
      return true;
    } catch (err) {
      console.warn('AppStorage.remove error:', err);
      return false;
    }
  }

  function clearNamespace() {
    try {
      if (hasLocal) {
        const keys = Object.keys(localStorage);
        for (const k of keys) {
          if (k.startsWith(NS)) localStorage.removeItem(k);
        }
      } else {
        fallback = {};
      }
      return true;
    } catch (err) {
      console.warn('AppStorage.clearNamespace error:', err);
      return false;
    }
  }

  w.AppStorage = { set, get, remove, clearNamespace };
})(window);