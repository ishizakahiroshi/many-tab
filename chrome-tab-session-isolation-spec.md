# Chrome タブ単位セッション分離拡張 — 設計仕様（Claude Code 引き継ぎ用）

## 0. このドキュメントについて
- Claude Code に渡して実装するための設計サマリ。チャットで確定した内容を集約したもの。
- **実装着手前に「§9 実装着手前の確認事項」を必ず読むこと。** 記憶/推測で API 仕様や Cookie 名を決め打ちせず、着手時点の最新ドキュメントを確認してから固める。

---

## 1. 目的 / コンセプト
- 同一 Chrome プロファイル・同一ウィンドウのまま、**同じサイトの複数アカウントを別タブで「同時に」ログイン状態に保つ**拡張（Manifest V3）。
- **X 専用ではなく汎用。** X は動機となったユースケースの一例にすぎない。対象ドメインはユーザーが指定する。
- 要件は **"本物の同時分離"**。Cookie スワップ式（タブ切替時に Cookie を入れ替える方式）は **不可** — 裏タブが間違ったアカウントで動くため。各タブが自分のセッションの Cookie を送り、複数アカウントが並行して生きている状態を作る。

---

## 2. 既存ツールとの差別化（なぜ自作するか）
既存ツールは2択しかない:
- **(a) クローズド + クラウド同期/課金**（SessionBox, Send.win 等）= 認証情報を他人のサーバに預ける不安がある。
- **(b) OSS だがスワップ式**（multiAccounts: `anilkumarum/multi-accounts` 等）= 本物の同時分離ができず、対応サイトも限定的。

本ツールの位置 = **「OSS で中身が見える × 本物の同時分離 × 権限は触る分だけ」**。この組み合わせは未充足。

**参考実装（※コードはコピーしない。設計理解のみ）:** MultiLogin Tabs（クローズド）が同アーキテクチャの動作を実証済み — HTTP(Set-Cookie)/JS(document.cookie) 両方の Cookie をセッション単位で横取り、localStorage をセッション名前空間化、IndexedDB の DB 名をセッションごとにプレフィックス。
→ **クリーンルーム再実装。proprietary なコードは1行も持ち込まない。** 著作権が守るのはコード（表現）であって、手法・アイデアではない。設計の正しさの確認材料としてのみ使う。

---

## 3. 配布前提（設計判断の背景）
- **Chrome Web Store 公開予定**（開発者登録済み）。
- **100% ローカル / テレメトリなし / クラウド同期なし。** Cookie・セッションはブラウザ外に一切出さない。→ 信頼性と審査通過の両方のため。
- 後述の最小権限設計は、"Cookie を読む拡張" が審査と install 時の信頼で詰まりやすい所を意図的に外すための選択。
- ニッチユーティリティである前提（開発者/パワーユーザー向け、爆発的には伸びない）。**勝負どころは宣伝ではなく §6 のストレージ分離の作り込みの質。**
- **対象は軽い SPA — Cookie + localStorage で認証・UI 状態が完結する web app**（自前 dev / 社内システム / マルチテナント SaaS / self-hosted など）。IndexedDB / Service Worker / cross-domain SSO / 反 multi-account 検知に強く依存するサービス（X / Google / 主要 SNS 等）はスコープ外（→ §3.5）。

---

## 3.5 動作対象 / 非対象

ユーザー向けの対象/非対象一覧と代替推奨は README に集約してある（fresh public clone でユーザーが最初に読むため）。本 spec ではそれぞれが**技術的に**なぜそうなるかを補足する。

### 対象（想定が成立する）

- Cookie のみで認証する web app（社内システム・自前 dev サーバー・古めの管理画面など）
- Cookie + localStorage で動く軽い SPA（マルチテナント SaaS の dev / QA、self-hosted の Nextcloud / Gitea / Vaultwarden 等）
- 拡張がドメインを追加してから使うため、ユーザーが「対象である」と知ったうえで権限付与する形に閉じる

### 非対象（本拡張の方式では分離できない）

