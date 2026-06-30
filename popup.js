// popup.js — ドメイン追加 / セッション取り込み / タブ割り当て UI
//
// 状態変更はすべて background のメッセージ API 経由（単一の正本）。
// 例外: chrome.permissions.request は user gesture が要るため、ここ（クリックハンドラ内）で直接呼ぶ。

const $ = (id) => document.getElementById(id);

// ---- i18n -----------------------------------------------------------------
//
// 既定 (`mtUiLang === "auto"` or 未設定) では Chrome の UI 言語に追従する
// chrome.i18n.getMessage を使う。popup の言語セレクタで "ja" / "en" を選んだ
// 場合は、Chrome 言語を無視して自前 messages.json を fetch して解決する。
//
// 後者の経路では chrome.i18n.getMessage が使えない（Chrome 言語ベースなので）
// ため、placeholders ($NAME$ ⇄ $1/$2/...) を JS 側で展開する。

let _localMessages = null; // null = auto (chrome.i18n に委譲)

async function loadLocalMessages(lang) {
  if (!lang || lang === "auto") {
    _localMessages = null;
    return;
  }
  try {
    const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
    _localMessages = await res.json();
  } catch (e) {
    console.warn("[popup] loadLocalMessages failed, falling back to auto:", e?.message);
    _localMessages = null;
  }
}

function _t(key, ...subs) {
  if (!_localMessages) {
    return chrome.i18n.getMessage(key, subs.map(String)) || key;
  }
  const entry = _localMessages[key];
  if (!entry) return key;
  let msg = entry.message;
  if (entry.placeholders) {
    for (const [name, def] of Object.entries(entry.placeholders)) {
      const m = /^\$(\d+)$/.exec(def.content || "");
      const val = m ? (subs[parseInt(m[1], 10) - 1] ?? "") : (def.content ?? "");
      msg = msg.replaceAll(`$${name.toUpperCase()}$`, String(val));
    }
  } else if (subs.length > 0) {
    subs.forEach((v, i) => {
      msg = msg.replaceAll(`$${i + 1}`, String(v));
    });
  }
  return msg;
}

/** popup HTML の data-i18n* 属性を chrome.i18n から差し込む。 */
function applyI18n() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const msg = _t(el.dataset.i18n);
    if (msg) el.textContent = msg;
  }
  for (const el of document.querySelectorAll("[data-i18n-html]")) {
    const msg = _t(el.dataset.i18nHtml);
    if (msg) el.innerHTML = msg;
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    const msg = _t(el.dataset.i18nPlaceholder);
    if (msg) el.placeholder = msg;
  }
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    const msg = _t(el.dataset.i18nTitle);
    if (msg) el.title = msg;
  }
  for (const el of document.querySelectorAll("[data-i18n-aria-label]")) {
    const msg = _t(el.dataset.i18nAriaLabel);
    if (msg) el.setAttribute("aria-label", msg);
  }
  document.documentElement.lang = (chrome.i18n.getUILanguage() || "ja").split("-")[0];
  document.title = _t("appName");
}

/** background へメッセージ送信。{ok,result} or {ok:false,error} を解いて返す/投げる。 */
function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!resp?.ok) return reject(new Error(resp?.error ?? "unknown error"));
      resolve(resp.result);
    });
  });
}

function showStatus(text, kind = "ok") {
  const el = $("status");
  el.textContent = text;
  el.className = `status show ${kind}`;
  setTimeout(() => el.classList.remove("show"), 4000);
}

