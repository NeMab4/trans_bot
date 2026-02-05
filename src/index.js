import 'dotenv/config';
import http from 'http';
import {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
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

/** イベントリマインド ID → タイマーなど */
const eventReminders = new Map();

/** ログイン待ちタイムアウト（ready で解除） */
let loginTimeoutId = null;

/** /event 重複時の「追加する？キャンセルする？」確認用一時データ */
const pendingEventConfirms = new Map();
const EVENT_CONFIRM_TTL_MS = 10 * 60 * 1000; // 10分で破棄

function scheduleEventReminder({ channel, guildId, title, serverStr, jstStr, eventUtcMs, requestedBy }) {
  const nowMs = Date.now();
  const remindUtcMs = eventUtcMs - 5 * 60 * 1000;
  let delayBeforeMs = remindUtcMs - nowMs;
  if (delayBeforeMs <= 0) delayBeforeMs = 0;

  let delayStartMs = eventUtcMs - nowMs;
  if (delayStartMs <= 0) delayStartMs = 0;

  const maxDelay = 24 * 60 * 60 * 1000 * 25; // 約25日（setTimeout の安全域）
  if (delayBeforeMs > maxDelay || delayStartMs > maxDelay) {
    throw new Error('too_far_in_future');
  }

  const reminderId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const timeouts = [];
  const hasStartReminder = delayStartMs > 0;

  if (delayBeforeMs >= 0) {
    const tBefore = setTimeout(async () => {
      try {
        if (!channel?.isTextBased()) return;
        await channel.send({
          content:
            `@everyone\n` +
            `【Event Reminder】\n` +
            `Title: ${title}\n` +
            `Server time ${serverStr} (JST ${jstStr}) — 5 minutes left.`
        });
      } catch (e) {
        console.error('Failed to send event reminder (5min):', e);
      } finally {
        if (!hasStartReminder) {
          eventReminders.delete(reminderId);
        }
      }
    }, delayBeforeMs);
    timeouts.push(tBefore);
  }

  if (delayStartMs > 0) {
    const tStart = setTimeout(async () => {
      try {
        if (!channel?.isTextBased()) return;
        await channel.send({
          content:
            `@everyone\n` +
            `【Event Reminder】\n` +
            `Title: ${title}\n` +
            `Server time ${serverStr} (JST ${jstStr}) — starts now.`
        });
      } catch (e) {
        console.error('Failed to send event reminder (start):', e);
      } finally {
        eventReminders.delete(reminderId);
      }
    }, delayStartMs);
    timeouts.push(tStart);
  }

  eventReminders.set(reminderId, {
    timeouts,
    channelId: channel?.id,
    guildId,
    title,
    serverStr,
    jstStr,
    eventUtcMs,
    createdBy: requestedBy
  });

  return reminderId;
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
  if (loginTimeoutId) clearTimeout(loginTimeoutId);
  loginTimeoutId = null;
  console.log(`Logged in as ${client.user.tag}`);
  console.log('対応リアクション:', Object.keys(FLAG_TO_LANG).join(' '));

  // スラッシュコマンド登録（失敗しても Bot はオンラインのままにする）
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

  const eventCancelCommand = new SlashCommandBuilder()
    .setName('eventcancel')
    .setDescription('登録済みイベントリマインドをキャンセル')
    .addStringOption((opt) =>
      opt
        .setName('id')
        .setDescription('登録時に表示されたイベントID')
        .setRequired(true)
    )
    .toJSON();

  const eventListCommand = new SlashCommandBuilder()
    .setName('eventlist')
    .setDescription('このチャンネルに登録されたイベント一覧を表示')
    .toJSON();

  try {
    await client.application.commands.set([helpCommand, eventCommand, eventCancelCommand, eventListCommand]);
    console.log('Slash commands registered.');
  } catch (e) {
    console.error('Slash command registration failed (bot stays online):', e);
  }
});

client.on('error', (err) => console.error('[Discord client error]', err));
client.on('warn', (msg) => console.warn('[Discord warn]', msg));

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

