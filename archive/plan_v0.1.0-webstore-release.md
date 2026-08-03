---
type: plan
status: done
tags: []
owner: 
review_status: draft
related: []
last_reviewed: 2026-07-04
---
# [完了] many-tab v0.1.0 Web Store リリース通し plan

## context配分

| ID | 種別 | 内容 |
|---|---|---|
| C1 | fix | 診断 hook 削減（content-main.js / background.js / popup.* から X 調査用コード削除） |
| C2 | fix | log buffer の縮小と debug flag 化（lib/logbuf.js） |
| C3 | fix | popup の debug UI を `<details>` 折りたたみに整理 |
| C4 | plan | README.md を「dev tool」フレーミングで全面書き直し |
| C5 | plan | chrome-tab-session-isolation-spec.md の MVP スコープ確定（IDB は将来課題に格下げ） |
| C6 | plan | PRIVACY.md を新規作成 |
| C7 | plan | アイコン作成（make-icon skill、icons/ ディレクトリ） |
| C8 | fix | manifest.json を v0.1.0 リリース用に整備 |
| C9 | plan | スクショ撮影段取り doc 作成（ユーザー手作業のため checklist 化） |
| C10 | plan | ZIP 化手順を docs にまとめる |
| C11 | plan | Web Store 申請フォーム文面を docs にまとめる |
| C12 | plan | 提出後対応（reject 時の GitHub OSS フォールバック手順） |

## 実行ルール（ultracode / 単一 agent 通し実行向け）

- **必ず C1 → C12 の順で実行**。前章の成果に後章が依存する箇所が多い（特に C1-3 整理後の構造に C8 が依存、C4-6 docs を C11 申請文面が引用）
- **並列実行禁止**: 同一リポなので 2 agent が同じファイルを編集すると競合する。1 つの agent が頭から順に進める
- 章単位で「[計画] → [実行中] → [様子見] or [完了]」を H1 ラベル相当として **本ファイルの「## 進捗トラッキング」表で管理**（章別に行）
- C7（アイコン）はユーザーがモチーフを確定済みの前提。未確定なら章冒頭で確認質問する（**それ以外の章は自律実行可**）
- C9 のスクショと C11-12 の最終提出はユーザー作業が混じる。AI 側は **ドキュメント・チェックリスト整備までを担当**し、実 submit は人間に委ねる
- 各章末に「変更ファイル」「検証方法」「次章への引き継ぎ事項（あれば）」を明示する

---

## C1 診断 hook の削減

### 背景

X.com の reload loop 調査のために `content-main.js` に大量の navigation hook を入れたが、X 対応は MVP スコープ外と確定。production 配布版にこれらを残すと:
- パフォーマンス劣化（全 navigation を hook、全 log を storage に書き込み）
- Web Store 審査で「過剰な権限・hooks」と見られるリスク
- コードベースが debug 漁ったまま

整理して core 機能（cookie 注入 + localStorage 仮想化）だけを表に出す。

### 対象ファイル

`content-main.js`

### 削除する hook（X 調査専用、production 不要）

- `Location.prototype.reload` / `.replace` / `.assign` hook
- `Location.prototype.href` setter hook（そもそも install 失敗してる）
- `Window.prototype.location` setter hook
- `Document.prototype.location` setter hook
- `History.prototype.go` hook
- `HTMLFormElement.prototype.submit` / `.requestSubmit` hook
- `HTMLAnchorElement.prototype.click` hook
- `HTMLElement.prototype.click` hook（anchor 経由のみログのやつ）
- 汎用 click イベント capture
- `window.open` hook
- Navigation API hook
- `<meta http-equiv=refresh>` MutationObserver
- `beforeunload` / `pagehide` イベントの詳細スタック付きログ
- `shortStack()` ヘルパー（上記専用）

### 残す（core）

- `document.cookie` getter/setter hook
- localStorage hook（`hookLocalStorage()` 一式）
- `__mt_init` / `__mt_update` イベントリスナ
- `__mt_boot` / `__mt_boot_ls` の sync 読み取り
- 最小限の起動ログ（`mainLog('injected at', ...)`、`hookLocalStorage installed`、`__mt_init received` 程度）

### 実装方針

コメントアウトではなく**削除**する（debug branch を別途切るより main を綺麗に保つ方針）。後日 X 対応再開時は git 履歴から復活させる。