/** 入力文字列からホスト名だけを取り出す（"https://x.com/foo" → "x.com"）。 */
function normalizeDomain(input) {
  let s = (input || "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z]+:\/\//, ""); // スキーム除去
  s = s.split("/")[0]; // パス除去
  s = s.split("@").pop(); // 認証情報除去（念のため）
  s = s.split(":")[0]; // ポート除去
  return s;
}

let activeTab = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

// ---- レンダリング --------------------------------------------------------

async function render() {
  const state = await send({ type: "getState" });
  const domains = state.domains ?? [];
  const sessions = Object.values(state.sessions ?? {});
  const assignments = state.assignments ?? {};

  // ドメイン一覧
  const domainList = $("domain-list");
  domainList.innerHTML = "";
  if (domains.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = _t("emptyDomainList");
    domainList.appendChild(empty);
  } else {
    for (const d of domains) {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.className = "grow";
      span.textContent = d;
      li.appendChild(span);
      domainList.appendChild(li);
    }
  }

  // 取り込み用ドメイン select
  const capDomain = $("capture-domain");
  capDomain.innerHTML = "";
  for (const d of domains) {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    capDomain.appendChild(opt);
  }

  // セッション一覧
  const sessionList = $("session-list");
  sessionList.innerHTML = "";
  if (sessions.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = _t("emptySessionList");
    sessionList.appendChild(empty);
  } else {
    for (const s of sessions) {
      const li = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = s.color;
      const label = document.createElement("span");
      label.className = "grow";
      label.textContent = s.name;
      const meta = document.createElement("span");
      meta.className = "badge";
      const lsCount = s.lsSnapshot ? Object.keys(s.lsSnapshot).length : 0;
      const lsWarn = lsCount < 5 ? " ⚠" : "";
      meta.textContent = _t("sessionMeta", s.domain, s.cookies?.length ?? 0, lsCount, lsWarn);
      meta.title = lsCount < 5
        ? _t("lsLowWarning")
        : _t("lsCountTooltip", lsCount);
      const del = document.createElement("button");
      del.className = "danger";
      del.textContent = _t("deleteSessionBtn");
      del.addEventListener("click", async () => {
        try {
          await send({ type: "deleteSession", id: s.id });
          showStatus(_t("successSessionDeleted", s.name));
          render();
        } catch (e) {
          showStatus(e.message, "err");
        }
      });
      li.append(dot, label, meta, del);
      sessionList.appendChild(li);
    }
  }

  // 割り当て用 select
  const assignSelect = $("assign-select");
  assignSelect.innerHTML = "";
  for (const s of sessions) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.name}（${s.domain}）`;
    assignSelect.appendChild(opt);
  }

  // アクティブタブ表示 + 現在の割り当て
  activeTab = await getActiveTab();
  if (activeTab) {
    $("tab-title").textContent = activeTab.title ?? _t("tabTitleUnknown");
    let host = "";
    try {
      host = new URL(activeTab.url).host;
    } catch (_) {}
    const assigned = assignments[activeTab.id];
    const assignedSession = assigned ? state.sessions[assigned] : null;
    $("tab-host").textContent = assignedSession
      ? _t("tabHostAssigned", host, assignedSession.name, activeTab.id)
      : _t("tabHostNormal", host, activeTab.id);
    if (assignedSession) assignSelect.value = assigned;
  } else {
    $("tab-title").textContent = _t("tabTitleError");
    $("tab-host").textContent = "";
  }
}

// ---- イベント ------------------------------------------------------------

// 1. ドメイン追加（権限要求はここで直接）
$("domain-add").addEventListener("click", async () => {
  const domain = normalizeDomain($("domain-input").value);
  if (!domain || !domain.includes(".")) {
    showStatus(_t("errorInvalidDomain"), "err");
    return;
  }
  try {
    const granted = await chrome.permissions.request({
      origins: [`*://${domain}/*`],
    });
    if (!granted) {
      showStatus(_t("errorPermissionDenied"), "err");
      return;
    }
    await send({ type: "addDomain", domain });
    $("domain-input").value = "";
    showStatus(_t("successDomainAdded", domain));
    render();
  } catch (e) {
    showStatus(e.message, "err");
  }
});

// 2. セッション取り込み
$("capture-btn").addEventListener("click", async () => {
  const domain = $("capture-domain").value;
  const name = $("capture-name").value.trim();
  if (!domain) {
    showStatus(_t("errorAddDomainFirst"), "err");
    return;
  }
  if (!name) {
    showStatus(_t("errorSessionNameRequired"), "err");
    return;
  }
  try {
    const res = await send({ type: "captureSession", domain, name });
    $("capture-name").value = "";
    showStatus(_t("successCaptured", name, res.cookieCount, res.lsCount ?? 0));
    render();
  } catch (e) {
    showStatus(e.message, "err");
  }
});

