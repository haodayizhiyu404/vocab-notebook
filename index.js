/**
 * index.js · 生词本扩展入口
 * 装配：魔法棒菜单 + 弹窗（menu.js）、聊天选词（selection.js）、落盘兜底（storage.flushNow）
 */

import { initMenu } from './menu.js';
import { initSelection } from './selection.js';
import { getConfig, saveConfig } from './config.js';
import * as storage from './storage.js';

// 扩展设置里的唯一配置项：选词收录总开关（生词本本体在魔法棒菜单里）
function injectSettingsDrawer() {
    const container = document.querySelector('#extensions_settings2')
        || document.querySelector('#extensions_settings');
    if (!container || document.getElementById('vocab-settings-drawer')) return;
    const wrap = document.createElement('div');
    wrap.id = 'vocab-settings-drawer';
    wrap.className = 'inline-drawer';
    wrap.innerHTML = `
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>生词本 (Vocab Notebook)</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <label class="vocab-setting-row">
                <input type="checkbox" id="vocab-capture-toggle" ${getConfig().captureEnabled ? 'checked' : ''}>
                启用选词收录（聊天中选词显示「＋ 生词」按钮）
            </label>
            <div class="vocab-hint">生词本界面：魔法棒菜单 → 生词本。词库文件：data/default-user/worlds/vocab-notebook.json</div>
        </div>`;
    container.appendChild(wrap);
    wrap.querySelector('#vocab-capture-toggle').addEventListener('change', (e) => {
        getConfig().captureEnabled = e.target.checked;
        saveConfig();
        toastr.info(e.target.checked ? '选词收录已开启' : '选词收录已关闭', '生词本', { timeOut: 1500 });
    });
}

export function init() {
    try {
        initMenu();
        initSelection();
        injectSettingsDrawer();
        // 切页/关页前把未落盘的改动写出去
        window.addEventListener('pagehide', () => { storage.flushNow(); });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') storage.flushNow();
        });
        console.info('[Vocab] 生词本扩展已加载');
    } catch (e) {
        console.error('[Vocab] 初始化失败:', e);
        try {
            toastr.error(`生词本初始化失败：${e.message}`, '生词本', { timeOut: 10000 });
        } catch (_) { /* toastr 不可用时只能看控制台 */ }
    }
}
