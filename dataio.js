/**
 * dataio.js · 弹窗内「数据」标签：导出下载 / 导入合并 / 重新从磁盘加载 / 补齐音标
 */

import * as storage from './storage.js';
import { fetchPhonetic } from './ai.js';
import { getConfig, saveConfig } from './config.js';
import { idbListKeys, idbDelete } from './fish-tts.js';

export async function renderDataTab(container) {
    container.innerHTML = `
        <div class="vocab-data-info">
            生词本存于酒馆数据目录的世界书文件：<code>data/default-user/worlds/vocab-notebook.json</code><br>
            可直接用编辑器查看备份；也可在世界书界面里浏览（content 为空，不会注入提示词）。
        </div>
        <div class="vocab-data-row">
            <button id="vocab-export">导出 JSON（下载）</button>
            <button id="vocab-reload">从磁盘重新加载</button>
        </div>
        <div class="vocab-data-row">
            <input type="file" id="vocab-import-file" accept=".json" style="display:none">
            <button id="vocab-import">导入 JSON（合并去重）</button>
            <button id="vocab-backfill">补齐缺失音标</button>
            <button id="vocab-gc-audio">清理孤儿音频</button>
        </div>
        <label class="vocab-field" style="margin-top:10px">Fish 发音音色 ID
            <input type="text" id="vocab-tts-voice" placeholder="Fish 广场复制；留空则用浏览器发音" value="">
        </label>
        <div class="vocab-hint">填入后，复习/词表里的 🔊 改用 Fish 朗读（复用 Multi-Char TTS 的 key），音频本地缓存；不填则回退浏览器发音。</div>
        <div id="vocab-data-msg" class="vocab-hint"></div>`;

    const msg = container.querySelector('#vocab-data-msg');

    // Fish 发音音色（失焦即存）
    const voiceInput = container.querySelector('#vocab-tts-voice');
    voiceInput.value = getConfig().ttsVoiceId || '';
    voiceInput.addEventListener('change', () => {
        getConfig().ttsVoiceId = voiceInput.value.trim();
        saveConfig();
        msg.textContent = getConfig().ttsVoiceId ? 'Fish 发音已启用。' : '已回退浏览器发音。';
    });

    // 孤儿音频清扫：缓存键不属于任何现存词条（单词/例句）的即删除
    container.querySelector('#vocab-gc-audio').onclick = async () => {
        await storage.load();
        const live = new Set();
        for (const rec of storage.list()) {
            live.add('v|' + rec.word);
            for (const s of rec.senses || []) {
                if (s.example) live.add('v|' + s.example);
            }
        }
        const keys = await idbListKeys();
        let removed = 0;
        for (const k of keys) {
            if (typeof k === 'string' && k.startsWith('v|') && !live.has(k)) {
                await idbDelete(k);
                removed++;
            }
        }
        msg.textContent = `音频清理完成：删除 ${removed} 条孤儿缓存，保留 ${keys.length - removed} 条。`;
    };

    container.querySelector('#vocab-export').onclick = async () => {
        const text = await storage.exportJson();
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'vocab-notebook.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        msg.textContent = '已导出。';
    };

    container.querySelector('#vocab-reload').onclick = async () => {
        await storage.load(true);
        msg.textContent = `已从磁盘加载，共 ${storage.list().length} 条。`;
        document.dispatchEvent(new CustomEvent('vocab-changed'));
    };

    // 补齐缺失音标：逐词查词典 API（短语拆词拼接），查不到保持空白
    container.querySelector('#vocab-backfill').onclick = async () => {
        const btn = container.querySelector('#vocab-backfill');
        btn.disabled = true;
        try {
            await storage.load();
            const targets = storage.list().filter(r => !r.phonetic);
            let done = 0, failed = 0;
            for (const rec of targets) {
                msg.textContent = `补齐音标中… ${done + failed + 1}/${targets.length}（${rec.word}）`;
                const ph = await fetchPhonetic(rec.word);
                if (ph) {
                    await storage.update(rec.word, (r) => { r.phonetic = ph; });
                    done++;
                } else {
                    failed++;
                }
                await new Promise(r => setTimeout(r, 150)); // 温和限速
            }
            msg.textContent = `音标补齐完成：成功 ${done}，查不到 ${failed}。`;
        } catch (e) {
            msg.textContent = '补齐失败：' + e.message;
        } finally {
            btn.disabled = false;
        }
    };

    const fileInput = container.querySelector('#vocab-import-file');
    container.querySelector('#vocab-import').onclick = () => fileInput.click();
    fileInput.onchange = async () => {
        const file = fileInput.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const added = await storage.importJson(text);
            msg.textContent = `导入完成：新增 ${added} 条（重复跳过）。`;
            document.dispatchEvent(new CustomEvent('vocab-changed'));
        } catch (e) {
            msg.textContent = '导入失败：' + e.message;
        }
        fileInput.value = '';
    };
}