- **X / Google / 主要 SNS / 大手 SaaS:**
  - IndexedDB に auth state / UI state を持つ（§4.4 が現状 localStorage しかカバーしていない）
  - Service Worker が origin 単位で 1 個動き、SW 発の fetch は `tabId === -1` で DNR タブ条件を素通りする（§5）
  - cross-domain SSO（accounts.google.com → mail.google.com 等）で複数オリジンに跨るため、ドメイン単位の Cookie 分離では足りない
  - 反 fraud / 反 multi-account の検知が走り、Cookie / localStorage の組み合わせや fingerprint で異常を検知して強制ログアウト or 同 URL リロードループに陥る
- **書き込み系の安定運用（投稿 / DM）:**
  - CSRF トークン（X の `ct0` 等）が定期ローテーションする。閲覧は堅牢、書き込みは脆い（§5）。

### 代替推奨

ユーザー向けには README に列挙: Chrome プロファイル / Ghost Browser / Wavebox / ブラウザ使い分け。これらは fingerprint レベルで分離するため上記制約を回避できる。本拡張は「同一プロファイル内で軽く済ませたい」狭いユースケースを担当する。

---

## 4. アーキテクチャ

### 4.1 権限モデル（肝）
- **install 時に広い `host_permissions` を要求しない**（「全サイトのデータを読み書き」警告 + 審査の疑念を回避）。
- 代わりに:
  - manifest に `declarativeNetRequestWithHostAccess`（プレーンな `declarativeNetRequest` ではなく — 同じヘッダ改変能力を持ちつつ host 権限の警告ポップアップを出さない。host 権限自体は必要）。
  - `optional_host_permissions` を使い、ユーザーが popup でドメインを追加したときに `chrome.permissions.request({ origins: ["*://<domain>/*"] })` で**そのドメインだけ実行時許可**を取る。
  - `permissions.getAll()` で付与状況を確認、`permissions.onAdded` / `permissions.onRemoved` で内部状態を同期。
- **検証済み事実:** DNR でヘッダを改変するには対象リクエストの host 権限が必須。これを実行時付与の host 権限で充足する。

### 4.2 Cookie 層の分離（コア / 実装の中心）
- DNR の **session ルール**（タブ単位は tabId が再起動で変わるため in-memory が適切。永続が要る設定値は dynamic ルール or `chrome.storage` 側に）を **tabId 条件 + ドメイン条件**付きで張り、送信リクエストの `Cookie` ヘッダを、そのタブに割り当てたセッションの Cookie セットで **`set`（=置換）** する。
  - `set` で置換するので、ブラウザ共有の本物 Cookie はそのリクエストに乗らない。
  - MV3 で Cookie リクエストヘッダの set/remove/append は可能（`cookie` は append 許可リストにも含まれる）。
- **"ドメイン丸ごと" を分離する:** そのセッションの全 Cookie を注入し、本物は外す。→ どれが認証 Cookie かを知る必要がなく、**サイト非依存**になる。X の `auth_token`/`ct0` 等を知る必要がない。
  - **「特定の Cookie だけ注入する」狭い実装にしないこと**（汎用性が落ちる）。
- ルールのライフサイクル: タブをセッションに割り当てた時（かつ当該ドメインの許可付与後）にルール登録 → タブ閉/再割り当てで撤去・更新。
- セッション識別の主体は Cookie。サーバが返すアカウントは Cookie で決まるので、**この層だけで「タブごとに別アカ」が成立する核**になる。

### 4.3 セッションの取得（ログイン時 Set-Cookie 捕捉問題の回避）
- ログイン時の `Set-Cookie` をライブ捕捉する設計は複雑なので**避ける**。
- 代わりに: セッション取得は**手動の一回取り込み**。普通にログインした状態で、`chrome.cookies` でそのドメインの現在の Cookie セットをスナップショットし、**名前付きセッション**として保存。
- 以後はそのセッションの Cookie を DNR で注入するだけ。

### 4.4 JS ストレージ層の分離（v0.1.0 実装状況）
- DNR はネットワーク層 = Cookie のみ。JS から触る `localStorage` / `sessionStorage` / `document.cookie` / `indexedDB` はネットワーク層では分離できない。
- 必要: `document_start` で **MAIN ワールド（`world: "MAIN"`）** のコンテンツスクリプトを注入し、上記 API を monkeypatch して、キー / DB 名を**セッション単位で名前空間化**する。
  - MAIN ワールド必須の理由: 通常のコンテンツスクリプトは isolated world で動き、ページ自身のスクリプトが見る `document.cookie` / `localStorage` を上書きできない。
  - **タイミング勝負:** ページ自身のスクリプトより先に差し込む必要があり、重い SPA では難しい。
