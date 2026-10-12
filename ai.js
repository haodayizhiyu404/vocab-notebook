/**
 * ai.js · 调当前聊天连接做词条解析（generateRaw 静默调用，不产生消息）
 */

import { generateRaw } from '../../../../script.js';
import { newSrs } from './srs.js';

const SYSTEM = 'You are a dictionary assistant for a Chinese learner studying American English through an immersive roleplay story. Reply with a single valid JSON object and nothing else.';

function buildPrompt(word, sentence, plot) {
    return `The learner selected this text from a story chat: "${word}"

Sentence it appeared in: "${sentence}"

Recent story context (for disambiguation):
"""
${plot}
"""

Analyze the selected text and return a JSON object with EXACTLY this shape:
{
  "word": "<the headword, lowercase unless proper noun>",
  "context_translation": "<faithful Chinese translation of the FULL sentence it appeared in>",
  "senses": [
    {
      "pos": "<part of speech, e.g. v./n./phr.>",
      "meaning": "<concise Chinese meaning>",
      "in_context": <true for the sense used in THIS story context>,
      "example": "<the sentence above, trimmed>",
      "example_translation": "<faithful Chinese translation of the example sentence>",
      "collocations": ["<common collocations, 0-3>"],
      "note": "<usage/memory tip in Chinese, or empty>"
    }
  ]
}

Rules:
- 1-4 senses. The FIRST sense must be the one matching the story context (in_context=true).
- If other common senses exist (e.g. "row" = 划船 vs 一排), include them with in_context=false.
- If the selection is a phrase/idiom, treat the whole phrase as the headword.
- LEMMATIZE: if the selection is an inflected form, record the base dictionary form instead — "heading to" -> "head to", "went" -> "go", "bigger" -> "big". Keep phrasal-verb particles ("looked after" -> "look after"). Verb "be"/"have" forms map to "be"/"have".
- All meanings/notes in Chinese; examples kept in English.
- Valid JSON only. No markdown fences, no commentary.`;
}

function extractJson(text) {
    const cleaned = String(text).replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('AI 未返回 JSON');
    return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * 查词：返回标准化词条记录；失败抛错（由调用方 toast）
 */
export async function lookup(selectedText, sentence, plot, sourceCard) {
    const prompt = buildPrompt(selectedText, sentence, plot);
    const raw = await generateRaw({
        prompt: prompt,
        systemPrompt: SYSTEM,
        jsonSchema: null, // 部分后端不支持 response_format；靠提示词 + 防御解析
    });

    const data = extractJson(raw);
    if (!data.word || !Array.isArray(data.senses) || data.senses.length === 0) {
        throw new Error('AI 返回结构不完整');
    }

    return {
        word: String(data.word),
        added_at: new Date().toISOString().slice(0, 10),
        context_translation: String(data.context_translation || ''),
        senses: data.senses.slice(0, 4).map(s => ({
            pos: String(s.pos || ''),
            meaning: String(s.meaning || ''),
            in_context: !!s.in_context,
            example: String(s.example || sentence || ''),
            example_translation: String(s.example_translation || ''),
            collocations: Array.isArray(s.collocations) ? s.collocations.map(String).slice(0, 3) : [],
            note: String(s.note || ''),
        })),
        source: {
            card: sourceCard || '',
            line: String(sentence || '').slice(0, 300),
        },
        srs: newSrs(),
    };
}
