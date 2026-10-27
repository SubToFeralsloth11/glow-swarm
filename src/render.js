// Canvas renderer.
//
// Readability rules (see the colour note in data.js):
// - Enemies: solid warm-coloured bodies with a dark outline, a bright rim, a
//   ground shadow and a face, so they read as creatures, not lights.
// - Enemy bullets: big red-hot orbs with a pulsing ring, drawn ABOVE everything
//   else in the world so danger is never hidden.
// - Player shots: thin cyan/white streaks. XP: faceted green crystals.
//   Coins: spinning gold discs. Hearts: pink hearts. Chests: gold boxes with a beam.
//
// Every shape is pre-rendered once into a cached, supersampled sprite and
// blitted with setTransform, which keeps hundreds of entities cheap on phones.
import { WEAPONS } from './data.js';

const SS = 2; // sprite supersampling
const TAU = Math.PI * 2;
const OUTLINE = 'rgba(6, 2, 14, 0.9)';

// ---------- colour helpers ----------
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// t > 0 mixes toward white, t < 0 toward black.
function shade(hex, t) {
  const f = (c) => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t));
  const [r, g, b] = rgb(hex);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function rgba(hex, a) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ---------- sprite cache ----------
const cache = new Map();
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
function sprite(key, half, draw) {
  let c = cache.get(key);
  if (!c) {
    c = makeCanvas(half * 2 * SS, half * 2 * SS);
    const g = c.getContext('2d');
    g.setTransform(SS, 0, 0, SS, half * SS, half * SS);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    draw(g);
    c.half = half;
    cache.set(key, c);
  }
  return c;
}

// Looked up by colour directly (no per-call key string) since it runs hundreds of times a frame.
const glowCache = new Map();
function glow(color) {
  let c = glowCache.get(color);
  if (!c) {
    c = sprite(`glow:${color}`, 32, (g) => {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 32);
      gr.addColorStop(0, rgba(color, 0.9));
      gr.addColorStop(0.3, rgba(color, 0.35));
      gr.addColorStop(1, rgba(color, 0));
      g.fillStyle = gr;
      g.fillRect(-32, -32, 64, 64);
    });
    glowCache.set(color, c);
  }
  return c;
}

const shadowSprite = () =>
  sprite('shadow', 20, (g) => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 20);
    gr.addColorStop(0, 'rgba(0,0,0,0.75)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.scale(1, 0.55);
    g.beginPath();
    g.arc(0, 0, 20, 0, TAU);
    g.fill();
  });

// ---------- frame transform state ----------
let K = 1; // world -> device pixels
let CX = 0, CY = 0; // camera top-left in world units
function place(ctx, x, y, rot = 0, sx = 1, sy = sx) {
  const c = Math.cos(rot) * K, s = Math.sin(rot) * K;
  ctx.setTransform(c * sx, s * sx, -s * sy, c * sy, (x - CX) * K, (y - CY) * K);
}
function blit(ctx, spr, x, y, rot = 0, sx = 1, sy = sx) {
  place(ctx, x, y, rot, sx, sy);
  ctx.drawImage(spr, -spr.half, -spr.half, spr.half * 2, spr.half * 2);
}
function glowAt(ctx, color, x, y, radius, alpha = 1) {
  ctx.globalAlpha = alpha;
  blit(ctx, glow(color), x, y, 0, radius / 32);
  ctx.globalAlpha = 1;
}
function world(ctx) {
  ctx.setTransform(K, 0, 0, K, -CX * K, -CY * K);
}

// ---------- enemy sprites ----------
function bodyPath(type, r) {
  const p = new Path2D();
  const poly = (pts) => { pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); };
  switch (type) {
    case 'drone': {
      const pts = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        const rr = i % 2 ? r * 0.8 : r * 0.98;
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      poly(pts);
      break;
    }
    case 'dart':
      poly([[r * 1.05, 0], [-r * 0.8, r * 0.8], [-r * 0.4, 0], [-r * 0.8, -r * 0.8]]);
      break;
    case 'spitter':
      poly([[r * 1.0, 0], [r * 0.2, r * 0.85], [-r * 0.9, r * 0.45], [-r * 0.9, -r * 0.45], [r * 0.2, -r * 0.85]]);
      break;
    case 'brute': {
      const s = r * 0.82, c = r * 0.32;
      p.moveTo(-s + c, -s);
      p.arcTo(s, -s, s, s, c);
      p.arcTo(s, s, -s, s, c);
      p.arcTo(-s, s, -s, -s, c);
      p.arcTo(-s, -s, s, -s, c);
      p.closePath();
      break;
    }
    case 'splitter': {
      const pts = [];
      for (let i = 0; i < 6; i++) pts.push([Math.cos((i / 6) * TAU) * r * 0.95, Math.sin((i / 6) * TAU) * r * 0.95]);
      poly(pts);
      break;
    }
    case 'boss': {
      const pts = [];
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * TAU;
        const rr = i % 2 ? r * 0.74 : r;
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      poly(pts);
      break;
    }
  }
  return p;
}

