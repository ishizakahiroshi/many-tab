// content-isolated.js — ISOLATED ワールド ブリッジ（spec §4.4）
//
// アプローチC（引継書）: __mt_set リスナーを完全廃止。
// ct0 ローテーション追跡は MVP では nice-to-have。永続的な __mt_set リスナーは
// 後から拡張がリロードされて context invalidated になった瞬間に
// chrome.runtime.sendMessage を呼び、try-catch / lastError / window.error
// のいずれをすり抜けて "Uncaught" を出す経路だったため、発生源そのものを削除する。
//
// 残るのは:
//   - 起動時 1 回の getTabSession（context が valid な瞬間に呼ぶだけ）
//   - chrome.runtime.onMessage（sessionUpdated push 受信。Chrome 側から発火されるので
//     context invalidated 後は単に呼ばれなくなるだけで Uncaught にはならない）

(() => {
  try {
    console.log('[MT-ISO] started at', document.readyState);

    try {
      chrome.runtime.sendMessage({ type: 'getTabSession' }, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.log('[MT-ISO] getTabSession lastError:', err.message);
          return;
        }
        const cookies = resp?.result?.cookies;
        console.log('[MT-ISO] getTabSession resp outer ok:', resp?.ok, 'result.ok:', resp?.result?.ok,
                    'reason:', resp?.result?.reason, 'cookies first60:', cookies?.slice(0, 60));
        if (resp?.ok && resp?.result?.ok && cookies != null) {
          window.dispatchEvent(new CustomEvent('__mt_init', { detail: { cookies } }));
        }
      });
    } catch (e) {
      console.log('[MT-ISO] getTabSession sync throw:', e?.message);
    }

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'sessionUpdated') {
        console.log('[MT-ISO] sessionUpdated push, first60:', msg.cookies?.slice(0, 60));
        window.dispatchEvent(
          new CustomEvent('__mt_update', { detail: { cookies: msg.cookies ?? null } })
        );
      }
    });
  } catch (e) {
    console.log('[MT-ISO] setup fatal:', e?.message);
  }
})();
