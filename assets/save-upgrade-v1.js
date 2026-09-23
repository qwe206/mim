// Upgrade additive book releases without replaying opening effects or story turns.
import { l as db, O as sessions, P as Save, I as Turn, i as store } from './index-CnBWxGMu.js';

const pending = new Map();
function compare(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
function valid(def, value) {
  if (def.type === 'number') return typeof value === 'number' && Number.isFinite(value) && (def.min === undefined || value >= def.min) && (def.max === undefined || value <= def.max);
  if (def.type === 'enum') return typeof value === 'string' && def.values.includes(value);
  return typeof value === def.type;
}
export function migrate(save, turns, book, key) {
  if (save.bookId !== book.manifest.bookId) throw Error('不是同一个剧本');
  function snapshot(original) {
    const next = structuredClone(original);
    for (const id of [next.currentStage, next.endingStage].filter(Boolean)) {
      if (!book.stages.some(s => s.id === id)) throw Error('新版移除了存档中的章节：' + id);
    }
    for (const def of book.stateSchema) {
      if (!Object.hasOwn(next.state, def.id)) next.state[def.id] = structuredClone(def.default);
      else if (!valid(def, next.state[def.id])) throw Error('新版变量与已有进度不兼容：' + def.id);
    }
    // Preserve the old time of day when introducing the minute clock.
    if (!Object.hasOwn(original.state, 'time.minuteOfDay') && Object.hasOwn(next.state, 'time.minuteOfDay')) {
      const clock = original.state['time.clock'];
      const minute = typeof clock === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(clock)
        ? Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3))
        : ({'清晨':360,'上午':540,'中午':720,'下午':840,'傍晚':1080,'夜晚':1260,'深夜':1380}[original.state['time.period']]);
      if (minute !== undefined) next.state['time.minuteOfDay'] = minute;
      const m = next.state['time.minuteOfDay'];
      if (Object.hasOwn(next.state, 'time.clock')) next.state['time.clock'] = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    }
    return next;
  }
  const nextTurns = turns.map(t => Turn.parse({...t, snapshot:snapshot(t.snapshot)}));
  const nextSave = Save.parse({...save, bookKey:key, bookVersion:book.manifest.version,
    initial:snapshot(save.initial), snapshot:snapshot(save.snapshot), panelResults:undefined,
    revision:save.revision + 1, updatedAt:Date.now()});
  return {save:nextSave, turns:nextTurns};
}

async function upgrade(id) {
  const active = sessions.get(id) || [...sessions.values()].find(s => s.slotId === id);
  if (active?.generating || active?.saving) return;
  const original = active?.save || await db.saves.get(id);
  if (!original) return;
  const latest = (await db.books.toArray()).filter(b => !b.hidden && b.book.manifest.bookId === original.bookId)
    .sort((a,b) => compare(b.book.manifest.version, a.book.manifest.version))[0];
  if (!latest || compare(latest.book.manifest.version, original.bookVersion) <= 0) return;
  try {
    if (active) {
      if (active.generating || active.saving || compare(latest.book.manifest.version, active.save.bookVersion) <= 0) return;
      const revision = active.save.revision, epoch = active.epoch;
      const result = migrate(active.save, active.turns, latest.book, latest.key);
      if (active.generating || active.saving || active.epoch !== epoch || active.save.revision !== revision) return;
      active.save = result.save; active.turns = result.turns; active.dirty = true; active.epoch++;
    } else {
      await db.transaction('rw', db.books, db.saves, db.turns, async () => {
        const current = await db.saves.get(id);
        if (!current || compare(latest.book.manifest.version, current.bookVersion) <= 0) return;
        if (!await db.books.get(latest.key)) throw Error('新版剧本已被删除');
        const turns = await db.turns.where('saveId').equals(id).toArray();
        const result = migrate(current, turns, latest.book, latest.key);
        await db.turns.bulkPut(result.turns);
        await db.saves.put(result.save);
      });
    }
    store.getState().notify('存档已兼容升级至 ' + latest.book.manifest.version + '，原有进度已保留。');
  } catch (error) {
    store.getState().notify('继续使用原版存档。' + (error instanceof Error ? error.message : String(error)), true);
  }
}
export function upgradeSave(id) {
  if (!pending.has(id)) pending.set(id, upgrade(id).finally(() => pending.delete(id)));
  return pending.get(id);
}
