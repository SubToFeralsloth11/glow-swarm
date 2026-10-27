// Canvas renderer. Glow is faked with cached radial-gradient sprites drawn
// additively, which is far cheaper on mobile GPUs than ctx.shadowBlur.
import { WEAPONS } from './data.js';

const glowCache = new Map();
function glow(color) {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(0.35, color + '88');
  grad.addColorStop(1, color + '00');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c);
  return c;
}

const STARS = Array.from({ length: 140 }, (_, i) => {
  const h = Math.sin(i * 12.9898) * 43758.5453;
  const h2 = Math.sin(i * 78.233) * 12543.123;
  return { x: h - Math.floor(h), y: h2 - Math.floor(h2), z: 0.15 + ((i * 37) % 10) / 22, s: 0.6 + ((i * 13) % 7) / 5 };
});

const PICKUP_COLOR = { coin: '#ffd60a', heart: '#ff4d6d', vacuum: '#7df9ff', chest: '#ffb703' };
function gemColor(v) {
  return v >= 20 ? '#c77dff' : v >= 5 ? '#06d6a0' : '#4cc9f0';
}

export function viewScale(W, H) {
  return Math.max(0.72, Math.min(1.1, Math.min(W, H) / 430));
}

export function render(ctx, game, W, H, now) {
  const s = viewScale(W, H);
  const p = game.player;
  const hue = game.stage.hue;
  let shx = 0, shy = 0;
  if (game.shake > 0) {
    shx = (Math.random() - 0.5) * game.shake;
    shy = (Math.random() - 0.5) * game.shake;
  }
  const camX = p.x - W / 2 / s + shx;
  const camY = p.y - H / 2 / s + shy;

  // background
  ctx.fillStyle = `hsl(${hue} 45% 5%)`;
  ctx.fillRect(0, 0, W, H);
  for (const st of STARS) {
    const x = (((st.x * W - camX * s * st.z) % W) + W) % W;
    const y = (((st.y * H - camY * s * st.z) % H) + H) % H;
    ctx.fillStyle = `hsla(${hue} 80% 85% / ${0.25 + st.z * 0.6})`;
    ctx.fillRect(x, y, st.s, st.s);
  }

  ctx.save();
  ctx.scale(s, s);
  ctx.translate(-camX, -camY);
  const vw = W / s, vh = H / s;
  const inView = (x, y, r) => x + r > camX && x - r < camX + vw && y + r > camY && y - r < camY + vh;

  // grid
  ctx.strokeStyle = `hsla(${hue} 90% 60% / 0.09)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const G = 90;
  for (let x = Math.floor(camX / G) * G; x < camX + vw; x += G) { ctx.moveTo(x, camY); ctx.lineTo(x, camY + vh); }
  for (let y = Math.floor(camY / G) * G; y < camY + vh; y += G) { ctx.moveTo(camX, y); ctx.lineTo(camX + vw, y); }
  ctx.stroke();

  ctx.globalCompositeOperation = 'lighter';

  // pickups
  for (const k of game.pickups) {
    if (!inView(k.x, k.y, 20)) continue;
    const bob = Math.sin(now * 0.006 + k.x) * 2;
    if (k.kind === 'xp') {
      const c = gemColor(k.value);
      const sz = k.value >= 20 ? 7 : k.value >= 5 ? 5.5 : 4.5;
      ctx.drawImage(glow(c), k.x - sz * 2.5, k.y - sz * 2.5 + bob, sz * 5, sz * 5);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(k.x, k.y - sz + bob); ctx.lineTo(k.x + sz * 0.7, k.y + bob); ctx.lineTo(k.x, k.y + sz + bob); ctx.lineTo(k.x - sz * 0.7, k.y + bob);
      ctx.fill();
    } else {
      const c = PICKUP_COLOR[k.kind];
      const sz = k.kind === 'chest' ? 13 : 7;
      ctx.drawImage(glow(c), k.x - sz * 3, k.y - sz * 3 + bob, sz * 6, sz * 6);
      ctx.fillStyle = c;
      ctx.font = `bold ${sz * 2}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(k.kind === 'coin' ? '●' : k.kind === 'heart' ? '♥' : k.kind === 'vacuum' ? '◉' : '▣', k.x, k.y + bob);
    }
  }

  // area effects
  for (const f of game.fx) {
    const t = f.life / f.max;
    if (f.kind === 'ring' || f.kind === 'blast') {
      const r = f.r * (f.kind === 'ring' ? 1 - t * 0.6 : 1 - t * 0.5);
      ctx.strokeStyle = f.color;
      ctx.globalAlpha = t;
      ctx.lineWidth = f.kind === 'ring' ? 6 * t + 1 : 3;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.stroke();
      if (f.kind === 'blast') {
        ctx.drawImage(glow(f.color), f.x - r, f.y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  // enemies
  for (const e of game.enemies) {
    if (e.dead || !inView(e.x, e.y, e.r * 2)) continue;
    const c = e.flash > 0 ? '#ffffff' : e.def.color;
    const gs = e.r * (e.elite || e.def.boss ? 4 : 2.6);
    ctx.drawImage(glow(e.def.color), e.x - gs / 2, e.y - gs / 2, gs, gs);
    drawEnemy(ctx, e, c, p);
  }

  // enemy bullets
  for (const b of game.ebullets) {
    if (!inView(b.x, b.y, 12)) continue;
    ctx.drawImage(glow('#ff006e'), b.x - b.r * 2.6, b.y - b.r * 2.6, b.r * 5.2, b.r * 5.2);
    ctx.fillStyle = '#ffd0e0';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // player bullets
  ctx.strokeStyle = '#c8fbff';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const b of game.bullets) {
    ctx.drawImage(glow('#7df9ff'), b.x - 10, b.y - 10, 20, 20);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx * 0.022, b.y - b.vy * 0.022);
    ctx.stroke();
  }
  for (const m of game.missiles) {
    ctx.drawImage(glow('#ff70a6'), m.x - 14, m.y - 14, 28, 28);
    ctx.fillStyle = '#ffe0ec';
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.a);
    ctx.fillRect(-6, -2.5, 12, 5);
    ctx.restore();
  }

  // orbit blades
  const orbit = game.wstate.orbit;
  if (orbit?.blades) {
    for (const b of orbit.blades) {
      ctx.drawImage(glow(WEAPONS.orbit.color), b.x - 18, b.y - 18, 36, 36);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(orbit.angle * 3);
      ctx.fillStyle = '#e8fff9';
      ctx.beginPath();
      ctx.moveTo(0, -10); ctx.lineTo(3, 0); ctx.lineTo(0, 10); ctx.lineTo(-3, 0);
      ctx.fill();
      ctx.restore();
    }
  }

  // player
  const blink = p.invuln > 0 && Math.floor(now / 70) % 2 === 0;
  if (!blink || game.state !== 'play') {
    ctx.drawImage(glow('#7df9ff'), p.x - 40, p.y - 40, 80, 80);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.face);
    ctx.fillStyle = '#e9feff';
    ctx.beginPath();
    ctx.moveTo(16, 0); ctx.lineTo(-10, 11); ctx.lineTo(-5, 0); ctx.lineTo(-10, -11);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // particles
  for (const q of game.particles) {
    const a = q.life / q.max;
    ctx.globalAlpha = a;
    ctx.fillStyle = q.color;
    ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
  }
  ctx.globalAlpha = 1;

  // lightning
  ctx.strokeStyle = '#fff9c4';
  ctx.lineWidth = 2.5;
  for (const f of game.fx) {
    if (f.kind !== 'zap') continue;
    ctx.globalAlpha = f.life / f.max;
    ctx.beginPath();
    ctx.moveTo(f.x1, f.y1);
    const segs = 5;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      ctx.lineTo(f.x1 + (f.x2 - f.x1) * t + (Math.random() - 0.5) * 18, f.y1 + (f.y2 - f.y1) * t + (Math.random() - 0.5) * 18);
    }
    ctx.lineTo(f.x2, f.y2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // damage numbers
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of game.texts) {
    ctx.globalAlpha = Math.min(1, (t.life / t.max) * 2);
    ctx.font = `800 ${t.big ? 17 : 12}px system-ui, sans-serif`;
    ctx.fillStyle = '#000a';
    ctx.fillText(t.txt, t.x + 1, t.y + 1);
    ctx.fillStyle = t.color;
    ctx.fillText(t.txt, t.x, t.y);
  }
  ctx.globalAlpha = 1;

  // player HP bar
  const bw = 40;
  const hpFrac = Math.max(0, p.hp / p.maxHp);
  ctx.fillStyle = '#0009';
  ctx.fillRect(p.x - bw / 2 - 1, p.y + 21, bw + 2, 6);
  ctx.fillStyle = hpFrac > 0.5 ? '#06d6a0' : hpFrac > 0.25 ? '#ffd166' : '#ff4d6d';
  ctx.fillRect(p.x - bw / 2, p.y + 22, bw * hpFrac, 4);

  ctx.restore();

  // off-screen indicators for boss, elites and chests
  const marks = [];
  for (const e of game.enemies) if (!e.dead && (e.elite || e.def.boss)) marks.push({ x: e.x, y: e.y, c: e.def.color });
  for (const k of game.pickups) if (k.kind === 'chest') marks.push({ x: k.x, y: k.y, c: PICKUP_COLOR.chest });
  for (const m of marks) {
    const sx = (m.x - camX) * s, sy = (m.y - camY) * s;
    if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
    const a = Math.atan2(sy - H / 2, sx - W / 2);
    const pad = 28;
    const ex = Math.max(pad, Math.min(W - pad, W / 2 + Math.cos(a) * W));
    const ey = Math.max(pad + 40, Math.min(H - pad, H / 2 + Math.sin(a) * H));
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(a);
    ctx.fillStyle = m.c;
    ctx.beginPath();
    ctx.moveTo(12, 0); ctx.lineTo(-6, 8); ctx.lineTo(-6, -8);
    ctx.fill();
    ctx.restore();
  }

  // low-HP vignette
  if (hpFrac < 0.3 && game.state === 'play') {
    const pulse = 0.25 + Math.sin(now * 0.008) * 0.1;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, 'rgba(255,0,60,0)');
    g.addColorStop(1, `rgba(255,0,60,${pulse})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

function drawEnemy(ctx, e, c, p) {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  const r = e.r;
  switch (e.type) {
    case 'drone':
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a0008';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'dart':
      ctx.rotate(Math.atan2(p.y - e.y, p.x - e.x));
      ctx.beginPath();
      ctx.moveTo(r, 0); ctx.lineTo(-r, r * 0.8); ctx.lineTo(-r * 0.5, 0); ctx.lineTo(-r, -r * 0.8);
      ctx.fill();
      break;
    case 'brute':
      ctx.rotate(e.spin * 0.5);
      ctx.lineWidth = 4;
      ctx.strokeRect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5);
      ctx.fillRect(-r * 0.4, -r * 0.4, r * 0.8, r * 0.8);
      if (e.elite) {
        ctx.rotate(Math.PI / 4);
        ctx.strokeStyle = '#ffd60a';
        ctx.lineWidth = 2;
        ctx.strokeRect(-r * 0.95, -r * 0.95, r * 1.9, r * 1.9);
      }
      break;
    case 'spitter':
      ctx.rotate(e.spin);
      ctx.beginPath();
      ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
      ctx.fill();
      break;
    case 'splitter':
      ctx.rotate(e.spin * 0.6);
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'boss': {
      ctx.rotate(e.spin);
      ctx.beginPath();
      const n = 12;
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2;
        const rr = i % 2 ? r * 0.7 : r;
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#1a0010';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
  if (e.elite && !e.def.boss) {
    const w = e.r * 2;
    ctx.fillStyle = '#0008';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 10, w, 4);
    ctx.fillStyle = '#ffd60a';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 10, w * Math.max(0, e.hp / e.maxHp), 4);
  }
}
