import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { getLangFromEmoji, translate, FLAG_TO_LANG } from './translate.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

/** 処理中メッセージID（二重送信防止） */
const processing = new Set();

const LANG_LABELS = { ja: '日本語', en: '英語', ko: '韓国語', 'zh-TW': '中国語（台湾）', id: 'インドネシア語', vi: 'ベトナム語' };

/** help 用の「対応言語と国旗」テキストを生成 */
function getHelpLanguagesText() {
  const byLang = {};
  for (const [flag, code] of Object.entries(FLAG_TO_LANG)) {
    if (!byLang[code]) byLang[code] = [];
    byLang[code].push(flag);
  }
  return Object.entries(byLang)
    .map(([code, flags]) => `${flags.join(' ')} → ${LANG_LABELS[code]}`)
    .join('\n');
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log('対応リアクション:', Object.keys(FLAG_TO_LANG).join(' '));
});

// help コマンド
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const content = message.content?.trim().toLowerCase();
  if (content !== '!help' && content !== '/help') return;

  const helpText = [
    '**使い方**',
    '翻訳したいメッセージに、下の国旗のリアクションを付けてください。Botがその言語に翻訳して返信します。',
    '',
    '**対応言語と国旗**',
    getHelpLanguagesText()
  ].join('\n');

  await message.reply({ content: helpText });
});

client.on('messageReactionAdd', async (reaction, user) => {
  // Bot自身のリアクションは無視
  if (user.bot) return;

  const emojiKey = reaction.emoji.name ?? reaction.emoji.identifier ?? '';
  const targetLang = getLangFromEmoji(emojiKey);
  if (!targetLang) return;

  try {
    // 部分キャッシュの場合はメッセージを取得
    if (reaction.partial) {
      await reaction.fetch();
    }
    const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
    const msgId = message.id;

    if (processing.has(msgId)) return;
    processing.add(msgId);

    const text = message.content?.trim();
    if (!text) {
      await message.reply({ content: '翻訳できるテキストがありません。', ephemeral: false });
      return;
    }

    const translated = await translate(text, targetLang);
    const langLabel = LANG_LABELS[targetLang];
    await message.reply({
      content: `**${reaction.emoji.name} ${langLabel}訳:**\n${translated}`
    });
  } catch (err) {
    console.error('Translation error:', err);
    const replyContent = err.message?.includes('API')
      ? '翻訳APIのエラーです。APIキーと残高を確認してください。'
      : `翻訳に失敗しました: ${err.message}`;
    try {
      await reaction.message.reply({ content: replyContent }).catch(() => {});
    } catch (_) {}
  } finally {
    if (reaction.message?.id) processing.delete(reaction.message.id);
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('.env に DISCORD_TOKEN を設定してください');
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error('.env に OPENAI_API_KEY を設定してください');
  process.exit(1);
}

client.login(token).catch((err) => {
  console.error('Login failed:', err);
  process.exit(1);
});
