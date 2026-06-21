// cookies.js — chrome.cookies スナップショット取り込み（§4.3）
//
// 設計上の要点（spec §4.2 / §4.3）:
// - セッション = そのドメインの「全 Cookie」のスナップショット。どれが認証 Cookie かは判別しない。
//   → サイト非依存（X の auth_token / ct0 等を知る必要がない）を維持する。
// - httpOnly Cookie も chrome.cookies.getAll で取得できる。これが DNR 注入の素になる。

/**
 * 指定ドメインの現在の Cookie セットをスナップショットする。
 * domain フィルタは「そのドメイン or サブドメイン」にマッチする。
 * @param {string} domain 例: "x.com"
 * @returns {Promise<Array<{name:string,value:string,domain:string,path:string,secure:boolean,httpOnly:boolean}>>}
 */
export async function snapshotDomain(domain) {
  const cookies = await chrome.cookies.getAll({ domain });
  // DNR の Cookie ヘッダ構築に必要な最小項目だけを保持する（ブラウザ外には出さない／storage.local のみ）。
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
  }));
}

/**
 * Cookie 配列を HTTP リクエスト用の `Cookie` ヘッダ値に組み立てる。
 * 形式: "name1=value1; name2=value2"
 * @param {Array<{name:string,value:string}>} cookies
 * @returns {string}
 */
export function buildCookieHeader(cookies) {
  return cookies
    .filter((c) => c && typeof c.name === "string")
    .map((c) => `${c.name}=${c.value ?? ""}`)
    .join("; ");
}
