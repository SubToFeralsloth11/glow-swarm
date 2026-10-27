// Headless balance probe: a simple kiting bot plays runs and reports how far it gets.
import { pathToFileURL } from 'node:url';
// Usage: node tests/sim.mjs [stage] [metaLevel] [runs]
import { Game, mulberry32 } from '../src/game.js';
import { defaultSave } from '../src/save.js';
import { META } from '../src/data.js';

export function botInput(g) {
  const p = g.player;
  let fx = 0, fy = 0;
  for (const e of g.enemies) {
    const dx = p.x - e.x, dy = p.y - e.y;
    const d2 = dx * dx + dy * dy + 1;
    if (d2 > 260 * 260) continue;
    const w = (e.def.boss ? 6 : 1) / d2;
    fx += dx * w; fy += dy * w;
  }
  for (const b of g.ebullets) {
    const dx = p.x - b.x, dy = p.y - b.y;
    const d2 = dx * dx + dy * dy + 1;
    if (d2 < 120 * 120) { fx += (dx * 3) / d2; fy += (dy * 3) / d2; }
  }
  // pull toward the nearest gem, scaled so danger still dominates up close
  let gem = null, gd = 320 * 320;
  for (const k of g.pickups) {
    const d2 = (k.x - p.x) ** 2 + (k.y - p.y) ** 2;
    if (d2 < gd) { gd = d2; gem = k; }
  }
  const m = Math.hypot(fx, fy);
  let ox = m ? fx / m - (fy / m) * 0.6 : 0, oy = m ? fy / m + (fx / m) * 0.6 : 0; // flee + circle-strafe
  const danger = Math.min(1, m * 150);
  if (gem) {
    const gl = Math.sqrt(gd) || 1;
    ox = ox * danger + ((gem.x - p.x) / gl) * (1 - danger * 0.7);
    oy = oy * danger + ((gem.y - p.y) / gl) * (1 - danger * 0.7);
  }
  return { x: ox, y: oy };
}

export function simulate({ stage = 0, metaLevel = 0, seed = 1, maxTime = 900 }) {
  const save = defaultSave();
  for (const k of Object.keys(META)) save.meta[k] = Math.min(META[k].max, metaLevel);
  let ended = null;
  const g = new Game({ stage, save, rng: mulberry32(seed), hooks: { end: (r) => (ended = r) } });
  const dt = 1 / 60;
  let steps = 0;
  while (!ended && g.time < maxTime && steps < maxTime * 70) {
    steps++;
    if (g.state === 'levelup') { g.choose(0); continue; }
    g.input = botInput(g);
    g.update(dt);
  }
  return { ...(ended || g.result()), enemies: g.enemies.length, timedOut: !ended };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [stage = 0, meta = 0, runs = 5] = process.argv.slice(2).map(Number);
  for (let s = 1; s <= runs; s++) {
    const t0 = performance.now();
    const r = simulate({ stage, metaLevel: meta, seed: s });
    console.log(`seed ${s}: won=${r.won} time=${r.time} lvl=${r.level} kills=${r.kills} coins=${r.coins} (${(performance.now() - t0).toFixed(0)}ms)`);
  }
}
