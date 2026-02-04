import 'dotenv/config';
import http from 'http';
import { Client, GatewayIntentBits, Partials, SlashCommandBuilder } from 'discord.js';
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

/** help メッセージの ID → 本文（Bot 自身の投稿で content が取れない場合の対策） */
const helpMessageCache = new Map();
const HELP_CACHE_TTL_MS = 60 * 60 * 1000; // 1時間で削除
function cacheHelpMessage(messageId, text) {
  helpMessageCache.set(messageId, text);
  setTimeout(() => helpMessageCache.delete(messageId), HELP_CACHE_TTL_MS);
}

const LANG_LABELS = { ja: '日本語', en: '英語', ko: '韓国語', 'zh-TW': '中国語（台湾）', id: 'インドネシア語', vi: 'ベトナム語', ar: 'アラビア語' };

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

/** Bot の help メッセージかどうか（本文で判定し、help だけ翻訳対象にする） */
function isHelpMessage(content) {
  const t = (content || '').trim();
  return t.includes('**使い方**') && t.includes('**対応言語と国旗**');
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log('対応リアクション:', Object.keys(FLAG_TO_LANG).join(' '));

  // スラッシュコマンド /help を登録（/ を押したときの一覧に表示される）
  const helpCommand = new SlashCommandBuilder()
    .setName('help')
    .setDescription('使い方と対応言語・国旗を表示')
    .toJSON();
  await client.application.commands.set([helpCommand]);
});

const HELP_TEXT = () => [
  '**使い方**',
  '翻訳したいメッセージに、下の国旗のリアクションを付けてください。Botがその言語に翻訳して返信します。',
  '※この案内メッセージに国旗を付けると、この案内をその言語で表示できます。',
  '',
  '**対応言語と国旗**',
  getHelpLanguagesText()
].join('\n');

// スラッシュコマンド /help（/ の一覧に表示される）
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'help') return;
  const helpText = HELP_TEXT();
  await interaction.reply({ content: helpText });
  const replyMsg = await interaction.fetchReply().catch(() => null);
  if (replyMsg?.id) cacheHelpMessage(replyMsg.id, helpText);
});

// 従来のテキストコマンド !help / /help
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const content = message.content?.trim().toLowerCase();
  if (content !== '!help' && content !== '/help') return;
  const helpText = HELP_TEXT();
  const sent = await message.reply({ content: helpText });
  if (sent?.id) cacheHelpMessage(sent.id, helpText);
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;

  const emojiKey = reaction.emoji.name ?? reaction.emoji.identifier ?? '';
  const targetLang = getLangFromEmoji(emojiKey);
  console.log('[Reaction] emoji:', JSON.stringify(emojiKey), '→ lang:', targetLang ?? '(未対応)');
  if (!targetLang) return;

  let message;
  try {
    if (reaction.partial) await reaction.fetch();
    message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
    const msgId = message.id;

    if (processing.has(msgId)) {
      console.log('[Reaction] 処理中なのでスキップ:', msgId);
      return;
    }
    processing.add(msgId);

    // 本文取得（Bot 自身の help は API で content が取れないことがあるのでキャッシュを参照）
    let text = message.content?.trim();
    if (!text && message.author?.bot && message.author.id === client.user.id) {
      text = helpMessageCache.get(message.id) ?? '';
    }
    if (!text) {
      await message.reply({ content: '翻訳できるテキストがありません。', ephemeral: false });
      return;
    }

    // Bot の投稿は help メッセージだけ翻訳する（他 Bot は翻訳しない）
    if (message.author?.bot) {
      if (message.author.id !== client.user.id) return; // 他 Bot のメッセージは無視
      const isHelp = isHelpMessage(text) || helpMessageCache.has(message.id);
      if (!isHelp) return; // 自 Bot の help 以外は無視
    }

    console.log('[Reaction] 翻訳開始:', targetLang);
    const translated = await translate(text, targetLang);
    const langLabel = LANG_LABELS[targetLang];
    await message.reply({
      content: `**${reaction.emoji.name} ${langLabel}訳:**\n${translated}`
    });
    console.log('[Reaction] 翻訳完了');
  } catch (err) {
    console.error('[Reaction] Error:', err);
    const replyContent = err.message?.includes('API')
      ? '翻訳APIのエラーです。APIキーと残高を確認してください。'
      : `翻訳に失敗しました: ${err.message}`;
    const targetMessage = message ?? (reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message);
    if (targetMessage?.reply) {
      await targetMessage.reply({ content: replyContent }).catch((e) => console.error('Reply failed:', e));
    }
  } finally {
    if (message?.id) processing.delete(message.id);
    else if (reaction.message?.id) processing.delete(reaction.message.id);
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

// Render 用: PORT が設定されていれば HTTP サーバーを立てる（GAS の定期 ping でスリープ解除）
const port = process.env.PORT;
if (port) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  server.listen(Number(port), () => {
    console.log(`Wake endpoint: http://0.0.0.0:${port}`);
  });
}
