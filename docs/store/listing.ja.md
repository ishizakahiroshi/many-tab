# Chrome Web Store 掲載文案

## 拡張機能名

Many Tab Session Isolator

## 短い説明

自社開発 web アプリ・社内システム・マルチテナント SaaS の動作確認用に、タブ単位で別アカウントの Cookie / localStorage を分離する開発支援拡張。100% ローカル、外部送信なし。

## 詳細説明

Many Tab Session Isolator (many-tab) は、同一 Chrome プロファイル・同一ウィンドウのまま、同じサイトの複数アカウントを別タブで「同時に」ログイン状態に保つ Chrome 拡張です。マルチテナント SaaS の dev / QA、社内システムの管理者と一般ユーザーの並行テスト、self-hosted 系（Nextcloud / Gitea / Bitwarden 等）の複数アカウント運用を 1 つの Chrome プロファイル内で完結させることを目的としています。

主な機能:

- ドメイン追加: popup から対象ホストを追加すると実行時に host permission を取得（インストール時に広い権限を要求しません）
- セッション取り込み: ログイン中のタブから Cookie + localStorage をスナップショット保存
- タブ割り当て: 別タブを開いて取り込み済みセッションを指定し、リロードで反映
- reload loop 自動検知: 同一 URL を短時間連続でナビゲーションするとタブ割り当てを自動解除
- 緊急停止: 全タブの割り当てを 1 クリックで解除

動作対象:

Cookie と localStorage で認証・UI 状態が完結する軽量な web app に向いています:

- 自前開発の web アプリ / 管理画面
- 社内システム / 業務システム
- self-hosted の Nextcloud / Gitea / Forgejo / Vaultwarden 等
- 軽量な多テナント SaaS の dev / QA 環境

動作対象外:

以下は IndexedDB / Service Worker / cross-domain SSO / 反 multi-account 検知などにより、本拡張の方式では分離できません:

- X / Google サービス全般（Gmail / Drive / GCP / YouTube 等）
- Instagram / TikTok / Facebook
- Slack / Discord
- Notion / Figma / Linear
- 主要 SNS / 大手 SaaS の多く

これらで複数アカウント運用が必要な場合は、Chrome の「プロファイル」機能、Ghost Browser、Wavebox などの専用ブラウザを推奨します。

プライバシー:

- 外部サーバーへの通信は行いません
- テレメトリ・アナリティクス・クラッシュレポートを一切収集しません
- 取り込んだ Cookie / localStorage は chrome.storage.local にのみ保存されます

使用権限:

- declarativeNetRequestWithHostAccess: タブ単位で Cookie ヘッダを差し替えるため
- cookies: ドメインの既存 Cookie をスナップショット保存するため
- storage: セッション定義 / タブ割り当て / localStorage オーバーレイをローカルに保存するため
- tabs: アクティブタブの URL と id を読み取り、セッションと紐づけるため
- scripting: ページの早い段階でセッション情報を注入し、ページスクリプトが storage を読む前に仮想化するため
- webNavigation: 同一 URL の reload loop を検知して自動的に割り当てを解除するため
- optional_host_permissions (*://*/*): インストール時には要求せず、ユーザーが popup でドメインを追加した瞬間のみ実行時取得

ソースコード（MIT ライセンス・100% ローカル）:
https://github.com/ishizakahiroshi/many-tab

プライバシーポリシー:
https://github.com/ishizakahiroshi/many-tab/blob/main/PRIVACY.md

## カテゴリ候補

Developer Tools

## スクリーンショット案

- popup UI（ドメイン追加 / セッション一覧 / 割り当て選択）
- 2 タブ並列動作（admin タブと tenant ユーザータブを左右に並べる）
- アーキテクチャ図（タブ A → Cookie A 注入 / タブ B → Cookie B 注入）
- popup の「デバッグ」セクション展開（透明性の訴求）
