/**
 * selection.js · 聊天内选词：选中文字 → 悬浮"＋生词"按钮 → AI 解析入库
 */

import { getContext } from '../../../extensions.js';
import * as storage from './storage.js';
import * as ai from './ai.js';
import { getConfig } from './config.js';

let floatBtn = null;
let busy = false;

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

function showBtn(rect, payload) {
    const btn = ensureBtn();
    btn.dataset.payload = JSON.stringify(payload);
    btn.style.display = 'block';
    // 定位在选区上方，钳制在视口内
    const top = Math.max(8, rect.top - 34);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - 90);
    btn.style.top = top + 'px';
    btn.style.left = left + 'px';
}

/** 取出处消息整句：从选区所在文本节点所在的块级元素取文本 */
function getSentenceContext(mesTextEl, selected) {
    const blocks = mesTextEl.querySelectorAll('p, li, div, blockquote, h1, h2, h3, h4, h5, h6');
    for (const b of blocks) {
        if (b.textContent.includes(selected)) {
            return b.textContent.replace(/\s+/g, ' ').trim();
        }
    }
    return mesTextEl.textContent.replace(/\s+/g, ' ').trim();
}

/** 最近剧情摘要：最后 6 条 AI 消息，各截 200 字 */
function getPlotSummary() {
    const chat = getContext().chat || [];
    return chat.filter(m => !m.is_user && !m.is_system).slice(-6)
        .map(m => String(m.mes || '').replace(/<[^>]+>/g, '').slice(0, 200))
        .join('\n---\n');
}

function currentCardName() {
    const ctx = getContext();
    const idx = Number(ctx.characterId);
    if (Number.isInteger(idx) && idx >= 0) return ctx.characters[idx]?.name || '';
    return '';
}

async function onBtnClick() {
    if (busy) return;
    const payload = JSON.parse(floatBtn.dataset.payload || '{}');
    if (!payload.text) return;
    busy = true;
    floatBtn.textContent = '解析中…';
    try {
        const record = await ai.lookup(payload.text, payload.sentence, payload.plot, payload.card);
        const added = await storage.add(record);
        if (added) {
            toastr.success(`已收录「${record.word}」（${record.senses.length} 个义项）`, '生词本', { timeOut: 2500 });
        } else {
            toastr.info(`「${record.word}」已在生词本中`, '生词本', { timeOut: 2000 });
        }
        document.dispatchEvent(new CustomEvent('vocab-changed'));
    } catch (e) {
        console.error('[Vocab]', e);
        toastr.error('收录失败：' + e.message, '生词本', { timeOut: 5000 });
    } finally {
        busy = false;
        floatBtn.textContent = '＋ 生词';
        hideBtn();
        window.getSelection()?.removeAllRanges();
    }
}

export function initSelection() {
    const btn = ensureBtn();
    btn.onclick = onBtnClick;

    document.addEventListener('mouseup', (e) => {
        if (e.target === btn || btn.contains(e.target)) return;
        setTimeout(() => {
            if (!getConfig().captureEnabled) { hideBtn(); return; } // 总开关关闭时不收录
            const sel = window.getSelection();
            const text = sel ? sel.toString().trim() : '';
            const mesText = text ? selectionInChat(sel) : null;
            if (!text || !mesText) { hideBtn(); return; }
            if (text.length > 120) { hideBtn(); return; } // 选中过长视为误操作
            const rect = sel.getRangeAt(0).getBoundingClientRect();
            showBtn(rect, {
                text: text,
                sentence: getSentenceContext(mesText, text),
                plot: getPlotSummary(),
                card: currentCardName(),
            });
        }, 10);
    });

    document.addEventListener('mousedown', (e) => {
        if (floatBtn && e.target !== floatBtn && !floatBtn.contains(e.target)) hideBtn();
    });

    document.addEventListener('scroll', hideBtn, true);
}
