---
type: bugfix
status: watching
tags: []
owner: 
review_status: draft
related: []
last_reviewed: 2026-07-04
---
# [様子見] content script デバッグ: context-invalidated と not-assigned

> 最終更新: 2026-06-21(日) 22:30:58

## 症状

2 タブ 2 アカウントを分離する MVP の実機確認で 2 つの障害が発生している。

**症状A — "Extension context invalidated"**
- `content-isolated.js:28` で `Uncaught Error: Extension context invalidated.` が発生
- 拡張機能をリロードしたあと、古い content script が残ったページで X の JS が `document.cookie` を書くと発火する

**症状B — getTabSession が not_assigned を返す**
- `content-isolated.js` 起動時の `getTabSession` に対して SW が `{ ok: false, reason: 'not_assigned' }` を返す
- MAIN world の `__mt_init` が受信されず、Cookie hook が session 値を持てない
- `__mt_set` は発火している（MAIN の `session` は non-null = どこかで `__mt_init` は届いた）

## 根本原因

**症状A**
- `chrome.runtime.sendMessage` は extension context 無効時に **同期 throw** する
- `.catch()` は同期 throw を捕まえられない
- 初回修正（前セッション）: `sendMessage` を `try { sendMessage(...).catch(...) } catch {}` で包んだが不十分だった
- **根本的な原因（2026-06-21 確定）**: 拡張機能をリロードしても既存タブの content script は「ゾンビ」として残る。
  ゾンビが持つ `__mt_set` リスナーが `chrome.runtime.*` を呼ぶと throw する。
  try-catch は「新しいコードを含む場合」にしか効かず、旧ゾンビは無防備なため "Uncaught" になり続ける。
- **抜本修正（2026-06-21 実施）**: 自己修復パターンを採用。
  ISOLATED は context gone を検知したらリスナーを除去し `__mt_iso_dead` イベントを dispatch。
  MAIN は `__mt_iso_dead` を受け取って `isoAlive = false` にし、以降 `__mt_set` を dispatch しない。
  ゾンビが残っていても最初の1回のエラー（catch 済み）で完全にサイレントになる。
- **残存バグ（2026-06-21 修正）**: `chrome.runtime.onMessage.addListener` が外側の try-catch に含まれておらず、
  `await getTabSession` 後に context が失効した場合に Uncaught になるケースが残っていた。
  async IIFE 全体を外側 try-catch で包むことで根絶。
- **デバッグ時の注意（2026-06-21 確認）**: ファイルを変更しただけでは Chrome は新しいコードを使わない。
  `chrome://extensions` で拡張機能の「再読み込み」を押した後にページをリロードすること。
  Shift+F5 はページキャッシュのみクリア。拡張機能のスクリプトは更新されない。
  （エラーが常に同じ行番号で出ていた理由: 古いコードが動き続けていた）

**症状B — 根本原因と修正（2026-06-21 実施）**

原因①: `applyTabRule`（DNR ルール登録）が throw すると、その後の `setAssignment` が呼ばれなかった。
- DNR ルール登録に失敗 → assignment が storage に保存されない → ページリロード時に `not_assigned`

修正: `setAssignment` を `applyTabRule` より前に移動、`applyTabRule` を try-catch で包んで
assignment 保存の失敗を阻まないよう変更（storage を正本とする設計）。

原因②: `popup.js` の `assign-btn` ハンドラが `render()` 時点のキャッシュ `activeTab` を使っており、
popup を開いたままユーザーがタブを切り替えると、割り当て対象が古いタブになっていた。

修正: `assign-btn` クリック時に `getActiveTab()` を再取得して最新タブを使うよう変更。

## 修正内容（実施済み）