function enemySprite(type, r, color, flash) {
  const R = Math.round(r);
  return sprite(`en:${type}:${R}:${color}:${flash ? 1 : 0}`, R * 1.2 + 4, (g) => {
    const path = bodyPath(type, R);
    g.lineWidth = Math.max(3.5, R * 0.3);
    g.strokeStyle = OUTLINE;
    g.stroke(path);
    if (flash) {
      g.fillStyle = '#ffffff';
      g.fill(path);
      return;
    }
    const gr = g.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.05, 0, 0, R * 1.15);
    gr.addColorStop(0, shade(color, 0.5));
    gr.addColorStop(0.5, color);
    gr.addColorStop(1, shade(color, -0.6));
    g.fillStyle = gr;
    g.fill(path);
    g.lineWidth = Math.max(1.5, R * 0.1);
    g.strokeStyle = shade(color, 0.55);
    g.stroke(path);
    const dark = shade(color, -0.85);
    switch (type) {
      case 'drone':
      case 'boss':
        // eye socket; the pupil is drawn live so it can track the player
        g.fillStyle = dark;
        g.beginPath();
        g.arc(0, 0, R * 0.42, 0, TAU);
        g.fill();
        g.strokeStyle = shade(color, 0.3);
        g.lineWidth = Math.max(1, R * 0.06);
        g.stroke();
        break;
      case 'dart':
        g.fillStyle = shade(color, 0.7);
        g.beginPath();
        g.moveTo(R * 0.6, 0);
        g.lineTo(-R * 0.15, R * 0.25);
        g.lineTo(-R * 0.15, -R * 0.25);
        g.fill();
        break;
      case 'spitter':
        g.fillStyle = dark;
        g.beginPath();
        g.arc(R * 0.38, 0, R * 0.32, 0, TAU);
        g.fill();
        g.fillStyle = '#ffd1f4';
        g.beginPath();
        g.arc(R * 0.42, 0, R * 0.13, 0, TAU);
        g.fill();
        break;
      case 'brute':
        g.strokeStyle = rgba('#000000', 0.35);
        g.lineWidth = Math.max(1.5, R * 0.08);
        g.strokeRect(-R * 0.45, -R * 0.45, R * 0.9, R * 0.9);
        g.fillStyle = '#ffe9a8';
        for (const sy of [-1, 1]) {
          g.beginPath();
          g.ellipse(R * 0.42, sy * R * 0.26, R * 0.16, R * 0.08, 0, 0, TAU);
          g.fill();
        }
        break;
      case 'splitter':
        for (const sx of [-1, 1]) {
          g.fillStyle = dark;
          g.beginPath();
          g.arc(sx * R * 0.32, 0, R * 0.28, 0, TAU);
          g.fill();
          g.fillStyle = shade(color, 0.6);
          g.beginPath();
          g.arc(sx * R * 0.32, 0, R * 0.14, 0, TAU);
          g.fill();
        }
        break;
    }
  });
}

// ---------- pickup sprites ----------
const GEM = [
  { size: 7, color: '#5cf08a' },
  { size: 8.5, color: '#19d98b' },
  { size: 10.5, color: '#c3ff3d' },
];
const gemTier = (v) => (v >= 20 ? 2 : v >= 5 ? 1 : 0);

function gemSprite(tier) {
  const { size: s, color } = GEM[tier];
  return sprite(`gem:${tier}`, s * 1.6 + 3, (g) => {
    const h = s * 1.4;
    const outline = new Path2D();
    outline.moveTo(0, -h); outline.lineTo(s, 0); outline.lineTo(0, h); outline.lineTo(-s, 0); outline.closePath();
    g.lineWidth = 2.6;
    g.strokeStyle = OUTLINE;
    g.stroke(outline);
    g.fillStyle = color;
    g.fill(outline);
    // lit facets
    g.fillStyle = shade(color, 0.45);
    g.beginPath(); g.moveTo(0, -h); g.lineTo(-s, 0); g.lineTo(0, 0); g.closePath(); g.fill();
    g.fillStyle = color;
    g.beginPath(); g.moveTo(0, -h); g.lineTo(s, 0); g.lineTo(0, 0); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.moveTo(-s * 0.15, -h * 0.75); g.lineTo(-s * 0.55, -h * 0.1); g.lineTo(-s * 0.25, -h * 0.1); g.closePath(); g.fill();
  });
}