- **v0.1.0 時点の実装:**
  - `document.cookie` getter/setter — **実装済み**（MAIN world で hook、session 由来の Cookie を merge して返す。session キーへの set は overlay のみ更新、それ以外は native に流す）
  - `localStorage` 一式（`getItem`/`setItem`/`removeItem`/`clear`/`key`/`length`）— **実装済み**（per-session overlay、書き込みは `chrome.storage.local` の `lsSnapshot` に永続化）
  - `sessionStorage` — 未対応（タブ寿命と一致するため実害が少ないと判断、要件出てから）
  - `indexedDB` — **未対応（将来課題）**。本拡張の方式で X / Google などが分離しきれない最大の理由。`IDBFactory.prototype.open` を hook して DB 名にセッションプレフィックスを付ける必要があり、ページ自身が`indexedDB.databases()` を確認するパターンや、既に開いた DB ハンドルを共有するパターンに弱い。
- **品質の決定要因。** ここが崩れると "たまにアカウントが混ざる" 挙動になり、既存の低評価ツールと同じ轍を踏む。auth は Cookie で担保できても、localStorage / IndexedDB 由来の UI 状態が混ざる。**安定性の唯一の勝負どころ。**

---

## 5. 既知の限界（正直に記載）
- **Service Worker 発のリクエスト**は `tabId === -1` になり、タブ単位 DNR ルールから漏れる。auth は Cookie ベースなのでサーバ返却アカウントは Cookie に従うが、SW 駆動のキャッシュ/リクエストは非 auth 状態の漏洩経路になりうる。
- **CSRF / トークンローテーション:** X 等では投稿/DM は `ct0`(CSRF) を伴い、トークンが定期ローテーションされる。閲覧は堅牢、書き込みは脆い。MVP は閲覧を先に通す。
- **対応サイト:** 丸ごと Cookie 分離 + Cookie 層だけなら多くのサイトで成立するが、JS ストレージ依存の強い SPA は §4.4 が必要。

---

## 6. MVP スコープ（最初に作る範囲）

**やること（v0.1.0 で達成済み）:**
- popup からドメイン追加 → そのドメインの実行時 host 許可を取得（§4.1）。
- 名前付きセッションの定義 + セッションごとの Cookie セット取り込み（§4.3）。
- 各タブをセッションに割り当て（popup, ワンクリック） + 視覚表示（バッジ/色）。
- Cookie 層分離（DNR タブ単位ルール）と `document.cookie` / `localStorage` の per-session 仮想化（§4.2 / §4.4）。
- reload loop 自動検知（同一 URL 3 秒以内 4 回でタブ割り当てを自動解除）。
- **達成基準（v0.1.0）:** 「軽い SPA / 社内システム / マルチテナント SaaS の dev で 2 タブに 2 アカウントが並ぶ」。X / Google など重い SPA は **対象外**として扱う（→ §3.5 / §6.6）。

**後回し（v0.1.0 では入れない）:**
- `indexedDB` の名前空間化（§4.4, MAIN ワールド monkeypatch の拡張）。
- SW 発リクエスト（`tabId === -1`）の取りこぼし対応。
- 投稿/DM の安定運用（`ct0` 等の CSRF トークン ローテーション追跡）。
- 反 multi-account 検知のある大手 SNS / SaaS（X / Google / Instagram / TikTok / Facebook / Slack / Discord / Notion / Figma / Linear など）への対応 — § 6.6 参照。
- テスト済みサイト以外への汎用化の作り込み。

**MVP+α:** 起動プロファイル / 端末別初期タブセットは「後回し（＝当面やらない）」ではなく、MVP 本体の直後に着手する補助機能として **§6.5** で別途定義する。

---

## 6.5 起動プロファイル / 端末別初期タブセット（MVP+α）

