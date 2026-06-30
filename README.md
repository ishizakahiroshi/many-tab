# many-tab

同一 Chrome プロファイル・同一ウィンドウのまま、同じサイトの複数アカウントを別タブで「同時に」ログイン状態に保つ開発支援拡張（Manifest V3）。タブ単位で Cookie と localStorage を分離します。100% ローカル動作・テレメトリ無し。

## 想定ユーザー

- マルチテナント SaaS の開発者・QA エンジニア（admin / tenant ユーザーを並べてテストしたい）
- 社内システムの運用担当（管理者と一般ユーザーで同時にログインして挙動を見たい）
- self-hosted 系の利用者（Nextcloud / Gitea / Bitwarden / Vaultwarden 等で別アカウントを並べたい）
- 自作 web アプリで権限ロールの差を確認したい個人開発者

## 動作確認済み

初期リリース時点では未確認。報告は GitHub Issues へ。
（軽量な Cookie + localStorage で完結する自前 web アプリと、Cookie + localStorage で完結する社内システムを想定して設計）

## 対象外（動きません）

以下のサービスは IndexedDB / Service Worker / cross-domain SSO / 反 fraud / 反 multi-account 検知などにより、本拡張の方式（Cookie + localStorage 分離）では分離しきれません。

- X
- Google サービス全般（Gmail / Drive / GCP console / YouTube 等）
- Instagram / TikTok / Facebook
- Slack / Discord
- Notion / Figma / Linear
- 主要 SNS / 大手 SaaS の多く

これらで複数アカウントを並行運用したい場合は、以下を推奨します。

- Chrome の「プロファイル」機能（公式・無料・安定）
- [Ghost Browser](https://ghostbrowser.com/) / [Wavebox](https://wavebox.io/) などのマルチセッション特化ブラウザ
- アカウントごとに別のブラウザ（Chrome / Edge / Firefox）を使い分け

## インストール

### 開発版（unpacked）

1. このリポジトリを clone
2. `chrome://extensions` を開き右上の「デベロッパー モード」を ON
3. 「パッケージ化されていない拡張機能を読み込む」→ プロジェクトルートを選択

### Chrome Web Store

公開審査の結果次第。決まり次第ここにリンクを追加します。

## 使い方

1. **対象ドメインを追加**: popup の「1. 対象ドメインを追加」にホスト名を入れて「許可して追加」（実行時に host permission を取得）
2. **セッションを取り込む**: 取り込みたいアカウントでログイン中の **未割り当てタブ** を 1 つ用意 → popup の「2. セッションを取り込む」でドメインと名前（例: `admin` / `tenant-a`）を指定して「取込」
3. **別タブに割り当て**: 新しいタブを開きそのドメインへ移動 → popup の「3. このタブに割り当て」で取り込み済みセッションを選んで「割当」→ ページをリロード（割り当て直後の自動リロードはループ防止のため行いません）

## 仕組み（概要）

- `declarativeNetRequest` で per-tab に Cookie ヘッダを差し替え（DNR session rule）
- content script (MAIN world) で `document.cookie` と `localStorage` を per-session 仮想化
- セッション情報は `chrome.storage.local` にのみ保存（クラウド同期なし）

技術詳細仕様: [chrome-tab-session-isolation-spec.md](chrome-tab-session-isolation-spec.md)

## 制限と注意

- 1 タブ 1 セッション（同タブ内では切替不可）
- ページの手動リロード後にセッションが反映される（自動リロードしない）
- 取り込みは「そのアカウントでログイン中の **未割り当て** タブ」から行う（割り当て済みタブから取ると localStorage が空になりループの原因）
- 同一 URL を 3 秒以内に 4 回以上ナビゲーションすると reload loop と判断し自動で割り当てを解除（バッジが `!` に変わる）
- IndexedDB / Service Worker 経由の状態は分離されない（→ X / Google などが対象外な理由）
- 反 multi-account 検知を備える大手 SNS / SaaS には効きません

困ったときは popup の「4. 緊急停止」で全タブの割り当てを解除できます。

## ライセンス

[MIT](LICENSE)

## Privacy

100% ローカル、テレメトリなし、外部送信なし。詳細は [PRIVACY.md](PRIVACY.md)。

## 変更履歴

[CHANGELOG.md](CHANGELOG.md) を参照。