const coinSprite = () =>
  sprite('coin', 9, (g) => {
    g.lineWidth = 2.6;
    g.strokeStyle = OUTLINE;
    g.beginPath(); g.arc(0, 0, 6.5, 0, TAU); g.stroke();
    const gr = g.createRadialGradient(-2, -2, 0.5, 0, 0, 7);
    gr.addColorStop(0, '#fff6b0');
    gr.addColorStop(0.5, '#ffd60a');
    gr.addColorStop(1, '#b8860b');
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = '#a87400';
    g.lineWidth = 1.2;
    g.beginPath(); g.arc(0, 0, 4.2, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(-1, -3, 2, 6);
  });

const heartSprite = () =>
  sprite('heart', 12, (g) => {
    const p = new Path2D();
    p.moveTo(0, 7);
    p.bezierCurveTo(-9, 1, -8, -7, -3.5, -7);
    p.bezierCurveTo(-1.5, -7, 0, -5.5, 0, -4);
    p.bezierCurveTo(0, -5.5, 1.5, -7, 3.5, -7);
    p.bezierCurveTo(8, -7, 9, 1, 0, 7);
    g.lineWidth = 3;
    g.strokeStyle = OUTLINE;
    g.stroke(p);
    g.fillStyle = '#ff5c8a';
    g.fill(p);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.beginPath(); g.ellipse(-3.5, -3.5, 1.8, 1.2, -0.6, 0, TAU); g.fill();
  });

const vacuumSprite = () =>
  sprite('vacuum', 12, (g) => {
    g.lineWidth = 3;
    g.strokeStyle = OUTLINE;
    g.beginPath(); g.arc(0, 0, 8, 0, TAU); g.stroke();
    g.fillStyle = '#1b4f72';
    g.fill();
    g.strokeStyle = '#7df9ff';
    g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, 8, 0.3, Math.PI - 0.3); g.stroke();
    g.beginPath(); g.arc(0, 0, 4.5, Math.PI + 0.3, TAU - 0.3); g.stroke();
    g.fillStyle = '#e8feff';
    g.beginPath(); g.arc(0, 0, 2, 0, TAU); g.fill();
  });

const chestSprite = () =>
  sprite('chest', 16, (g) => {
    g.lineWidth = 3;
    g.strokeStyle = OUTLINE;
    g.strokeRect(-11, -8, 22, 17);
    const gr = g.createLinearGradient(0, -8, 0, 9);
    gr.addColorStop(0, '#c97a2b');
    gr.addColorStop(1, '#6b3a12');
    g.fillStyle = gr;
    g.fillRect(-11, -8, 22, 17);
    g.fillStyle = '#4a250a';
    g.fillRect(-11, -2, 22, 2);
    g.fillStyle = '#ffd60a';
    g.fillRect(-11, -8, 3, 17);
    g.fillRect(8, -8, 3, 17);
    g.fillRect(-3, -3, 6, 6);
    g.fillStyle = '#5a3a00';
    g.fillRect(-1, -1, 2, 3);
  });

const beamSprite = () =>
  sprite('beam', 64, (g) => {
    const gr = g.createLinearGradient(0, 64, 0, -64);
    gr.addColorStop(0, 'rgba(255,214,10,0.55)');
    gr.addColorStop(1, 'rgba(255,214,10,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(-10, 64); g.lineTo(10, 64); g.lineTo(5, -64); g.lineTo(-5, -64);
    g.fill();
  });

// ---------- projectile & player sprites ----------
const boltSprite = () =>
  sprite('bolt', 13, (g) => {
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(40,200,255,0.55)';
    g.beginPath(); g.moveTo(-10, 0); g.lineTo(7, 0); g.stroke();
    g.lineWidth = 2.6;
    g.strokeStyle = '#ffffff';
    g.beginPath(); g.moveTo(-8, 0); g.lineTo(7, 0); g.stroke();
  });

function orbSprite(r) {
  const R = Math.round(r);
  return sprite(`orb:${R}`, R * 1.6 + 3, (g) => {
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(30,0,10,0.95)';
    g.beginPath(); g.arc(0, 0, R * 1.15, 0, TAU); g.stroke();
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, R * 1.15);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.35, '#ffd0dc');
    gr.addColorStop(0.6, '#ff2d55');
    gr.addColorStop(1, '#9b0030');
    g.fillStyle = gr;
    g.fill();
  });
}

const missileSprite = () =>
  sprite('missile', 12, (g) => {
    const p = new Path2D();
    p.moveTo(9, 0); p.lineTo(4, 3); p.lineTo(-6, 3); p.lineTo(-9, 6); p.lineTo(-9, -6); p.lineTo(-6, -3); p.lineTo(4, -3); p.closePath();
    g.lineWidth = 2.5;
    g.strokeStyle = OUTLINE;
    g.stroke(p);
    g.fillStyle = '#e6f3ff';
    g.fill(p);
    g.fillStyle = '#4ea8ff';
    g.fillRect(-9, -6, 3, 12);
    g.beginPath(); g.moveTo(9, 0); g.lineTo(4, 3); g.lineTo(4, -3); g.fill();
  });

