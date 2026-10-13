/**
 * util.js · 公共小工具：HTML 转义 + 浏览器原生发音
 */

export function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

let enVoice = null;

function pickVoice() {
    if (enVoice) return enVoice;
    const voices = window.speechSynthesis?.getVoices() || [];
    enVoice = voices.find(v => v.lang === 'en-US')
        || voices.find(v => v.lang?.startsWith('en'))
        || null;
    return enVoice;
}

// voices 是异步加载的，提前触发 + 监听
if (window.speechSynthesis) {
    pickVoice();
    window.speechSynthesis.onvoiceschanged = () => { enVoice = null; pickVoice(); };
}

/** 浏览器原生 TTS 读单词（用户手势内调用，无请求无依赖） */
export function speak(text) {
    if (!window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
}

/** 清理出处原句：剥掉【人名】：前缀、TTS 装饰按钮字符、行尾内嵌的（翻译），压行 */
export function cleanSourceLine(line) {
    let t = String(line || '')
        .replace(/^\s*【[^】]*】\s*[:：]\s*/, '')
        .replace(/🔊/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    // 行尾的全角括号翻译剥掉：译文统一由第三行（AI 的 context_translation）呈现，避免重复
    let prev;
    do {
        prev = t;
        t = t.replace(/（[^（）]*）\s*$/u, '').trim();
    } while (t !== prev);
    if (t.length > 150) {
        const cut = t.slice(0, 150);
        const parenStart = cut.lastIndexOf('（');
        const parenEnd = cut.lastIndexOf('）');
        if (parenStart > parenEnd) {
            // 括号被切断：回退到括号前，避免半个括号悬着
            t = cut.slice(0, parenStart).trim() + ' …';
        } else {
            t = cut.trim() + ' …';
        }
    }
    return t;
}

/** 出处块三行式：卡片名 / 原文 / 原文翻译 */
export function sourceBlockHtml(rec) {
    const line = cleanSourceLine(rec?.source?.line || '');
    const trans = rec?.context_translation
        || (rec?.senses || []).find(s => s.in_context)?.example_translation
        || '';
    return `<div class="vocab-src">
        <div class="vocab-src-meta">📖 ${esc(rec?.source?.card || '未知')}</div>
        ${line ? `<div class="vocab-src-line">${esc(line)}</div>` : ''}
        ${trans ? `<div class="vocab-src-cn">${esc(trans)}</div>` : ''}
    </div>`;
}
