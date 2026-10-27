// Run simulation. No DOM access: rendering lives in render.js so this file
// runs headless under Node for tests.
import { STAGES, ENEMIES, SPAWN_TABLE, WEAPONS, PASSIVES, PLAYER_BASE, xpForLevel, ENEMY_CAP, ENEMY_HARD_CAP, PICKUP_CAP } from './data.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ELITE = { elite: true, hpMul: 6, scale: 1.45 };
const PARTICLE_CAP = 450;
const TEXT_CAP = 40;
const FX_CAP = 140;
const CELL = 64;
const MAX_WEAPONS = 4;

const noop = () => {};

export class Game {
  constructor({ stage, save, snapshot = null, rng = Math.random, hooks = {} }) {
    this.stageIdx = stage;
    this.stage = STAGES[stage];
    this.rng = rng;
    this.hooks = { sfx: noop, haptic: noop, levelUp: noop, end: noop, boss: noop, toast: noop, ...hooks };
    this.settings = save.settings;
    const m = save.meta;
    this.meta = { hp: 10 * m.hp, dmg: 0.06 * m.power, speed: 0.05 * m.speed, magnet: 0.2 * m.magnet, xp: 0.08 * m.growth };

    this.player = { x: 0, y: 0, vx: 0, vy: 0, hp: 1, maxHp: 1, invuln: 0, r: PLAYER_BASE.r, face: 0 };
    this.weapons = {};
    this.passives = {};
    this.wstate = {};
    this.enemies = [];
    this.bullets = [];
    this.missiles = [];
    this.ebullets = [];
    this.pickups = [];
    this.particles = [];
    this.texts = [];
    this.fx = []; // transient visual effects: rings, zaps, blasts
    this.grid = new Map();
    this.nextId = 1;

    this.time = 0;
    this.level = 1;
    this.xp = 0;
    this.kills = 0;
    this.coins = 0;
    this.bosses = 0;
    this.revives = m.revive;
    this.rerolls = m.reroll;
    this.spawnAcc = 0;
    this.nextElite = 60;
    this.nextSwarm = 30;
    this.bossSpawned = false;
    this.bossWarned = false;
    this.boss = null;
    this.pendingLevelUps = 0;
    this.choices = null;
    this.state = 'play'; // play | levelup | dead | won
    this.endTimer = 0;
    this.shake = 0;
    this.hurtFlash = 0; // seconds of red screen flash left after taking a hit
    this.input = { x: 0, y: 0 };
    this.viewW = 420;
    this.viewH = 800;

    if (snapshot) this.restore(snapshot);
    else {
      this.weapons[save.startWeapon] = 1;
      this.recalc();
      this.player.hp = this.player.maxHp;
    }
  }

  // ---------- derived stats ----------
  recalc() {
    const p = this.passives;
    const lv = (k) => p[k] || 0;
    this.dmgMul = (1 + this.meta.dmg) * (1 + 0.12 * lv('might'));
    this.cdMul = 1 - 0.08 * lv('haste');
    this.speed = PLAYER_BASE.speed * (1 + this.meta.speed + 0.08 * lv('swift'));
    this.magnet = PLAYER_BASE.magnet * (1 + this.meta.magnet + 0.3 * lv('magnet'));
    this.regen = 0.5 * lv('regen');
    this.armor = lv('armor');
    this.crit = 0.07 * lv('crit');
    const maxHp = PLAYER_BASE.hp + this.meta.hp + 20 * lv('vitality');
    this.player.maxHp = maxHp;
    this.player.hp = Math.min(this.player.hp, maxHp);
  }

  get xpNeeded() {
    return xpForLevel(this.level);
  }

  get viewRadius() {
    return Math.hypot(this.viewW, this.viewH) / 2;
  }

