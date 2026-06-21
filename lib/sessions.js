// sessions.js — 名前付きセッション（Cookie セット）の保存/取得（chrome.storage.local）
//
// ストレージ・スキーマ（すべて chrome.storage.local。クラウド同期しない＝spec §3）:
//   domains:   string[]                          追加済みドメイン（実行時 host 権限を取得済みのもの）
//   sessions:  { [id]: Session }                 名前付きセッション
//   tabAssignments: { [tabId]: sessionId }       タブ→セッション割り当て
//
// Session = {
//   id: string, name: string, domain: string,
//   color: string,                               バッジ色
//   cookies: Cookie[],                           snapshotDomain() の戻り
//   createdAt: number
// }

const KEY_DOMAINS = "domains";
const KEY_SESSIONS = "sessions";
const KEY_ASSIGNMENTS = "tabAssignments";

// セッションに自動付与するバッジ色のパレット（視覚区別用）。
const COLORS = [
  "#1d9bf0", // blue
  "#f91880", // pink
  "#00ba7c", // green
  "#ff7a00", // orange
  "#7856ff", // purple
  "#ffd400", // yellow
  "#e0245e", // red
  "#536471", // gray
];

async function get(key, fallback) {
  const obj = await chrome.storage.local.get(key);
  return obj[key] ?? fallback;
}

async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

// ---- domains -------------------------------------------------------------

export async function listDomains() {
  return await get(KEY_DOMAINS, []);
}

export async function addDomain(domain) {
  const domains = await listDomains();
  if (!domains.includes(domain)) {
    domains.push(domain);
    await set(KEY_DOMAINS, domains);
  }
  return domains;
}

export async function removeDomain(domain) {
  const domains = (await listDomains()).filter((d) => d !== domain);
  await set(KEY_DOMAINS, domains);
  return domains;
}

// ---- sessions ------------------------------------------------------------

export async function listSessions() {
  return await get(KEY_SESSIONS, {});
}

export async function getSession(id) {
  const sessions = await listSessions();
  return sessions[id] ?? null;
}

/**
 * セッションを新規保存する。
 * @param {{name:string, domain:string, cookies:Array}} param0
 * @returns {Promise<object>} 保存した Session
 */
export async function saveSession({ name, domain, cookies }) {
  const sessions = await listSessions();
  const id = crypto.randomUUID();
  const color = COLORS[Object.keys(sessions).length % COLORS.length];
  const session = {
    id,
    name,
    domain,
    color,
    cookies,
    createdAt: Date.now(),
  };
  sessions[id] = session;
  await set(KEY_SESSIONS, sessions);
  return session;
}

/** 既存セッションの Cookie を再スナップショットで差し替える。 */
export async function updateSessionCookies(id, cookies) {
  const sessions = await listSessions();
  if (!sessions[id]) return null;
  sessions[id].cookies = cookies;
  sessions[id].updatedAt = Date.now();
  await set(KEY_SESSIONS, sessions);
  return sessions[id];
}

export async function deleteSession(id) {
  const sessions = await listSessions();
  delete sessions[id];
  await set(KEY_SESSIONS, sessions);
  // このセッションへの割り当ても掃除する。
  const assignments = await listAssignments();
  let changed = false;
  for (const [tabId, sid] of Object.entries(assignments)) {
    if (sid === id) {
      delete assignments[tabId];
      changed = true;
    }
  }
  if (changed) await set(KEY_ASSIGNMENTS, assignments);
}

// ---- assignments ---------------------------------------------------------

export async function listAssignments() {
  return await get(KEY_ASSIGNMENTS, {});
}

export async function setAssignment(tabId, sessionId) {
  const assignments = await listAssignments();
  assignments[tabId] = sessionId;
  await set(KEY_ASSIGNMENTS, assignments);
}

export async function clearAssignment(tabId) {
  const assignments = await listAssignments();
  delete assignments[tabId];
  await set(KEY_ASSIGNMENTS, assignments);
}
