/**
 * words.js · 词表浏览页（弹窗内「词表」标签）：搜索 / 按卡过滤 / 删除 / 看详情
 */

import * as storage from './storage.js';
import { esc, speak, cleanSourceLine } from './util.js';

function detailHtml(rec) {
    return rec.senses.map(s => `
        <div class="vocab-sense ${s.in_context ? 'ctx' : ''}">
            <div class="vocab-sense-head"><b>${esc(s.pos)}</b> ${esc(s.meaning)}
                ${s.in_context ? '<span class="vocab-ctx-badge">本剧情义项</span>' : ''}</div>
            <div class="vocab-example-row">
                <span class="vocab-example">${esc(s.example)}</span>
                ${s.example ? `<button class="vocab-mini-speak" data-say="${esc(s.example)}" title="朗读例句">🔊</button>` : ''}
            </div>
            ${s.example_translation ? `<div class="vocab-example-cn">${esc(s.example_translation)}</div>` : ''}
            ${(s.collocations || []).length ? `<div class="vocab-colloc">搭配：${s.collocations.map(esc).join('、')}</div>` : ''}
            ${s.note ? `<div class="vocab-note">💡 ${esc(s.note)}</div>` : ''}
        </div>`).join('');
}

export async function renderWordsTab(container) {
    await storage.load();
    const all = [...storage.list()].sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''));

    const cards = [...new Set(all.map(r => r.source?.card).filter(Boolean))];

    container.innerHTML = `
        <div class="vocab-toolbar">
            <input type="text" id="vocab-search" placeholder="搜索单词/释义…">
            <select id="vocab-card-filter"><option value="">全部卡片</option>
                ${cards.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
            </select>
        </div>
        <div id="vocab-list" class="vocab-list"></div>`;

    const listEl = container.querySelector('#vocab-list');
    const searchEl = container.querySelector('#vocab-search');
    const filterEl = container.querySelector('#vocab-card-filter');

    function apply() {
        const q = searchEl.value.trim().toLowerCase();
        const cf = filterEl.value;
        const rows = all.filter(r => {
            if (cf && r.source?.card !== cf) return false;
            if (!q) return true;
            return r.word.toLowerCase().includes(q)
                || r.senses.some(s => s.meaning.toLowerCase().includes(q));
        });
        listEl.innerHTML = rows.length === 0
            ? '<div class="vocab-empty">没有匹配的词条</div>'
            : rows.map(r => `
                <div class="vocab-item" data-word="${esc(r.word)}">
                    <div class="vocab-item-head">
                        <b>${esc(r.word)}</b>
                        <button class="vocab-item-speak" title="发音">🔊</button>
                        <span class="vocab-item-meaning">${esc(r.senses.find(s => s.in_context)?.meaning || r.senses[0]?.meaning || '')}</span>
                        <span class="vocab-item-due">下次: ${esc(r.srs?.due || '-')}</span>
                        <button class="vocab-item-del" title="删除">🗑</button>
                    </div>
                    <div class="vocab-item-detail" style="display:none">${detailHtml(r)}
                        <div class="vocab-source">出处：${esc(r.source?.card || '未知')} ｜ ${esc(cleanSourceLine(r.source?.line || ''))}</div>
                        ${(r.context_translation || (r.senses || []).find(s => s.in_context)?.example_translation)
                            ? `<div class="vocab-source-cn">${esc(r.context_translation || (r.senses || []).find(s => s.in_context)?.example_translation)}</div>` : ''}
                    </div>
                </div>`).join('');

        listEl.querySelectorAll('.vocab-item').forEach(item => {
            item.querySelector('.vocab-item-head').onclick = (e) => {
                if (e.target.closest('.vocab-item-del') || e.target.closest('.vocab-item-speak')) return;
                const d = item.querySelector('.vocab-item-detail');
                d.style.display = d.style.display === 'none' ? 'block' : 'none';
            };
            item.querySelector('.vocab-item-speak').onclick = (e) => {
                e.stopPropagation();
                speak(item.dataset.word);
            };
            item.querySelectorAll('.vocab-mini-speak').forEach(b => {
                b.onclick = (e) => { e.stopPropagation(); speak(b.dataset.say); };
            });
            item.querySelector('.vocab-item-del').onclick = async () => {
                if (!confirm(`删除词条「${item.dataset.word}」？`)) return;
                await storage.remove(item.dataset.word);
                item.remove();
            };
        });
    }

    searchEl.oninput = apply;
    filterEl.onchange = apply;
    apply();
}
