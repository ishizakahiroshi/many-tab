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
  applyLsOps,
  listAssignments,
  setAssignment,
  clearAssignment,
} from "./lib/sessions.js";
import { applyTabRule, removeTabRule } from "./lib/dnr.js";
import { mtLog, getLogs, clearLogs } from "./lib/logbuf.js";

// ---- セッション指紋（診断用）---------------------------------------------
//
// X.com の「同じアカウントなのに 2 セッション」「ls と cookie の twid mismatch」
// を一目で判定するための要約。 cookie の twid / auth_token / ct0 / auth_multi、
// lsSnapshot 内のユーザー id 含有キーを抜き出して 1 行ログにする。
function fingerprintSession(session) {
  if (!session) return { error: 'no session' };
  const cookieMap = new Map();
  for (const c of session.cookies || []) cookieMap.set(c.name, c.value || '');
  const twidRaw = cookieMap.get('twid') || '';
  // twid 値は通常 "u%3D<userId>" の形式（URL encoded）
  const twidUserId = decodeURIComponent(twidRaw).match(/u=(\d+)/)?.[1] || '';
  const authToken = cookieMap.get('auth_token') || '';
  const ct0 = cookieMap.get('ct0') || '';
  const authMulti = cookieMap.get('auth_multi') || '';
  const ls = session.lsSnapshot || {};
  const lsKeys = Object.keys(ls);
  // lsSnapshot 内に twidUserId が含まれているキー = この user 専用データ
  const lsKeysContainingTwid = twidUserId
    ? lsKeys.filter((k) => String(ls[k]).includes(twidUserId))
    : [];
  return {
    id: (session.id || '').slice(0, 8),
    name: session.name,
    cookieTwid: twidRaw.slice(0, 30),
    twidUserId,
    authTokenHead: authToken.slice(0, 12),
    authTokenLen: authToken.length,
    ct0Head: ct0.slice(0, 12),
    authMultiCount: (authMulti.match(/\|/g) || []).length + (authMulti ? 1 : 0),
    cookieCount: (session.cookies || []).length,
    lsKeyCount: lsKeys.length,
    lsKeysFirst10: lsKeys.slice(0, 10),
    lsKeysWithTwid: lsKeysContainingTwid.slice(0, 6),
  };
}

async function dumpAllSessions(reason) {
  const sessions = await listSessions();
  const arr = Object.values(sessions);
  await mtLog('MT-DIAG', '=== dumpAllSessions ===', 'reason:', reason, 'count:', arr.length);
  for (const s of arr) {
    await mtLog('MT-DIAG', fingerprintSession(s));
  }
  // セッション間の twid が同じかチェック（= 同じアカウントを 2 回取り込んでないか）
  const twidGroups = {};
  for (const s of arr) {
    const fp = fingerprintSession(s);
    const k = fp.twidUserId || '(none)';
    twidGroups[k] = (twidGroups[k] || []).concat(fp.name);
  }
  for (const [twid, names] of Object.entries(twidGroups)) {
    if (names.length > 1) {
      await mtLog('MT-DIAG', '!! SAME twid in', names.length, 'sessions:',
        'twidUserId:', twid, 'names:', names.join(','));
    }
  }
}

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
    console.warn('[MT-BG] registerDomainHook failed:', domain, e?.message);
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
  await mtLog('MT-BG', 'applyAssignment tabId:', tabId, 'sessionId:', sessionId, 'domain:', session.domain, 'cookieLen:', header.length);
  await mtLog('MT-DIAG', '=== applyAssignment ===', 'tabId:', tabId);
  await mtLog('MT-DIAG', fingerprintSession(session));

  // assignment を先に保存する（DNR 失敗でも getTabSession が機能するよう storage を正本とする）。
  await setAssignment(tabId, sessionId);
  await mtLog('MT-BG', 'setAssignment done');

  try {
    await applyTabRule(tabId, session.domain, header);
    await mtLog('MT-BG', 'applyTabRule done');
  } catch (e) {
    console.warn('[MT-BG] applyTabRule failed (assignment kept):', e?.message);
    await mtLog('MT-BG', 'applyTabRule failed (assignment kept):', e?.message);
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

// ---- webNavigation 診断（リロード源を transitionType で特定）-------------
//
// reload / form_submit / link / typed / generated / auto_subframe …
// X.com SPA がどの種類のナビゲーションを起こしているかを BG 側から観測する。
if (chrome.webNavigation) {
  chrome.webNavigation.onCommitted.addListener(async (d) => {
    if (d.frameId !== 0) return; // メインフレームのみ
    await mtLog('MT-NAV', 'onCommitted tabId:', d.tabId,
      'transitionType:', d.transitionType,
      'transitionQualifiers:', (d.transitionQualifiers || []).join(','),
      'url:', d.url?.slice(0, 100));
    // 割り当て済みなら boot データを即時注入（document_start に間に合わせるため）
    await injectBootData(d.tabId, d.frameId);
    await trackNavigationForLoopDetection(d.tabId, d.url);
  });
  chrome.webNavigation.onBeforeNavigate.addListener(async (d) => {
    if (d.frameId !== 0) return;
    await mtLog('MT-NAV', 'onBeforeNavigate tabId:', d.tabId, 'url:', d.url?.slice(0, 100));
  });
}

// 割り当て済みタブの新ドキュメントに boot データ（cookie ヘッダ + lsSnapshot）を
// document_start でできるだけ早く plant する。content-main.js は window.__mt_boot /
// __mt_boot_ls を sync 読みして hookLocalStorage を初期化する。
async function injectBootData(tabId, frameId) {
  const assignments = await listAssignments();
  const sessionId = assignments[tabId];
  if (!sessionId) return;
  const session = await getSession(sessionId);
  if (!session) return;
  const cookies = buildCookieHeader(session.cookies);
  const lsSnapshot = session.lsSnapshot || {};
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId ?? 0] },
      world: 'MAIN',
      injectImmediately: true,
      func: (c, ls) => {
        try { window.__mt_boot = c; window.__mt_boot_ls = ls; } catch (_) {}
      },
      args: [cookies, lsSnapshot],
    });
    await mtLog('MT-BG', 'injectBootData tabId:', tabId, 'lsKeys:', Object.keys(lsSnapshot).length);
  } catch (e) {
    console.warn('[MT-BG] injectBootData failed:', e?.message);
    await mtLog('MT-BG', 'injectBootData failed:', e?.message);
  }
}

