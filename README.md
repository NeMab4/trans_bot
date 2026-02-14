# Discord 翻訳Bot（国旗リアクション）

誰かのメッセージに**国旗のスタンプ（リアクション）**を付けると、そのメッセージへの返信として、その言語に翻訳した内容をBotが投稿します。翻訳は ChatGPT API を使用します。

## 対応言語・リアクション

| リアクション | 言語     |
|-------------|----------|
| 🇯🇵         | 日本語   |
| 🇺🇸 🇬🇧     | 英語     |
| 🇰🇷         | 韓国語   |
| 🇹🇼         | 中国語（繁体字） |
| 🇨🇳         | 中国語（簡体字） |
| 🇮🇩         | インドネシア語 |
| 🇻🇳         | ベトナム語   |
| 🇸🇦 🇪🇬 🇦🇪 | アラビア語（現代標準アラビア語） |

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数

`.env.example` をコピーして `.env` を作成し、値を設定してください。

```bash
cp .env.example .env
```

| 変数名 | 説明 |
|--------|------|
| `DISCORD_TOKEN` | Discord Developer Portal で発行したBotのトークン |
| `OPENAI_API_KEY` | OpenAI（ChatGPT）API キー（`sk-...`） |
| `NOTION_API_KEY` | Notion インテグレーションシークレット（`ntn_...`） |
| `NOTION_EVENT_DB_ID` | EventReminders データベース ID |
| `NOTION_USER_LANG_DB_ID` | UserLangSettings データベース ID |

### 3. Notion データベースのセットアップ（イベントリマインダー永続化）

Bot 再起動時にイベントリマインダーとユーザー言語設定が消えないよう、Notion をデータベースとして使います。

#### 3-1. Notion インテグレーションの作成