// スラッシュコマンド /help /event ＋ ボタン
client.on('interactionCreate', async (interaction) => {
  try {
    // ===== スラッシュコマンド =====
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'help') {
        const helpText = HELP_TEXT();
        await interaction.reply({ content: helpText, ephemeral: true });
        const replyMsg = await interaction.fetchReply().catch(() => null);
        if (replyMsg?.id) cacheHelpMessage(replyMsg.id, helpText);
        return;
      }

      if (interaction.commandName === 'event') {
      // 先に defer して Discord 側の3秒タイムアウトを回避
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      const rawDatetime = interaction.options.getString('datetime', true);
      const title = interaction.options.getString('title', true);

      const m = rawDatetime.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
      if (!m) {
        await interaction.editReply({
          content: '日時の形式は `MM/DD HH:mm`（例: `03/05 20:00`）で入力してください。（サーバータイム基準）',
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
        await interaction.editReply({
          content: '日時が不正です。`MM/DD HH:mm` の範囲を確認してください。',
        });
        return;
      }

      const now = new Date();
      const year = now.getUTCFullYear();

      // サーバータイム 0:00 = 日本時間 11:00 = UTC 2:00 → サーバータイム = UTC-2
      const SERVER_TO_UTC_HOURS = 2;
      const eventUtcMs = Date.UTC(year, month - 1, day, hourServer + SERVER_TO_UTC_HOURS, minute);

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

      // 同じチャンネル＋同じサーバータイムが既にあるかチェック
      const existing = [...eventReminders.values()].find(
        (e) => e.channelId === interaction.channelId && e.serverStr === serverStr
      );

      if (existing) {
        const confirmId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        pendingEventConfirms.set(confirmId, {
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          title,
          serverStr,
          jstStr,
          eventUtcMs,
          createdBy: interaction.user.id
        });
        setTimeout(() => pendingEventConfirms.delete(confirmId), EVENT_CONFIRM_TTL_MS);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`event-confirm:${confirmId}:add`)
            .setLabel('Add anyway')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`event-confirm:${confirmId}:cancel`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({
          content:
            '同じチャンネルで同じ日時のイベントが既に登録されています。\n' +
            `Existing: "${existing.title}" at ${existing.serverStr}\n\n` +
            '同じ時間にもう1件追加しますか？',
          components: [row]
        });

        return;
      }

      // 重複がない場合はそのまま登録
      const reminderId = scheduleEventReminder({
        channel: interaction.channel,
        guildId: interaction.guildId,
        title,
        serverStr,
        jstStr,
        eventUtcMs,
        requestedBy: interaction.user.id
      });

      await interaction.editReply({
        content:
          `イベントリマインドを登録しました。\n` +
          `サーバータイム **${serverStr}**（JST **${jstStr}**）の**5分前**と開始時刻に ` +
          `このチャンネルで @everyone に通知します。\n` +
          `タイトル: ${title}\n` +
          `ID: \`${reminderId}\` （キャンセルは /eventcancel でこのIDを指定）`,
        components: []
      });

      return;
    }

    if (interaction.commandName === 'eventlist') {
      const channelId = interaction.channelId;
      const entries = [...eventReminders.entries()]
        .filter(([, e]) => e.channelId === channelId)
        .map(([id, e]) => ({ id, ...e }))
        .sort((a, b) => (a.eventUtcMs ?? 0) - (b.eventUtcMs ?? 0));

      const maxShow = 25;
      const lines = entries.slice(0, maxShow).map(
        (e) => `• **${e.title}** — ${e.serverStr} (JST ${e.jstStr})\n  ID: \`${e.id}\``
      );
      let body =
        entries.length === 0
          ? 'このチャンネルに登録されたイベントはありません。'
          : `**このチャンネルの登録イベント（${entries.length}件）**\n\n` +
            lines.join('\n\n') +
            (entries.length > maxShow ? `\n\n（他 ${entries.length - maxShow} 件）` : '');
      if (body.length > 1990) body = body.slice(0, 1985) + '…（省略）';

      await interaction.reply({ content: body, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'eventcancel') {
      const id = interaction.options.getString('id', true);
      const entry = eventReminders.get(id);
      if (!entry) {
        await interaction.reply({
          content:
            'そのIDのイベントリマインドは見つかりませんでした。\n' +
            'すでに通知済みか、Botの再起動などで消えている可能性があります。',
          ephemeral: true
        });
        return;
      }

      if (entry.timeouts?.length) {
        for (const t of entry.timeouts) clearTimeout(t);
      }
      eventReminders.delete(id);

      await interaction.reply({
        content:
          'イベントリマインドをキャンセルしました。\n' +
          `ID: \`${id}\`\n` +
          `タイトル: ${entry.title}\n` +
          `サーバータイム: ${entry.serverStr}（JST ${entry.jstStr}）`,
        ephemeral: true
      });

      return;
    }
    }

    // ===== ボタンクリック（/event 重複確認） =====
    if (interaction.isButton()) {
      const [prefix, confirmId, action] = interaction.customId.split(':');
      if (prefix !== 'event-confirm') return;

      const data = pendingEventConfirms.get(confirmId);
      if (!data) {
        await interaction.reply({
          content: 'この確認は期限切れか、すでに処理済みです。',
          ephemeral: true
        });
        return;
      }

      pendingEventConfirms.delete(confirmId);

      if (action === 'cancel') {
        await interaction.update({
          content: 'イベントリマインドの追加をキャンセルしました。',
          components: []
        });
        return;
      }

      // action === 'add'
      const channel = interaction.channel;
      const reminderId = scheduleEventReminder({
        channel,
        guildId: data.guildId,
        title: data.title,
        serverStr: data.serverStr,
        jstStr: data.jstStr,
        eventUtcMs: data.eventUtcMs,
        requestedBy: interaction.user.id
      });

      await interaction.update({
        content:
          `同じ日時に既存のイベントがありましたが、追加登録しました。\n` +
          `Server time **${data.serverStr}**（JST **${data.jstStr}**）\n` +
          `Title: ${data.title}\n` +
          `ID: \`${reminderId}\``,
        components: []
      });
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

// 未処理の Promise 拒否でプロセスが黙って落ちないようにログを出す
process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandledRejection]', reason);
  if (reason && typeof reason === 'object' && 'stack' in reason) console.error((reason).stack);
});

const token = process.env.DISCORD_TOKEN;
// デバッグ用（トークンの中身は出さない）
console.log('DISCORD_TOKEN set:', !!token, '| OPENAI_API_KEY set:', !!process.env.OPENAI_API_KEY);
if (!token) {
  console.error('.env に DISCORD_TOKEN を設定してください');
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error('.env に OPENAI_API_KEY を設定してください');
  process.exit(1);
}

const LOGIN_TIMEOUT_MS = 90 * 1000;

function startBot() {
  console.log('Connecting to Discord gateway...');
  loginTimeoutId = setTimeout(() => {
    console.error(
      'Discord gateway timeout (90s). This Render instance\'s IP may be rate-limited by Discord. ' +
      'Try Railway, Fly.io, or another host.'
    );
    process.exit(1);
  }, LOGIN_TIMEOUT_MS);
  client.login(token).catch((err) => {
    if (loginTimeoutId) clearTimeout(loginTimeoutId);
    loginTimeoutId = null;
    console.error('Login failed:', err?.message ?? err);
    process.exit(1);
  });
}

startBot();

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
