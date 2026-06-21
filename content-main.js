// content-main.js — MAIN ワールド Cookie & localStorage hook（spec §4.4）

(() => {
  console.log('[MT-MAIN] injected at', document.readyState);

  const nativeDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');

  let session = typeof window.__mt_boot === 'string' ? window.__mt_boot : null;
  delete window.__mt_boot;

  if (session !== null) {
    console.log('[MT-MAIN] boot value present, first60:', session.slice(0, 60));
  }

  // ---- localStorage overlay -----------------------------------------------
  //
  // セッションが割り当てられているタブでは localStorage を仮想的に分離する。
  //
  // 問題: X.com は localStorage に Account A のユーザーID（twid 等）をキャッシュする。
  // DNR で Session B の Cookie に差し替えると、API レスポンス（Session B のユーザーID）が
  // localStorage（Account A のユーザーID）と食い違い、X.com が不整合を検知して
  // window.location.reload() を繰り返すチカチカループが発生する。
  //
  // 対策: __mt_init 受信時に既存の localStorage キーを全て null でシャドウし、
  // 「このタブから見ると localStorage は空」という状態にする。
  // X.com が API から Session B のデータを取得し直して書き込む際は
  // オーバーレイに書き込み、ネイティブ localStorage（他タブ共有）を汚染しない。

  const lsOverride = new Map(); // key → value | null（null = 存在しないとみなす）
  let lsHooked = false;

  function hookLocalStorage() {
    if (lsHooked) return;

    // フックをインストールする前に現在の全キーを記録する（インストール後だと再帰する）。
    const keysToShadow = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k != null) keysToShadow.push(k);
      }
    } catch (_) {}

    lsHooked = true;

    const _getItem    = Storage.prototype.getItem;
    const _setItem    = Storage.prototype.setItem;
    const _removeItem = Storage.prototype.removeItem;
    const _clear      = Storage.prototype.clear;

    Storage.prototype.getItem = function(key) {
      if (this === localStorage && lsOverride.has(key)) return lsOverride.get(key);
      return _getItem.call(this, key);
    };

    // セッションタブの書き込みはオーバーレイのみ（ネイティブに書かず他タブを汚染しない）。
    Storage.prototype.setItem = function(key, value) {
      if (this === localStorage) { lsOverride.set(key, String(value)); return; }
      _setItem.call(this, key, value);
    };

    Storage.prototype.removeItem = function(key) {
      if (this === localStorage) { lsOverride.set(key, null); return; }
      _removeItem.call(this, key);
    };

    Storage.prototype.clear = function() {
      if (this === localStorage) { lsOverride.clear(); return; }
      _clear.call(this);
    };

    // 既存キーを全て null でシャドウ（Session B から Account A のデータを隠す）。
    for (const k of keysToShadow) lsOverride.set(k, null);

    console.log('[MT-MAIN] localStorage hook installed, shadowed', keysToShadow.length, 'keys');
  }

  // ---- セッションイベント --------------------------------------------------

  window.addEventListener('__mt_init', (e) => {
    session = e.detail?.cookies ?? null;
    if (session !== null) hookLocalStorage();
    console.log('[MT-MAIN] __mt_init received, first60:', session?.slice(0, 60));
  });
  window.addEventListener('__mt_update', (e) => {
    session = e.detail?.cookies ?? null;
    console.log('[MT-MAIN] __mt_update received, first60:', session?.slice(0, 60));
  });

  function parseMap(str) {
    const m = new Map();
    for (const part of String(str || '').split(';')) {
      const i = part.indexOf('=');
      if (i >= 0) m.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
    }
    return m;
  }

  let _loggedGet = false;
  Object.defineProperty(Document.prototype, 'cookie', {
    configurable: true,
    get() {
      const native = nativeDesc.get.call(this);
      if (session === null) return native;
      // session のキーで native を上書きしたマージ結果を返す
      const m = parseMap(native);
      for (const [k, v] of parseMap(session)) m.set(k, v);
      const val = [...m].map(([k, v]) => `${k}=${v}`).join('; ');
      if (!_loggedGet) {
        _loggedGet = true;
        console.log('[MT-MAIN] first cookie GET merged, first60:', val.slice(0, 60));
      }
      return val;
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
        // background への通知（旧 __mt_set → cookieWritten）は引継書アプローチC で廃止済み。
        // タブ内 document.cookie 読み取りには即時反映されるが、DNR ルールの ct0 は
        // セッション割り当て時点の値で固定（ローテーション追跡は MVP スコープ外）。
        console.log('[MT-MAIN] session cookie SET intercepted (local only):', name, '=', value.slice(0, 20));
        sessionMap.set(name, value);
        session = [...sessionMap].map(([k, v]) => `${k}=${v}`).join('; ');
      } else {
        // セッション外の Cookie: native に書き込む（X の UI 状態等）
        console.log('[MT-MAIN] non-session cookie SET passed through:', name);
        nativeDesc.set.call(this, val);
      }
    },
  });

  console.log('[MT-MAIN] document.cookie hook installed');
})();