| 日付 | ファイル | 変更内容 |
|------|----------|----------|
| 2026-06-21 | `content-isolated.js` | async IIFE 全体を外側 try-catch で包んだ（`onMessage.addListener` 等が context invalidated で throw しても Uncaught にならない） |
| 2026-06-21 | `content-isolated.js` | `__mt_set` を名前付き関数 `handleMtSet` に変更。context gone を catch したらリスナー自己撤去 + `__mt_iso_dead` dispatch |
| 2026-06-21 | `content-main.js` | `isoAlive` フラグ追加。`__mt_iso_dead` 受信で `false` に。`__mt_init/update` 受信で `true` に戻す。setter は `isoAlive` を確認してから dispatch |
| 2026-06-21 | `background.js` | `applyAssignment`: `setAssignment` を `applyTabRule` より前に移動、`applyTabRule` を try-catch で包んだ。診断 console.log を各ステップに追加 |
| 2026-06-21 | `popup.js` | `assign-btn` クリック時に `getActiveTab()` を再取得（render 時キャッシュを使わない）|
| 前セッション | `content-isolated.js` | `getTabSession` の `sendMessage` を try-catch で囲んだ |
| 前セッション | `background.js` | `getTabSession` ハンドラに `JSON.stringify(assignments)` ログを追加 |
| 前セッション | `background.js` | reconcile を `session_not_found` 以外では removeAssignment しない設計に変更 |
| 前セッション | `popup.js` | `tab-host` 表示に `(id:N)` を追加、割り当て成功メッセージ追加 |
| 2026-06-21 | `background.js` | `applyAssignment` から `sessionUpdated` push を削除（チカチカループ防止・初回修正） |
| 2026-06-21 | `lib/dnr.js` | `RESOURCE_TYPES` から `main_frame` と `sub_frame` を削除（サーバーサイドリダイレクトループ防止・根本原因①修正） |
| 2026-06-21 | `content-main.js` | localStorage オーバーレイ追加（`hookLocalStorage()` + `lsOverride` Map）（X.com twid 不整合リロードループ防止・根本原因②修正） |
| 2026-06-21 | `content-isolated.js` | `handleMtSet` を `async/await` + 内部 async IIFE に変更（Chrome 拡張 API の二重 rejection が `.catch()` を抜けて Uncaught になる問題を根絶・症状E修正） |
| 2026-06-21 | `lib/dnr.js` | `applyTabRule` で `x-csrf-token` ヘッダも `operation:"set"` で Session B の `ct0` に上書き（ct0 タイミング不一致による 403 を防止・症状D修正） |

**症状C — チカチカリロードループ（2026-06-21 実施）**

根本原因は 2 つあった。最初の修正（`sessionUpdated` push 削除）は不十分で、チカチカが継続した。

**根本原因①: `main_frame` を DNR RESOURCE_TYPES に含めていた**
- ページナビゲーション（`main_frame`）に Session B の Cookie を注入すると、サーバーが
  2FA フロー等の 302 リダイレクトを返したとき、DNR が再び Session B の Cookie を注入する。
  同じリダイレクトが繰り返され高速チカチカループになる。
- さらに `main_frame` の `Set-Cookie` レスポンスが Account A のネイティブ Cookie jar を
  Session B のサーバー発行 Cookie で上書きしてしまう副作用もある。

修正: `lib/dnr.js` の `RESOURCE_TYPES` から `main_frame` と `sub_frame` を削除。
API 呼び出し（`xmlhttprequest` / `fetch` / `websocket` 等）のみ差し替えれば
X.com のタイムライン表示には十分。

**根本原因②: X.com の `localStorage.twid` と Session B の API ユーザーID が食い違う**
- X.com は `localStorage` に Account A のユーザーID（`twid` 等）をキャッシュしている。
- DNR で Session B の Cookie に差し替えると API が Session B のユーザーIDを返す。
- X.com がこの不整合を検知して `window.location.reload()` を発行。
- リロードしても `localStorage` は origin 共有なので Account A のデータが残り続け、
  Session B の Cookie が再び注入されるとまた不整合 → リロードループ。

修正: `content-main.js` に localStorage オーバーレイを追加。
- `__mt_init` 受信時（セッション割り当てが確定したとき）に `hookLocalStorage()` を呼ぶ。
- `hookLocalStorage()` は既存の全 localStorage キーを収集し、`lsOverride` Map で null にシャドウ。
- 以降、このタブの `localStorage.getItem` は `lsOverride` を優先するため Account A のキャッシュが見えない。
- `localStorage.setItem` はオーバーレイにのみ書き込む（ネイティブには書かず他タブを汚染しない）。
- X.com が Session B の API から取得した値を `localStorage` に書き直すと `lsOverride` に入り、
  以降は整合した Session B のデータとして読み返される → リロードループが止まる。