// セッション取り込み時に、対象ドメインの開いているタブから localStorage をスナップショット。
//
// 取得は ISOLATED world で行う（MAIN world で実行すると content-main.js が patched した
// Storage.prototype を経由してしまい、overlay の中身（空または partial）しか取れない）。
// ISOLATED world は独立した Storage.prototype を持ち、しかし localStorage 自体は
// origin 単位なので同じネイティブデータを参照できる。
async function snapshotLocalStorage(domain) {
  const tabs = await chrome.tabs.query({
    url: [`*://${domain}/*`, `*://*.${domain}/*`],
  });
  if (tabs.length === 0) {
    await mtLog('MT-BG', 'snapshotLocalStorage: no tab on', domain);
    return {};
  }
  // 未割り当てタブを優先（=このアカウントが native に書き込んでいる可能性が高い）
  const assignments = await listAssignments();
  const unassigned = tabs.filter((t) => !assignments[t.id]);
  const target = unassigned[0] || tabs[0];
  const isAssigned = !!assignments[target.id];
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: target.id, frameIds: [0] },
      // world 未指定 = ISOLATED（既定）。hook を素通りして native を読む。
      func: () => {
        const obj = {};
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k != null) obj[k] = localStorage.getItem(k);
          }
        } catch (_) {}
        return obj;
      },
    });
    const keys = Object.keys(result || {}).length;
    await mtLog('MT-BG', 'snapshotLocalStorage from tab:', target.id,
      'isAssigned:', isAssigned, 'keys:', keys);
    if (isAssigned && keys < 5) {
      console.warn('[MT-BG] snapshot from assigned tab returned only', keys,
        'keys — source tab may not be logged into the target account natively');
      await mtLog('MT-BG', '!! WARN: snapshot from assigned tab returned only', keys,
        'keys — source tab may not be logged into the target account natively');
    }
    return result || {};
  } catch (e) {
    console.warn('[MT-BG] snapshotLocalStorage failed:', e?.message);
    await mtLog('MT-BG', 'snapshotLocalStorage failed:', e?.message);
    return {};
  }
}

// ---- リロードループ サーキットブレーカー --------------------------------
//
// 同じ URL に対して短時間で複数回ナビゲーションが起きたら、自動的に
// 割り当てを解除して DNR ルールを撤去する。
// X.com 等の SPA は auth state mismatch を検知すると client_redirect で
// 同 URL に飛ばし続ける（無限ループ）。診断 hook では止められないため、
// 拡張側でループを検知して被害を止める。

const NAV_HISTORY = new Map(); // tabId -> [{url, ts}, ...]
const LOOP_THRESHOLD = 4;       // 3 秒以内に 4 回以上同 URL = ループ
const LOOP_WINDOW_MS = 3000;

