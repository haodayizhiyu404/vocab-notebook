/**
 * srs.js · SM-2 间隔重复（纯逻辑，无副作用）
 * quality: 0 = 不会，3 = 模糊，5 = 认识
 */

export function newSrs() {
    return { ease: 2.5, interval: 0, due: todayStr(), reps: 0 };
}

export function todayStr(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}

export function isDue(srs, dateStr) {
    return (srs.due || todayStr()) <= (dateStr || todayStr());
}

/**
 * 打分后返回新的 srs 对象（不改动入参）
 */
export function grade(srs, quality) {
    const next = { ...srs };
    next.reps = (next.reps || 0) + 1;

    if (quality < 3) {
        next.reps = 0;
        next.interval = 0;
        next.due = todayStr(1); // 明天再见
        return next;
    }

    if (next.reps === 1) {
        next.interval = 1;
    } else if (next.reps === 2) {
        next.interval = 3;
    } else {
        next.interval = Math.max(1, Math.round((next.interval || 1) * next.ease));
    }

    next.ease = Math.max(1.3, next.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
    next.due = todayStr(next.interval);
    return next;
}
