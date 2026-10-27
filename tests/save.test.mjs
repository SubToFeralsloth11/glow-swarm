import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSave, sanitizeSave, sanitizeRun, loadSave, writeSave, applyRunResult, SAVE_KEY } from '../src/save.js';
import { ENEMY_HARD_CAP, PICKUP_CAP } from '../src/data.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
}

test('corrupt or missing save falls back to defaults', () => {
  assert.deepEqual(loadSave(memoryStorage()), defaultSave());
  assert.deepEqual(loadSave(memoryStorage({ [SAVE_KEY]: '{not json' })), defaultSave());
  assert.deepEqual(sanitizeSave('nope'), defaultSave());
});

test('save round-trips through storage', () => {
  const store = memoryStorage();
  const s = defaultSave();
  s.coins = 321;
  s.meta.hp = 3;
  s.weapons.push('zap');
  s.startWeapon = 'zap';
  s.settings.music = false;
  assert.equal(writeSave(s, store), true);
  assert.deepEqual(loadSave(store), s);
});

test('sanitize clamps tampered values and drops unknown content', () => {
  const s = sanitizeSave({
    coins: -50,
    meta: { hp: 99, power: 'x', bogus: 4 },
    unlockedStages: 42,
    weapons: ['laser', 'nova'],
    startWeapon: 'laser',
    settings: { sound: 'yes' },
  });
  assert.equal(s.coins, 0);
  assert.equal(s.meta.hp, 5);
  assert.equal(s.meta.power, 0);
  assert.equal('bogus' in s.meta, false);
  assert.equal(s.unlockedStages, 3);
  assert.deepEqual(s.weapons, ['blaster', 'nova']);
  assert.equal(s.startWeapon, 'blaster');
  assert.equal(s.settings.sound, true);
});

test('invalid in-progress run is discarded, valid one kept', () => {
  assert.equal(sanitizeSave({ run: { stage: 9, weapons: { blaster: 1 } } }).run, null);
  assert.equal(sanitizeSave({ run: { stage: 0, weapons: {} } }).run, null);
  const run = sanitizeSave({ run: { stage: 1, time: 75, level: 6, hp: 500, maxHp: 120, weapons: { blaster: 9, orbit: 2 }, passives: { might: 2, fake: 1 } } }).run;
  assert.equal(run.stage, 1);
  assert.equal(run.hp, 120);
  assert.deepEqual(run.weapons, { blaster: 5, orbit: 2 });
  assert.deepEqual(run.passives, { might: 2 });
});

test('prototype keys in a tampered save are ignored, not crashed on', () => {
  const s = sanitizeSave({
    weapons: ['constructor', '__proto__', 'zap'],
    run: {
      stage: 0,
      weapons: { blaster: 1, constructor: 3, toString: 2 },
      passives: { hasOwnProperty: 1 },
      enemies: [['constructor', 0, 0, 1, 0], ['__proto__', 0, 0, 1, 0], ['drone', 10, 20, 0.5, 0], ['boss', 0, 0, 1, 0]],
      pickups: [['toString', 0, 0, 1], ['xp', 5, 5, 3]],
    },
  });
  assert.deepEqual(s.weapons, ['blaster', 'zap']);
  assert.deepEqual(s.run.weapons, { blaster: 1 });
  assert.deepEqual(s.run.passives, {});
  assert.deepEqual(s.run.enemies, [['drone', 10, 20, 0.5, 0]]);
  assert.deepEqual(s.run.pickups, [['xp', 5, 5, 3]]);
});

test('oversized saved swarms and loot are trimmed to the in-game caps', () => {
  const run = sanitizeRun({
    stage: 0,
    weapons: { blaster: 1 },
    enemies: Array.from({ length: ENEMY_HARD_CAP + 1 }, (_, i) => ['drone', i, 0, 1, 0]),
    pickups: Array.from({ length: PICKUP_CAP + 1 }, (_, i) => ['xp', i, 0, 1]),
  });
  assert.equal(run.enemies.length, ENEMY_HARD_CAP);
  assert.equal(run.pickups.length, PICKUP_CAP);
});

test('winning a stage unlocks the next one, pays a bonus and clears the run', () => {
  const s = defaultSave();
  s.run = { stage: 0 };
  const earned = applyRunResult(s, { stage: 0, time: 320, kills: 900, level: 25, coins: 100, bosses: 1, won: true });
  assert.equal(s.unlockedStages, 2);
  assert.equal(earned, 100 + 60 + 25);
  assert.equal(s.coins, earned);
  assert.equal(s.run, null);
  assert.deepEqual(s.best.nebula, { time: 320, kills: 900, level: 25, won: true });
  assert.equal(s.stats.wins, 1);
});

test('losing never unlocks stages and greed multiplies coins', () => {
  const s = defaultSave();
  s.meta.greed = 2;
  const earned = applyRunResult(s, { stage: 0, time: 59, kills: 10, level: 2, coins: 10, bosses: 0, won: false });
  assert.equal(earned, 13);
  assert.equal(s.unlockedStages, 1);
});

test('personal best only improves: a win beats any loss, otherwise longer survival wins', () => {
  const s = defaultSave();
  applyRunResult(s, { stage: 0, time: 200, kills: 300, level: 10, coins: 0, bosses: 0, won: false });
  applyRunResult(s, { stage: 0, time: 120, kills: 500, level: 8, coins: 0, bosses: 0, won: false });
  assert.equal(s.best.nebula.time, 200);
  applyRunResult(s, { stage: 0, time: 310, kills: 700, level: 20, coins: 0, bosses: 1, won: true });
  applyRunResult(s, { stage: 0, time: 400, kills: 900, level: 22, coins: 0, bosses: 0, won: false });
  assert.equal(s.best.nebula.won, true);
  assert.equal(s.best.nebula.time, 310);
});
