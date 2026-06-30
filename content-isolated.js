// content-isolated.js — ISOLATED ワールド ブリッジ（spec §4.4）
//
// アプローチC（引継書）: __mt_set リスナーを完全廃止。
// ct0 ローテーション追跡は MVP では nice-to-have。永続的な __mt_set リスナーは
// 後から拡張がリロードされて context invalidated になった瞬間に
// chrome.runtime.sendMessage を呼び、try-catch / lastError / window.error
// のいずれをすり抜けて "Uncaught" を出す経路だったため、発生源そのものを削除する。
//
// 役割:
//   - 起動時 1 回の getTabSession（context が valid な瞬間に呼ぶだけ）
//   - chrome.runtime.onMessage（sessionUpdated push 受信）
//   - MAIN ワールドからの window.postMessage({__mt_log:{tag, parts}}) を BG へ橋渡し
//     （MAIN は chrome.* にアクセスできないため）

(() => {
  function isoLog(...parts) {
    // BG にも転送（リングバッファに集約）
    try {
      chrome.runtime.sendMessage({ type: 'mtLog', tag: 'MT-ISO', parts }).catch?.(() => {});
    } catch (_) {}
    try { console.log('[MT-ISO]', ...parts); } catch (_) {}
  }

  try {
    isoLog('started at', document.readyState, 'url:', location.href);

    // MAIN → ISO の橋渡し（ログ + localStorage 書き込み通知）
    window.addEventListener('message', (ev) => {
      if (ev.source !== window) return;
      const data = ev.data;
      if (!data || typeof data !== 'object') return;
      if (data.__mt_log) {
        const { tag, parts } = data.__mt_log;
        try {
          chrome.runtime.sendMessage({
            type: 'mtLog',
            tag: tag || 'MT-MAIN',
            parts: parts || [],
          }).catch?.(() => {});
        } catch (_) {}
      }
      if (data.__mt_lsOps) {
        try {
          chrome.runtime.sendMessage({
            type: 'lsOps',
            ops: data.__mt_lsOps,
          }).catch?.(() => {});
        } catch (_) {}
      }
    });

    try {
      chrome.runtime.sendMessage({ type: 'getTabSession' }, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) {
          isoLog('getTabSession lastError:', err.message);
          return;
        }
        const cookies = resp?.result?.cookies;
        const lsSnapshot = resp?.result?.lsSnapshot || {};
        isoLog('getTabSession resp outer ok:', resp?.ok, 'result.ok:', resp?.result?.ok,
               'reason:', resp?.result?.reason, 'cookies first60:', cookies?.slice(0, 60),
               'lsKeys:', Object.keys(lsSnapshot).length);
        if (resp?.ok && resp?.result?.ok && cookies != null) {
          window.dispatchEvent(new CustomEvent('__mt_init', {
            detail: { cookies, lsSnapshot },
          }));
        }
      });
    } catch (e) {
      isoLog('getTabSession sync throw:', e?.message);
    }

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'sessionUpdated') {
        isoLog('sessionUpdated push, first60:', msg.cookies?.slice(0, 60));
        window.dispatchEvent(
          new CustomEvent('__mt_update', { detail: { cookies: msg.cookies ?? null } })
        );
      }
    });
  } catch (e) {
    try { console.log('[MT-ISO] setup fatal:', e?.message); } catch (_) {}
  }
})();
