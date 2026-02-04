# Discord 翻訳Bot（国旗リアクション）

誰かのメッセージに**国旗のスタンプ（リアクション）**を付けると、そのメッセージへの返信として、その言語に翻訳した内容をBotが投稿します。翻訳は ChatGPT API を使用します。

## 対応言語・リアクション

| リアクション | 言語     |
|-------------|----------|
| 🇯🇵         | 日本語   |
| 🇺🇸 🇬🇧     | 英語     |
| 🇰🇷         | 韓国語   |
| 🇹🇼         | 中国語（台湾・繁体字） |
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

### 3. Discord Bot の作成と設定

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成
2. **Bot** タブで Bot を追加し、**Reset Token** でトークンを取得 → `DISCORD_TOKEN` に設定
3. **Privileged Gateway Intents** で以下を有効化:
   - **Message Content Intent**（メッセージ本文を読むために必須）
4. **OAuth2 → URL Generator** でスコープに `bot`、Bot Permissions で「メッセージの送信」「メッセージ履歴の閲覧」など必要権限を付与し、生成されたURLでサーバーにBotを招待

### 4. 起動

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

1. チャンネルで誰かがメッセージを投稿
2. そのメッセージに **🇯🇵 / 🇺🇸 / 🇰🇷 / 🇹🇼 / 🇮🇩 / 🇻🇳 / 🇸🇦 など** のいずれかのリアクションを付ける
3. Bot がそのメッセージに返信し、選んだ言語に翻訳した文を投稿します

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

## 注意

- OpenAI API の利用料が発生します（gpt-4o-mini を使用）
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
