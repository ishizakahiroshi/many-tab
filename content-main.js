// content-main.js — MAIN ワールド Cookie & localStorage hook（spec §4.4）

(() => {
  // MAIN は chrome.* に触れないので window.postMessage で ISO に橋渡しする。
  function mainLog(...parts) {
    try {
      window.postMessage({ __mt_log: { tag: 'MT-MAIN', parts } }, '*');
    } catch (_) {}
    try { console.log('[MT-MAIN]', ...parts); } catch (_) {}
  }

  mainLog('injected at', document.readyState);

  const nativeDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');

  let session = typeof window.__mt_boot === 'string' ? window.__mt_boot : null;
  delete window.__mt_boot;

  // ---- localStorage overlay（per-session 永続）---------------------------
  //
  // 同一プロファイル内では localStorage / IndexedDB / Cookie jar が共有されるため、
  // 何もしないと「最後にログインしたアカウントの状態」が全タブに見える。
  // それを防ぐため、割り当て済みタブの localStorage を完全に仮想化する:
  //
  //   - 読み: overlay にあれば返す、なければ null（ネイティブにフォールバックしない＝完全分離）
  //   - 書き: overlay 更新 + window.postMessage で ISO 経由 BG に通知 → session.lsSnapshot 永続化
  //
  // overlay は __mt_boot_ls（document_start に BG が executeScript で植えた値）または
  // 後続の __mt_init で渡される lsSnapshot で初期化する。

  const lsOverride = new Map();
  let lsHooked = false;
  let lsActive = false; // overlay 読み書きを有効化するフラグ（未割り当て時は素通し）

  const bootLs = (typeof window.__mt_boot_ls === 'object' && window.__mt_boot_ls) || null;
  delete window.__mt_boot_ls;
  if (bootLs) {
    for (const k of Object.keys(bootLs)) lsOverride.set(k, String(bootLs[k]));
    lsActive = true;
  }

  // 書き込みを BG に送る（debounce で間引き）
  let pendingOps = [];
  let flushTimer = null;
  function queueLsOp(op) {
    pendingOps.push(op);
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      const ops = pendingOps;
      pendingOps = [];
      flushTimer = null;
      try { window.postMessage({ __mt_lsOps: ops }, '*'); } catch (_) {}
    }, 120);
  }

  function hookLocalStorage() {
    if (lsHooked) return;
    lsHooked = true;
    try {
      const _getItem    = Storage.prototype.getItem;
      const _setItem    = Storage.prototype.setItem;
      const _removeItem = Storage.prototype.removeItem;
      const _clear      = Storage.prototype.clear;
      const _key        = Storage.prototype.key;
      const _lengthDesc = Object.getOwnPropertyDescriptor(Storage.prototype, 'length');

      Storage.prototype.getItem = function (key) {
        if (this === localStorage && lsActive) {
          return lsOverride.has(key) ? lsOverride.get(key) : null;
        }
        return _getItem.call(this, key);
      };

      Storage.prototype.setItem = function (key, value) {
        if (this === localStorage && lsActive) {
          const v = String(value);
          lsOverride.set(key, v);
          queueLsOp({ op: 'set', key, value: v });
          return;
        }
        _setItem.call(this, key, value);
      };

      Storage.prototype.removeItem = function (key) {
        if (this === localStorage && lsActive) {
          lsOverride.delete(key);
          queueLsOp({ op: 'remove', key });
          return;
        }
        _removeItem.call(this, key);
      };

      Storage.prototype.clear = function () {
        if (this === localStorage && lsActive) {
          lsOverride.clear();
          queueLsOp({ op: 'clear' });
          return;
        }
        _clear.call(this);
      };

      Storage.prototype.key = function (i) {
        if (this === localStorage && lsActive) {
          return Array.from(lsOverride.keys())[i] ?? null;
        }
        return _key.call(this, i);
      };

      if (_lengthDesc?.get) {
        Object.defineProperty(Storage.prototype, 'length', {
          configurable: _lengthDesc.configurable,
          enumerable: _lengthDesc.enumerable,
          get() {
            if (this === localStorage && lsActive) return lsOverride.size;
            return _lengthDesc.get.call(this);
          },
        });
      }
      mainLog('hookLocalStorage installed (lsActive=', lsActive, ')');
    } catch (e) {
      mainLog('hookLocalStorage failed:', e?.message);
    }
  }

  // hook は常に install しておく（active フラグだけで挙動切替）
  hookLocalStorage();

  // ---- セッションイベント --------------------------------------------------

  window.addEventListener('__mt_init', (e) => {
    session = e.detail?.cookies ?? null;
    const snap = e.detail?.lsSnapshot;
    if (snap && typeof snap === 'object') {
      for (const k of Object.keys(snap)) {
        if (!lsOverride.has(k)) lsOverride.set(k, String(snap[k]));
      }
      lsActive = true;
    }
    mainLog('__mt_init received, lsOverlay size:', lsOverride.size, 'active:', lsActive);
  });
  window.addEventListener('__mt_update', (e) => {
    session = e.detail?.cookies ?? null;
  });

  function parseMap(str) {
    const m = new Map();
    for (const part of String(str || '').split(';')) {
      const i = part.indexOf('=');
      if (i >= 0) m.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
    }
    return m;
  }

  Object.defineProperty(Document.prototype, 'cookie', {
    configurable: true,
    get() {
      const native = nativeDesc.get.call(this);
      if (session === null) return native;
      // session のキーで native を上書きしたマージ結果を返す
      const m = parseMap(native);
      for (const [k, v] of parseMap(session)) m.set(k, v);
      return [...m].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set(val) {
      const semi = String(val).indexOf(';');
      const pair = semi >= 0 ? val.slice(0, semi) : String(val);
      const eq = pair.indexOf('=');
      if (eq < 0) { nativeDesc.set.call(this, val); return; }
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();

      if (session === null) {
        nativeDesc.set.call(this, val);
        return;
      }

      const sessionMap = parseMap(session);
      if (sessionMap.has(name)) {
        // セッション Cookie のキー: タブ内のオーバーレイ session のみ更新し native には書かない。
        // タブ内 document.cookie 読み取りには即時反映されるが、DNR ルールの値は
        // セッション割り当て時点で固定（ローテーション追跡は MVP スコープ外）。
        sessionMap.set(name, value);
        session = [...sessionMap].map(([k, v]) => `${k}=${v}`).join('; ');
      } else {
        // セッション外の Cookie: native に書き込む（UI 状態等）
        nativeDesc.set.call(this, val);
      }
    },
  });
})();