const bladeSprite = () =>
  sprite('blade', 14, (g) => {
    const p = new Path2D();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const b = a + 0.9;
      p.moveTo(0, 0);
      p.quadraticCurveTo(Math.cos(a) * 12, Math.sin(a) * 12, Math.cos(b) * 11, Math.sin(b) * 11);
      p.quadraticCurveTo(Math.cos(a + 0.5) * 4, Math.sin(a + 0.5) * 4, 0, 0);
    }
    g.lineWidth = 2.5;
    g.strokeStyle = OUTLINE;
    g.stroke(p);
    g.fillStyle = '#e8fff9';
    g.fill(p);
    g.fillStyle = '#38d6ff';
    g.beginPath(); g.arc(0, 0, 3, 0, TAU); g.fill();
  });

const shipSprite = () =>
  sprite('ship', 24, (g) => {
    const p = new Path2D();
    p.moveTo(19, 0);
    p.lineTo(3, 5);
    p.lineTo(-9, 15);
    p.lineTo(-6, 5);
    p.lineTo(-10, 0);
    p.lineTo(-6, -5);
    p.lineTo(-9, -15);
    p.lineTo(3, -5);
    p.closePath();
    g.lineWidth = 4;
    g.strokeStyle = OUTLINE;
    g.stroke(p);
    const gr = g.createLinearGradient(0, -15, 0, 15);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.5, '#a8f6ff');
    gr.addColorStop(1, '#2fb6cf');
    g.fillStyle = gr;
    g.fill(p);
    g.lineWidth = 1.4;
    g.strokeStyle = '#f2feff';
    g.stroke(p);
    g.fillStyle = '#0b3550';
    g.beginPath(); g.ellipse(4, 0, 5.5, 2.6, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(160,240,255,0.9)';
    g.beginPath(); g.ellipse(5.5, -0.8, 2, 0.9, 0, 0, TAU); g.fill();
    g.fillStyle = '#00e1ff';
    g.fillRect(-9, 12, 3, 3);
    g.fillRect(-9, -15, 3, 3);
  });

// ---------- background ----------
let bgW = 0, bgH = 0, bgHue = -1;
let bgGrad = null;
let nebula = null;
let nebulaHue = -1;
let starColor = '#fff';
let gridColor = 'transparent';
let hurtVignette = null;
const NEBULA = 640;

