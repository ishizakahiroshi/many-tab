// background.js — service worker（ESM module）
//
// 責務（spec §4）:
// - popup からのメッセージ API を受け、セッション分離の状態を一元管理する。
// - タブ割り当てに応じて DNR session ルールを登録/撤去し、バッジで視覚表示する。
// - ドメインごとに MAIN/ISOLATED ワールドの content script を動的登録する（§4.4）。
// - タブが閉じたらルール・割り当てを掃除する。
// - SW 再起動時に、保存済み割り当てを現存タブだけ再適用する。

import {
  snapshotDomain,
  buildCookieHeader,
} from "./lib/cookies.js";
import {
  listDomains,
  addDomain,
  removeDomain,
  listSessions,
  getSession,
  saveSession,
  deleteSession,
  listAssignments,
  setAssignment,
  clearAssignment,
} from "./lib/sessions.js";
import { applyTabRule, removeTabRule } from "./lib/dnr.js";

// ---- バッジ表示 ----------------------------------------------------------

async function setBadge(tabId, session) {
  const text = session?.name ? [...session.name][0] : "●";
  try {
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: session?.color ?? "#536471",
    });
  } catch (_) {}
}

async function clearBadge(tabId) {
  try {
    await chrome.action.setBadgeText({ tabId, text: "" });
  } catch (_) {}
}

// ---- content script 動的登録（§4.4）------------------------------------
//
// ドメインを追加したとき、そのドメインに対して MAIN/ISOLATED ワールドの
// content script を document_start で自動注入する登録を行う。
// これにより document.cookie が monkeypatch され CSRF 照合が通る。

function hookId(domain) {
  return `hook-${domain.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

async function registerDomainHook(domain) {
  const base = hookId(domain);
  const ids = [`${base}-main`, `${base}-iso`];
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids });
    const existingIds = new Set(existing.map((s) => s.id));
    const toAdd = [];
    if (!existingIds.has(ids[0])) {
      toAdd.push({
        id: ids[0],
        matches: [`*://${domain}/*`, `*://*.${domain}/*`],
        js: ['content-main.js'],
        world: 'MAIN',
        runAt: 'document_start',
      });
    }
    if (!existingIds.has(ids[1])) {
      toAdd.push({
        id: ids[1],
        matches: [`*://${domain}/*`, `*://*.${domain}/*`],
        js: ['content-isolated.js'],
        world: 'ISOLATED',
        runAt: 'document_start',
      });
    }
    if (toAdd.length > 0) {
      await chrome.scripting.registerContentScripts(toAdd);
    }
  } catch (e) {
    console.warn('[many-tab] registerDomainHook failed:', domain, e?.message);
  }
}

async function unregisterDomainHook(domain) {
  const base = hookId(domain);
  await chrome.scripting.unregisterContentScripts({
    ids: [`${base}-main`, `${base}-iso`],
  }).catch(() => {});
}

// ---- 割り当ての適用/解除 -------------------------------------------------

async function hasHostPermission(domain) {
  return await chrome.permissions.contains({
    origins: [`*://${domain}/*`],
  });
}

/**
 * タブにセッションを割り当て、DNR ルール＋バッジを反映する。
 * 既にページが開いていれば ISOLATED ブリッジ経由でセッション情報を push する。
 * @returns {{ok:boolean, reason?:string}}
 */
async function applyAssignment(tabId, sessionId) {
  const session = await getSession(sessionId);
  if (!session) return { ok: false, reason: "session_not_found" };

  if (!(await hasHostPermission(session.domain))) {
    return { ok: false, reason: "permission_missing" };
  }

  const header = buildCookieHeader(session.cookies);
  console.log('[MT-BG] applyAssignment tabId:', tabId, 'sessionId:', sessionId, 'domain:', session.domain, 'cookieLen:', header.length);

  // assignment を先に保存する（DNR 失敗でも getTabSession が機能するよう storage を正本とする）。
  await setAssignment(tabId, sessionId);
  console.log('[MT-BG] setAssignment done');

  try {
    await applyTabRule(tabId, session.domain, header);
    console.log('[MT-BG] applyTabRule done');
  } catch (e) {
    console.warn('[MT-BG] applyTabRule failed (assignment kept):', e?.message);
  }

  await setBadge(tabId, session);

  // sessionUpdated を push しない: 開いているページに mid-flight で Cookie を切り替えると
  // X.com 等の SPA が変化を検知してリロードし、ループになるため。
  // 割り当て後は popup のメッセージ（"ページを再読み込みすると反映されます"）の通り
  // ユーザーが手動リロードすれば、content-isolated.js の getTabSession が自動初期化する。

  return { ok: true };
}

async function removeAssignment(tabId) {
  await removeTabRule(tabId);
  await clearAssignment(tabId);
  await clearBadge(tabId);
}

// ---- SW 起動時: 保存済み割り当てを現存タブに再適用 -----------------------

