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

- **`!help` または `/help`** … 使い方と対応言語・国旗の案内を表示します。

1. チャンネルで誰かがメッセージを投稿
2. そのメッセージに **🇯🇵 / 🇺🇸 / 🇰🇷 / 🇹🇼 / 🇮🇩 / 🇻🇳** のいずれかのリアクションを付ける
3. Bot がそのメッセージに返信し、選んだ言語に翻訳した文を投稿します

## 注意

- OpenAI API の利用料が発生します（gpt-4o-mini を使用）
- `.env` は Git にコミットしないでください（`.gitignore` 済み）
