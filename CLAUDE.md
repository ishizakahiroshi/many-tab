# many-tab 開発ガイド

> 詳細仕様は [chrome-tab-session-isolation-spec.md](chrome-tab-session-isolation-spec.md) を正本とする。このファイルはプロジェクト固有の常時ロード分のみ。

## プロジェクト概要

**many-tab** — 同一 Chrome プロファイル・同一ウィンドウのまま、**同じサイトの複数アカウントを別タブで「同時に」ログイン状態に保つ** Chrome 拡張（Manifest V3）。X 専用ではなく**汎用**（対象ドメインはユーザー指定）。

- **本物の同時分離**: Cookie スワップ式（タブ切替時に Cookie を入れ替える）は採用しない。各タブが自分のセッションの Cookie を送り、複数アカウントが並行して生きる状態を作る。
- **100% ローカル / テレメトリなし / クラウド同期なし**: Cookie・セッションはブラウザ外に一切出さない。
- **最小権限**: install 時に広い `host_permissions` を要求せず、ユーザーが popup で追加したドメインだけ実行時に `chrome.permissions.request` で許可を取る。
- **配布**: Chrome Web Store 公開予定（開発者登録済み）。

> AI の個人グローバルルール（言語・確認・質問フォーマット・出力ルール・スクリーンショット規約等）は、各利用者の AI ツールのグローバル設定に置く。公開リポジトリ内の `CLAUDE.md` / `AGENTS.md` はプロジェクト固有ルールだけを扱う（fresh public clone で完結すること）。

## 技術スタック

| レイヤ | 採用 |
|------|------|
| プラットフォーム | Chrome 拡張 Manifest V3 |
| 言語 | JavaScript（ESM / バンドラなしの素の拡張を基本とする） |
| Cookie 改変 | `declarativeNetRequestWithHostAccess`（DNR session ルール） |
| セッション保存 | `chrome.storage` |
| Cookie 取得 | `chrome.cookies`（手動スナップショット） |
| ストレージ名前空間化（将来） | `world: "MAIN"` コンテンツスクリプトで `localStorage` / `sessionStorage` / `document.cookie` / `indexedDB` を monkeypatch |

## ディレクトリ構成（叩き台 / 詳細は spec §7）

```
/
├─ manifest.json
├─ background.js        # service worker: DNR ルール管理 / タブ↔セッション割り当て / permissions 同期
├─ popup.html
├─ popup.js             # ドメイン追加 / セッション定義 / タブ割り当て UI
├─ lib/
│  ├─ sessions.js       # セッション(Cookie セット)の保存/取得 (chrome.storage)
│  ├─ dnr.js            # tabId+domain 条件の session ルール生成/更新/撤去
│  └─ cookies.js        # chrome.cookies スナップショット取り込み
└─ (将来) content-main.js  # MAIN ワールド注入、localStorage/IndexedDB 名前空間化
```

## 設計上の制約（厳守）

- **本物の同時分離を崩さない**: スワップ式に流れない。各タブが並行して別アカウントで生きる。
- **ドメイン丸ごと Cookie 分離**: そのセッションの全 Cookie を注入し本物は外す。**「特定の Cookie だけ注入する」狭い実装にしない**（汎用性が落ちる。X の `auth_token`/`ct0` 等を知る必要がない設計を維持）。
- **広い `host_permissions` を manifest に置かない**: `optional_host_permissions` + 実行時 per-domain 許可で充足する。
- **DNR ルールは許可付与の後に登録する**: 付与 → 該当ホストでルールが効く順序を守る。
- **ブラウザ外にデータを出さない**: テレメトリ・クラウド同期・外部送信を一切入れない。
- **商標**: name / アイコン / ストア説明に "X" / "Twitter" / 鳥ロゴを使わない。"○○ for X" 系の名前も避ける（2026年1月発効の X 改定 ToS が無断使用を明示禁止）。
- **クリーンルーム**: MultiLogin Tabs 等のクローズド proprietary コードは参照のみ・持ち込み禁止。設計理解とコードのコピーは別物。

## 実装着手前の確認事項（必須）

**記憶/推測で API 仕様や Cookie 名を決め打ちしないこと。** 着手時点の最新を一次ソース（chrome.com/docs 等）で確認してから固める。詳細は spec [§9](chrome-tab-session-isolation-spec.md)。

- DNR session/dynamic ルールでの `Cookie` リクエストヘッダ `set` の現行挙動（本当に置換され本物 Cookie が乗らないか）と `tabIds` 条件の指定方法。
- `optional_host_permissions` + `permissions.request` の現行作法と、許可付与 → DNR ルールが効くまでの順序。
- MAIN ワールドコンテンツスクリプト（`world: "MAIN"`）の登録方法と注入タイミング（§4.4 着手時）。

## MVP スコープ（spec §6）

- popup からドメイン追加 → 実行時 host 許可取得。
- 名前付きセッション定義 + セッションごとの Cookie セット取り込み。
- 各タブをセッションに割り当て（ワンクリック）+ 視覚表示（バッジ/色）。
- Cookie 層分離のみ DNR タブ単位ルールで実装。
- **達成基準**: 「2 タブに 2 アカウントのタイムラインが正しく並ぶ」。

**後回し**: localStorage / IndexedDB 名前空間化（MAIN ワールド）、SW 発リクエスト（tabId=-1）の取りこぼし、投稿/DM の安定運用（`ct0` ローテーション）、テスト済み以外への汎用化。

## 作業運用ルール（AI 共通）

- **拡張のロード・リロード・ブラウザ操作・動作確認はユーザーが行う**。AI からは提案・確認質問をしない（明示指示があった場合のみ実行）。完了報告ではコード変更の要約だけ伝える。
- **ライセンス**: OSS として出す（`LICENSE` を明示）。

## 参照リンク

| 項目 | パス |
|------|------|
| 設計仕様（正本） | [chrome-tab-session-isolation-spec.md](chrome-tab-session-isolation-spec.md) |
| Codex/他 AI 用補足 | [AGENTS.md](AGENTS.md)（ローカル補足があれば `AGENTS.local.md`） |