1. [Notion Integrations](https://www.notion.so/my-integrations) にアクセス
2. **「New integration」** をクリック
3. 設定:
   - **Name:** 任意（例: `Discord Bot`）
   - **Associated workspace:** 自分のワークスペース
   - **Type:** `Internal`
4. **Submit** → 作成されたインテグレーションの **「Secrets」** タブから **Internal Integration Secret** をコピー
5. `.env` の `NOTION_API_KEY` に貼り付け（`ntn_` で始まる文字列）

#### 3-2. Notion データベースの作成

1. Notion で新しいページを作成（タイトルは任意、例: `Bot Data`）
2. そのページ内に **2つのデータベース** を作成:
   - **EventReminders**（イベントリマインダー用）
   - **UserLangSettings**（ユーザー言語設定用）
3. 各データベースの右上 **「•••」メニュー** → **「Add connections」** → 作成したインテグレーションを選択
4. 各データベースの URL からデータベース ID を取得:
   - URL: `https://notion.so/{32文字の英数字}?v=...`
   - その 32 文字（ハイフンなし）をコピー
5. `.env` に設定:
   - `NOTION_EVENT_DB_ID=` に EventReminders の ID
   - `NOTION_USER_LANG_DB_ID=` に UserLangSettings の ID

#### 3-3. データベースプロパティの設定

データベースに必要なプロパティを自動で追加するスクリプトを実行します:

```bash
npm install
node scripts/setup-notion-db.js
```

「✅ すべてのデータベースのセットアップが完了しました！」と表示されれば成功です。

### 4. Discord Bot の作成と設定

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成
2. **Bot** タブで Bot を追加し、**Reset Token** でトークンを取得 → `DISCORD_TOKEN` に設定
3. **Privileged Gateway Intents** で以下を有効化:
   - **Message Content Intent**（メッセージ本文を読むために必須）
4. **OAuth2 → URL Generator** でスコープに `bot`、Bot Permissions で「メッセージの送信」「メッセージ履歴の閲覧」など必要権限を付与し、生成されたURLでサーバーにBotを招待

### 5. 起動

```bash
npm start
```

開発時はファイル変更の自動再起動:

```bash
npm run dev
```

## 使い方

- **`/help`**（スラッシュコマンド）… `/` を押すと一覧に表示されます。使い方と対応言語・国旗を表示。
- **`!help`**（テキスト）… 同じ内容を表示します。

1. チャンネルで誰かが**テキスト**または**画像**を投稿
2. そのメッセージに **🇯🇵 / 🇺🇸 / 🇰🇷 / 🇹🇼 / 🇮🇩 / 🇻🇳 / 🇸🇦 など** のいずれかのリアクションを付ける
3. Bot が返信し、**テキスト**ならその文を、**画像だけ**なら画像内の文字を読み取って、選んだ言語に翻訳して投稿します

## Render にデプロイ + GAS でスリープ解除（無料運用）

Render の無料プランは約15分アクセスがないとスリープするため、Google Apps Script（GAS）で定期的に HTTP アクセスして起こします。

### Render 側

1. [Render](https://render.com) で **New → Web Service**
2. GitHub のこのリポジトリ（NeMab4/trans_bot）を連携して選択
3. 設定例:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** 環境変数 `DISCORD_TOKEN` と `OPENAI_API_KEY` を追加（Secret で）
4. デプロイ後、**URL**（例: `https://trans-bot-xxxx.onrender.com`）を控える

Bot は `PORT` が設定されているときだけ HTTP サーバーを立て、ルートにアクセスすると `ok` を返します（GAS の ping 用）。

### GAS で定期 ping

1. [Google Apps Script](https://script.google.com) で「新しいプロジェクト」を作成
2. リポジトリの **`gas-wake-ping.js`** の中身をコピーしてエディタに貼り付け
3. `RENDER_WAKE_URL` をあなたの Render の URL に変更（末尾スラッシュなし）
4. 保存して **実行** → `wakeRender` を選んでテスト
5. 左メニュー **「トリガー」** → **「トリガーを追加」**
   - 関数: `wakeRender`
   - イベント: 時間駆動型 → **分ベースのタイマー** → **15分おき**
6. 保存すると「権限の確認」が出るので、許可する

これで約15分ごとに Render にアクセスし、スリープしにくくできます。

## Railway にデプロイ（Render で Discord に接続できない場合）

Render のインスタンス IP が Discord にレート制限され、ゲートウェイに接続できない場合があります。そのときは **Railway** にデプロイすると別 IP で動くため、接続できることが多いです。

1. [Railway](https://railway.app) にログイン（GitHub 連携が簡単）
2. **New Project** → **Deploy from GitHub repo** でこのリポジトリ（`NeMab4/trans_bot`）を選択
3. デプロイが始まったら **Variables** で環境変数を追加:
   - `DISCORD_TOKEN` … Bot トークン
   - `OPENAI_API_KEY` … OpenAI API キー
4. **Settings** で **Start Command** が `npm start` になっていることを確認（未設定なら自動で `npm start`）
5. **Deploy** が成功すると Bot がオンラインになります

Railway 無料枠は月の利用量に上限がありますが、スリープは Render ほど厳しくないため、GAS の wake ping は必須ではありません。必要なら **Settings → Networking** で Public URL を有効にし、その URL を GAS で叩くこともできます。

## Fly.io にデプロイ

Render で Discord ゲートウェイがタイムアウトする場合や、常時稼働させたい場合に **Fly.io** で動かせます。Docker ビルドでデプロイします。

### 前提

- [Fly.io](https://fly.io) アカウントと [flyctl](https://fly.io/docs/hands-on/install-flyctl/) のインストール
- このリポジトリを clone 済み

### 手順

1. **ログイン**
   ```bash
   fly auth login
   ```

2. **アプリ作成（既存の fly.toml を使う場合）**
   ```bash
   fly launch --no-deploy
   ```
   - アプリ名を聞かれたらそのまま Enter（`trans-bot`）か、任意の名前に変更
   - Region は希望のリージョン（例: `nrt` 東京）を選択

3. **シークレット（環境変数）を設定**
   ```bash
   fly secrets set DISCORD_TOKEN=あなたのBotトークン
   fly secrets set OPENAI_API_KEY=sk-...
   fly secrets set NOTION_API_KEY=ntn_...
   fly secrets set NOTION_EVENT_DB_ID=...
   fly secrets set NOTION_USER_LANG_DB_ID=...
   ```
   またはまとめて:
   ```bash
   fly secrets set DISCORD_TOKEN=xxx OPENAI_API_KEY=xxx NOTION_API_KEY=xxx NOTION_EVENT_DB_ID=xxx NOTION_USER_LANG_DB_ID=xxx
   ```

4. **デプロイ**
   ```bash
   fly deploy
   ```

5. **ログで起動確認**
   ```bash
   fly logs
   ```
   `Logged in as ...` と `Slash commands registered.` が出ていれば OK。

### 補足

- **Dockerfile** で Node 22 を使い、`npm start` で起動します。
- **fly.toml** で `internal_port = 8080`、`min_machines_running = 1` にしています（1台常時稼働）。
- ヘルスチェック用にルートへ HTTP アクセスすると `ok` を返します。必要なら GAS の wake ping の URL を Fly の URL（`https://<app>.fly.dev`）に変更してスリープ対策も可能です。

## 注意

- OpenAI API の利用料が発生します（gpt-5.1-chat-latest を使用。2026年2月の gpt-4o 系終了に伴い移行済み）
- `.env` は Git にコミットしないでください（`.gitignore` 済み）

## Git（NeMab4 で push する場合）

このリポジトリは `git@github.com:NeMab4/trans_bot.git` を origin に設定しています。  
会社アカウント（imaiSMI）がデフォルトのため、NeMab4 で push するには **NeMab4 の GitHub に登録した SSH 鍵** を別途用意し、このリポジトリだけその鍵を使うようにします。

1. **NeMab4 用の鍵を用意**（まだなければ作成して GitHub に登録）
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_nemab4 -C "NeMab4用"
   ```
   GitHub → NeMab4 アカウント → Settings → SSH and GPG keys で `id_ed25519_nemab4.pub` を登録。

2. **`~/.ssh/config` に NeMab4 用の Host を追加**
   ```
   Host github.com-nemab4
     HostName github.com
     User git
     AddKeysToAgent yes
     UseKeychain yes
     IdentityFile ~/.ssh/id_ed25519_nemab4
   ```

3. **このリポジトリの origin だけ NeMab4 用ホストに変更**
   ```bash
   git remote set-url origin git@github.com-nemab4:NeMab4/trans_bot.git
   git push -u origin main
   ```
