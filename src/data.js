// Static game content: stages, enemies, weapons, passives, meta upgrades.
// Pure data + small helpers so the simulation can be tested in Node.

export const STAGES = [
  { id: 'nebula', name: 'Nebula Drift', hue: 195, diff: 1, rate: 1, duration: 300, blurb: 'A calm start. Learn to dodge.' },
  { id: 'inferno', name: 'Inferno Belt', hue: 18, diff: 1.45, rate: 1.15, duration: 360, blurb: 'Hotter, faster, angrier.' },
  { id: 'void', name: 'The Void', hue: 280, diff: 2, rate: 1.3, duration: 420, blurb: 'Nothing survives here. Prove it wrong.' },
];

// hp/speed/dmg are base values; hp is scaled by stage difficulty and elapsed time.
export const ENEMIES = {
  drone: { hp: 8, speed: 72, r: 12, dmg: 8, xp: 1, color: '#ff4d6d', coin: 0.14 },
  dart: { hp: 7, speed: 135, r: 9, dmg: 6, xp: 1, color: '#ffd166', coin: 0.14 },
  spitter: { hp: 22, speed: 50, r: 13, dmg: 8, xp: 3, color: '#06d6a0', coin: 0.3, fireEvery: 2.6 },
  brute: { hp: 70, speed: 44, r: 22, dmg: 16, xp: 6, color: '#c77dff', coin: 0.6 },
  splitter: { hp: 34, speed: 60, r: 16, dmg: 10, xp: 3, color: '#4cc9f0', coin: 0.3, splits: 2 },
  boss: { hp: 1800, speed: 58, r: 46, dmg: 26, xp: 60, color: '#ff006e', coin: 1, boss: true, fireEvery: 3.2 },
};

// Time (s) at which each enemy joins the random spawn table, and its weight.
export const SPAWN_TABLE = [
  { type: 'drone', from: 0, weight: 10 },
  { type: 'dart', from: 35, weight: 5 },
  { type: 'spitter', from: 80, weight: 3 },
  { type: 'brute', from: 120, weight: 2 },
  { type: 'splitter', from: 150, weight: 3 },
];

export const WEAPONS = {
  blaster: {
    name: 'Pulse Blaster', icon: '✦', color: '#7df9ff',
    desc: 'Fires at the nearest enemy.',
    levels: [
      { cd: 0.42, dmg: 12, count: 1, pierce: 0 },
      { cd: 0.39, dmg: 14, count: 1, pierce: 1 },
      { cd: 0.36, dmg: 16, count: 2, pierce: 1 },
      { cd: 0.35, dmg: 17, count: 2, pierce: 2 },
      { cd: 0.3, dmg: 21, count: 3, pierce: 3 },
    ],
  },
  orbit: {
    name: 'Orbit Blades', icon: '◎', color: '#b8f2e6',
    desc: 'Blades circle you, shredding anything close.',
    levels: [
      { count: 2, dmg: 9, radius: 62 },
      { count: 3, dmg: 11, radius: 66 },
      { count: 3, dmg: 14, radius: 72 },
      { count: 4, dmg: 17, radius: 78 },
      { count: 5, dmg: 22, radius: 88 },
    ],
  },
  zap: {
    name: 'Chain Zap', icon: 'ϟ', color: '#fff275',
    desc: 'Lightning jumps between enemies.',
    levels: [
      { cd: 1.6, dmg: 16, chains: 3 },
      { cd: 1.45, dmg: 20, chains: 4 },
      { cd: 1.3, dmg: 24, chains: 5 },
      { cd: 1.15, dmg: 29, chains: 6 },
      { cd: 0.95, dmg: 36, chains: 8 },
    ],
  },
  nova: {
    name: 'Nova Pulse', icon: '✺', color: '#ff9e00',
    desc: 'A shockwave that blasts enemies away.',
    levels: [
      { cd: 3.0, dmg: 20, radius: 110 },
      { cd: 2.7, dmg: 26, radius: 125 },
      { cd: 2.4, dmg: 33, radius: 140 },
      { cd: 2.1, dmg: 40, radius: 155 },
      { cd: 1.8, dmg: 50, radius: 178 },
    ],
  },
  missile: {
    name: 'Seeker Missiles', icon: '➹', color: '#ff70a6',
    desc: 'Homing rockets that explode on impact.',
    levels: [
      { cd: 1.9, dmg: 24, count: 1, blast: 52 },
      { cd: 1.7, dmg: 30, count: 1, blast: 56 },
      { cd: 1.5, dmg: 36, count: 2, blast: 60 },
      { cd: 1.3, dmg: 44, count: 2, blast: 64 },
      { cd: 1.1, dmg: 55, count: 3, blast: 72 },
    ],
  },
};

export const PASSIVES = {
  might: { name: 'Might', icon: '⚔', desc: '+12% damage', max: 5 },
  haste: { name: 'Haste', icon: '»', desc: '-8% weapon cooldowns', max: 5 },
  swift: { name: 'Swift', icon: '➶', desc: '+8% move speed', max: 5 },
  magnet: { name: 'Magnet', icon: '◉', desc: '+30% pickup range', max: 5 },
  vitality: { name: 'Vitality', icon: '♥', desc: '+20 max HP and heal 20', max: 5 },
  regen: { name: 'Regen', icon: '✚', desc: '+0.5 HP per second', max: 5 },
  armor: { name: 'Armor', icon: '⛨', desc: '-1 damage taken per hit', max: 5 },
  crit: { name: 'Precision', icon: '✧', desc: '+7% critical hit chance (2x damage)', max: 5 },
};

// Permanent upgrades bought with coins between runs.
export const META = {
  hp: { name: 'Hull Plating', desc: '+10 max HP', max: 5, base: 40 },
  power: { name: 'Overcharge', desc: '+6% damage', max: 5, base: 50 },
  speed: { name: 'Thrusters', desc: '+5% move speed', max: 5, base: 40 },
  magnet: { name: 'Tractor Beam', desc: '+20% pickup range', max: 5, base: 30 },
  greed: { name: 'Greed', desc: '+15% coins earned', max: 5, base: 60 },
  growth: { name: 'Insight', desc: '+8% XP gained', max: 5, base: 60 },
  reroll: { name: 'Reroll', desc: '+1 upgrade reroll per run', max: 3, base: 120 },
  revive: { name: 'Second Life', desc: 'Revive once per run at 50% HP', max: 1, base: 400 },
};

// Starting-weapon unlocks bought in the shop.
export const WEAPON_UNLOCK_COST = { blaster: 0, orbit: 150, zap: 250, nova: 350, missile: 450 };

export function metaCost(id, level) {
  return Math.round(META[id].base * Math.pow(level + 1, 1.55));
}

export function xpForLevel(level) {
  return Math.floor(3 + level * 2 + 0.8 * Math.pow(level, 1.8));
}

export const PLAYER_BASE = { hp: 100, speed: 155, magnet: 100, r: 13, invuln: 0.6 };
