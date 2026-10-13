/**
 * dataio.js · 弹窗内「数据」标签：导出下载 / 导入合并 / 重新从磁盘加载 / 补齐音标
 */

import * as storage from './storage.js';
import { fetchPhonetic } from './ai.js';

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
        </div>
        <div id="vocab-data-msg" class="vocab-hint"></div>`;

    const msg = container.querySelector('#vocab-data-msg');

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
