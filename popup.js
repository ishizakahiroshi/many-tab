// popup.js — ドメイン追加 / セッション取り込み / タブ割り当て UI
//
// 状態変更はすべて background のメッセージ API 経由（単一の正本）。
// 例外: chrome.permissions.request は user gesture が要るため、ここ（クリックハンドラ内）で直接呼ぶ。

const $ = (id) => document.getElementById(id);

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
    domainList.innerHTML = `<li class="empty">まだドメインがありません</li>`;
  } else {
    for (const d of domains) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="grow">${d}</span>`;
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
    sessionList.innerHTML = `<li class="empty">まだセッションがありません</li>`;
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
      meta.textContent = `${s.domain}・${s.cookies?.length ?? 0} cookie`;
      const del = document.createElement("button");
      del.className = "danger";
      del.textContent = "削除";
      del.addEventListener("click", async () => {
        try {
          await send({ type: "deleteSession", id: s.id });
          showStatus(`セッション「${s.name}」を削除しました`);
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
    $("tab-title").textContent = activeTab.title ?? "(無題)";
    let host = "";
    try {
      host = new URL(activeTab.url).host;
    } catch (_) {}
    const assigned = assignments[activeTab.id];
    const assignedSession = assigned ? state.sessions[assigned] : null;
    $("tab-host").textContent = assignedSession
      ? `${host}　→ 割当中: ${assignedSession.name} (id:${activeTab.id})`
      : `${host} (id:${activeTab.id})`;
    if (assignedSession) assignSelect.value = assigned;
  } else {
    $("tab-title").textContent = "(アクティブタブを取得できません)";
    $("tab-host").textContent = "";
  }
}

// ---- イベント ------------------------------------------------------------

// 1. ドメイン追加（権限要求はここで直接）
$("domain-add").addEventListener("click", async () => {
  const domain = normalizeDomain($("domain-input").value);
  if (!domain || !domain.includes(".")) {
    showStatus("正しいドメインを入力してください（例: x.com）", "err");
    return;
  }
  try {
    const granted = await chrome.permissions.request({
      origins: [`*://${domain}/*`],
    });
    if (!granted) {
      showStatus("権限が許可されませんでした", "err");
      return;
    }
    await send({ type: "addDomain", domain });
    $("domain-input").value = "";
    showStatus(`${domain} を追加しました`);
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
    showStatus("先にドメインを追加してください", "err");
    return;
  }
  if (!name) {
    showStatus("セッション名を入力してください", "err");
    return;
  }
  try {
    const res = await send({ type: "captureSession", domain, name });
    $("capture-name").value = "";
    showStatus(`「${name}」を取込（${res.cookieCount} cookie）`);
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
    showStatus("アクティブタブがありません", "err");
    return;
  }
  const sessionId = $("assign-select").value;
  if (!sessionId) {
    showStatus("割り当てるセッションがありません", "err");
    return;
  }
  try {
    const res = await send({ type: "assignTab", tabId: activeTab.id, sessionId });
    if (!res.ok) {
      const map = {
        permission_missing: "このドメインの権限が未付与です（手順1で追加してください）",
        session_not_found: "セッションが見つかりません",
      };
      showStatus(map[res.reason] ?? res.reason, "err");
      return;
    }
    showStatus("割り当てました。ページを再読み込みすると反映されます");
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
    showStatus("割り当てを解除しました。ページを再読み込みしてください");
    render();
  } catch (e) {
    showStatus(e.message, "err");
  }
});

render();