### 目的
- Chrome 起動時に、端末ごとに定義した URL セットを自動または手動で開けるようにする。
- 単なる「URL を開く」機能ではなく、保存済みセッションが存在する場合に、開いたタブへ指定セッションを自動割り当てできるようにする。
- これにより、同一 Chrome プロファイルのまま以下のような使い方を可能にする:
  - メイン PC では X メインアカウント / X サブアカウント / ChatGPT / Gmail を開く
  - VM では GitHub / ChatGPT / 管理画面を開く
  - サブ PC では Gmail / Calendar / ChatGPT だけを開く
  - 同じ URL を複数タブで開き、それぞれ別セッションを割り当てる

### 位置づけ
- 本拡張の主目的はタブ単位セッション分離（§4.2）である。起動プロファイルは便利機能だがセッション分離の中核ではないため、**MVP 本体ではなく MVP+α** として扱う。
- 優先順位:
  1. Cookie 層のタブ単位セッション分離（§4.2）
  2. ドメイン追加と実行時 host 権限取得（§4.1）
  3. Cookie セッションの取り込み（§4.3）
  4. タブへのセッション割り当て
  5. 起動プロファイル / 端末別初期タブセット（本節）

### 基本方針
- **Chrome 標準機能でできることは Chrome 標準に任せる。** 本拡張は Chrome 標準では難しい以下のケースのみ補完する:
  - 端末ごとに起動タブを変えたい
  - Chrome 同期で起動ページ設定が混ざるのを避けたい
  - 同じ URL を複数アカウントで同時に開きたい
  - 起動時に URL ごとに保存済みセッションを自動割り当てしたい
- 初期状態では Chrome 標準設定の利用を推奨し、高度な使い方が必要なユーザーのみ本拡張の起動プロファイルを有効化する。

---

### 6.5.1 初期設定 / 起動タブ管理モード

#### 目的
ユーザーが Chrome 標準の起動時ページ設定を使うか、本拡張の起動プロファイル機能を使うかを選べるようにする。

#### 初回セットアップ画面
初回起動時、または設定未完了状態で popup / options を開いたときに、以下の選択肢を表示する。

```text
起動時のタブ管理方法を選択してください

◯ Chrome標準設定を使う
  Chromeの「起動時に特定のページを開く」設定を使います。
  この拡張はセッション分離だけを担当します。
  通常はこちらを推奨します。

◯ この拡張の起動プロファイルを使う
  端末ごとにURLセットを保存し、必要に応じてタブにセッションを自動割り当てします。
  同じURLを複数アカウントで開きたい場合はこちらを使います。

◯ 今は設定しない
  起動タブ管理を無効にします。
  あとで設定画面から変更できます。
```

#### 設定値
`chrome.storage.local` に以下の形式で保存する。

```json
{
  "startupMode": "chrome_default"
}
```

許可する値は以下。

```text
chrome_default
extension_profile
disabled
```

#### 各モードの意味

**chrome_default** — Chrome 標準の起動時設定を使う。
- 本拡張は起動時にタブを自動作成しない
- 本拡張はセッション分離機能のみ担当する
- 初期状態の推奨値
- Chrome 標準設定への案内リンクまたは説明を表示する

**extension_profile** — 本拡張の起動プロファイルを使う。
- `chrome.runtime.onStartup` で起動プロファイルを読み込む
- URL セットを開く
- URL ごとに保存済みセッションが指定されている場合は、タブ作成後に自動割り当てする
- DNR の tabId + domain 条件付き session rule を登録する

**disabled** — 起動タブ管理を使わない。
- Chrome 標準設定も本拡張からは案内しない
- 本拡張の起動プロファイルも実行しない
- 手動でタブ割り当て機能だけ使いたいユーザー向け

#### 注意点
- 本拡張から Chrome 本体の起動時設定を直接変更しない
- Chrome 標準設定を選んだ場合、本拡張の `onStartup` 自動タブ作成は実行しない
- 拡張の起動プロファイルを有効にする場合も、二重起動防止を実装する
- Chrome 標準の「前回開いていたページを開く」と併用するとタブが増えすぎる可能性があるため、UI 上で注意を出す

---

### 6.5.2 起動プロファイル仕様