// 3. 割り当て
$("assign-btn").addEventListener("click", async () => {
  // クリック時点の最新アクティブタブを取得（render() 時のキャッシュは使わない）。
  activeTab = await getActiveTab();
  if (!activeTab) {
    showStatus(_t("errorNoActiveTab"), "err");
    return;
  }
  const sessionId = $("assign-select").value;
  if (!sessionId) {
    showStatus(_t("errorNoSessionToAssign"), "err");
    return;
  }
  try {
    const res = await send({ type: "assignTab", tabId: activeTab.id, sessionId });
    if (!res.ok) {
      const map = {
        permission_missing: _t("errorPermissionMissing"),
        session_not_found: _t("errorSessionNotFound"),
      };
      showStatus(map[res.reason] ?? res.reason, "err");
      return;
    }
    showStatus(_t("successAssigned"));
    render();
  } catch (e) {
    showStatus(e.message, "err");
  }
});

// 割り当て解除
$("unassign-btn").addEventListener("click", async () => {
  if (!activeTab) return;
  try {
    await send({ type: "unassignTab", tabId: activeTab.id });
    showStatus(_t("successUnassigned"));
    render();
  } catch (e) {
    showStatus(e.message, "err");
  }
});

// ---- 4. デバッグ / 緊急停止 ----------------------------------------------

$("panic-btn").addEventListener("click", async () => {
  if (!confirm(_t("confirmPanic"))) return;
  try {
    const res = await send({ type: "panicUnassignAll" });
    showStatus(_t("successPanic", res.cleared));
    render();
  } catch (e) {
    showStatus(e.message, "err");
  }
});

async function refreshLogs() {
  try {
    const logs = await send({ type: "getLogs" });
    const area = $("logs-area");
    area.value = (logs ?? []).join("\n");
    area.scrollTop = area.scrollHeight;
  } catch (e) {
    showStatus(e.message, "err");
  }
}

$("logs-refresh").addEventListener("click", refreshLogs);

$("logs-copy").addEventListener("click", async () => {
  const area = $("logs-area");
  try {
    await navigator.clipboard.writeText(area.value);
    showStatus(_t("successLogsCopied", area.value.length));
  } catch (e) {
    area.select();
    document.execCommand("copy");
    showStatus(_t("successLogsCopiedFallback"));
  }
});

$("logs-clear").addEventListener("click", async () => {
  try {
    await send({ type: "clearLogs" });
    $("logs-area").value = "";
    showStatus(_t("successLogsCleared"));
  } catch (e) {
    showStatus(e.message, "err");
  }
});

$("dump-sessions").addEventListener("click", async () => {
  try {
    await send({ type: "dumpSessions" });
    showStatus(_t("successDumpSessions"));
    setTimeout(refreshLogs, 200);
  } catch (e) {
    showStatus(e.message, "err");
  }
});

// ---- Debug log toggle ----------------------------------------------------
//
// chrome.storage.local.mtDebug と双方向バインド。
// ON 直後は popup 上の checkbox が即時更新されるが、既に立ち上がっている
// content script / SW は次回起動 (拡張リロード) まで以前の値で動く。

async function loadDebugFlag() {
  try {
    const { mtDebug } = await chrome.storage.local.get("mtDebug");
    $("debug-enabled").checked = mtDebug === true;
  } catch (_) {}
}

$("debug-enabled").addEventListener("change", async (e) => {
  const next = e.target.checked;
  try {
    await chrome.storage.local.set({ mtDebug: next });
    showStatus(next ? _t("debugEnableMsg") : _t("debugDisableMsg"));
  } catch (err) {
    showStatus(err.message, "err");
  }
});

// details を開いたタイミングでログを取りに行く（閉じてる間は無駄なフェッチをしない）
$("debug-details").addEventListener("toggle", () => {
  if ($("debug-details").open) {
    refreshLogs();
  }
});

$("close-btn").addEventListener("click", () => window.close());

// ---- 言語セレクタ --------------------------------------------------------

async function loadUiLang() {
  const { mtUiLang } = await chrome.storage.local.get("mtUiLang");
  const lang = mtUiLang || "auto";
  $("ui-lang").value = lang;
  await loadLocalMessages(lang);
}

$("ui-lang").addEventListener("change", async (e) => {
  const lang = e.target.value;
  await chrome.storage.local.set({ mtUiLang: lang });
  await loadLocalMessages(lang);
  applyI18n();
  render();
});

(async () => {
  await loadUiLang();
  applyI18n();
  render();
  loadDebugFlag();
})();