  // ---------- save / restore ----------
  snapshot() {
    return {
      stage: this.stageIdx,
      time: this.time,
      level: this.level,
      xp: this.xp,
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      weapons: { ...this.weapons },
      passives: { ...this.passives },
      kills: this.kills,
      coins: this.coins,
      revives: this.revives,
      rerolls: this.rerolls,
      nextElite: this.nextElite,
      nextSwarm: this.nextSwarm,
      // choose() is what decrements, so this already includes an open level-up menu.
      pendingLevelUps: this.pendingLevelUps,
      // Fraction of Warden HP left, so a reload mid-fight doesn't heal the boss.
      bossHp: this.boss && !this.boss.dead ? this.boss.hp / this.boss.maxHp : null,
      // Saved during the victory beat: resuming finishes the win instead of respawning the boss.
      bossDefeated: this.bosses > 0,
      // The swarm itself, relative to the ship, so reloading is not an escape hatch.
      enemies: this.enemies
        .filter((e) => !e.dead && !e.def.boss)
        .map((e) => [e.type, Math.round(e.x - this.player.x), Math.round(e.y - this.player.y), Math.round((e.hp / e.maxHp) * 1000) / 1000, e.elite ? 1 : 0]),
      // Uncollected loot, so a reload doesn't throw away XP and coins.
      pickups: this.pickups.map((k) => [k.kind, Math.round(k.x - this.player.x), Math.round(k.y - this.player.y), k.value]),
    };
  }

  restore(s) {
    Object.assign(this, {
      time: s.time, level: s.level, xp: s.xp, kills: s.kills, coins: s.coins,
      revives: s.revives, rerolls: s.rerolls, nextElite: s.nextElite, nextSwarm: s.nextSwarm,
      pendingLevelUps: s.pendingLevelUps,
    });
    this.weapons = { ...s.weapons };
    this.passives = { ...s.passives };
    this.player.hp = s.hp;
    this.recalc();
    this.player.hp = Math.max(1, Math.min(s.hp, this.player.maxHp));
    this.player.invuln = 1.5; // short grace period to get your bearings after resuming
    this.restoredBossHp = s.bossHp; // applied when the Warden respawns on the first update
    this.bossWarned = s.time >= this.stage.duration - 10;
    if (s.bossDefeated) {
      this.bosses = 1;
      this.bossSpawned = true;
      this.endTimer = 0.5;
    }
    for (const [type, x, y, frac, elite] of s.enemies || []) {
      const e = this.spawnEnemy(type, x, y, elite ? { ...ELITE, force: true } : { force: true });
      if (e) e.hp = e.maxHp * frac;
    }
    for (const [kind, x, y, value] of s.pickups || []) this.addPickup(kind, x, y, value);
  }

  result() {
    return {
      stage: this.stageIdx, time: Math.floor(this.time), kills: this.kills, level: this.level,
      coins: this.coins, bosses: this.bosses, won: this.state === 'won',
    };
  }

  // ---------- level-up choices ----------
  rollChoices() {
    const pool = [];
    const ownedWeapons = Object.keys(this.weapons).length;
    for (const [id, w] of Object.entries(WEAPONS)) {
      const lv = this.weapons[id] || 0;
      if (lv === 0 && ownedWeapons >= MAX_WEAPONS) continue;
      if (lv < w.levels.length) pool.push({ kind: 'weapon', id, level: lv + 1, w: lv ? 1.5 : 1.1 });
    }
    for (const [id, ps] of Object.entries(PASSIVES)) {
      const lv = this.passives[id] || 0;
      if (lv < ps.max) pool.push({ kind: 'passive', id, level: lv + 1, w: 1 });
    }
    const picks = [];
    while (picks.length < 3 && pool.length) {
      let total = 0;
      for (const c of pool) total += c.w;
      let r = this.rng() * total;
      let i = 0;
      for (; i < pool.length - 1; i++) {
        r -= pool[i].w;
        if (r <= 0) break;
      }
      picks.push(pool.splice(i, 1)[0]);
    }
    if (picks.length === 0) {
      picks.push({ kind: 'heal', id: 'heal', level: 0 }, { kind: 'gold', id: 'gold', level: 0 });
    }
    return picks;
  }

