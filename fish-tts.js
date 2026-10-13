/**
 * fish-tts.js · 生词本的 Fish 发音
 * 复用 Multi-Char TTS 扩展的全局配置（key/模型），音色由本扩展 config.ttsVoiceId 指定。
 * 音频存为 files 目录下的真实文件（/api/files/upload 写、/user/files/* 直读直播），
 * 文件名 = vocab-a-<文本哈希>.mp3；删除词条时按哈希联动删除。
 * 任何一步不满足都返回 false，由调用方回退浏览器发音。
 */

import { extension_settings } from '../../../extensions.js';
import { getConfig } from './config.js';

// ---------- TTS 扩展的全局配置（只读） ----------
function ttsGlobal() {
    return extension_settings['multi-char-tts'] || {};
}

// ---------- 文件名哈希（FNV-1a，文本 ↔ 文件 的确定性映射） ----------
export function audioFileName(text) {
    let h = 0x811c9dc5;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
    }
    return 'vocab-a-' + h.toString(16) + '.mp3';
}

export function audioFileUrl(text) {
    return '/user/files/' + audioFileName(text);
}

// ---------- CSRF ----------
let csrfToken = null;
async function getCsrf() {
    if (csrfToken) return csrfToken;
    try {
        const r = await fetch('/csrf-token');
        if (r.ok) csrfToken = (await r.json()).token;
    } catch (e) { /* 老版本无此路由就免头 */ }
    return csrfToken;
}

async function postJson(url, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = await getCsrf();
    if (token) headers['X-CSRF-Token'] = token;
    return fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
}

// ---------- blob → base64 ----------
async function blobToB64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) {
        bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    }
    return btoa(bin);
}

async function urlExists(url) {
    try {
        const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        return r.ok;
    } catch (e) { return false; }
}

// ---------- 播放 ----------
let currentAudio = null;
function stopCurrent() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
}

/** 删除指定文本的音频文件（删词条联动清理用） */
export async function deleteAudioFile(text) {
    try {
        await postJson('/api/files/delete', { path: audioFileUrl(text) });
    } catch (e) { /* 残留无害 */ }
}

/**
 * 用 Fish 朗读 text。成功返回 true；未配置/失败返回 false（调用方回退浏览器发音）。
 * 音频落 files 目录，已存在则直链播放。
 */
export async function fishSpeak(text) {
    const g = ttsGlobal();
    const voice = getConfig().ttsVoiceId;
    if (!g.fishKey || !voice || !text) return false;
    try {
        const url = audioFileUrl(text);
        if (!(await urlExists(url))) {
            const r = await fetch('/proxy/https://api.fish.audio/v1/tts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${g.fishKey}`,
                    'model': g.fishModel || 's2.1-pro-free',
                },
                body: JSON.stringify({ text: text, reference_id: voice, format: 'mp3' }),
            });
            if (!r.ok) return false;
            const blob = await r.blob();
            const up = await postJson('/api/files/upload', {
                name: audioFileName(text),
                data: await blobToB64(blob),
            });
            if (!up.ok) return false; // 存不下就本次直读 blob，不阻塞播放
        }
        stopCurrent();
        const audio = new Audio();
        currentAudio = audio;
        audio.src = url;
        audio.onended = () => { if (currentAudio === audio) currentAudio = null; };
        await audio.play();
        return true;
    } catch (e) {
        console.warn('[Vocab] Fish 发音失败，回退浏览器发音', e);
        return false;
    }
}