初回修正（不十分だったもの）: `applyAssignment` からの `sessionUpdated` push を削除。
- 割り当て後は popup の案内（"ページを再読み込みすると反映されます"）に従ってユーザーが手動リロード
- リロード時は `content-isolated.js` の `getTabSession` が自動初期化する経路が正本
- `unassignTab` の push（null cookies でネイティブに戻す）は意図的な操作のため残す

**症状D — 403 Forbidden / codes:[353]（2026-06-21 実施）**

X.com の API 呼び出し（`api.x.com`）が 403 を返す。ログで localStorage hook と `__mt_init` 受信は確認できており、Cookie 差し替え自体は動いている。

**根本原因: ct0 / x-csrf-token の不一致（タイミング競合）**

X.com の JS は `document.cookie` から `ct0` を読んで `x-csrf-token` リクエストヘッダに使う。
この読み取りは `__mt_init` が届く前（つまり `session = null` のとき）に行われることがある。
`session = null` のとき `document.cookie` getter は Account A のネイティブ Cookie を返すため、
X.com が `x-csrf-token` に Account A の `ct0` をキャッシュしてしまう。
DNR は Cookie ヘッダを Session B に差し替えるため、`Cookie: ct0=<B>` と `x-csrf-token: <A>` が不一致になり
サーバーが CSRF 検証に失敗して 403（codes:[353]）を返す。

**修正: DNR で `x-csrf-token` も Session B の `ct0` で上書き**

`lib/dnr.js` の `applyTabRule` を修正。`cookieHeader` から `ct0` を正規表現で抽出し、
`x-csrf-token` ヘッダも `operation: "set"` で Session B の値に強制上書きする。
これにより X.com が初期キャッシュ時にどの Account の `ct0` を読んでいても、
実際の API リクエストでは両者が Session B で一致する。

**症状E — content-isolated.js:28 で "Uncaught Error: Extension context invalidated"（2026-06-21 実施）**

症状A の亜種。行番号が 28（`handleMtSet` 内の `try {`）で発生。

**根本原因: Chrome 拡張 API の二重 rejection**

`chrome.runtime.sendMessage` は拡張機能コンテキスト消滅時に **同期 throw** と **Promise rejection** を
二重に発行することがある。`.catch()` チェーンは同期 throw を捕まえないため "Uncaught" として漏れる。
`async/await` の `try/catch` は同期 throw も async rejection も同一の catch ブロックで捕まえるため、
このパターンが唯一の完全な解。

**修正: `handleMtSet` を `async/await` + 内部 async IIFE に変更**

`handleMtSet` 内で `(async () => { try { ... } catch {} })()` パターンを使い、
`sendMessage` を `await` する。これで二重 rejection の両方を同一 catch が捕捉する。

## 変更ファイル

- `content-isolated.js`
- `content-main.js`
- `background.js`
- `popup.js`
- `lib/dnr.js`

## 検証

### 症状A の確認手順
1. 拡張機能をリロード
2. x.com タブをリロード（または新規で開く）
3. DevTools コンソールを **クリア** （Ctrl+Shift+J → Clear）
4. x.com を操作（スクロール等、`document.cookie` が書かれるアクション）
5. "Uncaught Error: Extension context invalidated" が **出なければ修正完了**
6. 出た場合: paste してもらいエラー行を確認する（`__mt_set skipped` が代わりに出ていれば catch が効いている）

### 症状B の確認手順（修正後の動作確認）
1. 拡張機能をリロード
2. `chrome://extensions` → many-tab → サービスワーカー「検査」→ Console タブを開く
3. popup でドメイン追加 → セッション capture → **割り当てたいタブをアクティブにしてから** 割り当てボタンをクリック
4. SW コンソールに以下が揃って出ることを確認：
   ```
   [MT-BG] applyAssignment tabId: N sessionId: ... domain: ... cookieLen: N
   [MT-BG] setAssignment done
   [MT-BG] applyTabRule done   ← 失敗時は [MT-BG] applyTabRule failed (assignment kept): ...
   ```
5. 対象タブをリロード → content script コンソールに以下が出ることを確認：
   ```
   [MT-ISO] getTabSession resp outer ok: true  result.ok: true  cookies first60: ...
   [MT-MAIN] __mt_init received, first60: ...
   ```
