import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** 国旗絵文字 → 言語コード */
export const FLAG_TO_LANG = {
  '🇯🇵': 'ja',   // 日本語
  '🇺🇸': 'en',   // 英語（米）
  '🇬🇧': 'en',   // 英語（英）
  '🇰🇷': 'ko',   // 韓国語
  '🇹🇼': 'zh-TW', // 中国語（繁体字）
  '🇨🇳': 'zh-CN', // 中国語（簡体字）
  '🇮🇩': 'id',   // インドネシア語
  '🇻🇳': 'vi',   // ベトナム語
  '🇸🇦': 'ar',   // アラビア語（現代標準アラビア語・フスハー）
  '🇪🇬': 'ar',   // アラビア語（エジプトなどでも同じフスハーで翻訳）
  '🇦🇪': 'ar'    // アラビア語（UAEなど）
};

const LANG_NAMES = {
  'ja': '日本語',
  'en': '英語',
  'ko': '韓国語',
  'zh-TW': '中国語（繁体字）',
  'zh-CN': '中国語（簡体字）',
  'id': 'インドネシア語',
  'vi': 'ベトナム語',
  'ar': 'アラビア語（現代標準アラビア語）'
};

/**
 * テキストを指定言語に翻訳する（ChatGPT API）
 * @param {string} text - 翻訳するテキスト
 * @param {string} targetLang - 言語コード (ja, en, ko, zh-TW, id, vi, ar)
 * @returns {Promise<string>} 翻訳結果
 */
export async function translate(text, targetLang) {
  const langName = LANG_NAMES[targetLang] ?? targetLang;
  const response = await openai.chat.completions.create({
    model: 'gpt-5.1-chat-latest',
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
    max_completion_tokens: 1000,
    temperature: 0.3
  });

  const result = response.choices[0]?.message?.content?.trim();
  if (!result) throw new Error('翻訳結果が空です');
  return result;
}

/**
 * 画像内の文字を読み取り、指定言語に翻訳する（Vision API）
 * @param {string} imageUrl - 画像の URL（Discord の attachment.url など）
 * @param {string} targetLang - 言語コード
 * @returns {Promise<string>} 翻訳結果
 */
export async function translateImage(imageUrl, targetLang) {
  const extracted = await extractTextFromImageBestEffort(imageUrl);
  if (!extracted) {
    const langName = LANG_NAMES[targetLang] ?? targetLang;
    return await translate('画像に文字は見つかりませんでした。', targetLang).catch(() => `画像に文字は見つかりませんでした（${langName}）`);
  }
  return await translate(extracted, targetLang);
}

function normalizeOcrText(s) {
  const t = (s ?? '').trim();
  if (!t) return '';
  // よくある「文字がない」系の返答を弾く（モデルに言わせない前提だが保険）
  const lower = t.toLowerCase();
  if (lower.includes('no text') || lower.includes('no visible text') || t.includes('見つかりません') || t.includes('ありません')) {
    // ただし短文全てを潰すと誤検知するので、極端に短い場合のみ空扱いにする
    if (t.length < 40) return '';
  }
  return t;
}

async function extractTextFromImageOnce(imageUrl, model, prompt) {
  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content:
          'あなたはOCRエンジンです。画像に写っている文字を、可能な限り漏らさず正確に抽出してください。' +
          '出力は「抽出した文字だけ」。説明、注釈、前置き、箇条書きタイトル、囲み、翻訳は一切しないこと。'
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
        ]
      }
    ],
    // OCRは創造性不要
    temperature: 0,
    max_completion_tokens: 1200
  });

  return normalizeOcrText(response.choices[0]?.message?.content);
}

async function extractTextFromImageBestEffort(imageUrl) {
  // 1回目: 速いモデル + 高詳細
  const p1 =
    '画像内の文字をそのまま抽出してください。改行や空白の意味がある場合はできるだけ維持。' +
    '見出し・本文・UIラベル・チャット文・小さい文字も含めて、読める範囲で全部。';
  const first = await extractTextFromImageOnce(imageUrl, 'gpt-5.1-chat-latest', p1);
  if (first) return first;

  // 2回目: 同じモデルで「小さい文字/薄い文字/斜め」まで粘る（gpt-4o 終了に伴い gpt-5.1-chat-latest に統一）
  const p2 =
    '画像内の文字を可能な限り抽出してください。小さい文字、薄い文字、斜めの文字、背景に埋もれた文字も拡大して読むつもりで抽出。' +
    '一部しか読めなくても、読めた文字は必ず出力してください。';
  const second = await extractTextFromImageOnce(imageUrl, 'gpt-5.1-chat-latest', p2);
  return second;
}

/**
 * リアクションの絵文字から言語コードを取得する
 * 一部クライアントは絵文字にバリアントセレクタ(U+FE0F)を付けるので、まずそれを取り除いてから判定する
 * @param {string} emoji - 絵文字（name または id）
 * @returns {string|null} 言語コード、未対応なら null
 */
export function getLangFromEmoji(emoji) {
  const raw = emoji ?? '';
  const cleaned = raw.replace(/\uFE0F/g, '');
  return FLAG_TO_LANG[cleaned] ?? FLAG_TO_LANG[raw] ?? null;
}
