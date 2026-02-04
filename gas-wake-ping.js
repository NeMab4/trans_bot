/**
 * Google Apps Script: Render の Discord Bot を定期的に起こす
 *
 * 使い方:
 * 1. https://script.google.com で「新しいプロジェクト」を作成
 * 2. このファイルの中身をコピーして貼り付け
 * 3. RENDER_WAKE_URL をあなたの Render の URL に変更（例: https://trans-bot-xxxx.onrender.com）
 * 4. 保存して「実行」で一度テスト
 * 5. 「トリガー」を追加 → 時間駆動型 → 分ベースのタイマー → 15分おき など
 */

const RENDER_WAKE_URL = 'https://あなたのサービス名.onrender.com'; // 要変更

function wakeRender() {
  try {
    const response = UrlFetchApp.fetch(RENDER_WAKE_URL, {
      method: 'get',
      muteHttpExceptions: true
    });
    console.log('Wake ping: ' + response.getResponseCode());
  } catch (e) {
    console.error('Wake ping failed: ' + e.message);
  }
}
