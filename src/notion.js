import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

const EVENT_DB_ID = process.env.NOTION_EVENT_DB_ID;
const USER_LANG_DB_ID = process.env.NOTION_USER_LANG_DB_ID;

// ========================================
// Event Reminders
// ========================================

export async function loadEventRemindersFromNotion() {
  if (!EVENT_DB_ID) throw new Error('NOTION_EVENT_DB_ID not set');
  
  const reminders = new Map();
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: EVENT_DB_ID,
      start_cursor: startCursor
    });

    for (const page of response.results) {
      const props = page.properties;
      const id = props.id?.title?.[0]?.plain_text;
      if (!id) continue;

      reminders.set(id, {
        channelId: props.channelId?.rich_text?.[0]?.plain_text ?? '',
        guildId: props.guildId?.rich_text?.[0]?.plain_text ?? '',
        title: props.eventTitle?.rich_text?.[0]?.plain_text ?? '',
        serverStr: props.serverStr?.rich_text?.[0]?.plain_text ?? '',
        jstStr: props.jstStr?.rich_text?.[0]?.plain_text ?? '',
        eventUtcMs: props.eventUtcMs?.number ?? 0,
        createdBy: props.createdBy?.rich_text?.[0]?.plain_text ?? '',
        sent5min: props.sent5min?.checkbox ?? false,
        sentStart: props.sentStart?.checkbox ?? false,
        pageId: page.id
      });
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  return reminders;
}

export async function saveEventReminderToNotion(id, reminder) {
  if (!EVENT_DB_ID) throw new Error('NOTION_EVENT_DB_ID not set');

  // 既存ページを検索
  const existing = await notion.databases.query({
    database_id: EVENT_DB_ID,
    filter: {
      property: 'id',
      title: {
        equals: id
      }
    }
  });

  const properties = {
    id: {
      title: [{ text: { content: id } }]
    },
    channelId: {
      rich_text: [{ text: { content: reminder.channelId || '' } }]
    },
    guildId: {
      rich_text: [{ text: { content: reminder.guildId || '' } }]
    },
    eventTitle: {
      rich_text: [{ text: { content: reminder.title || '' } }]
    },
    serverStr: {
      rich_text: [{ text: { content: reminder.serverStr || '' } }]
    },
    jstStr: {
      rich_text: [{ text: { content: reminder.jstStr || '' } }]
    },
    eventUtcMs: {
      number: reminder.eventUtcMs || 0
    },
    createdBy: {
      rich_text: [{ text: { content: reminder.createdBy || '' } }]
    },
    sent5min: {
      checkbox: !!reminder.sent5min
    },
    sentStart: {
      checkbox: !!reminder.sentStart
    }
  };

  if (existing.results.length > 0) {
    // 更新
    await notion.pages.update({
      page_id: existing.results[0].id,
      properties
    });
  } else {
    // 新規作成
    await notion.pages.create({
      parent: { database_id: EVENT_DB_ID },
      properties
    });
  }
}

export async function deleteEventReminderFromNotion(id) {
  if (!EVENT_DB_ID) throw new Error('NOTION_EVENT_DB_ID not set');

  const existing = await notion.databases.query({
    database_id: EVENT_DB_ID,
    filter: {
      property: 'id',
      title: {
        equals: id
      }
    }
  });

  if (existing.results.length > 0) {
    await notion.pages.update({
      page_id: existing.results[0].id,
      archived: true
    });
  }
}

// ========================================
// User Language Settings
// ========================================

export async function loadUserLangSettingsFromNotion() {
  if (!USER_LANG_DB_ID) throw new Error('NOTION_USER_LANG_DB_ID not set');
  
  const settings = new Map();
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: USER_LANG_DB_ID,
      start_cursor: startCursor
    });

    for (const page of response.results) {
      const props = page.properties;
      const userId = props.userId?.title?.[0]?.plain_text;
      const lang = props.lang?.rich_text?.[0]?.plain_text;
      if (userId && lang) {
        settings.set(userId, lang);
      }
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  return settings;
}

export async function saveUserLangSettingToNotion(userId, lang) {
  if (!USER_LANG_DB_ID) throw new Error('NOTION_USER_LANG_DB_ID not set');

  // 既存ページを検索
  const existing = await notion.databases.query({
    database_id: USER_LANG_DB_ID,
    filter: {
      property: 'userId',
      title: {
        equals: userId
      }
    }
  });

  const properties = {
    userId: {
      title: [{ text: { content: userId } }]
    },
    lang: {
      rich_text: [{ text: { content: lang || '' } }]
    }
  };

  if (existing.results.length > 0) {
    // 更新
    await notion.pages.update({
      page_id: existing.results[0].id,
      properties
    });
  } else {
    // 新規作成
    await notion.pages.create({
      parent: { database_id: USER_LANG_DB_ID },
      properties
    });
  }
}