#### 要件
- 端末名をローカル設定として保存する
- 起動プロファイルは `chrome.storage.local` に保存する（Chrome 同期には依存しない）
- Chrome 起動時に `chrome.runtime.onStartup` でプロファイルを読み込み、URL を開く
- URL ごとに任意で保存済みセッションを紐づけられる
- タブ作成後、該当タブにセッションを自動割り当てする
- セッション割り当て後、DNR ルールを登録する
- 二重起動防止のため、同一起動内で一度だけ実行する
- popup に手動実行ボタン「このプロファイルを開く」を用意する

#### 保存データ例
```json
{
  "device": {
    "name": "main-pc"
  },
  "startupProfiles": [
    {
      "id": "profile-main",
      "name": "Main PC Default",
      "enabled": true,
      "openOnStartup": true,
      "items": [
        {
          "url": "https://x.com",
          "sessionId": "x-main"
        },
        {
          "url": "https://x.com",
          "sessionId": "x-sub"
        },
        {
          "url": "https://chatgpt.com",
          "sessionId": null
        },
        {
          "url": "https://mail.google.com",
          "sessionId": null
        }
      ]
    }
  ]
}
```

#### device.name
端末名は**自動判定しない**。理由:
- Chrome 拡張から OS の正確な端末名を安定して取得するのは難しい
- プライバシー上も自動取得しない方がよい
- ユーザーが明示的に設定した方が挙動を理解しやすい
- Chrome Web Store 審査上も説明しやすい

したがって、端末名は初回セットアップまたは設定画面でユーザーが手動入力する。例: `main-pc` / `work-vm` / `sub-pc` / `home-laptop`

#### startupProfiles
複数の起動プロファイルを保存できる。ただし MVP+α の初期実装では、複数プロファイル対応は**データ構造だけ用意し、UI 上は 1 件のみ扱ってもよい**。

将来的な使い方の想定: 通常作業 / 開発作業 / SNS確認 / サーバー管理 / 調査作業。

#### items
`items` は起動時に開くタブのリスト。各 item は以下を持つ。

```json
{
  "url": "https://example.com",
  "sessionId": "optional-session-id"
}
```

- `sessionId` が `null` の場合は、通常タブとして開く。
- `sessionId` が指定されている場合は、タブ作成後にそのセッションを割り当てる。

---

### 6.5.3 起動時処理フロー

#### chrome_default の場合
何もしない。

```text
onStartup
  -> startupMode を読む
  -> chrome_default なら return
```

#### disabled の場合
何もしない。

```text
onStartup
  -> startupMode を読む
  -> disabled なら return
```

#### extension_profile の場合
以下の流れで処理する。

```text
onStartup
  -> startupMode を読む
  -> extension_profile でなければ return
  -> device.name を読む
  -> startupProfiles を読む
  -> enabled && openOnStartup の profile を選ぶ
  -> 二重起動防止チェック
  -> items の URL を順に chrome.tabs.create する
  -> sessionId がある item は、作成された tabId に session を割り当てる
  -> 対象ドメインの権限があるか確認する
  -> 権限がある場合は DNR ルールを登録する
  -> 権限がない場合は、そのタブは通常タブとして開き、popup で警告表示する
```

#### 二重起動防止
Chrome 起動時に同じ URL セットが重複して開かないようにする。

```json
{
  "startupRunState": {
    "lastRunAt": 1782000000000,
    "lastProfileId": "profile-main"
  }
}
```

実装方針:
- service worker の同一起動内で一度だけ実行する
- `lastRunAt` が極端に近い場合は再実行しない
- ただしユーザーが popup から「このプロファイルを開く」を押した場合は手動実行として許可する

厳密な永続判定は MVP+α 初期では不要。まずは「同一起動内で重複しない」程度でよい。

---

### 6.5.4 popup / options UI

#### 初回セットアップ
表示項目:
- 起動タブ管理モード（Chrome標準設定を使う / この拡張の起動プロファイルを使う / 今は設定しない）
- 端末名
- 起動プロファイル名
- URL 一覧
- 各 URL に割り当てるセッション
- 保存ボタン
- 手動実行ボタン