### 完了条件

- `wc -l content-main.js` が概ね 200 行以下
- 通常ログには `[MT-MAIN] injected at ...` `[MT-MAIN] __mt_init received ...` 等しか出ない
- `node --check content-main.js` 通る

---

## C2 log buffer の縮小と debug flag 化

### 背景

`lib/logbuf.js` は MAX=2000 のリングバッファだが、通常使用時はログ不要。debug 時のみ有効化する。

### 対象ファイル

- `lib/logbuf.js`
- `background.js`

### 変更内容

- `lib/logbuf.js`: `MAX = 2000` → `MAX = 200`
- `mtLog()` 冒頭で module-local `let debugEnabled = false` を参照、`false` なら storage 書き込みスキップ（`console.log` は維持）
- 起動時 1 回 `chrome.storage.local.get('mtDebug')` で読み込み `debugEnabled` を設定
- 別途 export: `setDebugEnabled(bool)` / `getDebugEnabled()`
- `chrome.storage.onChanged` で `mtDebug` 変化を購読し runtime 反映

### `background.js` のログ呼び出し整理

- `[MT-BG]` の applyAssignment / setAssignment / applyTabRule done のような頻発ログは debug flag 下のみ（既存 mtLog そのまま、storage 書き込みが flag 制御されるので自動的に間引かれる）
- `MT-DIAG` (セッション指紋ダンプ) も debug flag 下のみ
- 重要なエラー (apply 失敗・permission missing 等) は `console.warn` を直接呼んで flag 関係なく出す

### 完了条件

- 通常使用時に `chrome.storage.local.get('__mt_logs')` が空 or 存在しない
- popup の Debug toggle ON にすると以降のログが記録される（C3 で UI 提供）
- `node --check lib/logbuf.js background.js` 通る

---

## C3 popup debug UI 整理

### 対象ファイル

- `popup.html`
- `popup.js`

### 残す（通常 UI）

- ドメイン追加
- セッション取り込み（lsCount 表示・⚠ 警告も維持）
- このタブに割り当て / 解除
- 緊急停止ボタン（reload loop 起きた時の保険、core 機能扱い）

### Debug section（折りたたみ）

`<details><summary>デバッグ</summary>...</details>` で折りたたみ:

- Debug log を有効化 toggle（チェックボックス、`chrome.storage.local.mtDebug` と双方向）
- ログ表示 textarea
- ログ更新 / コピー / クリア
- セッション全部ログに出す

トグル ON 後は「拡張をリロードしてください」と注意書き（既存 listener が立ち上がっているため）。

### 完了条件

- popup を開いた直後の見た目がスッキリ（通常 UI のみ）
- デバッグ折りたたみを開くと従来機能にアクセスできる
- toggle 切替で `chrome.storage.local.mtDebug` が変化することを popup 上から確認できる

---

## C4 README.md 全面書き直し

### 対象ファイル

`README.md`（既存なら上書き、無ければ新規）

### 構成（必須セクション）

```markdown
# many-tab

[1〜2 行の概要：同一 Chrome プロファイル内で、同じサイトの複数アカウントを別タブで同時にログイン状態に保つ拡張]

## 想定ユーザー
- マルチテナント SaaS の開発者・QA エンジニア
- 社内システム運用者
- self-hosted 系（Nextcloud / Gitea / Bitwarden 等）の利用者
- 自前 web app を持つ個人開発者

## 動作確認済み
[実テスト済みのものをリスト。初期はゼロでも OK]

## 対象外（動きません）
以下は IndexedDB / Service Worker / cross-domain SSO / 反 fraud により対応困難:
- X (Twitter)
- Google サービス全般（Gmail / Drive / GCP console 等）
- Instagram / TikTok / Facebook
- Slack / Discord
- Notion / Figma / Linear
- その他大手 SNS / SaaS の多く

これらに使うなら Chrome の「プロファイル」機能や、
Ghost Browser / Wavebox 等の専用ブラウザを推奨。

## インストール
- 開発版: GitHub から clone → chrome://extensions で「パッケージ化されていない拡張機能を読み込む」
- （Web Store 公開後はリンク追加）

## 使い方
1. 対象ドメインを追加（権限取得）
2. そのアカウントでログイン中の未割り当てタブから「取込」
3. 別タブを開いて「割当」→ リロード

## 仕組み（概要）
- declarativeNetRequest で per-tab に Cookie ヘッダを差し替え
- content script で document.cookie と localStorage を per-session 仮想化
- 100% ローカル、外部送信なし

詳細仕様: chrome-tab-session-isolation-spec.md

## 制限と注意
- 1 タブ 1 セッション
- ページの手動リロード後にセッションが反映される
- 取り込みは「そのアカウントでログイン中の未割り当てタブ」から
- セッション割り当て後の reload loop は自動検知して解除する

## ライセンス
MIT (LICENSE 参照)

## Privacy
PRIVACY.md 参照。100% ローカル、テレメトリなし、外部送信なし。
```

