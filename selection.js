/**
 * selection.js · 聊天内选词收录
 * - 桌面端：选中文字 → 选区上方浮出"＋ 生词"按钮
 * - 触屏端：选区下方浮出（原生选区面板在上方，两者共存；可先翻译再收录）
 * 判别用 pointer: coarse —— maxTouchPoints 会把带触控板的笔记本误判成触屏
 */

import { getContext } from '../../../extensions.js';
import * as storage from './storage.js';
import * as ai from './ai.js';
import { getConfig } from './config.js';

const isCoarse = window.matchMedia
    ? window.matchMedia('(pointer: coarse)').matches
    : navigator.maxTouchPoints > 0;
let floatBtn = null;
let busy = false;
let selTimer = null;

function ensureBtn() {
    if (floatBtn) return floatBtn;
    floatBtn = document.createElement('div');
    floatBtn.id = 'vocab-sel-btn';
    floatBtn.textContent = '＋ 生词';
    floatBtn.title = '加入生词本并解析';
    document.body.appendChild(floatBtn);
    return floatBtn;
}

function hideBtn() {
    if (floatBtn) floatBtn.style.display = 'none';
}

function selectionInChat(sel) {
    if (!sel.rangeCount) return null;
    const node = sel.getRangeAt(0).commonAncestorContainer;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return el?.closest?.('#chat .mes_text') ?? null;
}

/** 取当前选区（若在聊天内且长度合适）→ 收录所需 payload；否则 null */
export function getChatSelection() {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text || text.length > 120) return null; // 选中过长视为误操作
    const mesText = selectionInChat(sel);
    if (!mesText) return null;
    return {
        text: text,
        sentence: getSentenceContext(mesText, text),
        plot: getCurrentMessageText(mesText), // 选区所在楼的完整正文（已剥元信息块）
        card: currentCardName(),
    };
}

/** 取出处整句：从选区所在块级元素取文本（剥元信息块，防渲染出的思考区混入） */
function getSentenceContext(mesTextEl, selected) {
    const blocks = mesTextEl.querySelectorAll('p, li, div, blockquote, h1, h2, h3, h4, h5, h6');
    for (const b of blocks) {
        if (b.textContent.includes(selected)) {
            return stripMetaBlocks(b.textContent).slice(0, 500);
        }
    }
    return stripMetaBlocks(mesTextEl.textContent).slice(0, 500);
}

/** 黑名单制剥离：六类元信息块（标签+内容）整块删除，其余一切视为正文。
 *  标签各自独立成块、不相嵌套；块匹配长度限 20000 字符，某标签未闭合时
 *  最多剥不掉该块（内容泄漏），绝不会反吞正文。 */
const META_BLOCK_RE = /<(cot|thinking|think|summary|abstract|skit)>[\s\S]{0,20000}?<\/\1>/gi;

function stripMetaBlocks(text) {
    return String(text || '')
        .replace(META_BLOCK_RE, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** 取选区所在那一楼（消息）的完整正文作为剧情语境，上限 2000 字 */
function getCurrentMessageText(mesTextEl) {
    const mesEl = mesTextEl.closest('.mes');
    const idx = Number(mesEl?.getAttribute('mesid'));
    const chat = getContext().chat || [];
    const mes = Number.isInteger(idx) ? chat[idx] : null;
    if (!mes || typeof mes.mes !== 'string') return '';
    return stripMetaBlocks(mes.mes).slice(0, 2000);
}

function currentCardName() {
    const ctx = getContext();
    const idx = Number(ctx.characterId);
    if (Number.isInteger(idx) && idx >= 0) return ctx.characters[idx]?.name || '';
    return '';
}

/**
 * 收录：AI 解析 → 入库 → toast。
 * @param clearSelection 收录后是否清除选区（浮动按钮流程清；菜单流程保留，方便继续用原生翻译）
 */
export async function captureSelection(payload, { clearSelection = false } = {}) {
    if (!payload || busy) return false;
    busy = true;
    try {
        const record = await ai.lookup(payload.text, payload.sentence, payload.plot, payload.card);
        const added = await storage.add(record);
        if (added) {
            toastr.success(`已收录「${record.word}」（${record.senses.length} 个义项）`, '生词本', { timeOut: 2500 });
        } else {
            toastr.info(`「${record.word}」已在生词本中`, '生词本', { timeOut: 2000 });
        }
        document.dispatchEvent(new CustomEvent('vocab-changed'));
        if (clearSelection) window.getSelection()?.removeAllRanges();
        return true;
    } catch (e) {
        console.error('[Vocab]', e);
        toastr.error('收录失败：' + e.message, '生词本', { timeOut: 5000 });
        return false;
    } finally {
        busy = false;
    }
}

function showBtn(rect, payload) {
    const btn = ensureBtn();
    btn.dataset.payload = JSON.stringify(payload);
    btn.style.display = 'block';
    // 桌面端：选区上方；触屏端：选区下方（避开顶部原生选区面板，两者共存）
    const top = isCoarse
        ? Math.min(window.innerHeight - 44, rect.bottom + 10)
        : Math.max(8, rect.top - 34);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - 90);
    btn.style.top = top + 'px';
    btn.style.left = left + 'px';
}

export function initSelection() {
    const btn = ensureBtn();
    btn.onclick = () => {
        const payload = JSON.parse(floatBtn.dataset.payload || '{}');
        if (!payload.text || busy) return;
        // 点击反馈：解析中状态（收录失败/成功都由 captureSelection 弹 toast）
        btn.textContent = '解析中…';
        btn.style.opacity = '.7';
        captureSelection(payload, { clearSelection: true }).then((ok) => {
            btn.textContent = '＋ 生词';
            btn.style.opacity = '';
            if (ok) hideBtn();
        });
    };

    if (!isCoarse) {
        // 桌面端：mouseup 时弹按钮
        document.addEventListener('mouseup', (e) => {
            if (e.target === btn || btn.contains(e.target)) return;
            setTimeout(() => {
                if (!getConfig().captureEnabled) { hideBtn(); return; }
                const sel = window.getSelection();
                if (!sel || sel.isCollapsed || !sel.toString().trim()) { hideBtn(); return; }
                const rect = sel.getRangeAt(0).getBoundingClientRect();
                const payload = getChatSelection();
                if (!payload) { hideBtn(); return; }
                showBtn(rect, payload);
            }, 10);
        });
        document.addEventListener('mousedown', (e) => {
            if (floatBtn && e.target !== floatBtn && !floatBtn.contains(e.target)) hideBtn();
        });
    } else {
        // 触屏端：选区稳定后弹按钮在选区下方；选区塌缩即隐藏
        document.addEventListener('selectionchange', () => {
            clearTimeout(selTimer);
            selTimer = setTimeout(() => {
                if (!getConfig().captureEnabled) { hideBtn(); return; }
                const sel = window.getSelection();
                if (!sel || sel.isCollapsed || !sel.toString().trim()) { hideBtn(); return; }
                const payload = getChatSelection();
                if (!payload) { hideBtn(); return; }
                const rect = sel.getRangeAt(0).getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) { hideBtn(); return; }
                showBtn(rect, payload);
            }, 350); // 等拖完选区手柄稳定
        });
        // 点到页面别处时隐藏
        document.addEventListener('touchstart', (e) => {
            if (floatBtn && e.target !== floatBtn && !floatBtn.contains(e.target)) hideBtn();
        }, { passive: true });
    }

    document.addEventListener('scroll', hideBtn, true);
}
