import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, mulberry32 } from '../src/game.js';
import { defaultSave, sanitizeRun } from '../src/save.js';
import { WEAPONS, PASSIVES, xpForLevel } from '../src/data.js';
import { botInput, simulate } from './sim.mjs';

function newGame(opts = {}) {
  const events = { end: null, levelUps: 0, boss: 0 };
  const g = new Game({
    stage: 0,
    save: opts.save || defaultSave(),
    rng: mulberry32(opts.seed || 7),
    snapshot: opts.snapshot,
    hooks: { end: (r) => (events.end = r), levelUp: () => events.levelUps++, boss: () => events.boss++ },
  });
  return { g, events };
}

function run(g, seconds, { choose = true } = {}) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps && g.state !== 'dead' && g.state !== 'won'; i++) {
    if (g.state === 'levelup') { if (choose) g.choose(0); else return; }
    g.input = botInput(g);
    g.update(1 / 60);
  }
}

test('a 90 second run stays numerically sane and progresses', () => {
  const { g } = newGame();
  run(g, 90);
  const finite = (o) => Number.isFinite(o.x) && Number.isFinite(o.y);
  assert.ok(finite(g.player));
  assert.ok(g.enemies.every(finite));
  assert.ok(g.enemies.every((e) => Number.isFinite(e.hp)));
  assert.ok(g.kills > 20, `kills ${g.kills}`);
  assert.ok(g.level >= 3, `level ${g.level}`);
  assert.ok(g.enemies.length <= 260);
});

test('collecting enough XP opens a level-up with distinct choices and pauses time', () => {
  const { g, events } = newGame();
  g.xp = xpForLevel(1);
  g.update(1 / 60);
  g.update(1 / 60);
  assert.equal(g.state, 'levelup');
  assert.equal(events.levelUps, 1);
  const ids = g.choices.map((c) => c.kind + c.id);
  assert.equal(new Set(ids).size, ids.length);
  const t = g.time;
  g.update(1);
  assert.equal(g.time, t, 'time frozen while choosing');
  const c = g.choices[0];
  g.choose(0);
  assert.equal(g.state, 'play');
  const owned = c.kind === 'weapon' ? g.weapons[c.id] : g.passives[c.id];
  assert.equal(owned, c.level);
});

test('fully upgraded builds fall back to heal / coin choices', () => {
  const { g } = newGame();
  for (const id of Object.keys(WEAPONS)) g.weapons[id] = WEAPONS[id].levels.length;
  for (const id of Object.keys(PASSIVES)) g.passives[id] = PASSIVES[id].max;
  assert.deepEqual(g.rollChoices().map((c) => c.kind), ['heal', 'gold']);
});

test('weapon slots cap new weapons at four', () => {
  const { g } = newGame();
  g.weapons = { blaster: 1, orbit: 1, zap: 1, nova: 1 };
  for (let i = 0; i < 50; i++) {
    for (const c of g.rollChoices()) assert.ok(!(c.kind === 'weapon' && c.id === 'missile'));
  }
});

test('snapshot -> sanitize -> restore resumes the same run', () => {
  const { g } = newGame();
  run(g, 60);
  const snap = sanitizeRun(JSON.parse(JSON.stringify(g.snapshot())));
  const { g: g2 } = newGame({ snapshot: snap });
  assert.equal(g2.time, g.time);
  assert.equal(g2.level, g.level);
  assert.equal(g2.kills, g.kills);
  assert.deepEqual(g2.weapons, g.weapons);
  assert.deepEqual(g2.passives, g.passives);
  assert.equal(g2.player.maxHp, g.player.maxHp);
  assert.ok(Math.abs(g2.player.hp - Math.max(1, g.player.hp)) < 1e-9);
});

test('an open level-up menu survives a save/resume exactly once', () => {
  const { g } = newGame();
  g.xp = xpForLevel(1);
  g.update(1 / 60);
  g.update(1 / 60);
  assert.equal(g.state, 'levelup');
  const { g: g2, events } = newGame({ snapshot: sanitizeRun(g.snapshot()) });
  g2.update(1 / 60);
  assert.equal(g2.state, 'levelup');
  assert.equal(events.levelUps, 1);
  g2.choose(0);
  assert.equal(g2.pendingLevelUps, 0, 'reloading must not mint extra upgrades');
  g2.update(1 / 60);
  assert.equal(g2.state, 'play');
});

test('resuming restores the swarm around the ship', () => {
  const { g } = newGame();
  run(g, 45);
  const alive = g.enemies.filter((e) => !e.dead);
  assert.ok(alive.length > 5);
  const { g: g2 } = newGame({ snapshot: sanitizeRun(JSON.parse(JSON.stringify(g.snapshot()))) });
  assert.equal(g2.enemies.length, alive.length);
  const near = (a, b) => Math.abs(a - b) <= 1;
  alive.forEach((e, i) => {
    const r = g2.enemies[i];
    assert.equal(r.type, e.type);
    assert.ok(near(r.x, e.x - g.player.x) && near(r.y, e.y - g.player.y));
    assert.ok(Math.abs(r.hp / r.maxHp - e.hp / e.maxHp) < 0.002);
  });
});

test('saving during the victory beat resumes into the win, not a fresh boss', () => {
  const { g } = newGame();
  g.time = g.stage.duration;
  g.nextElite = g.nextSwarm = 1e9;
  g.update(1 / 60);
  g.damage(g.boss, 1e9, 0, 0);
  g.update(1 / 60);
  assert.equal(g.state, 'play', 'still in the victory beat');
  const { g: g2, events } = newGame({ snapshot: sanitizeRun(JSON.parse(JSON.stringify(g.snapshot()))) });
  for (let i = 0; i < 120 && !events.end; i++) g2.update(1 / 60);
  assert.equal(events.boss, 0, 'no Warden respawn');
  assert.equal(events.end?.won, true);
  assert.equal(events.end.bosses, 1);
});