### 注意

- 「dev tool」「テスト用」を強調
- X / Google を**動かないもの一覧として明記**（Web Store reviewer 向け重要シグナル）
- Ghost Browser / Wavebox / Chrome Profile を**代替手段として推奨**（責任転嫁・誠実さアピール）
- 商標違反になる "X" / "Twitter" / 鳥ロゴは絶対使わない

### 完了条件

- README.md が新フォーマット
- `grep -i "twitter\|🐦" README.md` が空（商標漏れ確認）

---

## C5 spec の MVP スコープ確定

### 対象ファイル

`chrome-tab-session-isolation-spec.md`

### 更新内容

- §6 MVP スコープの「後回し」項に **「localStorage / IndexedDB / SW 経路の取りこぼし、X / Google 等の重い SPA 対応」** を明記し、将来課題として独立 section 化
- §3 設計上の制約に「**対象は軽い SPA（Cookie + localStorage で完結する web app）**」を追加
- §4.4 の MAIN ワールド content script の説明に「localStorage は完了、IndexedDB は将来課題」と現状を反映
- 新規 section: 「**動作対象/非対象**」を 1 セクション立てて C4 README の対象外リストと同じ内容を記載（spec 側は技術的理由も書く）

### 完了条件

- spec に「対象/非対象」section が追加されている
- §6 MVP スコープの将来課題が明文化されている

---

## C6 PRIVACY.md 新規作成

### 対象ファイル

`PRIVACY.md`（プロジェクトルート直下、新規）

### 内容

```markdown
# many-tab Privacy Policy

## データ収集と送信について

many-tab は **テレメトリ・アナリティクス・クラッシュレポート等を一切収集・送信しません**。

## ローカルストレージ

- 取り込んだ Cookie とセッション情報は `chrome.storage.local` にのみ保存され、
  ユーザーのブラウザ内に留まります。Google アカウントや他のクラウドへの同期は行いません。
- ドメインへの実行時権限は `chrome.permissions` で必要なものだけ取得します。
- 取り込んだ localStorage 内容も同様にローカル保存です。

## 外部送信

無し。本拡張は外部サーバーへの一切の通信を行いません。
DNR (declarativeNetRequest) によるリクエスト改変は、ユーザーが取り込んだ Cookie を
ユーザー自身が指定したドメイン向け HTTP リクエストに差し込むためのみに使用します。

## 第三者提供

無し。

## 連絡先

GitHub Issues: https://github.com/ishizakahiroshi/many-tab/issues
```

### 完了条件

- ファイルが配置されている
- Web Store 申請の Privacy policy URL として参照可能（GitHub に push 後）

---

## C7 アイコン作成

### 前提

ユーザーがモチーフを確定済みであること。**未確定の場合は本章冒頭で確認質問を出す**。

### 起動方法

`make-icon` skill を invoke する。引数（モチーフ・配色）は親会話または `## 進捗トラッキング` 表のメモ欄から取得。

### 出力先

`icons/` ディレクトリ（新規）:
- `icons/icon-16.png`
- `icons/icon-32.png`
- `icons/icon-48.png`
- `icons/icon-128.png`
- `icons/icon.svg` （マスター）

`D:\dev\tools\svg-to-icons.ps1` で svg → 全 PNG 一括生成（make-icon 標準フロー）。

### 注意

- X / Twitter / 鳥のアイコンを**絶対に使わない**（商標違反）
- 「アカウント切り替え」「複数人物」系も避けたい（multi-account 強調しすぎは Web Store 警戒）
- 「タブ」「ブラウザ window」「分岐」系の抽象モチーフが安全

### 完了条件