// Backdrop gradients are smooth, so they are built at quarter resolution and
// upscaled by drawImage: a few hundred KB instead of tens of MB on big screens.
const BG_RES = 0.25;
function buildBackground(W, H, hue) {
  if (W === bgW && H === bgH && hue === bgHue) return;
  bgW = W;
  bgH = H;
  bgHue = hue;
  hurtVignette = null; // rebuilt lazily at the new size
  bgGrad = makeCanvas(W * BG_RES, H * BG_RES);
  const g = bgGrad.getContext('2d');
  const w = bgGrad.width, h = bgGrad.height;
  let gr = g.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
  gr.addColorStop(0, `hsl(${hue} 45% 10%)`);
  gr.addColorStop(1, `hsl(${hue} 55% 3%)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  // edge vignette baked into the backdrop (saves a full-screen composite per frame)
  gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  starColor = `hsl(${hue} 60% 90%)`;
  gridColor = `hsla(${hue} 90% 65% / 0.06)`;
  if (hue !== nebulaHue) buildNebula(hue);
}

function getHurtVignette(W, H) {
  if (!hurtVignette) {
    hurtVignette = makeCanvas(W * BG_RES, H * BG_RES);
    const g = hurtVignette.getContext('2d');
    const w = hurtVignette.width, h = hurtVignette.height;
    const gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
    gr.addColorStop(0, 'rgba(255,0,60,0)');
    gr.addColorStop(1, 'rgba(255,0,60,1)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
  return hurtVignette;
}

function buildNebula(hue) {
  nebulaHue = hue;
  nebula = makeCanvas(NEBULA, NEBULA);
  const g = nebula.getContext('2d');
  let seed = hue * 9301 + 49297;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 18; i++) {
    const x = rnd() * NEBULA, y = rnd() * NEBULA, r = 60 + rnd() * 170;
    const h = hue + (rnd() - 0.5) * 60; // stay near the stage's cool hue, away from enemy reds
    const a = 0.05 + rnd() * 0.09;
    // draw wrapped copies so the tile repeats seamlessly
    for (const ox of [-NEBULA, 0, NEBULA]) {
      for (const oy of [-NEBULA, 0, NEBULA]) {
        const bx = x + ox, by = y + oy;
        if (bx + r < 0 || bx - r > NEBULA || by + r < 0 || by - r > NEBULA) continue;
        const b = g.createRadialGradient(bx, by, 0, bx, by, r);
        b.addColorStop(0, `hsla(${h} 85% 55% / ${a})`);
        b.addColorStop(1, `hsla(${h} 85% 55% / 0)`);
        g.fillStyle = b;
        g.fillRect(bx - r, by - r, r * 2, r * 2);
      }
    }
  }
}

const STARS = Array.from({ length: 160 }, (_, i) => {
  const h = Math.sin(i * 12.9898) * 43758.5453;
  const h2 = Math.sin(i * 78.233) * 12543.123;
  return { x: h - Math.floor(h), y: h2 - Math.floor(h2), z: 0.08 + ((i * 37) % 10) / 30, s: 0.7 + ((i * 13) % 7) / 6, tw: i * 1.7 };
});

const PICKUP_GLOW = { coin: '#ffd60a', heart: '#ff5c8a', vacuum: '#7df9ff', chest: '#ffb703' };

export function viewScale(W, H) {
  return Math.max(0.72, Math.min(1.1, Math.min(W, H) / 430));
}

// Per-frame scratch state, reused so the hot path allocates nothing.
let VW = 0, VH = 0;
const visEnemies = [];
const visPickups = [];
const marks = [];
function inView(x, y, r) {
  return x + r > CX && x - r < CX + VW && y + r > CY && y - r < CY + VH;
}
// Enemy radius never changes after spawn, so each enemy keeps its own sprite pair.
function enemySprites(e) {
  if (!e.spr) e.spr = [enemySprite(e.type, e.r, e.def.color, false), enemySprite(e.type, e.r, e.def.color, true)];
  return e.spr;
}
function spawnScale(e) {
  const a = Math.min(1, (e.age ?? 1) / 0.25);
  return a < 1 ? 1 - Math.pow(1 - a, 3) + Math.sin(a * Math.PI) * 0.15 : 1;
}
const GLOW_BUDGET = 110; // above this many visible enemies, only elites/bosses glow
const XP_GLOW_BUDGET = 100; // gem glows start shrinking past this many visible gems (minimum at 2.2x)
const BULLET_MARGIN = 24; // enemy bullet glow is 3r with r up to 7
const ELITE_DASH = [7, 6];
const NO_DASH = [];
const FONT_SMALL = '900 14px system-ui, sans-serif';
const FONT_BIG = '900 18px system-ui, sans-serif';

export function render(ctx, game, W, H, dpr, now, dt) {
  const s = viewScale(W, H);
  const p = game.player;
  buildBackground(W, H, game.stage.hue);
  // Shake and hurt tint only animate while the run is live; behind pause and
  // level-up overlays (dt === 0 or not playing) the frame stays still.
  const live = game.state === 'play' && dt > 0 && !(game.endTimer > 0);

  // smoothed camera that leads slightly in the direction of travel
  const tx = p.x + p.vx * 0.22, ty = p.y + p.vy * 0.22;
  if (!game.cam) game.cam = { x: tx, y: ty };
  const follow = 1 - Math.exp(-7 * Math.min(dt, 0.05));
  game.cam.x += (tx - game.cam.x) * follow;
  game.cam.y += (ty - game.cam.y) * follow;
  let shx = 0, shy = 0;
  if (live && game.shake > 0) {
    shx = (Math.random() - 0.5) * game.shake;
    shy = (Math.random() - 0.5) * game.shake;
  }
  K = dpr * s;
  VW = W / s;
  VH = H / s;
  CX = game.cam.x - VW / 2 + shx;
  CY = game.cam.y - VH / 2 + shy;

  // ---- background (device space) ----
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.drawImage(bgGrad, 0, 0, W * dpr, H * dpr);
  {
    const tile = NEBULA * dpr;
    const ox = -(((CX * K * 0.3) % tile) + tile) % tile;
    const oy = -(((CY * K * 0.3) % tile) + tile) % tile;
    for (let x = ox; x < W * dpr; x += tile) for (let y = oy; y < H * dpr; y += tile) ctx.drawImage(nebula, x, y, tile, tile);
  }
  ctx.fillStyle = starColor;
  for (const st of STARS) {
    const x = (((st.x * W - CX * s * st.z) % W) + W) % W;
    const y = (((st.y * H - CY * s * st.z) % H) + H) % H;
    ctx.globalAlpha = Math.min(1, (0.2 + st.z * 1.4) * (0.55 + 0.45 * Math.sin(now * 0.002 + st.tw)));
    ctx.fillRect(x * dpr, y * dpr, st.s * dpr, st.s * dpr);
  }
  ctx.globalAlpha = 1;

  // ---- grid ----
  world(ctx);
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1 / s;
  ctx.beginPath();
  const G = 96;
  for (let x = Math.floor(CX / G) * G; x < CX + VW; x += G) { ctx.moveTo(x, CY); ctx.lineTo(x, CY + VH); }
  for (let y = Math.floor(CY / G) * G; y < CY + VH; y += G) { ctx.moveTo(CX, y); ctx.lineTo(CX + VW, y); }
  ctx.stroke();

  visEnemies.length = 0;
  // margin covers the widest enemy glow (2.6r on elites/bosses) plus its ground shadow
  for (const e of game.enemies) if (!e.dead && inView(e.x, e.y, e.r * 2.8)) visEnemies.push(e);
  visPickups.length = 0;
  let gems = 0;
  for (const k of game.pickups) {
    // margin covers the widest glow (~34 units) and a chest's 128-unit beam
    if (!inView(k.x, k.y, k.kind === 'chest' ? 140 : 40)) continue;
    visPickups.push(k);
    if (k.kind === 'xp') gems++;
  }

  // ---- ground shadows ----
  const sh = shadowSprite();
  ctx.globalAlpha = 0.5;
  for (const e of visEnemies) blit(ctx, sh, e.x + e.r * 0.2, e.y + e.r * 0.75, 0, (e.r / 17) * spawnScale(e));
  blit(ctx, sh, p.x + 3, p.y + 14, 0, 0.8);
  ctx.globalAlpha = 1;

  // ---- pickups ----
  ctx.globalCompositeOperation = 'lighter';
  // Gem glows shrink smoothly as the gem count climbs, instead of popping off at a threshold.
  const crowd = Math.min(1, Math.max(0, (gems - XP_GLOW_BUDGET) / XP_GLOW_BUDGET));
  const gemGlowSize = 3.2 - crowd * 1.0, gemGlowAlpha = 0.7 - crowd * 0.3;
  for (const k of visPickups) {
    if (k.kind === 'xp') {
      const gm = GEM[gemTier(k.value)];
      glowAt(ctx, gm.color, k.x, k.y, gm.size * gemGlowSize, gemGlowAlpha);
    } else if (k.kind === 'chest') {
      ctx.globalAlpha = 0.6 + 0.2 * Math.sin(now * 0.005);
      blit(ctx, beamSprite(), k.x, k.y - 64, 0, 1);
      ctx.globalAlpha = 1;
      glowAt(ctx, PICKUP_GLOW.chest, k.x, k.y, 34, 0.6);
    } else glowAt(ctx, PICKUP_GLOW[k.kind], k.x, k.y, 16, 0.5);
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const k of visPickups) {
    const ph = now * 0.004 + k.x * 0.05;
    const bob = Math.sin(ph) * 1.6;
    if (k.kind === 'xp') {
      blit(ctx, gemSprite(gemTier(k.value)), k.x, k.y + bob, Math.sin(ph * 0.7) * 0.25);
      if (Math.sin(now * 0.003 + k.y) > 0.96) {
        // occasional sparkle
        place(ctx, k.x + 3, k.y - 6 + bob);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-0.6, -3, 1.2, 6);
        ctx.fillRect(-3, -0.6, 6, 1.2);
      }
    } else if (k.kind === 'coin') blit(ctx, coinSprite(), k.x, k.y + bob, 0, 0.25 + 0.75 * Math.abs(Math.cos(now * 0.005 + k.x)), 1);
    else if (k.kind === 'heart') blit(ctx, heartSprite(), k.x, k.y + bob, 0, 1 + 0.1 * Math.sin(now * 0.01));
    else if (k.kind === 'vacuum') blit(ctx, vacuumSprite(), k.x, k.y + bob, now * 0.004);
    else if (k.kind === 'chest') blit(ctx, chestSprite(), k.x, k.y + bob * 1.5);
  }

  // ---- area effects under units ----
  ctx.globalCompositeOperation = 'lighter';
  for (const f of game.fx) {
    const t = f.life / f.max;
    if (f.kind === 'ring') {
      const r = f.r * (1 - t * 0.55);
      world(ctx);
      ctx.globalAlpha = t * 0.15;
      ctx.fillStyle = f.color;
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.fill();
      ctx.globalAlpha = t;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 8 * t + 1.5;
      ctx.stroke();
    } else if (f.kind === 'blast') {
      glowAt(ctx, f.color, f.x, f.y, f.r * (1.3 - t * 0.3), t);
      world(ctx);
      ctx.globalAlpha = t;
      ctx.strokeStyle = '#e6f3ff';
      ctx.lineWidth = 3 * t + 1;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 - t * 0.5), 0, TAU); ctx.stroke();
    } else if (f.kind === 'pop') {
      world(ctx);
      ctx.globalAlpha = t * 0.9;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 3 * t + 0.5;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.45 + (1 - t) * 0.8), 0, TAU); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // ---- enemies ----
  const crowded = visEnemies.length > GLOW_BUDGET;
  for (const e of visEnemies) {
    if (crowded && !e.elite && !e.def.boss) continue;
    glowAt(ctx, e.def.color, e.x, e.y, e.r * (e.elite || e.def.boss ? 2.6 : 1.9) * spawnScale(e), 0.45);
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const e of visEnemies) {
    const pop = spawnScale(e);
    const face = Math.atan2(p.y - e.y, p.x - e.x);
    const rot = e.type === 'dart' || e.type === 'spitter' || e.type === 'brute' ? face : e.type === 'splitter' ? e.spin * 0.6 : e.spin * 0.5;
    const spr = enemySprites(e);
    blit(ctx, e.flash > 0 ? spr[1] : spr[0], e.x, e.y, rot, pop);
    if ((e.type === 'drone' || e.type === 'boss') && e.flash <= 0) {
      place(ctx, e.x + Math.cos(face) * e.r * 0.12, e.y + Math.sin(face) * e.r * 0.12);
      ctx.fillStyle = '#fff4f6';
      ctx.beginPath(); ctx.arc(0, 0, e.r * 0.25 * pop, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1a0008';
      ctx.beginPath(); ctx.arc(Math.cos(face) * e.r * 0.08, Math.sin(face) * e.r * 0.08, e.r * 0.12 * pop, 0, TAU); ctx.fill();
    }
    if (e.elite) {
      world(ctx);
      ctx.setLineDash(ELITE_DASH);
      ctx.lineDashOffset = -now / 25;
      ctx.strokeStyle = '#ffd60a';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 1.4, 0, TAU); ctx.stroke();
      ctx.setLineDash(NO_DASH);
      const w = e.r * 2;
      ctx.fillStyle = OUTLINE;
      ctx.fillRect(e.x - w / 2 - 1, e.y - e.r * 1.4 - 12, w + 2, 6);
      ctx.fillStyle = '#ffd60a';
      ctx.fillRect(e.x - w / 2, e.y - e.r * 1.4 - 11, w * Math.max(0, e.hp / e.maxHp), 4);
    }
  }

  // ---- player weapons (cyan / white / blue family) ----
  ctx.globalCompositeOperation = 'lighter';
  for (const b of game.bullets) glowAt(ctx, '#38d6ff', b.x, b.y, 11, 0.55);
  for (const m of game.missiles) {
    const fl = 0.8 + Math.random() * 0.4;
    glowAt(ctx, '#8ec5ff', m.x - Math.cos(m.a) * 10, m.y - Math.sin(m.a) * 10, 11 * fl, 0.95);
  }
  ctx.globalCompositeOperation = 'source-over';
  const bolt = boltSprite();
  for (const b of game.bullets) blit(ctx, bolt, b.x, b.y, Math.atan2(b.vy, b.vx));
  const ms = missileSprite();
  for (const m of game.missiles) blit(ctx, ms, m.x, m.y, m.a);

  const orbit = game.wstate.orbit;
  const orbitLv = game.weapons.orbit;
  if (orbit?.blades && orbitLv) {
    const st = WEAPONS.orbit.levels[orbitLv - 1];
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < st.count; i++) {
      for (let tr = 3; tr >= 1; tr--) {
        const a = orbit.angle - tr * 0.11 + (i / st.count) * TAU;
        glowAt(ctx, '#38d6ff', p.x + Math.cos(a) * st.radius, p.y + Math.sin(a) * st.radius, 9, 0.18 * (4 - tr));
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    const bl = bladeSprite();
    for (const b of orbit.blades) blit(ctx, bl, b.x, b.y, orbit.angle * 4);
  }

  // ---- player ship ----
  const speed = Math.hypot(p.vx, p.vy);
  ctx.globalCompositeOperation = 'lighter';
  {
    const back = p.face + Math.PI;
    const len = 6 + speed * 0.07 + Math.random() * 4;
    const ex = p.x + Math.cos(back) * 10, ey = p.y + Math.sin(back) * 10;
    glowAt(ctx, '#38d6ff', ex + Math.cos(back) * len * 0.5, ey + Math.sin(back) * len * 0.5, 8 + len * 0.6, 0.9);
    place(ctx, ex, ey, back);
    ctx.fillStyle = 'rgba(200,250,255,0.9)';
    ctx.beginPath(); ctx.moveTo(0, -3.2); ctx.lineTo(len, 0); ctx.lineTo(0, 3.2); ctx.fill();
    glowAt(ctx, '#7df9ff', p.x, p.y, 30, 0.35);
  }
  ctx.globalCompositeOperation = 'source-over';
  const hurtBlink = live && p.invuln > 0.25 && p.invuln < 0.6 && Math.floor(now / 60) % 2 === 0;
  if (!hurtBlink) blit(ctx, shipSprite(), p.x, p.y, p.face);
  if (p.invuln > 0 && game.state === 'play') {
    world(ctx);
    ctx.globalAlpha = Math.min(1, p.invuln * 2) * (0.35 + 0.15 * Math.sin(now * 0.02));
    ctx.strokeStyle = '#9ff6ff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 22, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---- enemy bullets: drawn on top of everything so danger is always visible ----
  ctx.globalCompositeOperation = 'lighter';
  for (const b of game.ebullets) if (inView(b.x, b.y, BULLET_MARGIN)) glowAt(ctx, '#ff2d55', b.x, b.y, b.r * 3, 0.7);
  ctx.globalCompositeOperation = 'source-over';
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.015);
  world(ctx);
  ctx.strokeStyle = '#ff6b8b';
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.35 + 0.45 * pulse;
  ctx.beginPath();
  for (const b of game.ebullets) {
    if (!inView(b.x, b.y, BULLET_MARGIN)) continue;
    const rr = b.r * (1.6 + pulse * 0.35);
    ctx.moveTo(b.x + rr, b.y);
    ctx.arc(b.x, b.y, rr, 0, TAU);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  for (const b of game.ebullets) if (inView(b.x, b.y, BULLET_MARGIN)) blit(ctx, orbSprite(b.r), b.x, b.y);

  // ---- particles & lightning ----
  ctx.globalCompositeOperation = 'lighter';
  world(ctx);
  for (const q of game.particles) {
    ctx.globalAlpha = q.life / q.max;
    ctx.fillStyle = q.color;
    const sz = q.size * (0.5 + 0.5 * (q.life / q.max));
    ctx.fillRect(q.x - sz / 2, q.y - sz / 2, sz, sz);
  }
  for (const f of game.fx) {
    if (f.kind !== 'zap') continue;
    const t = f.life / f.max;
    ctx.beginPath();
    ctx.moveTo(f.x1, f.y1);
    for (let i = 1; i < 6; i++) {
      const u = i / 6;
      ctx.lineTo(f.x1 + (f.x2 - f.x1) * u + (Math.random() - 0.5) * 16, f.y1 + (f.y2 - f.y1) * u + (Math.random() - 0.5) * 16);
    }
    ctx.lineTo(f.x2, f.y2);
    ctx.globalAlpha = t * 0.55;
    ctx.strokeStyle = '#fff275';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.globalAlpha = t;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // ---- damage numbers ----
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  for (const t of game.texts) {
    const life = t.life / t.max;
    ctx.globalAlpha = Math.min(1, life * 2.5);
    place(ctx, t.x, t.y, 0, t.big ? 1 + Math.max(0, life - 0.7) * 1.5 : 1);
    ctx.font = t.big ? FONT_BIG : FONT_SMALL;
    ctx.strokeText(t.txt, 0, 0);
    ctx.fillStyle = t.color;
    ctx.fillText(t.txt, 0, 0);
  }
  ctx.globalAlpha = 1;

  // ---- player HP pill ----
  world(ctx);
  const bw = 38;
  const hpFrac = Math.max(0, p.hp / p.maxHp);
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(p.x - bw / 2 - 1.5, p.y + 21, bw + 3, 7, 3.5);
  else ctx.rect(p.x - bw / 2 - 1.5, p.y + 21, bw + 3, 7);
  ctx.fill();
  ctx.fillStyle = hpFrac > 0.5 ? '#3ee08f' : hpFrac > 0.25 ? '#ffd166' : '#ff4d6d';
  ctx.fillRect(p.x - bw / 2, p.y + 22.5, bw * hpFrac, 4);

  // ---- screen space overlays: off-screen markers for boss, elites, chests ----
  marks.length = 0;
  for (const e of game.enemies) if (!e.dead && (e.elite || e.def.boss)) marks.push(e);
  for (const k of game.pickups) if (k.kind === 'chest') marks.push(k);
  for (const m of marks) {
    const sx = (m.x - CX) * s, sy = (m.y - CY) * s;
    if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
    const c = m.kind === 'chest' ? PICKUP_GLOW.chest : m.def.boss ? m.def.color : '#ffd60a';
    const a = Math.atan2(sy - H / 2, sx - W / 2);
    const pad = 28;
    const ex = Math.max(pad, Math.min(W - pad, W / 2 + Math.cos(a) * W));
    const ey = Math.max(pad + 90, Math.min(H - pad, H / 2 + Math.sin(a) * H));
    const ca = Math.cos(a) * dpr, sa = Math.sin(a) * dpr;
    ctx.setTransform(ca, sa, -sa, ca, ex * dpr, ey * dpr);
    ctx.fillStyle = OUTLINE;
    ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(-8, 11); ctx.lineTo(-8, -11); ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, 8); ctx.lineTo(-6, -8); ctx.fill();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (live && game.hurtFlash > 0) {
    ctx.globalAlpha = (game.hurtFlash / 0.18) * 0.22;
    ctx.fillStyle = '#ff2846';
    ctx.fillRect(0, 0, W * dpr, H * dpr);
    ctx.globalAlpha = 1;
  }
  if (hpFrac < 0.3 && game.state === 'play') {
    ctx.globalAlpha = 0.28 + Math.sin(now * 0.008) * 0.1;
    ctx.drawImage(getHurtVignette(W, H), 0, 0, W * dpr, H * dpr);
    ctx.globalAlpha = 1;
  }
}
