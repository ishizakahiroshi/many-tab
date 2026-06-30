# プライバシーポリシー

最終更新日: 2026-06-30

Many Tab Session Isolator (many-tab) は、ユーザーの個人情報を収集、保存、販売、共有しません。

## 収集する情報

この拡張機能は、テレメトリ・アナリティクス・クラッシュレポートを含む一切のデータを外部に送信しません。閲覧履歴・ページ本文・入力内容・Cookie・認証情報を本拡張の運営者側で収集することはありません。

## 外部通信

本拡張は外部サーバーへの通信を一切行いません。declarativeNetRequest (DNR) によるリクエスト改変は、ユーザーが取り込んだ Cookie を、ユーザー自身が popup で指定したドメイン向けの HTTP リクエストに差し込むためにのみ使用します。改変対象や挿入する内容は完全にローカルで決まり、外部とは通信しません。

## ローカルに保存する情報

以下を `chrome.storage.local` にのみ保存します。Chrome 同期や Google アカウントへの同期は行いません。

- ユーザーが追加した対象ドメインの一覧
- 名前付きセッション（取り込んだ Cookie の集合と localStorage スナップショット）
- タブとセッションの割り当て（タブが閉じると自動掃除されます）
- デバッグ機能の ON / OFF 設定（既定 OFF）
- デバッグ機能が ON の場合の動作ログ（リングバッファ 200 行）

これらの情報はユーザーのブラウザ内に保存され、外部に送信されません。Chrome から拡張機能を削除すると `chrome.storage.local` の内容も Chrome により消去されます。

## 使用する権限

- declarativeNetRequestWithHostAccess: タブ単位で Cookie ヘッダを差し替えるため
- cookies: ドメインの既存 Cookie をスナップショット保存するため
- storage: 上記ローカル情報を保存するため
- tabs: アクティブタブの URL と id を読み取り、セッションと紐づけるため
- scripting: ページの早い段階でセッション情報を注入し、ページスクリプトが storage を読む前に仮想化するため
- webNavigation: 同一 URL の reload loop を検知して自動的に割り当てを解除するため
- optional_host_permissions (*://*/*): インストール時には要求せず、ユーザーが popup でドメインを追加した瞬間のみ実行時取得

## 第三者提供

行いません。

## 連絡先

問い合わせ・不具合報告は GitHub Issues へお願いします: <https://github.com/ishizakahiroshi/many-tab/issues>

## 変更履歴

- 2026-06-30: 初版（v0.1.0 リリース向け）