- icons/ に 4 サイズ PNG + svg が揃う
- C8 の manifest.json から参照されて chrome://extensions で表示確認できる

---

## C8 manifest.json 整備

### 対象ファイル

`manifest.json`

### 変更内容

1. **description 書き直し（132 文字以内、Web Store と同期）:**
   ```
   自社開発 web アプリ・社内システム・マルチテナント SaaS の動作確認用に、タブ単位で別アカウントの Cookie / localStorage を分離する開発支援拡張。100% ローカル、外部送信なし。
   ```

2. **icons / action.default_icon セクション追加:**
   ```json
   "icons": {
     "16":  "icons/icon-16.png",
     "32":  "icons/icon-32.png",
     "48":  "icons/icon-48.png",
     "128": "icons/icon-128.png"
   },
   "action": {
     "default_popup": "popup.html",
     "default_title": "Many Tab Session Isolator",
     "default_icon": {
       "16":  "icons/icon-16.png",
       "32":  "icons/icon-32.png",
       "48":  "icons/icon-48.png",
       "128": "icons/icon-128.png"
     }
   }
   ```

3. **permissions 見直し:**
   - 現在: `declarativeNetRequestWithHostAccess` / `cookies` / `storage` / `tabs` / `scripting` / `webNavigation`
   - 全て core 機能で必須なので削らない
   - `webNavigation` は circuit breaker (reload loop 検知) で使用

4. **version は `0.1.0` のまま**

5. **`optional_host_permissions`** は `*://*/*` で OK（実行時 user gesture で取得）

### 完了条件

- `chrome://extensions` で読み込んでバッジ・popup アイコンが表示される
- console エラー無し
- `node --check manifest.json` ... は JSON なので JSON.parse 確認に置き換え

---

## C9 スクショ撮影段取り doc

### 対象ファイル

`docs/local/screenshots-checklist.md`（新規）

### 内容

```markdown
# Web Store スクショ撮影チェックリスト

## 撮影サイズ
- 1280 x 800 px 推奨（640 x 400 でも可）
- PNG or JPG
- 最低 1 枚、最大 5 枚

## 撮影対象（候補・どれか 1〜3 枚）

### A. popup UI
- ドメイン追加 / セッション一覧 / 割り当て選択画面
- 「dev」「main」みたいな実在 SNS を連想させない名前を使う
  推奨: 「admin」「test-user1」「tenant-a」

### B. 動作中の様子（2 タブ並列）
- 何らかの軽い web app（社内システム風）の admin タブと一般 user タブを並べる
- **絶対に X / Gmail / Instagram 等を映さない**
- 候補:
  - 自前テスト用に建てた静的 web app
  - Nextcloud のデモインスタンス
  - GitLab / Gitea
  - 適当な掲示板アプリ（社内テスト環境）
  - 自作の Hello world 多 tenant アプリ

### C. spec の図解（あれば）
- アーキテクチャ図を画像化

## 撮影後
- `store-screenshots/` ディレクトリを作って配置（gitignored で OK）
- C11 で Web Store 申請時にアップロード
```

### 完了条件

- ファイルが配置されている

---

## C10 ZIP 化手順 doc

### 対象ファイル

`docs/local/release-zip-howto.md`（新規）

### 内容

```markdown
# v0.1.0 ZIP 化手順

## ZIP に含めるファイル
- manifest.json
- background.js
- popup.html / popup.js
- content-main.js / content-isolated.js
- lib/ 配下（cookies.js / dnr.js / sessions.js / logbuf.js）
- icons/ 配下（PNG・svg）
- LICENSE
- PRIVACY.md
- chrome-tab-session-isolation-spec.md

## ZIP から除外
- docs/ 全部
- node_modules/ / build/ / dist/
- *.zip / *.crx / *.pem
- .git/
- .claude/ / .codex-tmp/
- README.md（GitHub 用、Web Store 説明文は別管理）

## 作成コマンド (PowerShell)

\`\`\`powershell
Remove-Item -Path "many-tab-v0.1.0.zip" -Force -ErrorAction SilentlyContinue
Compress-Archive -Path manifest.json, background.js, popup.html, popup.js, content-main.js, content-isolated.js, lib, icons, LICENSE, PRIVACY.md, chrome-tab-session-isolation-spec.md -DestinationPath many-tab-v0.1.0.zip
\`\`\`

## 検証
- ZIP を展開して manifest.json がルートに来ているか
- ZIP の中に .git / docs / node_modules が混入していないか
- ZIP サイズが 10MB 以下
```