  choose(index) {
    if (this.state !== 'levelup' || !this.choices) return;
    const c = this.choices[index];
    if (!c) return;
    if (c.kind === 'weapon') this.weapons[c.id] = c.level;
    else if (c.kind === 'passive') {
      this.passives[c.id] = c.level;
      if (c.id === 'vitality') this.player.hp += 20;
    } else if (c.kind === 'heal') this.player.hp += this.player.maxHp * 0.4;
    else if (c.kind === 'gold') this.coins += 25;
    this.recalc();
    this.pendingLevelUps--;
    this.choices = null;
    this.state = 'play';
    this.player.invuln = Math.max(this.player.invuln, 0.4);
    const p = this.player;
    this.fx.push({ kind: 'ring', x: p.x, y: p.y, r: 120, life: 0.5, max: 0.5, color: '#ffd60a' });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.particle(p.x, p.y, Math.cos(a) * 220, Math.sin(a) * 220, '#ffe066', 0.5, 3);
    }
  }

  reroll() {
    if (this.state !== 'levelup' || this.rerolls <= 0) return false;
    this.rerolls--;
    this.choices = this.rollChoices();
    this.hooks.levelUp(this.choices);
    return true;
  }

  // ---------- main update ----------
  update(dt) {
    if (this.state === 'won' || this.state === 'dead') return;
    if (this.endTimer > 0) {
      // Short slow-motion beat after the boss dies before the victory screen.
      this.endTimer -= dt;
      this.shake = Math.max(0, this.shake - dt * 30);
      this.hurtFlash = Math.max(0, this.hurtFlash - dt);
      this.updateFx(dt * 0.3);
      if (this.endTimer <= 0) {
        this.state = 'won';
        this.hooks.end(this.result());
      }
      return;
    }
    if (this.state !== 'play') return;
    if (this.pendingLevelUps > 0) {
      this.state = 'levelup';
      this.choices = this.rollChoices();
      this.hooks.sfx('levelup');
      this.hooks.haptic(25);
      this.hooks.levelUp(this.choices);
      return;
    }

    this.time += dt;
    this.updatePlayer(dt);
    this.buildGrid();
    this.updateSpawns(dt);
    this.updateWeapons(dt);
    this.updateBullets(dt);
    this.updateMissiles(dt);
    this.updateEnemies(dt);
    this.updateEnemyBullets(dt);
    this.updatePickups(dt);
    this.updateFx(dt);
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.checkLevel();
  }

  updatePlayer(dt) {
    const p = this.player;
    let { x: ix, y: iy } = this.input;
    const mag = Math.hypot(ix, iy);
    if (mag > 1) { ix /= mag; iy /= mag; }
    p.vx = ix * this.speed;
    p.vy = iy * this.speed;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (mag > 0.1) p.face = Math.atan2(iy, ix);
    p.invuln = Math.max(0, p.invuln - dt);
    if (this.regen > 0) p.hp = Math.min(p.maxHp, p.hp + this.regen * dt);
    this.shake = Math.max(0, this.shake - dt * 30);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
  }

  buildGrid() {
    const g = this.grid;
    g.clear();
    for (const e of this.enemies) {
      const k = cellKey(Math.floor(e.x / CELL), Math.floor(e.y / CELL));
      let arr = g.get(k);
      if (!arr) g.set(k, (arr = []));
      arr.push(e);
    }
  }

  // Calls fn(e) for enemies whose cell overlaps the circle; caller checks distance.
  query(x, y, r, fn) {
    const x0 = Math.floor((x - r - 50) / CELL), x1 = Math.floor((x + r + 50) / CELL);
    const y0 = Math.floor((y - r - 50) / CELL), y1 = Math.floor((y + r + 50) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const arr = this.grid.get(cellKey(cx, cy));
        if (arr) for (const e of arr) if (!e.dead && fn(e) === true) return;
      }
    }
  }

  nearest(x, y, maxR, exclude) {
    let best = null;
    let bd = maxR * maxR;
    for (const e of this.enemies) {
      if (e.dead || (exclude && exclude.has(e))) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ---------- spawning ----------
  hpScale() {
    const t = this.time;
    return this.stage.diff * (1 + t / 150 + (t / 240) ** 2);
  }

  spawnEnemy(type, x, y, opts = {}) {
    const cap = type === 'boss' ? Infinity : opts.force ? ENEMY_HARD_CAP : ENEMY_CAP;
    if (this.enemies.length >= cap) return null;
    const def = ENEMIES[type];
    const t = this.time;
    const hpMul = def.boss ? this.stage.diff * (1 + this.time / 600) : this.hpScale();
    const hp = def.hp * hpMul * (opts.hpMul || 1);
    if (x === undefined) {
      const a = this.rng() * Math.PI * 2;
      const d = this.viewRadius + 30 + this.rng() * 60;
      x = this.player.x + Math.cos(a) * d;
      y = this.player.y + Math.sin(a) * d;
    }
    const e = {
      id: this.nextId++, type, def, x, y, kx: 0, ky: 0,
      hp, maxHp: hp,
      r: def.r * (opts.scale || 1),
      speed: def.speed * (1 + t / 900) * (0.9 + this.rng() * 0.2) * (opts.speedMul || 1),
      dmg: Math.round(def.dmg * (1 + t / 420) * Math.sqrt(this.stage.diff)),
      flash: 0, orbitCd: 0, fire: def.fireEvery ? def.fireEvery * (0.5 + this.rng()) : 0,
      elite: !!opts.elite, dead: false, spin: this.rng() * 6, minionTimer: 5, age: 0,
    };
    this.enemies.push(e);
    return e;
  }

  pickType() {
    const t = this.time;
    let total = 0;
    for (const s of SPAWN_TABLE) if (t >= s.from) total += s.weight;
    let r = this.rng() * total;
    for (const s of SPAWN_TABLE) {
      if (t < s.from) continue;
      r -= s.weight;
      if (r <= 0) return s.type;
    }
    return 'drone';
  }

  updateSpawns(dt) {
    const t = this.time;
    let rate = (1.5 + t * 0.016) * this.stage.rate;
    if (this.bossSpawned) rate *= 0.45;
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      this.spawnEnemy(this.pickType());
    }
    if (t >= this.nextElite) {
      this.nextElite += 60;
      if (this.spawnEnemy('brute', undefined, undefined, { ...ELITE, force: true })) {
        this.hooks.toast('An elite approaches — it carries treasure!');
      }
    }
    if (t >= this.nextSwarm && !this.bossSpawned) {
      this.nextSwarm += 45;
      const n = Math.min(40, 14 + Math.floor(t / 15));
      const type = t > 200 ? 'dart' : 'drone';
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const d = this.viewRadius * 0.85;
        this.spawnEnemy(type, this.player.x + Math.cos(a) * d, this.player.y + Math.sin(a) * d, { force: true });
      }
      this.hooks.toast('Swarm incoming!');
      this.hooks.sfx('warn');
    }
    if (t >= this.stage.duration - 10 && !this.bossWarned) {
      this.bossWarned = true;
      this.hooks.toast('⚠ The Warden arrives in 10 seconds — get ready!');
      this.hooks.sfx('warn');
    }
    if (t >= this.stage.duration && !this.bossSpawned) {
      this.bossSpawned = true;
      this.boss = this.spawnEnemy('boss', undefined, undefined, { force: true });
      if (this.restoredBossHp != null) this.boss.hp = this.boss.maxHp * this.restoredBossHp;
      this.hooks.boss(this.boss);
      this.hooks.sfx('boss');
      this.hooks.haptic(120);
    }
  }

  // ---------- weapons ----------
  cd(id) {
    return (this.wstate[id] ??= { t: 0, angle: 0 });
  }

  updateWeapons(dt) {
    const p = this.player;
    for (const [id, lv] of Object.entries(this.weapons)) {
      const st = WEAPONS[id].levels[lv - 1];
      const ws = this.cd(id);
      if (id === 'orbit') { this.updateOrbit(ws, st, dt); continue; }
      ws.t -= dt;
      if (ws.t > 0) continue;
      const cooldown = st.cd * this.cdMul;
      if (id === 'blaster') {
        const target = this.nearest(p.x, p.y, 460);
        if (!target) { ws.t = 0.05; continue; }
        const base = Math.atan2(target.y - p.y, target.x - p.x);
        for (let i = 0; i < st.count; i++) {
          const a = base + (i - (st.count - 1) / 2) * 0.13;
          this.bullets.push({ x: p.x, y: p.y, vx: Math.cos(a) * 560, vy: Math.sin(a) * 560, dmg: st.dmg, pierce: st.pierce, life: 0.9, hit: [] });
        }
        this.hooks.sfx('shoot');
        ws.t = cooldown;
      } else if (id === 'zap') {
        let cur = this.nearest(p.x, p.y, 280);
        if (!cur) { ws.t = 0.1; continue; }
        const hit = new Set();
        let px = p.x, py = p.y;
        for (let i = 0; i < st.chains && cur; i++) {
          hit.add(cur);
          this.fx.push({ kind: 'zap', x1: px, y1: py, x2: cur.x, y2: cur.y, life: 0.18, max: 0.18 });
          px = cur.x; py = cur.y;
          this.damage(cur, st.dmg, 0, 0);
          cur = this.nearest(px, py, 170, hit);
        }
        this.hooks.sfx('zap');
        ws.t = cooldown;
      } else if (id === 'nova') {
        const target = this.nearest(p.x, p.y, st.radius * 1.1);
        if (!target) { ws.t = 0.1; continue; }
        this.fx.push({ kind: 'ring', x: p.x, y: p.y, r: st.radius, life: 0.4, max: 0.4, color: WEAPONS.nova.color });
        this.query(p.x, p.y, st.radius, (e) => {
          const dx = e.x - p.x, dy = e.y - p.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < st.radius + e.r) this.damage(e, st.dmg, (dx / d) * 380, (dy / d) * 380);
        });
        this.hooks.sfx('nova');
        this.shake = Math.max(this.shake, 4);
        ws.t = cooldown;
      } else if (id === 'missile') {
        if (!this.nearest(p.x, p.y, 520)) { ws.t = 0.1; continue; }
        for (let i = 0; i < st.count; i++) {
          const a = p.face + Math.PI + (i - (st.count - 1) / 2) * 0.7;
          this.missiles.push({ x: p.x, y: p.y, a, v: 240, dmg: st.dmg, blast: st.blast, life: 3, target: null, trail: 0 });
        }
        this.hooks.sfx('missile');
        ws.t = cooldown;
      }
    }
  }

  updateOrbit(ws, st, dt) {
    const p = this.player;
    ws.angle += dt * 3.4;
    const blades = [];
    for (let i = 0; i < st.count; i++) {
      const a = ws.angle + (i / st.count) * Math.PI * 2;
      blades.push({ x: p.x + Math.cos(a) * st.radius, y: p.y + Math.sin(a) * st.radius });
    }
    ws.blades = blades;
    for (const b of blades) {
      this.query(b.x, b.y, 14, (e) => {
        if (e.orbitCd > 0) return;
        if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < (e.r + 12) ** 2) {
          const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
          this.damage(e, st.dmg, (dx / d) * 160, (dy / d) * 160);
          e.orbitCd = 0.4;
        }
      });
    }
  }

  updateBullets(dt) {
    const bs = this.bullets;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let alive = b.life > 0;
      if (alive) {
        this.query(b.x, b.y, 6, (e) => {
          if (b.hit.includes(e.id)) return;
          if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < (e.r + 5) ** 2) {
            b.hit.push(e.id);
            this.damage(e, b.dmg, b.vx * 0.12, b.vy * 0.12);
            if (b.pierce-- <= 0) { alive = false; return true; }
          }
        });
      }
      if (!alive) { bs[i] = bs[bs.length - 1]; bs.pop(); }
    }
  }

  updateMissiles(dt) {
    const ms = this.missiles;
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      if (!m.target || m.target.dead) m.target = this.nearest(m.x, m.y, 600);
      if (m.target) {
        const want = Math.atan2(m.target.y - m.y, m.target.x - m.x);
        let diff = want - m.a;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        m.a += Math.max(-6 * dt, Math.min(6 * dt, diff));
      }
      m.v = Math.min(520, m.v + 600 * dt);
      m.x += Math.cos(m.a) * m.v * dt;
      m.y += Math.sin(m.a) * m.v * dt;
      m.life -= dt;
      m.trail -= dt;
      if (m.trail <= 0) { m.trail = 0.03; this.particle(m.x, m.y, 0, 0, '#ffd27a', 0.3, 3); }
      let boom = m.life <= 0;
      if (!boom) this.query(m.x, m.y, 10, (e) => {
        if ((e.x - m.x) ** 2 + (e.y - m.y) ** 2 < (e.r + 6) ** 2) { boom = true; return true; }
      });
      if (boom) {
        this.explode(m.x, m.y, m.blast, m.dmg);
        ms[i] = ms[ms.length - 1];
        ms.pop();
      }
    }
  }

  explode(x, y, radius, dmg) {
    this.fx.push({ kind: 'blast', x, y, r: radius, life: 0.3, max: 0.3, color: '#8ec5ff' });
    this.query(x, y, radius, (e) => {
      const dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy) || 1;
      if (d < radius + e.r) this.damage(e, dmg, (dx / d) * 220, (dy / d) * 220);
    });
    for (let i = 0; i < 10; i++) {
      const a = this.rng() * Math.PI * 2, s = 60 + this.rng() * 160;
      this.particle(x, y, Math.cos(a) * s, Math.sin(a) * s, '#d6ecff', 0.4, 3);
    }
    this.hooks.sfx('boom');
  }

  damage(e, amount, kx, ky) {
    if (e.dead) return;
    let dmg = amount * this.dmgMul;
    const crit = this.rng() < this.crit;
    if (crit) dmg *= 2;
    dmg = Math.round(dmg);
    e.hp -= dmg;
    e.flash = 0.1;
    const kb = e.def.boss ? 0.08 : e.elite ? 0.35 : 1;
    e.kx += kx * kb;
    e.ky += ky * kb;
    if (this.settings.damageNumbers) {
      const jitter = (Math.random() - 0.5) * 10; // cosmetic: keep the seeded gameplay RNG untouched
      // Rapid hits on one enemy add up in a single number instead of stacking a pile of them.
      const t = e.dmgText;
      if (t && t.life > 0.2 && this.texts.includes(t)) {
        t.total += dmg;
        t.txt = String(t.total);
        t.life = t.max;
        t.x = e.x;
        t.y = e.y - e.r;
        if (crit) { t.big = true; t.color = '#ffd60a'; }
      } else if (this.texts.length < TEXT_CAP) {
        e.dmgText = { x: e.x + jitter, y: e.y - e.r, txt: String(dmg), total: dmg, life: 0.6, max: 0.6, color: crit ? '#ffd60a' : '#ffffff', big: crit };
        this.texts.push(e.dmgText);
      }
    }
    this.hooks.sfx('hit');
    if (e.hp <= 0) this.kill(e);
  }

  kill(e) {
    e.dead = true;
    this.kills++;
    const def = e.def;
    for (let i = 0; i < (def.boss ? 40 : 6); i++) {
      const a = this.rng() * Math.PI * 2, s = 40 + this.rng() * (def.boss ? 380 : 160);
      this.particle(e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, def.color, 0.5 + this.rng() * 0.3, def.boss ? 5 : 3);
    }
    if (this.fx.length < FX_CAP) this.fx.push({ kind: 'pop', x: e.x, y: e.y, r: e.r * (def.boss ? 4 : 2.2), life: 0.35, max: 0.35, color: def.color });
    this.dropGem(e.x, e.y, def.xp * (e.elite ? 5 : 1));
    if (this.rng() < def.coin) this.addPickup('coin', e.x + 6, e.y, 1);
    const r = this.rng();
    if (r < 0.012) this.addPickup('heart', e.x, e.y + 6, 1);
    else if (r < 0.016) this.addPickup('vacuum', e.x, e.y + 6, 1);
    if (def.splits) {
      for (let i = 0; i < def.splits; i++) {
        this.spawnEnemy('dart', e.x + (i ? 8 : -8), e.y, { force: true });
      }
    }
    if (e.elite) {
      this.addPickup('chest', e.x, e.y, 1);
      for (let i = 0; i < 5; i++) this.addPickup('coin', e.x + (this.rng() - 0.5) * 40, e.y + (this.rng() - 0.5) * 40, 1);
      this.hooks.sfx('bigkill');
      this.shake = Math.max(this.shake, 8);
    } else this.hooks.sfx('kill');
    if (def.boss) {
      this.bosses++;
      this.coins += 40;
      this.boss = null;
      this.shake = 18;
      this.hooks.sfx('victory');
      this.hooks.haptic(200);
      this.endTimer = 2.2;
      for (const o of this.enemies) if (o !== e && !o.dead) { o.dead = true; this.particle(o.x, o.y, 0, 0, o.def.color, 0.5, 4); }
      this.ebullets.length = 0;
    }
  }

  dropGem(x, y, value) {
    this.addPickup('xp', x, y, value);
  }

  addPickup(kind, x, y, value) {
    // Hard cap on floor pickups. When the field is full, XP merges into a
    // random existing gem; everything else (or XP with no gem to join) is
    // collected on the spot so nothing is lost.
    if (this.pickups.length >= PICKUP_CAP) {
      if (kind === 'xp') {
        const start = Math.floor(this.rng() * this.pickups.length);
        for (let i = 0; i < this.pickups.length; i++) {
          const g = this.pickups[(start + i) % this.pickups.length];
          if (g.kind === 'xp') { g.value += value; return; }
        }
      }
      this.collect({ kind, value });
      return;
    }
    this.pickups.push({ kind, x, y, value, pulled: false, vx: 0, vy: 0, age: 0 });
  }

  updateEnemies(dt) {
    const p = this.player;
    const far = this.viewRadius * 1.7;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.flash = Math.max(0, e.flash - dt);
      e.age += dt;
      e.orbitCd -= dt;
      e.spin += dt * (e.def.boss ? 0.8 : 2);
      // Enemies left far behind are recycled ahead of the player to keep pressure on.
      if (d > far && !e.def.boss) {
        const mv = Math.hypot(p.vx, p.vy);
        const base = mv > 1 ? Math.atan2(p.vy, p.vx) : this.rng() * Math.PI * 2;
        const a = base + (this.rng() - 0.5) * 1.6;
        e.x = p.x + Math.cos(a) * (this.viewRadius + 40);
        e.y = p.y + Math.sin(a) * (this.viewRadius + 40);
        continue;
      }
      let sp = e.speed;
      if (e.def.boss && d > 330) sp *= 2.4; // the Warden never lets you run away
      if (e.type === 'spitter' && d < 220) sp = -e.speed * 0.5; // keep distance
      e.x += (dx / d) * sp * dt + e.kx * dt;
      e.y += (dy / d) * sp * dt + e.ky * dt;
      const decay = Math.exp(-7 * dt);
      e.kx *= decay;
      e.ky *= decay;
      // separation
      this.query(e.x, e.y, e.r, (o) => {
        if (o === e) return;
        const sx = e.x - o.x, sy = e.y - o.y;
        const rr = e.r + o.r;
        const d2 = sx * sx + sy * sy;
        if (d2 > 0.01 && d2 < rr * rr) {
          const dd = Math.sqrt(d2);
          const push = ((rr - dd) / dd) * 0.25;
          const w = o.def.boss ? 1 : e.def.boss ? 0 : 0.5;
          e.x += sx * push * w * 2;
          e.y += sy * push * w * 2;
        }
      });
      if (d < e.r + p.r) this.hurtPlayer(e.dmg);
      if (e.def.fireEvery) {
        e.fire -= dt;
        if (e.fire <= 0 && d < 460) {
          e.fire = e.def.fireEvery;
          if (e.def.boss) this.bossAttack(e);
          else {
            const a = Math.atan2(dy, dx);
            this.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 190, vy: Math.sin(a) * 190, dmg: Math.round(e.dmg * 0.9), life: 4, r: 6 });
          }
        }
      }
      if (e.def.boss) {
        e.minionTimer -= dt;
        if (e.minionTimer <= 0) {
          e.minionTimer = 6;
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 + e.spin;
            this.spawnEnemy('dart', e.x + Math.cos(a) * 60, e.y + Math.sin(a) * 60, { force: true });
          }
        }
      }
    }
  }

  bossAttack(e) {
    const n = 16;
    const off = this.rng() * Math.PI;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2;
      this.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 165, vy: Math.sin(a) * 165, dmg: 12, life: 5, r: 7 });
    }
    this.hooks.sfx('bossfire');
  }

  updateEnemyBullets(dt) {
    const p = this.player;
    const bs = this.ebullets;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let alive = b.life > 0;
      if (alive && (b.x - p.x) ** 2 + (b.y - p.y) ** 2 < (b.r + p.r - 3) ** 2) {
        this.hurtPlayer(b.dmg);
        alive = false;
      }
      if (!alive) { bs[i] = bs[bs.length - 1]; bs.pop(); }
    }
  }

  hurtPlayer(amount) {
    const p = this.player;
    if (p.invuln > 0 || this.state !== 'play' || this.endTimer > 0) return;
    const dmg = Math.max(1, amount - this.armor);
    p.hp -= dmg;
    p.invuln = PLAYER_BASE.invuln;
    this.hurtFlash = 0.18;
    this.shake = Math.max(this.shake, 9);
    this.hooks.sfx('hurt');
    this.hooks.haptic(45);
    for (let i = 0; i < 8; i++) {
      const a = this.rng() * Math.PI * 2;
      this.particle(p.x, p.y, Math.cos(a) * 140, Math.sin(a) * 140, '#ff4d6d', 0.4, 3);
    }
    if (p.hp <= 0) {
      if (this.revives > 0) {
        this.revives--;
        p.hp = p.maxHp * 0.5;
        p.invuln = 2.5;
        this.fx.push({ kind: 'ring', x: p.x, y: p.y, r: 260, life: 0.7, max: 0.7, color: '#ffffff' });
        this.query(p.x, p.y, 260, (e) => {
          const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
          if (d < 260 && !e.def.boss) this.damage(e, 9999, (dx / d) * 600, (dy / d) * 600);
        });
        this.ebullets.length = 0;
        this.hooks.toast('Second Life!');
        this.hooks.sfx('revive');
      } else {
        p.hp = 0;
        this.state = 'dead';
        this.hooks.sfx('death');
        this.hooks.haptic(300);
        this.hooks.end(this.result());
      }
    }
  }

  updatePickups(dt) {
    const p = this.player;
    const mr = this.magnet;
    const ps = this.pickups;
    for (let i = ps.length - 1; i >= 0; i--) {
      const k = ps[i];
      k.age += dt;
      const dx = p.x - k.x, dy = p.y - k.y;
      const d = Math.hypot(dx, dy) || 1;
      // Pull range grows with age so gems left behind still find their way home.
      const range = k.kind === 'chest' ? mr * 0.6 : mr + (k.kind === 'xp' ? k.age * 45 : 0);
      if (!k.pulled && d < range) k.pulled = true;
      if (k.pulled) {
        const s = 260 + k.age * 40 + Math.max(0, 500 - d);
        k.x += (dx / d) * s * dt;
        k.y += (dy / d) * s * dt;
      }
      if (d < p.r + 10) {
        this.collect(k);
        ps[i] = ps[ps.length - 1];
        ps.pop();
      }
    }
  }

  collect(k) {
    if (k.kind === 'xp') {
      this.xp += k.value * (1 + this.meta.xp);
      // cosmetic only: Math.random keeps the seeded gameplay RNG stream untouched
      this.particle(this.player.x, this.player.y, (Math.random() - 0.5) * 120, -40 - Math.random() * 80, '#7dffb0', 0.3, 2.5);
      this.hooks.sfx('gem');
    } else if (k.kind === 'coin') {
      this.coins += k.value;
      this.hooks.sfx('coin');
    } else if (k.kind === 'heart') {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 30);
      this.texts.push({ x: this.player.x, y: this.player.y - 24, txt: '+30', life: 0.8, max: 0.8, color: '#06d6a0', big: true });
      this.hooks.sfx('heal');
    } else if (k.kind === 'vacuum') {
      for (const g of this.pickups) if (g.kind === 'xp' || g.kind === 'coin') g.pulled = true;
      this.hooks.sfx('vacuum');
    } else if (k.kind === 'chest') {
      this.pendingLevelUps++;
      this.hooks.toast('Treasure! Free upgrade');
      this.hooks.sfx('chest');
      this.hooks.haptic(60);
    }
  }

  checkLevel() {
    while (this.xp >= this.xpNeeded) {
      this.xp -= this.xpNeeded;
      this.level++;
      this.pendingLevelUps++;
    }
  }

  particle(x, y, vx, vy, color, life, size) {
    if (this.particles.length >= PARTICLE_CAP) return;
    this.particles.push({ x, y, vx, vy, color, life, max: life, size });
  }

  updateFx(dt) {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const q = ps[i];
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= 0.94;
      q.vy *= 0.94;
      q.life -= dt;
      if (q.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); }
    }
    const ts = this.texts;
    for (let i = ts.length - 1; i >= 0; i--) {
      ts[i].life -= dt;
      ts[i].y -= 40 * dt;
      if (ts[i].life <= 0) { ts[i] = ts[ts.length - 1]; ts.pop(); }
    }
    const fx = this.fx;
    for (let i = fx.length - 1; i >= 0; i--) {
      fx[i].life -= dt;
      if (fx[i].life <= 0) { fx[i] = fx[fx.length - 1]; fx.pop(); }
    }
  }
}

function cellKey(cx, cy) {
  return (cx + 32768) * 65536 + (cy + 32768);
}