#### 通常 popup
既存のセッション分離 UI に加えて以下を表示する。

```text
起動プロファイル
- 現在のモード: Chrome標準 / 拡張プロファイル / 無効
- 現在の端末名: main-pc
- 使用中の起動プロファイル: Main PC Default
- [このプロファイルを開く]
- [設定を変更]
```

#### Chrome 標準設定を使っている場合の表示
```text
起動時タブ管理は Chrome 標準設定を使用中です。
この拡張はセッション分離のみ担当します。

同じURLを複数アカウントで開きたい場合や、端末ごとに起動タブを変えたい場合は、
拡張の起動プロファイルを有効にできます。
```

#### 拡張プロファイルを使っている場合の表示
```text
起動時タブ管理はこの拡張の起動プロファイルを使用中です。

Chrome標準の「前回開いていたページを開く」と併用すると、
タブが重複して開く場合があります。
必要に応じて Chrome 側の起動設定を確認してください。
```

---

### 6.5.5 実装上の注意

#### Chrome 標準設定を直接変更しない
Chrome 拡張から Chrome 本体の起動時設定を勝手に変更しない。理由:
- ユーザーの予期しない変更になる
- 権限や審査上の説明が難しくなる
- 本拡張の責務が広がりすぎる

本拡張では、Chrome 標準設定を案内するだけにする。

#### 起動プロファイルは chrome.storage.local
端末ごとの設定であるため、`chrome.storage.sync` ではなく `chrome.storage.local` を使う。理由:
- 端末別にしたい設定が Chrome 同期で混ざるのを避ける
- Cookie / セッション関連データと同様、ローカル完結にする
- 「100% ローカル / クラウド同期なし」というコンセプト（§3）と一致する

#### URL ごとの sessionId は任意
すべての URL にセッション割り当てが必要なわけではない。ChatGPT、Gmail、GitHub などは通常の Chrome セッションでよい場合がある。一方、同じ URL を複数アカウントで開きたい場合は `sessionId` を指定する。

#### 権限未付与時の扱い
起動プロファイルに `sessionId` が指定されていても、対象ドメインの host 権限が未付与の場合は DNR ルールを登録できない。この場合:
- タブ自体は開く
- セッション割り当ては保留または失敗扱いにする
- popup に「このドメインの権限が必要です」と表示する
- ユーザー操作で `chrome.permissions.request` を実行する

**自動起動処理中に突然 permission prompt を出すのは避ける。** 権限要求はユーザーが popup / options 上で明示的に操作したときに行う（§4.1 の権限モデルと整合）。

#### 自動起動は任意
拡張の起動プロファイルを使う場合でも、自動起動は必須にしない。以下の 2 つを分ける。

```json
{
  "enabled": true,
  "openOnStartup": false
}
```

- `enabled`: プロファイルとして有効
- `openOnStartup`: Chrome 起動時に自動で開く

これにより、手動で「このプロファイルを開く」だけの運用も可能にする。

---

### 6.5.6 将来追加候補
初期実装では入れないが、将来的に追加できる機能:
- 複数起動プロファイル
- 曜日別プロファイル
- 時間帯別プロファイル
- 現在開いているタブからプロファイル作成
- プロファイルのインポート / エクスポート
- URL ごとのウィンドウ指定
- 起動時に既存タブがあれば再利用
- プロファイルごとのバッジ色
- プロファイルごとの説明メモ
- 手動実行時のみ一時セッションで開く

ただしこれらは MVP+α 初期では不要。まずは「端末ごとの URL セットを開く」「必要ならセッションを割り当てる」だけに絞る。

---

## 6.6 将来課題（v0.1.0 リリース時点で意図的に外したもの）

§6 の「後回し」を粒度高くまとめ、それぞれ「やるとどう延伸するか」「先送り判断の根拠」を書く。Web Store 提出後の優先順位を考えるときの目安にする。

### 6.6.1 `indexedDB` の per-session 仮想化