### 完了条件

- doc が配置されている。実際の ZIP 作成は C11 段で実行 or ユーザー実行

---

## C11 Web Store 申請文面 doc

### 対象ファイル

`docs/local/webstore-submission-fields.md`（新規）

### 内容

各申請欄に貼り付ける文面のテンプレート。

```markdown
# Web Store 申請フォーム文面（v0.1.0）

申請 URL: https://chrome.google.com/webstore/devconsole

## Item summary (132 文字以内)
自社開発 web アプリ・社内システム・マルチテナント SaaS の動作確認用に、
タブ単位で別アカウントの Cookie / localStorage を分離する開発支援拡張。

## Detailed description
[ここに C4 README の主要セクションを再構成して貼る。

主要要素:
- 想定ユーザー（dev / QA / 社内 / self-hosted）
- 機能
- 動作確認済み環境
- 対象外（X / Google / Instagram / TikTok / Facebook / Slack / Discord / Notion / Figma / Linear）
- 代替推奨（Chrome Profile / Ghost Browser / Wavebox）
- ソース URL
- Privacy URL]

## Category
Developer Tools

## Single Purpose
A developer tool that isolates browser sessions per-tab using cookie injection
and localStorage virtualization, enabling QA testing of multi-tenant applications
without account switching.

## Permissions justification (各 permission ごと)

| permission | justification |
|---|---|
| declarativeNetRequestWithHostAccess | Per-tab cookie header injection for session isolation. Hosts are user-granted at runtime only. |
| cookies | Capturing the user's existing cookies for a domain to create a named session snapshot. |
| storage | Storing user-created session definitions locally. |
| tabs | Reading the active tab's URL/id to associate sessions with tabs. |
| scripting | Injecting the session bootstrap data into newly committed pages so virtualization is in place before page scripts read storage. |
| webNavigation | Detecting same-URL reload loops on assigned tabs to auto-recover by un-assigning the session. |
| optional_host_permissions: <all_urls> | Not requested at install time. Only granted at runtime when the user explicitly adds a domain via the popup. |

## Privacy policy URL
https://github.com/ishizakahiroshi/many-tab/blob/main/PRIVACY.md

## Data usage declarations
- Personally identifiable information: Yes (cookies/localStorage may contain it)
- Authentication information: Yes (cookies may contain auth tokens)
- Website content: No
- Location: No
- Sold or transferred to third parties: No
- Used for unrelated purpose: No
- Used to determine creditworthiness: No
```

### 注意

- **Authentication information を取り扱うことを隠さない**のが審査通過のポイント
- 「ローカル限定」「外部送信なし」は強くアピール

### 完了条件

- doc が配置されている。実際の submit はユーザー手作業

---

## C12 提出後対応 doc

### 対象ファイル

`docs/local/webstore-post-submit-playbook.md`（新規）

### 内容

```markdown
# Web Store 提出後対応プレイブック

## 想定パターン

### A. 一発で approve（数日〜2 週間）
- Web Store 公開リンク発行
- GitHub README に Web Store バッジ追加
- → リリース成功

### B. 1 回 reject + 軽微修正で resubmit
よくある reject 理由:
- permission justification 不足 → C11 文面を見直し再記入
- description が他拡張と類似 → 用語を変える
- icon が他拡張と似ている → 微修正（C7 やり直し）
- single purpose が複数機能に見える → 説明を 1 機能に絞る

修正して resubmit。基本 1〜2 回で通る想定。

### C. 連続 reject（3 回以上）or "Authentication circumvention" を理由にされる
ポリシー違反扱い、Web Store では難しい。GitHub OSS 公開に切替:

1. GitHub releases から v0.1.0 タグを切って ZIP を asset として添付
2. README に「Web Store 公開を断念、unpacked install で利用してください」追記
3. unpacked install 手順を README に詳述（chrome://extensions の Developer Mode → 「パッケージ化されていない拡張機能を読み込む」→ プロジェクトルート選択）

## 提出ログ記録欄

このファイル末尾に追記:

- YYYY-MM-DD: submit #1 → result: ?
- YYYY-MM-DD: submit #2 → result: ?
```

### 完了条件

