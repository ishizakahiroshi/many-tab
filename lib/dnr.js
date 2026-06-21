// dnr.js — tabId + domain 条件の DNR session ルール生成/更新/撤去（§4.2）
//
// 設計（spec §4.2／一次ソースで確認済み 2026-06）:
// - session ルール（in-memory・ブラウザセッション内のみ保持。tabId は再起動で変わるため適切）。
// - condition.tabIds は session ルール限定で利用可。
// - action.modifyHeaders で `Cookie` リクエストヘッダを operation:"set" で置換
//   → ブラウザ共有の本物 Cookie はそのタブの対象ドメイン宛リクエストに乗らない。
// - condition.requestDomains はそのドメイン＋サブドメインにマッチ。
//
// ルール ID 規約: 1 タブ 1 ルール。ruleId = tabId（tabId は正の整数で一意）。
//   更新は removeRuleIds:[tabId] + addRules:[{id:tabId,...}] でアトミックに差し替える。

// Cookie を載せ替えたいリクエスト種別。
// main_frame / sub_frame は意図的に除外する:
//   - ページナビゲーション（main_frame）に Session B の Cookie を注入すると、
//     サーバーが 302 リダイレクト（2FA フロー等）を返した場合に DNR が同じ Cookie を
//     再注入してリダイレクトループになる。
//   - main_frame の Set-Cookie レスポンスが Native のネイティブ Cookie jar（Account A）を
//     Session B のサーバー発行 Cookie で上書きしてしまう。
//   API 呼び出し（xmlhttprequest / fetch / websocket 等）のみを差し替えれば
//   X.com のタイムラインは Session B のデータを表示できる。
const RESOURCE_TYPES = [
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "webtransport",
  "webbundle",
  "other",
];

/**
 * 指定タブ・ドメインに、与えた Cookie ヘッダ値を set する session ルールを張る（既存は置換）。
 * @param {number} tabId
 * @param {string} domain   例: "x.com"（サブドメインも対象）
 * @param {string} cookieHeader  "name=value; name2=value2"
 */
export async function applyTabRule(tabId, domain, cookieHeader) {
  const requestHeaders = [
    { header: "Cookie", operation: "set", value: cookieHeader },
  ];

  // x-csrf-token を Session B の ct0 で上書きする。
  // 問題: X.com JS は __mt_init 到着前に document.cookie から ct0 をキャッシュし、
  // 以降の API リクエストの x-csrf-token ヘッダにその値（Account A の ct0）を使う。
  // DNR は Cookie を Session B に差し替えるため ct0 が不一致になり 403 になる。
  // DNR で x-csrf-token も Session B の ct0 に揃えることでタイミング依存を排除する。
  const ct0m = cookieHeader.match(/(?:^|;\s*)ct0=([^;]+)/);
  if (ct0m) {
    requestHeaders.push({ header: "x-csrf-token", operation: "set", value: ct0m[1].trim() });
  }

  const rule = {
    id: tabId,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders,
    },
    condition: {
      tabIds: [tabId],
      requestDomains: [domain],
      resourceTypes: RESOURCE_TYPES,
    },
  };
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
    addRules: [rule],
  });
}

/** 指定タブのルールを撤去する。 */
export async function removeTabRule(tabId) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
  });
}

/** 現在登録されている session ルールの tabId 一覧を返す。 */
export async function listRuleTabIds() {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  return rules.map((r) => r.id);
}