- **影響:** これが入ると X / Google / Slack 等の「IndexedDB 経由で auth/UI state を持つ重い SPA」が分離対象に入る可能性が出る（ただし反 multi-account 検知や SW 連動が別の壁として残る）。
- **手法案:** MAIN world で `IDBFactory.prototype.open` / `deleteDatabase` / `databases` を hook し、DB 名にセッション ID プレフィックスを付ける。`indexedDB.databases()` の戻り値からプレフィックスを剥がして見せる。
- **既知の難所:**
  - 既に open 済みの IDBDatabase ハンドルがページ scripts 間で共有されていると、後から prefix を切替えても以前のハンドルが残る。
  - `databases()` を非標準フォールバックする実装（古い Safari など）に対する `version` 列挙の挙動が揺れる。
  - DB の `version` upgrade 中（onupgradeneeded）にプレフィックス切替えがかかった場合の整合性。
- **判定:** v0.1.0 では入れない。**反 multi-account 検知のあるサイトには結局通用しないため**、IDB だけ対応してもユーザー体験は大きく変わらない。狭いユースケース（IDB を持つ自前 SPA）で要望が出てから着手する。

### 6.6.2 SW 発リクエスト（`tabId === -1`）の取りこぼし

- **影響:** 各サイトの Service Worker がバックグラウンドで打つ fetch（push 受信、cache prefetch、analytics、API ポーリング）は DNR の `tabIds` 条件にマッチせず素通りする。サーバから見ると「最後に origin で auth した cookie jar の状態」で来るため、複数タブで別 user として並んでいる状態と矛盾する。
- **対策案:** `chrome.declarativeNetRequest.updateSessionRules` で SW origin 全体に対するルールを足す案があるが、複数 user を同居させる際にどの session を選ぶかの仲裁が必要。
- **判定:** v0.1.0 では入れない。本拡張の対象ドメイン（軽い SPA）では SW を使わない or 使っても auth に絡まないケースが多いと判断。

### 6.6.3 CSRF トークン（`ct0` 等）ローテーション追跡

- **影響:** 投稿 / DM などの書き込みでサーバが要求する CSRF トークンが、レスポンスの Set-Cookie で動的にローテーションする系（X が代表例）。**閲覧は堅牢、書き込みは間欠的に失敗**する。
- **手法案:** `chrome.declarativeNetRequest.onRuleMatchedDebug` か `chrome.webRequest.onResponseStarted` で Set-Cookie を観測し、特定キーだけ session の cookie ジャーに反映する。
- **判定:** v0.1.0 では入れない。そもそも本拡張は X / Google を対象外と明示しており、書き込み堅牢化は対応サイトを広げる文脈で考える話。

### 6.6.4 反 multi-account 検知のある大手 SNS / SaaS への対応

- **対象:** X / Google / Instagram / TikTok / Facebook / Slack / Discord / Notion / Figma / Linear など。
- **理由:** 上記 §6.6.1 〜 §6.6.3 を全部やっても、fingerprint / SSO / 内部 health check により「同一プロファイル内の複数 session」を検知して強制ログアウト or 同 URL リロードループを誘発する設計が増えている。本拡張の方式（同一プロファイル内で per-tab に Cookie/storage を分離）では原理的に勝ち目が薄い。
- **判定:** **対応しない**（v0.1.0 以降も含めて）。これらを必要とするユーザーには README で代替手段（Chrome プロファイル / Ghost Browser / Wavebox / ブラウザ使い分け）を推奨。

---

## 7. ディレクトリ / ファイル構成（叩き台）
```
/
├── manifest.json
├── background.js        # service worker: DNR ルール管理、タブ↔セッション割り当て、permissions 同期、onStartup で起動プロファイル展開（§6.5）
├── popup.html
├── popup.js            # ドメイン追加 / セッション定義 / タブ割り当て UI / 起動プロファイル設定・手動実行（§6.5）
├── lib/
│   ├── sessions.js     # セッション(Cookie セット)の保存/取得 (chrome.storage)
│   ├── dnr.js          # tabId+domain 条件の session ルール生成/更新/撤去
│   ├── cookies.js      # chrome.cookies スナップショット取り込み
│   └── startup.js      # 起動プロファイル(startupMode/startupProfiles)の保存・読込・展開・二重起動防止（§6.5, MVP+α）
└── (将来) content-main.js  # MAIN ワールド注入、localStorage/IndexedDB 名前空間化
```