6. `applyTabRule failed` が出た場合は DNR 登録が問題。assignment は保存されているため
   `getTabSession` は成功するはず。DNR の失敗理由（`e.message`）を確認する

## 現在のアーキテクチャ（メモ）

```
popup.js
  └─ assignTab（クリック時に activeTab を再取得して最新タブを使う）
       └─ background.js: applyAssignment
            ├─ getSession → session が無ければ abort
            ├─ hasHostPermission → 権限なければ abort（assignment を保存しない）
            ├─ setAssignment（storage に tabId → sessionId 保存）← 先に保存（正本）
            ├─ applyTabRule（DNR セッションルール登録）← try-catch、失敗してもassignmentは残る
            └─ setBadge
            ※ sessionUpdated push は削除（mid-flight 切替がリロードループを引き起こすため）

lib/dnr.js
  └─ RESOURCE_TYPES: main_frame / sub_frame を除外（サーバーサイドリダイレクトループ防止）
     API 呼び出し（xmlhttprequest / fetch / websocket 等）のみを差し替える
  └─ applyTabRule: Cookie ヘッダと x-csrf-token ヘッダを両方 Session B に揃える
     （ct0 タイミング競合による CSRF 403 防止）

content-isolated.js (ISOLATED world)
  ├─ 起動時: getTabSession → background.js → assignments[tabId] があれば cookies を返す
  │    → __mt_init を MAIN world に dispatch
  ├─ onMessage(sessionUpdated) → __mt_update を dispatch
  └─ window.on(__mt_set) → cookieWritten を SW へ中継

content-main.js (MAIN world)
  ├─ document.cookie getter: native + session Cookie をマージして返す
  ├─ document.cookie setter: session キーならインターセプト → __mt_set を dispatch
  └─ localStorage overlay（__mt_init 時に hookLocalStorage() 呼び出し）:
       - 既存キーを全て null でシャドウ（Account A のキャッシュを隠す）
       - 書き込みはオーバーレイ Map のみ（ネイティブ localStorage を汚染しない）
       - X.com が Session B のデータを取得してオーバーレイに書き込むと整合し reload ループが止まる
```

### 症状D・E の確認手順（修正後）

1. `chrome://extensions` で拡張機能を「再読み込み」
2. x.com タブをリロード（ゾンビ解消のため必須）
3. DevTools コンソールをクリア
4. 正常なケース（症状E 解消）:
   - 拡張機能を再度リロードしてもコンソールに "Uncaught Error: Extension context invalidated" が出ない
   - `[MT-ISO] context gone, killing bridge:` が出て静かに終わる
5. 正常なケース（症状D 解消）:
   - タイムライン API（`api.x.com` 宛）が 403 にならず Session B のデータを返す
   - Network タブで `x-csrf-token` リクエストヘッダが Session B の `ct0` 値になっていることを確認
   - Session B のタイムライン（アカウント B の投稿）が表示されれば成功

### 症状C の確認手順（修正後）

1. `chrome://extensions` で拡張機能を「再読み込み」
2. x.com タブを 2 枚開き、それぞれ別セッションを割り当て
3. 各タブを手動リロード（または新規タブで x.com を開く）
4. タブのコンソールで以下が出ることを確認:
   ```
   [MT-MAIN] localStorage hook installed, shadowed N keys
   [MT-MAIN] __mt_init received, first60: ...
   ```
5. 両タブで異なるアカウントのタイムラインが表示され、チカチカ・連続リロードが止まることを確認
6. 片方のタブを操作（スクロール等）しても、もう一方が影響を受けないことを確認

## 備忘

- `handleMessage` のラッパー構造: `{ ok: true, result: <返り値> }` でラップ
  → content script 側は `resp.result.ok` と `resp.result.cookies` を見る
- `buildCookieHeader` は `Cookie` ヘッダ形式（`name=value; name2=value2`）の文字列を返す
- `__mt_set` が発火 = MAIN の `session` が non-null = `__mt_init` は届いた = `not_assigned` でも
  `sessionUpdated` push が届いた可能性あり（先に open していたタブ？）
- reconcile は extension reload 時に `session_not_found` 以外は assignment を消さない
  → reload 後も assignments は残る → `getTabSession` は not_assigned を返さないはず
  → ということは assignment が最初から入っていない可能性が高い