- doc が配置されている

---

## 進捗トラッキング

各章を実行するたびに状態を更新。`[完了]` になったら 1 行下に補足を書ける。

| 章 | 状態 | 補足（変更 PR / commit / 注意点） |
|---|---|---|
| C1 診断 hook 削減 | [完了] | content-main.js を 414→190 行へ。navigation hook 群・shortStack・meta refresh observer・beforeunload/pagehide 全削除。core (cookie + lsHook) のみ残置 |
| C2 log buffer 縮小 | [完了] | MAX 200・mtDebug flag 化・setDebugEnabled/getDebugEnabled export・storage.onChanged 連動。background.js の致命系 4 箇所に console.warn 直呼び併用 |
| C3 popup debug UI | [完了] | 緊急停止を独立 section に昇格、デバッグ系を details に格納、Debug log 有効化 toggle 追加、details 開閉時のみ logs を fetch |
| C4 README | [完了] | dev tool フレーミングで全面書き直し。対象外サービス列挙＋代替推奨。grep -i twitter/🐦 空を確認 |
| C5 spec 更新 | [完了] | §3 末に「対象は軽い SPA」追加、§3.5 動作対象/非対象 新設、§4.4 を v0.1.0 実装状況に更新（localStorage 完了 / IndexedDB 未対応）、§6 後回しを明文化、§6.6 将来課題 4 項目を独立 section 化 |
| C6 PRIVACY | [完了] | テレメトリなし・ローカル限定・外部送信なしを明文化。連絡先 GitHub Issues。Web Store 提出時の Privacy URL として参照可能 |
| C7 アイコン | [完了] | icon.svg + icon-16/32/48/128.png 生成。暗ティール背景に白親タブ＋ゴールド Y 字分岐＋白子タブ 2 つ。四隅透過確認済 (alpha=0)。商標フリー |
| C8 manifest | [完了] | description 105 文字 (132 以内)、icons / default_icon 4 サイズ追加、permissions 維持、version 0.1.0、JSON.parse 確認 |
| C9 スクショ checklist | [完了] | 1280x800 推奨、popup UI/2 タブ並列/アーキ図/拡大/デバッグの 5 案、撮影前チェック・命名規則・撮影ログ欄を整備 |
| C10 ZIP 手順 doc | [完了] | 含めるファイル / 除外 / Compress-Archive コマンド / 検証手順 / トラブルシューティング表 |
| C11 申請文面 doc | [完了] | item summary / detailed description / single purpose / permissions justification 表 / privacy URL / data usage 表 / 申請前チェックリスト |
| C12 提出後対応 doc | [完了] | パターン A 一発 approve / B 軽微 reject / C 連続 reject + GitHub OSS フォールバック・提出ログ表・補足 tips |

## 受け入れ条件（親 plan 全体）

- C1〜C10 が `[完了]`
- C11-C12 の doc が配置済み
- ユーザーが手作業で実行する後続タスク（スクショ撮影・実 submit）に必要な情報が docs に揃っている

実 Web Store submit の成否は本 plan の範囲外（C12 の playbook に従う）。

## 構造再編メモ（2026-06-30 追記）

本 plan 完了後、`chrome-webstore-publish` skill 化に伴い docs と scripts を always-pinned 流に再編した:

- `scripts/validate-extension.ps1` + `scripts/package-webstore.ps1` を追加（旧 `docs/local/release-zip-howto.md` の手順を機械化）
- `docs/store/listing.{ja,en}.md` / `privacy-policy.{ja,en}.md` / `submission-notes-v0.1.0.{ja,en}.md` を追加（旧 `docs/local/webstore-submission-fields.md` を分解・bilingual 化）
- `CHANGELOG.md` (Keep a Changelog) と `docs/release-notes-v0.1.0.md` を追加
- 旧 `docs/local/release-zip-howto.md` と `docs/local/webstore-submission-fields.md` は削除（役割が新ファイル群に移ったため）
- 残存する `docs/local/`: 本 plan / `screenshots-checklist.md`（実用 checklist）/ `webstore-post-submit-playbook.md`（reject 対応 playbook）

次回以降のリリース手順は `chrome-webstore-publish` skill を `mode=release version=vX.Y.Z` で起動する。詳細は `D:/dev/workshop/skills/chrome-webstore-publish/SKILL.md` を参照。
