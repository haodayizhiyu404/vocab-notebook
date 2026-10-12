/**
 * storage.js · 生词本文件存储
 * 落点：data/default-user/worlds/vocab-notebook.json（世界书文件，肉眼可见、可手动备份）
 * 读写走酒馆官方 /api/worldinfo/{get,edit}（整文件原子写 + 防抖）
 *
 * 世界书条目结构：key=[单词], comment=完整记录的 JSON 字符串, content=空（不注入提示词）
 */

import { getRequestHeaders } from '../../../../script.js';
import { newSrs } from './srs.js';

const WORLD_NAME = 'vocab-notebook';

let mirror = null;   // [{ word, added_at, senses, source, srs }] 会话内镜像
let writing = null;  // 防抖中的 Promise
let dirty = false;

async function apiGet() {
    const r = await fetch('/api/worldinfo/get', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name: WORLD_NAME }),
    });
    if (!r.ok) throw new Error(`读取生词本失败: HTTP ${r.status}`);
    return await r.json();
}

async function apiWrite(data) {
    const r = await fetch('/api/worldinfo/edit', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name: WORLD_NAME, data }),
    });
    if (!r.ok) throw new Error(`写入生词本失败: HTTP ${r.status}`);
}

/** 读文件 → 解析进内存镜像（幂等，会话内只读一次，外部改动后手动 reload） */
export async function load(force = false) {
    if (mirror && !force) return mirror;
    const world = await apiGet();
    mirror = [];
    let maxUid = 0;
    for (const [uidStr, entry] of Object.entries(world.entries || {})) {
        try {
            const record = JSON.parse(entry.comment);
            record._uid = Number(uidStr) || entry.uid;
            maxUid = Math.max(maxUid, record._uid);
            mirror.push(record);
        } catch (e) {
            console.warn('[Vocab] 跳过损坏条目 uid=', uidStr, e);
        }
    }
    mirror._maxUid = maxUid;
    return mirror;
}

function toWorldFile(list) {
    const entries = {};
    for (const rec of list) {
        const uid = rec._uid;
        const { _uid, ...clean } = rec;
        entries[String(uid)] = {
            uid: uid,
            key: [rec.word],
            keysecondary: [],
            comment: JSON.stringify(clean),
            content: '',
            order: 100,
            position: 0,
            depth: 4,
            selective: false,
            selectiveLogic: 0,
            addMemo: true,
            constant: false,
            disable: false,
            addKeys: [],
            useProbability: false,
            probability: 100,
            useGroupWeights: false,
            group: '',
            scanDepth: null,
            caseSensitive: null,
            matchWholeWords: null,
            useGroups: false,
            groupOverride: false,
            groupWeight: 100,
            recursionAware: false,
            excludeRecursion: false,
            preventRecursion: false,
            delayUntilRecursion: false,
            probabilitySequenced: false,
            sticky: 0,
            cooldown: null,
            delay: null,
        };
    }
    return { name: WORLD_NAME, entries: entries };
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
    const data = toWorldFile(mirror);
    writing = apiWrite(data).catch(e => {
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

/** 加词：已存在则返回 false（不覆盖旧记录，保留学习历史） */
export async function add(record) {
    await load();
    const key = record.word.trim().toLowerCase();
    if (mirror.some(r => r.word.trim().toLowerCase() === key)) return false;
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
        const key = rec.word.trim().toLowerCase();
        if (mirror.some(r => r.word.trim().toLowerCase() === key)) continue;
        mirror._maxUid = (mirror._maxUid || 0) + 1;
        rec._uid = mirror._maxUid;
        rec.srs = rec.srs || newSrs();
        mirror.push(rec);
        added++;
    }
    if (added > 0) scheduleWrite();
    return added;
}
