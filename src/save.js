// Persistent save data in localStorage. All reads are validated so a corrupt
// or older save never crashes the game; unknown fields are dropped.
import { META, STAGES, WEAPONS, PASSIVES, ENEMIES } from './data.js';

export const SAVE_KEY = 'glowswarm.save.v1';

export function defaultSave() {
  return {
    version: 1,
    coins: 0,
    meta: Object.fromEntries(Object.keys(META).map((k) => [k, 0])),
    unlockedStages: 1,
    weapons: ['blaster'],
    startWeapon: 'blaster',
    best: {}, // stageId -> { time, kills, level, won }
    stats: { runs: 0, kills: 0, bosses: 0, wins: 0, playTime: 0, coinsEarned: 0 },
    settings: { sound: true, music: true, haptics: true, damageNumbers: true },
    tutorialDone: false,
    run: null, // in-progress run snapshot, see Game.snapshot()
  };
}

const int = (v, min, max, d) => (Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : d);
const num = (v, min, max, d) => (Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

function sanitizeLevels(obj, table, maxOf) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    if (table[k]) {
      const lv = int(v, 0, maxOf(k), 0);
      if (lv > 0) out[k] = lv;
    }
  }
  return out;
}

export function sanitizeRun(run) {
  if (!run || typeof run !== 'object') return null;
  const stage = run.stage;
  if (!Number.isInteger(stage) || stage < 0 || stage >= STAGES.length) return null;
  const weapons = sanitizeLevels(run.weapons, WEAPONS, (k) => WEAPONS[k].levels.length);
  if (Object.keys(weapons).length === 0) return null;
  const maxHp = num(run.maxHp, 1, 10000, 100);
  return {
    stage,
    time: num(run.time, 0, 3600, 0),
    level: int(run.level, 1, 999, 1),
    xp: num(run.xp, 0, 1e7, 0),
    hp: num(run.hp, 1, maxHp, maxHp),
    maxHp,
    weapons,
    passives: sanitizeLevels(run.passives, PASSIVES, (k) => PASSIVES[k].max),
    kills: int(run.kills, 0, 1e7, 0),
    coins: int(run.coins, 0, 1e7, 0),
    revives: int(run.revives, 0, 1, 0),
    rerolls: int(run.rerolls, 0, 99, 0),
    nextElite: num(run.nextElite, 0, 3600, 60),
    nextSwarm: num(run.nextSwarm, 0, 3600, 45),
    pendingLevelUps: int(run.pendingLevelUps, 0, 99, 0),
    bossHp: Number.isFinite(run.bossHp) ? Math.max(0.01, Math.min(1, run.bossHp)) : null,
    bossDefeated: bool(run.bossDefeated, false),
    enemies: sanitizeEnemies(run.enemies),
  };
}

// Saved swarm entries: [type, dx, dy, hpFraction, elite]. Bosses are restored separately.
function sanitizeEnemies(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const e of list.slice(0, 320)) {
    if (!Array.isArray(e) || !ENEMIES[e[0]] || ENEMIES[e[0]].boss) continue;
    if (![e[1], e[2], e[3]].every(Number.isFinite)) continue;
    out.push([e[0], num(e[1], -3000, 3000, 0), num(e[2], -3000, 3000, 0), num(e[3], 0.01, 1, 1), e[4] ? 1 : 0]);
  }
  return out;
}

export function sanitizeSave(raw) {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const s = d;
  s.coins = int(raw.coins, 0, 1e9, 0);
  for (const k of Object.keys(META)) s.meta[k] = int(raw.meta?.[k], 0, META[k].max, 0);
  s.unlockedStages = int(raw.unlockedStages, 1, STAGES.length, 1);
  if (Array.isArray(raw.weapons)) {
    s.weapons = [...new Set(['blaster', ...raw.weapons.filter((w) => WEAPONS[w])])];
  }
  s.startWeapon = s.weapons.includes(raw.startWeapon) ? raw.startWeapon : 'blaster';
  if (raw.best && typeof raw.best === 'object') {
    for (const st of STAGES) {
      const b = raw.best[st.id];
      if (b && typeof b === 'object') {
        s.best[st.id] = {
          time: num(b.time, 0, 3600, 0),
          kills: int(b.kills, 0, 1e7, 0),
          level: int(b.level, 1, 999, 1),
          won: bool(b.won, false),
        };
      }
    }
  }
  for (const k of Object.keys(s.stats)) s.stats[k] = num(raw.stats?.[k], 0, 1e12, 0);
  for (const k of Object.keys(s.settings)) s.settings[k] = bool(raw.settings?.[k], s.settings[k]);
  s.tutorialDone = bool(raw.tutorialDone, false);
  s.run = sanitizeRun(raw.run);
  return s;
}

export function loadSave(storage = globalThis.localStorage) {
  try {
    const txt = storage?.getItem(SAVE_KEY);
    return txt ? sanitizeSave(JSON.parse(txt)) : defaultSave();
  } catch {
    return defaultSave();
  }
}

export function writeSave(save, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false; // storage full / private mode: keep playing without persistence
  }
}

// Apply the result of a finished run to the save. Returns the coins awarded.
export function applyRunResult(save, result) {
  const greed = 1 + 0.15 * save.meta.greed;
  const stage = STAGES[result.stage];
  const winBonus = result.won ? 60 * (result.stage + 1) : 0;
  const survivalBonus = 5 * Math.floor(result.time / 60); // every minute survived pays out
  const earned = Math.round(result.coins * greed) + winBonus + survivalBonus;
  save.coins += earned;
  save.stats.runs += 1;
  save.stats.kills += result.kills;
  save.stats.bosses += result.bosses;
  save.stats.playTime += result.time;
  save.stats.coinsEarned += earned;
  if (result.won) {
    save.stats.wins += 1;
    save.unlockedStages = Math.max(save.unlockedStages, Math.min(STAGES.length, result.stage + 2));
  }
  const prev = save.best[stage.id];
  const better = !prev || (result.won && !prev.won) || (result.won === prev.won && result.time > prev.time);
  if (better) save.best[stage.id] = { time: result.time, kills: result.kills, level: result.level, won: result.won };
  save.run = null;
  return earned;
}
