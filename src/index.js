import 'dotenv/config';
import http from 'http';
import { Client, GatewayIntentBits, Partials, SlashCommandBuilder } from 'discord.js';
import { getLangFromEmoji, translate, translateImage, FLAG_TO_LANG } from './translate.js';

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
  const eventCommand = new SlashCommandBuilder()
    .setName('event')
    .setDescription('ゲームイベントのリマインドを設定（サーバータイム基準）')
    .addStringOption((opt) =>
      opt
        .setName('datetime')
        .setDescription('サーバータイム MM/DD HH:mm（例: 03/05 20:00）')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('title')
        .setDescription('イベント名・メモ')
        .setRequired(true)
    )
    .toJSON();

  await client.application.commands.set([helpCommand, eventCommand]);
});

const HELP_TEXT = () => [
  '**使い方**',
  '翻訳したいメッセージに、下の国旗のリアクションを付けてください。Botがその言語に翻訳して返信します。',
  '・テキストメッセージ → その文を翻訳',
  '・画像だけの投稿 → 画像内の文字を読み取って翻訳',
  '※この案内メッセージに国旗を付けると、この案内をその言語で表示できます。',
  '',
  '**対応言語と国旗**',
  getHelpLanguagesText()
].join('\n');

// スラッシュコマンド /help /event
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'help') {
      const helpText = HELP_TEXT();
      await interaction.reply({ content: helpText, ephemeral: true });
      const replyMsg = await interaction.fetchReply().catch(() => null);
      if (replyMsg?.id) cacheHelpMessage(replyMsg.id, helpText);
      return;
    }

    if (interaction.commandName === 'event') {
      const rawDatetime = interaction.options.getString('datetime', true);
      const title = interaction.options.getString('title', true);

      const m = rawDatetime.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
      if (!m) {
        await interaction.reply({
          content: '日時の形式は `MM/DD HH:mm`（例: `03/05 20:00`）で入力してください。（サーバータイム基準）',
          ephemeral: true
        });
        return;
      }

      const [, mmStr, ddStr, hhStr, minStr] = m;
      const month = Number(mmStr);
      const day = Number(ddStr);
      const hourServer = Number(hhStr);
      const minute = Number(minStr);

      if (
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31 ||
        hourServer < 0 ||
        hourServer > 23 ||
        minute < 0 ||
        minute > 59
      ) {
        await interaction.reply({
          content: '日時が不正です。`MM/DD HH:mm` の範囲を確認してください。',
          ephemeral: true
        });
        return;
      }

      const now = new Date();
      const year = now.getUTCFullYear();

      // サーバータイム 0:00 = 日本時間 11:00 = UTC 2:00 → サーバータイム = UTC-2
      const SERVER_TO_UTC_HOURS = 2;
      const eventUtcMs = Date.UTC(year, month - 1, day, hourServer + SERVER_TO_UTC_HOURS, minute);

      // 5分前に通知
      const remindUtcMs = eventUtcMs - 5 * 60 * 1000;
      const nowMs = Date.now();
      let delayMs = remindUtcMs - nowMs;

      if (delayMs <= 0) {
        // 過去 or 5分以内なら即時通知扱い
        delayMs = 0;
      }

      const maxDelay = 24 * 60 * 60 * 1000 * 25; // 約25日（setTimeout の安全域）
      if (delayMs > maxDelay) {
        await interaction.reply({
          content: 'あまりにも先のイベントは登録できません。（約25日以内にお願いします）',
          ephemeral: true
        });
        return;
      }

      const serverStr = `${mmStr.padStart(2, '0')}/${ddStr.padStart(2, '0')} ${hhStr.padStart(
        2,
        '0'
      )}:${minStr}`;
      const jstEvent = new Date(eventUtcMs + 9 * 60 * 60 * 1000);
      const jstStr = `${String(jstEvent.getUTCMonth() + 1).padStart(2, '0')}/${String(
        jstEvent.getUTCDate()
      ).padStart(2, '0')} ${String(jstEvent.getUTCHours()).padStart(2, '0')}:${String(
        jstEvent.getUTCMinutes()
      ).padStart(2, '0')}`;

      await interaction.reply({
        content:
          `イベントリマインドを登録しました。\n` +
          `サーバータイム **${serverStr}**（JST **${jstStr}**）の**5分前**に ` +
          `このチャンネルで @everyone に通知します。\n` +
          `タイトル: ${title}`,
        ephemeral: true
      });

      const channel = interaction.channel;
      const guildName = interaction.guild?.name ?? 'unknown guild';

      setTimeout(async () => {
        try {
          if (!channel?.isTextBased()) return;
          await channel.send({
            content:
              `@everyone\n` +
              `【イベントリマインド】\n` +
              `タイトル: ${title}\n` +
              `サーバータイム ${serverStr} 開始予定の5分前です。（JST ${jstStr}）\n` +
              `（登録者: ${interaction.user.username} / サーバー: ${guildName}）`
          });
        } catch (e) {
          console.error('Failed to send event reminder:', e);
        }
      }, delayMs);

      return;
    }
  } catch (err) {
    console.error('Interaction error:', err);
    const msg = 'コマンド処理中にエラーが発生しました。入力内容を確認して、もう一度試してみてください。';
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: msg, ephemeral: true });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    } catch {
      // どうしても返せなかった場合は黙ってログだけ残す
    }
  }
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
    // 画像判定のため、attachments が空ならメッセージを再取得（キャッシュで添付が落ちていることがある）
    if (message.attachments?.size === 0 && !message.content?.trim()) {
      const refetched = await message.channel?.messages?.fetch(message.id).catch(() => null);
      if (refetched?.attachments?.size) message = refetched;
    }
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

    // 画像添付の場合は画像内テキストを翻訳（ユーザー投稿のみ）
    const isImage = (a) =>
      a.contentType?.startsWith('image/') ||
      /\.(png|jpe?g|gif|webp)$/i.test(a.name ?? a.filename ?? '');
    const imageAttachment = message.attachments?.find(isImage);
    const imageUrl = imageAttachment?.url ?? imageAttachment?.proxyURL;

    if (!text && !imageUrl) {
      await message.reply({ content: '翻訳できるテキストがありません。', ephemeral: false });
      return;
    }

    // Bot の投稿は help メッセージだけ翻訳する（他 Bot は翻訳しない）。画像はユーザー投稿のみ対象。
    if (message.author?.bot) {
      if (message.author.id !== client.user.id) return;
      const isHelp = text && (isHelpMessage(text) || helpMessageCache.has(message.id));
      if (!isHelp) return; // 自 Bot の help 以外は無視（Bot の画像は翻訳しない）
    }

    console.log('[Reaction] 翻訳開始:', targetLang, imageUrl ? '(画像)' : '');
    // テキスト＋画像が両方ある場合は両方翻訳してまとめて返す
    const [translatedText, translatedImage] = await Promise.all([
      text ? translate(text, targetLang) : Promise.resolve(null),
      imageUrl ? translateImage(imageUrl, targetLang) : Promise.resolve(null)
    ]);

    const translated =
      translatedText && translatedImage
        ? `text:\n${translatedText}\n\nimage:\n${translatedImage}`
        : (translatedText ?? translatedImage);
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
