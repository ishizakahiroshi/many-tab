// logbuf.js — chrome.storage.local 上のリングバッファログ（debug flag 制御）
//
// 目的: SW console / 各タブ console を毎回開いてコピーする手間を消し、
// popup の「ログコピー」ボタン 1 つで全箇所のログを集約コピペできるようにする。
//
// 通常使用時はストレージ書き込みを行わない（debugEnabled=false）。
// popup の Debug toggle が ON のときだけ chrome.storage.local に蓄積する。
// console.log は flag に関係なく常に出す（DevTools を開いている人向け）。
//
// 使い分け:
//   - background / content-isolated は chrome.storage に直接書ける → mtLog() を呼ぶ
//   - content-main (MAIN world) は chrome.* が無い → window.postMessage で ISOLATED に
//     橋渡しし、ISOLATED 側が mtLog() を呼ぶ

const KEY = '__mt_logs';
const FLAG_KEY = 'mtDebug';
const MAX = 200;

let debugEnabled = false;
let debugLoaded = false;
let debugLoadPromise = null;

function loadDebugFlag() {
  if (debugLoadPromise) return debugLoadPromise;
  debugLoadPromise = (async () => {
    try {
      const { [FLAG_KEY]: v } = await chrome.storage.local.get(FLAG_KEY);
      debugEnabled = v === true;
    } catch (_) {
      debugEnabled = false;
    }
    debugLoaded = true;
  })();
  return debugLoadPromise;
}

// SW / content-isolated いずれの読み込み時にも 1 回だけ走る。
loadDebugFlag();

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (FLAG_KEY in changes) {
      debugEnabled = changes[FLAG_KEY].newValue === true;
      debugLoaded = true;
    }
  });
} catch (_) {}

export function setDebugEnabled(v) {
  debugEnabled = !!v;
  return chrome.storage.local.set({ [FLAG_KEY]: !!v });
}

export function getDebugEnabled() {
  return debugEnabled;
}

function stamp() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function fmtPart(p) {
  if (typeof p === 'string') return p;
  try { return JSON.stringify(p); } catch (_) { return String(p); }
}

export async function mtLog(tag, ...parts) {
  const line = `[${stamp()}] [${tag}] ${parts.map(fmtPart).join(' ')}`;
  // console は flag に関係なく常に出す
  try { console.log(line); } catch (_) {}
  // 初回呼び出し時にまだ flag をロード中なら待つ（race を避ける）
  if (!debugLoaded) {
    try { await loadDebugFlag(); } catch (_) {}
  }
  if (!debugEnabled) return;
  try {
    const { [KEY]: logs = [] } = await chrome.storage.local.get(KEY);
    logs.push(line);
    if (logs.length > MAX) logs.splice(0, logs.length - MAX);
    await chrome.storage.local.set({ [KEY]: logs });
  } catch (_) {}
}

export async function getLogs() {
  const { [KEY]: logs = [] } = await chrome.storage.local.get(KEY);
  return logs;
}

export async function clearLogs() {
  await chrome.storage.local.remove(KEY);
}
