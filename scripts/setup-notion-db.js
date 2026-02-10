#!/usr/bin/env node
import 'dotenv/config';
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function setupEventRemindersDB() {
  const dbId = process.env.NOTION_EVENT_DB_ID;
  if (!dbId) {
    console.error('NOTION_EVENT_DB_ID が設定されていません');
    return false;
  }

  try {
    console.log('EventReminders データベースのプロパティを設定中...');
    
    // 既存のデータベース情報を取得
    const db = await notion.databases.retrieve({ database_id: dbId });
    const existingProps = db.properties;
    
    // 既存のタイトルプロパティを探す
    const titleProp = Object.entries(existingProps).find(([_, prop]) => prop.type === 'title');
    const titlePropName = titleProp ? titleProp[0] : 'Name';
    
    console.log(`  既存のタイトルプロパティ: "${titlePropName}"`);
    
    // ステップ1: 既存のタイトルプロパティを "id" にリネーム
    if (titlePropName !== 'id') {
      await notion.databases.update({
        database_id: dbId,
        properties: {
          [titlePropName]: { name: 'id' }
        }
      });
      console.log(`  ✓ タイトルプロパティを "id" にリネーム`);
    }
    
    // ステップ2: 他のプロパティを追加
    await notion.databases.update({
      database_id: dbId,
      properties: {
        channelId: { rich_text: {} },
        guildId: { rich_text: {} },
        eventTitle: { rich_text: {} },
        serverStr: { rich_text: {} },
        jstStr: { rich_text: {} },
        eventUtcMs: { number: {} },
        createdBy: { rich_text: {} },
        sent5min: { checkbox: {} },
        sentStart: { checkbox: {} }
      }
    });
    
    console.log('✓ EventReminders データベースの設定完了');
    return true;
  } catch (err) {
    console.error('EventReminders データベースの設定エラー:', err.message);
    return false;
  }
}

async function setupUserLangSettingsDB() {
  const dbId = process.env.NOTION_USER_LANG_DB_ID;
  if (!dbId) {
    console.error('NOTION_USER_LANG_DB_ID が設定されていません');
    return false;
  }

  try {
    console.log('UserLangSettings データベースのプロパティを設定中...');
    
    // 既存のデータベース情報を取得
    const db = await notion.databases.retrieve({ database_id: dbId });
    const existingProps = db.properties;
    
    // 既存のタイトルプロパティを探す
    const titleProp = Object.entries(existingProps).find(([_, prop]) => prop.type === 'title');
    const titlePropName = titleProp ? titleProp[0] : 'Name';
    
    // プロパティを更新
    const properties = {
      lang: { rich_text: {} }
    };
    
    // 既存のタイトルプロパティを "userId" にリネーム
    if (titlePropName !== 'userId') {
      properties[titlePropName] = { name: 'userId' };
    }
    
    await notion.databases.update({
      database_id: dbId,
      properties
    });
    
    console.log('✓ UserLangSettings データベースの設定完了');
    return true;
  } catch (err) {
    console.error('UserLangSettings データベースの設定エラー:', err.message);
    return false;
  }
}

async function main() {
  console.log('Notion データベースのセットアップを開始します...\n');
  
  if (!process.env.NOTION_API_KEY) {
    console.error('エラー: NOTION_API_KEY が設定されていません');
    process.exit(1);
  }

  const results = await Promise.all([
    setupEventRemindersDB(),
    setupUserLangSettingsDB()
  ]);

  if (results.every(r => r)) {
    console.log('\n✅ すべてのデータベースのセットアップが完了しました！');
    process.exit(0);
  } else {
    console.log('\n❌ 一部のデータベースのセットアップに失敗しました');
    process.exit(1);
  }
}

main();
