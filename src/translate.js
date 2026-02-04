import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** 国旗絵文字 → 言語コード */
export const FLAG_TO_LANG = {
  '🇯🇵': 'ja',   // 日本語
  '🇺🇸': 'en',   // 英語（米）
  '🇬🇧': 'en',   // 英語（英）
  '🇰🇷': 'ko',   // 韓国語
  '🇹🇼': 'zh-TW', // 中国語（台湾・繁体字）
  '🇮🇩': 'id',   // インドネシア語
  '🇻🇳': 'vi'    // ベトナム語
};

const LANG_NAMES = {
  'ja': '日本語',
  'en': '英語',
  'ko': '韓国語',
  'zh-TW': '中国語（台湾）',
  'id': 'インドネシア語',
  'vi': 'ベトナム語'
};

/**
 * テキストを指定言語に翻訳する（ChatGPT API）
 * @param {string} text - 翻訳するテキスト
 * @param {string} targetLang - 言語コード (ja, en, ko, zh-TW, id, vi)
 * @returns {Promise<string>} 翻訳結果
 */
export async function translate(text, targetLang) {
  const langName = LANG_NAMES[targetLang] ?? targetLang;
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `あなたは翻訳者です。ユーザーのテキストを${langName}に自然に翻訳してください。翻訳結果のみを返し、説明や注釈は付けないでください。`
      },
      {
        role: 'user',
        content: text
      }
    ],
    max_tokens: 1000,
    temperature: 0.3
  });

  const result = response.choices[0]?.message?.content?.trim();
  if (!result) throw new Error('翻訳結果が空です');
  return result;
}

/**
 * リアクションの絵文字から言語コードを取得する
 * @param {string} emoji - 絵文字（name または id）
 * @returns {string|null} 言語コード、未対応なら null
 */
export function getLangFromEmoji(emoji) {
  return FLAG_TO_LANG[emoji] ?? null;
}