async function reconcile() {
  // ドメインの content script hook を確認・再登録する（SW 再起動で解除されないが念のため）。
  const domains = await listDomains();
  await Promise.all(domains.map(registerDomainHook));

  // 保存済み割り当てを現存タブにだけ再適用する。
  const assignments = await listAssignments();
  const entries = Object.entries(assignments);
  if (entries.length === 0) return;

  const tabs = await chrome.tabs.query({});
  const aliveTabIds = new Set(tabs.map((t) => t.id));

  for (const [tabIdStr, sessionId] of entries) {
    const tabId = Number(tabIdStr);
    if (!aliveTabIds.has(tabId)) {
      await removeAssignment(tabId);
      continue;
    }
    // 権限がなければスキップ（assignment は消さない）。
    // DNR ルールだけ再適用を試みる。
    const res = await applyAssignment(tabId, sessionId);
    if (!res.ok && res.reason === 'session_not_found') {
      await removeAssignment(tabId);
    }
  }
}

chrome.runtime.onStartup.addListener(reconcile);
chrome.runtime.onInstalled.addListener(async (details) => {
  await reconcile();
  // 拡張 install/update（開発中の「拡張をリロード」も含む）時、既にページに付いた
  // 旧 content script は残り続け、context だけ無効化される。これが
  // "Uncaught Error: Extension context invalidated" の正体（引継書 §優先3 ゾンビ問題）。
  // 登録ドメインの既存タブを強制リロードして新 content script を当て直す。
  if (details.reason === 'install' || details.reason === 'update') {
    try {
      const domains = await listDomains();
      for (const d of domains) {
        const tabs = await chrome.tabs.query({ url: [`*://${d}/*`, `*://*.${d}/*`] });
        for (const t of tabs) {
          chrome.tabs.reload(t.id).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[MT-BG] zombie reload failed:', e?.message);
    }
  }
});
reconcile();

// ---- 権限取り消しの同期（§4.1）------------------------------------------

function originToDomain(origin) {
  const m = /^\*:\/\/([^/]+)\/\*$/.exec(origin);
  return m ? m[1] : null;
}

chrome.permissions.onRemoved.addListener(async (perms) => {
  const removedDomains = (perms.origins ?? [])
    .map(originToDomain)
    .filter(Boolean);
  if (removedDomains.length === 0) return;

  for (const d of removedDomains) {
    await removeDomain(d);
    await unregisterDomainHook(d);
  }

  const [sessions, assignments] = await Promise.all([
    listSessions(),
    listAssignments(),
  ]);
  for (const [tabIdStr, sid] of Object.entries(assignments)) {
    const s = sessions[sid];
    if (s && removedDomains.includes(s.domain)) {
      await removeAssignment(Number(tabIdStr));
    }
  }
});

// ---- タブが閉じたら掃除 --------------------------------------------------

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const assignments = await listAssignments();
  if (assignments[tabId] != null) {
    await removeAssignment(tabId);
  }
});

// ---- popup / content script からのメッセージ API -------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
  return true;
});

async function handleMessage(msg, sender) {
  switch (msg?.type) {
    case "getState": {
      const [domains, sessions, assignments] = await Promise.all([
        listDomains(),
        listSessions(),
        listAssignments(),
      ]);
      return { domains, sessions, assignments };
    }

    case "addDomain": {
      const domains = await addDomain(msg.domain);
      await registerDomainHook(msg.domain);
      return { domains };
    }

    case "captureSession": {
      const cookies = await snapshotDomain(msg.domain);
      const session = await saveSession({
        name: msg.name,
        domain: msg.domain,
        cookies,
      });
      return { session, cookieCount: cookies.length };
    }

    case "deleteSession": {
      const assignments = await listAssignments();
      for (const [tabIdStr, sid] of Object.entries(assignments)) {
        if (sid === msg.id) await removeAssignment(Number(tabIdStr));
      }
      await deleteSession(msg.id);
      return { deleted: msg.id };
    }

    case "assignTab": {
      return await applyAssignment(msg.tabId, msg.sessionId);
    }

    case "unassignTab": {
      await removeAssignment(msg.tabId);
      // ISOLATED に null を送って document.cookie を本物に戻す。
      chrome.tabs.sendMessage(msg.tabId, { type: 'sessionUpdated', cookies: null }).catch(() => {});
      return { ok: true };
    }

    // content-isolated.js から呼ばれる。sender.tab.id で自タブのセッションを返す。
    case "getTabSession": {
      const tabId = sender?.tab?.id;
      console.log('[MT-BG] getTabSession from tabId:', tabId);
      if (!tabId) return { ok: false };
      const assignments = await listAssignments();
      const sessionId = assignments[tabId];
      console.log('[MT-BG] assignments:', JSON.stringify(assignments), '/ queried tabId:', tabId, '(type:', typeof tabId, ')');
      console.log('[MT-BG] sessionId for tab:', sessionId);
      if (!sessionId) return { ok: false, reason: 'not_assigned' };
      const session = await getSession(sessionId);
      if (!session) return { ok: false };
      const cookies = buildCookieHeader(session.cookies);
      console.log('[MT-BG] returning cookies first60:', cookies.slice(0, 60));
      return { ok: true, cookies };
    }

    default:
      throw new Error(`unknown message type: ${msg?.type}`);
  }
}
