/**
 * review.js · 复习翻卡页（弹窗内「复习」标签）
 */

import * as storage from './storage.js';
import * as srs from './srs.js';
import { esc, speak, cleanSourceLine } from './util.js';

const QUALITY = { again: 0, hard: 3, good: 5 };
let deck = [];        // 今日到期队列
let flipped = false;

function senseHtml(s) {
    const badge = s.in_context ? '<span class="vocab-ctx-badge">本剧情义项</span>' : '';
    const cols = (s.collocations || []).length
        ? `<div class="vocab-colloc">搭配：${s.collocations.map(esc).join('、')}</div>` : '';
    const note = s.note ? `<div class="vocab-note">💡 ${esc(s.note)}</div>` : '';
    const trans = s.example_translation ? `<div class="vocab-example-cn">${esc(s.example_translation)}</div>` : '';
    const say = esc(s.example || '');
    return `<div class="vocab-sense ${s.in_context ? 'ctx' : ''}">
        <div class="vocab-sense-head"><b>${esc(s.pos)}</b> ${esc(s.meaning)} ${badge}</div>
        <div class="vocab-example-row">
            <span class="vocab-example">${esc(s.example)}</span>
            ${s.example ? `<button class="vocab-mini-speak" data-say="${say}" title="朗读例句">🔊</button>` : ''}
        </div>
        ${trans}${cols}${note}
    </div>`;
}

function bindMiniSpeaks(container) {
    container.querySelectorAll('.vocab-mini-speak').forEach(b => {
        b.onclick = (e) => { e.stopPropagation(); speak(b.dataset.say); };
    });
}

/** 出处块：原句（代码抓的 ground truth）+ AI 整句翻译（旧词条回退用义项例句译文） */
function sourceBlock(rec) {
    const line = cleanSourceLine(rec.source?.line || '');
    const trans = rec.context_translation
        || (rec.senses || []).find(s => s.in_context)?.example_translation
        || '';
    return `<div class="vocab-source">出处：${esc(rec.source?.card || '未知')} ｜ ${esc(line)}</div>
        ${trans ? `<div class="vocab-source-cn">${esc(trans)}</div>` : ''}`;
}

function render(container) {
    if (deck.length === 0) {
        container.innerHTML = `<div class="vocab-empty">🎉 今日到期已全部清完</div>`;
        return;
    }
    const rec = deck[0];
    if (!flipped) {
        container.innerHTML = `
            <div class="vocab-card front" id="vocab-card">
                <div class="vocab-word">${esc(rec.word)}</div>
                <button class="vocab-speak-btn" id="vocab-speak" title="发音">🔊</button>
                <div class="vocab-flip-hint">点击卡片翻面看解析</div>
            </div>
            <div class="vocab-progress">剩余 ${deck.length} 张</div>`;
        container.querySelector('#vocab-card').onclick = (e) => {
            if (e.target.closest('.vocab-speak-btn')) return;
            flipped = true;
            render(container);
        };
        container.querySelector('#vocab-speak').onclick = (e) => {
            e.stopPropagation();
            speak(rec.word);
        };
    } else {
        const sorted = [...rec.senses].sort((a, b) => (b.in_context ? 1 : 0) - (a.in_context ? 1 : 0));
        container.innerHTML = `
            <div class="vocab-card back">
                <div class="vocab-word-row">
                    <span class="vocab-word small">${esc(rec.word)}</span>
                    <button class="vocab-speak-btn" id="vocab-speak2" title="发音">🔊</button>
                </div>
                ${sorted.map(senseHtml).join('')}
                ${sourceBlock(rec)}
            </div>
            <div class="vocab-grade-row">
                <button data-q="${QUALITY.again}" class="vocab-grade again">不会</button>
                <button data-q="${QUALITY.hard}" class="vocab-grade hard">模糊</button>
                <button data-q="${QUALITY.good}" class="vocab-grade good">认识</button>
            </div>
            <div class="vocab-progress">剩余 ${deck.length} 张</div>`;
        container.querySelector('#vocab-speak2').onclick = () => speak(rec.word);
        bindMiniSpeaks(container);
        container.querySelectorAll('.vocab-grade').forEach(btn => {
            btn.onclick = async () => {
                const q = Number(btn.dataset.q);
                await storage.update(rec.word, (r) => { r.srs = srs.grade(r.srs, q); });
                deck.shift();
                flipped = false;
                render(container);
            };
        });
    }
}

export async function renderReviewTab(container) {
    flipped = false;
    await storage.load();
    const today = srs.todayStr();
    deck = storage.list().filter(r => srs.isDue(r.srs, today))
        .sort((a, b) => (a.srs.due || '').localeCompare(b.srs.due || ''));
    render(container);
}
