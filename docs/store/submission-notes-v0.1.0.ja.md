# Chrome Web Store 提出文書（v0.1.0）

## 審査担当者向けメモ

これは Many Tab Session Isolator (many-tab) の初版リリースです。同一 Chrome プロファイル内で、同じドメインの複数アカウントを別タブで同時に維持できるようにする開発者向けツールです。

主な動作:

- popup でユーザーが対象ドメインを明示追加し、その瞬間のみ実行時に host permission を取得する（インストール時に広い権限を要求しない）
- そのドメインで現在ログイン中のタブから Cookie と localStorage をスナップショット保存する
- 別タブにそのセッションを割り当てると、declarativeNetRequest の tabId 条件付き session ルールで Cookie ヘッダを差し替え、content script (MAIN world) で document.cookie / localStorage を per-session に仮想化する
- 同一 URL を 3 秒以内に 4 回以上ナビゲーションしたら reload loop と判断し、自動的にそのタブの割り当てを解除する

X / Google / Slack 等の大手 SNS / SaaS は IndexedDB / Service Worker / 反 multi-account 検知によって本拡張の方式では分離しきれないため、listing の「動作対象外」セクションで明示的に対応しないと宣言しています。代替手段（Chrome プロファイル / Ghost Browser / Wavebox）を listing で推奨しています。

## 権限に関する変更

- 初版のため、以前のバージョンとの比較対象はありません。
- 必要な permission は以下のみです:
  - declarativeNetRequestWithHostAccess
  - cookies
  - storage
  - tabs
  - scripting
  - webNavigation
- インストール時の `host_permissions` は意図的に空にしています。広いホストアクセスは `optional_host_permissions: ["*://*/*"]` 経由で、ユーザーが popup でドメインを追加した瞬間に `chrome.permissions.request` で実行時取得する設計です。

## データ取り扱い

- **個人情報**: ユーザーが取り込んだ Cookie / localStorage は氏名・メールアドレス等を含み得るため、Web Store の Data usage では Personally identifiable information と Authentication information を Yes と申告しています。
- **外部送信**: 一切ありません。テレメトリ・アナリティクス・クラッシュレポート・利用統計のいずれも持ちません。
- **保存場所**: 取り込んだ Cookie / localStorage は `chrome.storage.local` にのみ保存され、Chrome Sync や Google アカウントには同期されません。
- **削除**: Chrome から本拡張を削除すると `chrome.storage.local` の内容も Chrome により消去されます。

## テスト観点

- popup の「対象ドメインを追加」→ 実行時 host permission ダイアログが正しく出ること
- 取り込んだセッションが別タブで適用され、サーバー応答が想定アカウントになっていること
- 取り込み元タブの localStorage キー数が 5 未満の場合に popup 上で `⚠` 警告が出ること
- reload loop シミュレーション（任意のタブで同一 URL を素早く 4 回リロード）でタブの割り当てが自動解除され、バッジが `!` に変わること
- popup の「緊急停止」ボタンで全タブの割り当てが解除されること
- popup の「デバッグ」セクションで Debug log toggle を ON にすると `chrome.storage.local.__mt_logs` に動作ログが蓄積されること（OFF だと蓄積されないこと）
