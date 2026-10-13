/**
 * fish-tts.js · 生词本的 Fish 发音
 * 复用 Multi-Char TTS 扩展的全局配置（key/模型），音色由本扩展 config.ttsVoiceId 指定。
 * 音频持久化在 IndexedDB，反复听零请求。任何一步不满足都返回 false，由调用方回退浏览器发音。
 */

import { extension_settings } from '../../../extensions.js';
import { getConfig } from './config.js';

// ---------- TTS 扩展的全局配置（只读） ----------
function ttsGlobal() {
    return extension_settings['multi-char-tts'] || {};
}

// ---------- IndexedDB 音频缓存 ----------
const IDB_NAME = 'vocab-audio';
const IDB_STORE = 'audio';
let idbPromise = null;

function idbOpen() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise((resolve, reject) => {
        const rq = indexedDB.open(IDB_NAME, 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore(IDB_STORE);
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => reject(rq.error);
    });
    return idbPromise;
}

async function idbGet(key) {
    try {
        const db = await idbOpen();
        return await new Promise((resolve, reject) => {
            const rq = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
            rq.onsuccess = () => resolve(rq.result || null);
            rq.onerror = () => reject(rq.error);
        });
    } catch (e) { return null; }
}

async function idbPut(key, blob) {
    try {
        const db = await idbOpen();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(blob, key);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) { /* 缓存失败不影响播放 */ }
}

// ---------- 播放 ----------
let currentAudio = null;
function stopCurrent() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
}

let csrfToken = null;
async function getCsrf() {
    if (csrfToken) return csrfToken;
    try {
        const r = await fetch('/csrf-token');
        if (r.ok) csrfToken = (await r.json()).token;
    } catch (e) { /* 老版本无此路由就免头 */ }
    return csrfToken;
}

/**
 * 用 Fish 朗读 text。成功返回 true；未配置/失败返回 false（调用方回退浏览器发音）。
 */
export async function fishSpeak(text) {
    const g = ttsGlobal();
    const voice = getConfig().ttsVoiceId;
    if (!g.fishKey || !voice || !text) return false;
    try {
        const key = 'v|' + text;
        let blob = await idbGet(key);
        if (!blob) {
            const token = await getCsrf();
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${g.fishKey}`,
                'model': g.fishModel || 's2.1-pro-free',
            };
            if (token) headers['X-CSRF-Token'] = token;
            const r = await fetch('/proxy/https://api.fish.audio/v1/tts', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ text: text, reference_id: voice, format: 'mp3' }),
            });
            if (!r.ok) return false;
            blob = await r.blob();
            idbPut(key, blob);
        }
        stopCurrent();
        const url = URL.createObjectURL(blob);
        const audio = new Audio();
        currentAudio = audio;
        audio.src = url;
        audio.onended = () => { URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; };
        await audio.play();
        return true;
    } catch (e) {
        console.warn('[Vocab] Fish 发音失败，回退浏览器发音', e);
        return false;
    }
}