async function trackNavigationForLoopDetection(tabId, url) {
  const now = Date.now();
  const list = NAV_HISTORY.get(tabId) ?? [];
  // 古いエントリを削除
  const recent = list.filter((e) => now - e.ts < LOOP_WINDOW_MS);
  recent.push({ url, ts: now });
  NAV_HISTORY.set(tabId, recent);

  const sameUrlCount = recent.filter((e) => e.url === url).length;
  if (sameUrlCount < LOOP_THRESHOLD) return;

  // ループ検出。割り当てがあるタブのみ介入する。
  const assignments = await listAssignments();
  if (!assignments[tabId]) return;

  console.warn('[MT-BG] !! RELOAD LOOP DETECTED tabId:', tabId,
    'count:', sameUrlCount, 'in', LOOP_WINDOW_MS, 'ms — auto-unassign');
  await mtLog('MT-BG', '!! RELOAD LOOP DETECTED tabId:', tabId,
    'count:', sameUrlCount, 'in', LOOP_WINDOW_MS, 'ms — auto-unassign');
  NAV_HISTORY.delete(tabId);

  await removeAssignment(tabId);
  try {
    await chrome.action.setBadgeText({ tabId, text: '!' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#e0245e' });
  } catch (_) {}
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'sessionUpdated', cookies: null });
  } catch (_) {}
}

chrome.tabs.onRemoved.addListener((tabId) => { NAV_HISTORY.delete(tabId); });

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
      const lsSnapshot = await snapshotLocalStorage(msg.domain);
      const session = await saveSession({
        name: msg.name,
        domain: msg.domain,
        cookies,
        lsSnapshot,
      });
      await mtLog('MT-DIAG', '=== captureSession ===', 'name:', msg.name);
      await mtLog('MT-DIAG', fingerprintSession(session));
      await dumpAllSessions('after-capture');
      return {
        session,
        cookieCount: cookies.length,
        lsCount: Object.keys(lsSnapshot).length,
      };
    }

    case "dumpSessions": {
      await dumpAllSessions('manual');
      return { ok: true };
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
      await mtLog('MT-BG', 'getTabSession from tabId:', tabId);
      if (!tabId) return { ok: false };
      const assignments = await listAssignments();
      const sessionId = assignments[tabId];
      await mtLog('MT-BG', 'assignments keys:', Object.keys(assignments).join(','), 'queried:', tabId, 'sessionId:', sessionId);
      if (!sessionId) return { ok: false, reason: 'not_assigned' };
      const session = await getSession(sessionId);
      if (!session) return { ok: false };
      const cookies = buildCookieHeader(session.cookies);
      const lsSnapshot = session.lsSnapshot || {};
      await mtLog('MT-BG', 'returning cookies first60:', cookies.slice(0, 60),
        'lsKeys:', Object.keys(lsSnapshot).length);
      return { ok: true, cookies, lsSnapshot, sessionId };
    }

    // content-main からの localStorage 書き込み通知（per-session 永続化）
    case "lsOps": {
      const tabId = sender?.tab?.id;
      if (!tabId) return { ok: false };
      const assignments = await listAssignments();
      const sessionId = assignments[tabId];
      if (!sessionId) return { ok: false, reason: 'not_assigned' };
      await applyLsOps(sessionId, msg.ops || []);
      return { ok: true };
    }

    // ログ集約（content-main → content-isolated → BG）
    case "mtLog": {
      await mtLog(msg.tag || 'MT-?', ...(msg.parts || []));
      return { ok: true };
    }

    case "getLogs": {
      return await getLogs();
    }

    case "clearLogs": {
      await clearLogs();
      return { ok: true };
    }

    // 緊急停止: 全タブの割り当てを解除 + 全 DNR session ルール撤去
    case "panicUnassignAll": {
      await mtLog('MT-BG', 'panicUnassignAll START');
      const assignments = await listAssignments();
      const tabIds = Object.keys(assignments).map(Number);
      for (const tid of tabIds) {
        try { await removeAssignment(tid); } catch (_) {}
      }
      // 念のため残存 session ルールも全撤去
      try {
        const rules = await chrome.declarativeNetRequest.getSessionRules();
        if (rules.length > 0) {
          await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: rules.map((r) => r.id),
          });
        }
      } catch (_) {}
      await mtLog('MT-BG', 'panicUnassignAll DONE, cleared', tabIds.length, 'tabs');
      return { ok: true, cleared: tabIds.length };
    }

    default:
      throw new Error(`unknown message type: ${msg?.type}`);
  }
}
