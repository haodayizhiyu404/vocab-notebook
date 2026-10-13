/**
 * storage.js · 生词本文件存储
 * 落点：data/default-user/files/vocab-notebook.json —— 格式自由的独立本地文件
 *   读：GET  /user/files/vocab-notebook.json（酒馆静态文件服务）
 *   写：POST /api/files/upload（base64 整写，防抖）
 * 文件内容就是词条数组本身，无任何包装结构。
 * 旧版曾寄存在世界书文件（vocab-notebook world），首次读取时自动迁移并删除旧文件。
 */

import { newSrs } from './srs.js';
import { deleteAudioFile } from './fish-tts.js';

const FILE_NAME = 'vocab-notebook.json';
const OLD_WORLD_NAME = 'vocab-notebook';

let mirror = null;   // [{ word, added_at, senses, source, srs, phonetic, ... }]
let writing = null;
let dirty = false;
let csrfToken = null;

async function getCsrfToken() {
    if (csrfToken) return csrfToken;
    const r = await fetch('/csrf-token');
    if (!r.ok) throw new Error(`获取 CSRF token 失败: HTTP ${r.status}`);
    csrfToken = (await r.json()).token;
    return csrfToken;
}

/** UTF-8 安全的 base64（TextEncoder 分块，防大文件栈溢出） */
function utf8ToB64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
}

async function apiWrite(records) {
    const data = utf8ToB64(JSON.stringify(records, null, 2));
    const r = await fetch('/api/files/upload', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': await getCsrfToken(),
        },
        body: JSON.stringify({ name: FILE_NAME, data: data }),
    });
    if (!r.ok) throw new Error(`写入生词本失败: HTTP ${r.status}`);
}

/** 一次性迁移：从旧世界书文件读回词条数组；成功返回记录，无旧文件返回 null */
async function readOldWorld() {
    try {
        const r = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await getCsrfToken() },
            body: JSON.stringify({ name: OLD_WORLD_NAME }),
        });
        if (!r.ok) return null;
        const world = await r.json();
        const records = [];
        for (const entry of Object.values(world.entries || {})) {
            try {
                const rec = JSON.parse(entry.comment);
                if (rec && typeof rec.word === 'string') records.push(rec);
            } catch (e) { /* 跳过损坏条目 */ }
        }
        return records;
    } catch (e) {
        return null;
    }
}

async function apiGet() {
    const r = await fetch('/user/files/' + FILE_NAME, { cache: 'no-store' });
    if (r.ok) {
        const text = await r.text();
        const arr = JSON.parse(text || '[]');
        return Array.isArray(arr) ? arr : [];
    }
    if (r.status !== 404) throw new Error(`读取生词本失败: HTTP ${r.status}`);
    // 新文件不存在：尝试从旧世界书迁移
    const old = await readOldWorld();
    if (old && old.length > 0) {
        await apiWrite(old);
        // 迁移成功后删除旧世界书文件（尽力而为）
        try {
            await fetch('/api/worldinfo/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({ name: OLD_WORLD_NAME }),
            });
        } catch (e) { /* 旧文件残留无害 */ }
        console.info('[Vocab] 已从世界书文件迁移到 files 目录：', old.length, '条');
        return old;
    }
    return []; // 全新用户
}

/** 读文件 → 解析进内存镜像（幂等；force 用于外部改动后手动 reload） */
export async function load(force = false) {
    if (mirror && !force) return mirror;
    const records = await apiGet();
    mirror = [];
    let maxUid = 0;
    for (const rec of records) {
        rec._uid = rec._uid ?? ++maxUid;
        maxUid = Math.max(maxUid, rec._uid);
        mirror.push(rec);
    }
    mirror._maxUid = maxUid;
    return mirror;
}

function scheduleWrite() {
    dirty = true;
    clearTimeout(scheduleWrite._t);
    scheduleWrite._t = setTimeout(flush, 800);
}

/** 防抖整写（800ms 合并连续改动） */
export async function flush() {
    if (!dirty || !mirror) return;
    dirty = false;
    const snapshot = mirror.map(({ _uid, ...rest }) => ({ ...rest, _uid }));
    writing = apiWrite(snapshot).catch(e => {
        dirty = true; // 失败恢复脏标记，下次重试
        console.error('[Vocab]', e);
        throw e;
    }).finally(() => { writing = null; });
    return writing;
}

/** 立即写（页面隐藏/切页面前兜底） */
export async function flushNow() {
    clearTimeout(scheduleWrite._t);
    return flush();
}

/** 规范化词目键：首尾空白、词间多空格压成单空格、忽略大小写 */
function normKey(word) {
    return String(word || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 精确匹配：是否已收录该词（含短语）。供解析前的零成本拦截 */
export async function has(word) {
    await load();
    const key = normKey(word);
    return mirror.some(r => normKey(r.word) === key);
}

/** 加词：已存在则返回 false（不覆盖旧记录，保留学习历史） */
export async function add(record) {
    await load();
    const key = normKey(record.word);
    if (mirror.some(r => normKey(r.word) === key)) return false;
    mirror._maxUid = (mirror._maxUid || 0) + 1;
    record._uid = mirror._maxUid;
    record.srs = record.srs || newSrs();
    mirror.push(record);
    scheduleWrite();
    return true;
}

export async function update(word, updater) {
    await load();
    const rec = mirror.find(r => r.word === word);
    if (!rec) return false;
    updater(rec);
    scheduleWrite();
    return true;
}

export async function remove(word) {
    await load();
    const i = mirror.findIndex(r => r.word === word);
    if (i < 0) return false;
    // 联动删除该词条的音频文件（单词 + 例句），不留孤儿
    const rec = mirror[i];
    deleteAudioFile(rec.word);
    for (const s of rec.senses || []) {
        if (s.example) deleteAudioFile(s.example);
    }
    mirror.splice(i, 1);
    scheduleWrite();
    return true;
}

export function list() {
    return mirror || [];
}

export async function exportJson() {
    await load();
    const { _maxUid, ...rest } = mirror;
    return JSON.stringify(rest, null, 2);
}

/** 导入：合并外部 JSON（按 word 去重，跳过已存在） */
export async function importJson(text) {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error('格式错误：应为词条数组');
    await load();
    let added = 0;
    for (const rec of arr) {
        if (!rec || typeof rec.word !== 'string') continue;
        const key = normKey(rec.word);
        if (mirror.some(r => normKey(r.word) === key)) continue;
        mirror._maxUid = (mirror._maxUid || 0) + 1;
        rec._uid = mirror._maxUid;
        rec.srs = rec.srs || newSrs();
        mirror.push(rec);
        added++;
    }
    if (added > 0) scheduleWrite();
    return added;
}