---

## 8. manifest.json スケッチ（MV3, 確定前の叩き台）
```json
{
  "manifest_version": 3,
  "name": "(未定 — X/Twitter 商標を名前・アイコンに使わないこと)",
  "version": "0.1.0",
  "permissions": [
    "declarativeNetRequestWithHostAccess",
    "cookies",
    "storage",
    "tabs"
  ],
  "optional_host_permissions": ["*://*/*"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" }
}
```
- 広い `host_permissions` は置かない。`optional_host_permissions: ["*://*/*"]` は「任意のユーザー指定ドメインを実行時に要求できる」ようにするための枠（付与はユーザーが都度承認）。限定したいなら狭めてよい。
- 将来の MAIN ワールド注入用に `scripting` を追加（MVP の Cookie 層だけなら不要）。
- **商標:** name / アイコン / ストア説明に "X" / "Twitter" / 鳥ロゴを使わない（2026年1月発効の X 改定 ToS が無断使用を明示的に禁止）。"○○ for X" 系の名前も避ける。

---

## 9. 実装着手前の確認事項（重要 / Claude Code 向け指示）
**記憶/推測で API 仕様や Cookie 名を決め打ちしないこと。** 着手時点の最新を一次ソースで確認してから固める:
- DNR 動的/session ルールでの `Cookie` リクエストヘッダ `set` の現行挙動（本当に置換され、本物 Cookie が乗らないか）と、`tabIds` 条件の指定方法。
- `optional_host_permissions` + `permissions.request` の現行作法。**許可付与 → 該当ホストで DNR ルールが効くまでの順序**（付与後にルールを登録する）。
- MAIN ワールドコンテンツスクリプト（`world: "MAIN"`）の登録方法と注入タイミング（§4.4 着手時）。
- 「特定 Cookie だけ注入」の狭い設計に流れていないか（丸ごと分離＝サイト非依存を維持）。

**ライセンス / クリーンルーム:**
- OSS として出すなら `LICENSE` を明示（MIT 等）。
- MultiLogin Tabs 等のクローズド proprietary コードは**参照のみ・持ち込み禁止**。設計理解とコードのコピーは別物。

---

## 10. 決定事項サマリ（一覧）
| 項目 | 決定 |
|---|---|
| 性質 | 汎用・OSS・MV3・100%ローカル |
| 分離方式 | 本物の同時分離（スワップ式は不採用） |
| 対象ドメイン | ユーザー指定（ハードコードしない） |
| 権限 | `optional_host_permissions` + 実行時 per-domain 許可、広い host 権限なし |
| Cookie 改変 | `declarativeNetRequestWithHostAccess` の tabId+domain ルールで `Cookie` ヘッダを `set` |
| Cookie 範囲 | ドメイン丸ごと分離（認証 Cookie 名に非依存） |
| セッション取得 | 手動スナップショット（ライブ Set-Cookie 捕捉は回避） |
| MVP | Cookie 層のみ／閲覧／「2タブ2アカ並ぶ」がゴール |
| 後回し | localStorage・IndexedDB 名前空間化、SW(tabId=-1)、書き込み堅牢化 |
| 配布 | Chrome Web Store（開発者登録済み）、商標は名称/ロゴに使わない |

### 10.1 起動プロファイルに関する決定事項サマリ（§6.5）
| 項目 | 決定 |
|---|---|
| 性質 | MVP+α。セッション分離の補助機能 |
| 初期推奨 | Chrome 標準設定を推奨 |
| 拡張側機能 | 端末別 URL セット + 任意のセッション自動割り当て |
| 保存先 | `chrome.storage.local` |
| 同期 | Chrome 同期には依存しない |
| 端末判定 | 自動判定しない。ユーザーが端末名を手動設定 |
| 起動処理 | `chrome.runtime.onStartup` |
| 自動起動 | 任意。手動実行も用意 |
| 二重起動防止 | 同一起動内で一度だけ実行 |
| Chrome 本体設定 | 拡張から直接変更しない |
| 権限要求 | 自動起動中に要求しない。ユーザー操作時のみ要求 |
| 注意点 | Chrome 標準の復元機能と併用するとタブ重複の可能性あり |