test('scripted spawns cannot grow the swarm without bound', () => {
  const { g } = newGame();
  for (let i = 0; i < 1000; i++) g.spawnEnemy('dart', i, 0, { force: true });
  const n = g.enemies.length;
  assert.ok(n < 1000);
  assert.ok(g.spawnEnemy('boss', 0, 0, { force: true }), 'the Warden always spawns');
  assert.equal(g.enemies.length, n + 1);
});

test('dying ends the run once; a revive saves you first', () => {
  const save = defaultSave();
  save.meta.revive = 1;
  const { g, events } = newGame({ save });
  g.hurtPlayer(9999);
  assert.equal(g.state, 'play');
  assert.equal(g.revives, 0);
  assert.equal(g.player.hp, g.player.maxHp / 2);
  g.player.invuln = 0;
  g.hurtPlayer(9999);
  assert.equal(g.state, 'dead');
  assert.equal(events.end.won, false);
  const first = events.end;
  g.update(1);
  g.hurtPlayer(9999);
  assert.equal(events.end, first);
});

test('boss spawns at the stage timer and killing it wins the stage', () => {
  const { g, events } = newGame();
  g.time = g.stage.duration - 0.01;
  g.nextElite = g.nextSwarm = 1e9;
  g.update(1 / 60);
  assert.equal(events.boss, 1);
  assert.ok(g.boss);
  g.damage(g.boss, 1e9, 0, 0);
  assert.equal(g.bosses, 1);
  for (let i = 0; i < 200 && !events.end; i++) g.update(1 / 60);
  assert.equal(g.state, 'won');
  assert.equal(events.end.won, true);
});

test('reloading mid boss fight keeps the Warden wounded', () => {
  const { g } = newGame();
  g.time = g.stage.duration;
  g.nextElite = g.nextSwarm = 1e9;
  g.update(1 / 60);
  g.boss.hp = g.boss.maxHp * 0.25;
  const { g: g2 } = newGame({ snapshot: sanitizeRun(JSON.parse(JSON.stringify(g.snapshot()))) });
  g2.update(1 / 60);
  assert.ok(g2.boss);
  assert.ok(Math.abs(g2.boss.hp / g2.boss.maxHp - 0.25) < 1e-9);
});

test('Second Life blast clears the swarm but never kills the Warden', () => {
  const save = defaultSave();
  save.meta.revive = 1;
  const { g, events } = newGame({ save });
  g.time = g.stage.duration;
  g.update(1 / 60);
  g.boss.x = g.player.x + 60;
  g.boss.y = g.player.y;
  const drone = g.spawnEnemy('drone', g.player.x - 40, g.player.y, { force: true });
  g.buildGrid();
  g.hurtPlayer(9999);
  assert.equal(drone.dead, true);
  assert.equal(g.boss.dead, false);
  assert.equal(g.bosses, 0);
  assert.equal(g.endTimer, 0, 'no victory countdown started');
  assert.equal(events.end, null);
});

test('elite drops a chest that grants a free level-up', () => {
  const { g } = newGame();
  const e = g.spawnEnemy('brute', 30, 0, { elite: true, force: true });
  g.damage(e, 1e9, 0, 0);
  const chest = g.pickups.find((p) => p.kind === 'chest');
  assert.ok(chest);
  chest.x = g.player.x;
  chest.y = g.player.y;
  const before = g.pendingLevelUps;
  g.updatePickups(1 / 60);
  assert.equal(g.pendingLevelUps, before + 1);
});

test('a full pickup field never grows; overflow loot still pays out', () => {
  const { g } = newGame();
  for (let i = 0; i < 1000; i++) g.addPickup('coin', 5000 + i, 5000, 1);
  const cap = g.pickups.length;
  assert.ok(cap < 1000, 'field is capped');
  const banked = 1000 - cap;
  assert.equal(g.coins, banked, 'overflow coins are banked');
  g.player.hp = 10;
  g.addPickup('heart', 0, 0, 1);
  assert.equal(g.player.hp, 40, 'overflow heart heals immediately');
  const pending = g.pendingLevelUps;
  g.addPickup('chest', 0, 0, 1);
  assert.equal(g.pendingLevelUps, pending + 1, 'overflow chest grants its upgrade');
  const xpBefore = g.xp;
  g.addPickup('xp', 0, 0, 3);
  assert.ok(g.xp > xpBefore, 'XP with no gem to merge into is granted');
  assert.equal(g.pickups.length, cap);
});

test('each level costs more XP than the last', () => {
  for (let l = 1; l < 100; l++) assert.ok(xpForLevel(l + 1) > xpForLevel(l), `level ${l}`);
});

test('meta upgrades make the ship stronger', () => {
  const save = defaultSave();
  Object.assign(save.meta, { hp: 5, power: 5, speed: 5, magnet: 5 });
  const { g: base } = newGame();
  const { g: boosted } = newGame({ save });
  assert.equal(boosted.player.maxHp, base.player.maxHp + 50);
  assert.ok(boosted.dmgMul > base.dmgMul);
  assert.ok(boosted.speed > base.speed);
  assert.ok(boosted.magnet > base.magnet);
});

test('a well-upgraded bot can clear the first stage', () => {
  const wins = [1, 3].map((seed) => simulate({ stage: 0, metaLevel: 3, seed }).won);
  assert.ok(wins.some(Boolean), 'first stage should be beatable with moderate upgrades');
});
