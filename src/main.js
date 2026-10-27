// App shell: screens, input, game loop, persistence wiring.
import { STAGES, WEAPONS, PASSIVES, META, WEAPON_UNLOCK_COST, metaCost } from './data.js';
import { Game } from './game.js';
import { render, viewScale } from './render.js';
import { loadSave, writeSave, applyRunResult, defaultSave } from './save.js';
import { audio, sfx, unlockAudio, suspendAudio, startMusic, stopMusic } from './audio.js';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#game');
const ctx = canvas.getContext('2d', { alpha: false });

let save = loadSave();
let game = null; // active run
let demo = null; // attract-mode game behind the menus
let paused = false;
let selectedStage = Math.min(save.unlockedStages - 1, STAGES.length - 1);
let W = 0, H = 0;
let lastAutosave = 0;
let installPrompt = null;
const screenStack = [];

applyAudioSettings();

// ---------- canvas sizing ----------
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = viewScale(W, H);
  for (const g of [game, demo]) if (g) { g.viewW = W / s; g.viewH = H / s; }
}
window.addEventListener('resize', resize);
resize();

// ---------- screens ----------
const SCREENS = ['title', 'setup', 'shop', 'records', 'settings', 'levelup', 'pause', 'results', 'confirm'];
function show(name) {
  for (const s of SCREENS) $(`#screen-${s}`).classList.toggle('hidden', s !== name);
  if (name === 'title') refreshTitle();
  if (name === 'setup') buildSetup();
  if (name === 'shop') buildShop();
  if (name === 'records') buildRecords();
  if (name === 'settings') buildSettings($('#settings-list'));
}
function go(name) {
  screenStack.push(currentScreen());
  show(name);
}
function back() {
  show(screenStack.pop() || 'title');
}
function currentScreen() {
  return SCREENS.find((s) => !$(`#screen-${s}`).classList.contains('hidden')) || 'title';
}
document.querySelectorAll('.btn.back').forEach((b) => b.addEventListener('click', () => { sfx('click'); back(); }));

let confirmAction = null;
function confirmDialog(text, action, yesLabel = 'Confirm') {
  confirmAction = action;
  $('#confirm-text').textContent = text;
  $('#btn-confirm-yes').textContent = yesLabel;
  go('confirm');
}
$('#btn-confirm-no').addEventListener('click', () => { confirmAction = null; back(); });
$('#btn-confirm-yes').addEventListener('click', () => {
  const a = confirmAction;
  confirmAction = null;
  back();
  a?.();
});

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function fmtTime(t) {
  t = Math.max(0, Math.floor(t));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
function persist() {
  writeSave(save);
}

// ---------- title ----------
function refreshTitle() {
  document.querySelectorAll('.coin-count').forEach((n) => (n.textContent = save.coins));
  $('#btn-continue').classList.toggle('hidden', !save.run);
  if (save.run) $('#btn-continue').textContent = `Continue Run — ${STAGES[save.run.stage].name} ${fmtTime(save.run.time)}`;
  $('#btn-install').classList.toggle('hidden', !installPrompt);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone;
  $('#ios-hint').classList.toggle('hidden', !ios);
}
$('#btn-play').addEventListener('click', () => {
  sfx('click');
  if (save.run) {
    confirmDialog('Starting a new run abandons your saved run. Continue?', () => { save.run = null; persist(); go('setup'); }, 'New Run');
  } else go('setup');
});
$('#btn-continue').addEventListener('click', () => { sfx('click'); startRun(save.run.stage, save.run); });
$('#btn-shop').addEventListener('click', () => { sfx('click'); go('shop'); });
$('#btn-records').addEventListener('click', () => { sfx('click'); go('records'); });
$('#btn-settings').addEventListener('click', () => { sfx('click'); go('settings'); });
$('#btn-install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  refreshTitle();
});
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (currentScreen() === 'title' && !game) refreshTitle();
});

// ---------- stage setup ----------
function buildSetup() {
  const list = $('#stage-list');
  list.innerHTML = '';
  STAGES.forEach((st, i) => {
    const locked = i >= save.unlockedStages;
    const best = save.best[st.id];
    const c = el('button', `card${locked ? ' locked' : ''}${i === selectedStage ? ' selected' : ''}`);
    const bestTxt = best ? (best.won ? `★ Cleared · best ${fmtTime(best.time)}` : `Best ${fmtTime(best.time)}`) : 'Not played';
    c.innerHTML = `<div class="icon" style="color:hsl(${st.hue} 90% 65%)">${locked ? '🔒' : ['◈', '✹', '◐'][i]}</div>
      <div class="body"><div class="name">${st.name}</div>
      <div class="desc">${locked ? `Clear ${STAGES[i - 1].name} to unlock` : `${st.blurb} Boss at ${fmtTime(st.duration)}.`}</div>
      <div class="desc">${locked ? '' : bestTxt}</div></div>`;
    c.addEventListener('click', () => {
      if (locked) { sfx('deny'); return; }
      sfx('click');
      selectedStage = i;
      buildSetup();
    });
    list.appendChild(c);
  });
  const wp = $('#weapon-pick');
  wp.innerHTML = '';
  for (const id of save.weapons) {
    const w = WEAPONS[id];
    const b = el('button', `chip${save.startWeapon === id ? ' selected' : ''}`, `${w.icon} ${w.name}`);
    b.addEventListener('click', () => { sfx('click'); save.startWeapon = id; persist(); buildSetup(); });
    wp.appendChild(b);
  }
  if (save.weapons.length < Object.keys(WEAPONS).length) {
    wp.appendChild(el('span', 'hint', 'Unlock more starting weapons in Upgrades.'));
  }
}
$('#btn-start').addEventListener('click', () => { sfx('click'); startRun(selectedStage, null); });

// ---------- shop ----------
function pips(lv, max) {
  return `<div class="pips">${Array.from({ length: max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div>`;
}
function buildShop() {
  document.querySelectorAll('.coin-count').forEach((n) => (n.textContent = save.coins));
  const list = $('#shop-list');
  const scroll = list.scrollTop;
  list.innerHTML = '';
  list.appendChild(el('h3', '', 'Permanent Boosts'));
  for (const [id, m] of Object.entries(META)) {
    const lv = save.meta[id];
    const maxed = lv >= m.max;
    const cost = maxed ? 0 : metaCost(id, lv);
    const c = el('button', `card${!maxed && save.coins < cost ? ' locked' : ''}`);
    c.innerHTML = `<div class="body"><div class="name">${m.name}</div><div class="desc">${m.desc}</div>${pips(lv, m.max)}</div>
      <div class="price${maxed ? ' max' : ''}">${maxed ? 'MAX' : `● ${cost}`}</div>`;
    c.addEventListener('click', () => {
      if (maxed || save.coins < cost) { sfx('deny'); return; }
      save.coins -= cost;
      save.meta[id]++;
      persist();
      sfx('buy');
      haptic(20);
      buildShop();
    });
    list.appendChild(c);
  }
  list.appendChild(el('h3', '', 'Starting Weapons'));
  for (const [id, w] of Object.entries(WEAPONS)) {
    const owned = save.weapons.includes(id);
    const cost = WEAPON_UNLOCK_COST[id];
    const c = el('button', `card${!owned && save.coins < cost ? ' locked' : ''}`);
    c.innerHTML = `<div class="icon" style="color:${w.color}">${w.icon}</div><div class="body"><div class="name">${w.name}</div><div class="desc">${w.desc}</div></div>
      <div class="price${owned ? ' max' : ''}">${owned ? 'OWNED' : `● ${cost}`}</div>`;
    c.addEventListener('click', () => {
      if (owned || save.coins < cost) { sfx('deny'); return; }
      save.coins -= cost;
      save.weapons.push(id);
      persist();
      sfx('buy');
      haptic(20);
      buildShop();
    });
    list.appendChild(c);
  }
  list.scrollTop = scroll;
}

// ---------- records ----------
function buildRecords() {
  const list = $('#records-list');
  list.innerHTML = '';
  for (const st of STAGES) {
    const b = save.best[st.id];
    list.appendChild(el('div', 'card', `<div class="body"><div class="name">${st.name} ${b?.won ? '★' : ''}</div>
      <div class="desc">${b ? `Best ${fmtTime(b.time)} · ${b.kills} kills · LV ${b.level}` : 'No runs yet'}</div></div>`));
  }
  const s = save.stats;
  list.appendChild(el('div', 'card', `<div class="body"><div class="name">Career</div>
    <div class="desc">${s.runs} runs · ${s.wins} wins · ${s.kills} kills · ${s.bosses} bosses</div>
    <div class="desc">${fmtTime(s.playTime)} played · ● ${s.coinsEarned} earned</div></div>`));
}

// ---------- settings ----------
const SETTING_LABELS = { sound: 'Sound effects', music: 'Music', haptics: 'Vibration', damageNumbers: 'Damage numbers' };
function buildSettings(container) {
  container.innerHTML = '';
  for (const [k, label] of Object.entries(SETTING_LABELS)) {
    const c = el('button', 'card toggle', `<span class="name">${label}</span><span class="switch${save.settings[k] ? ' on' : ''}"></span>`);
    c.setAttribute('role', 'switch');
    c.setAttribute('aria-checked', String(save.settings[k]));
    c.addEventListener('click', () => {
      save.settings[k] = !save.settings[k];
      persist();
      applyAudioSettings();
      sfx('click');
      buildSettings(container);
    });
    container.appendChild(c);
  }
}
function applyAudioSettings() {
  audio.sound = save.settings.sound;
  audio.music = save.settings.music;
  if (!audio.music) stopMusic();
  else if (game && !paused) startMusic(game.stageIdx);
}
$('#btn-reset').addEventListener('click', () => {
  confirmDialog('Erase ALL progress, coins and upgrades? This cannot be undone.', () => {
    save = defaultSave();
    persist();
    selectedStage = 0;
    applyAudioSettings();
    screenStack.length = 0;
    show('title');
  }, 'Erase');
});

function haptic(ms) {
  if (save.settings.haptics && navigator.vibrate) navigator.vibrate(ms);
}

// ---------- toasts ----------
function toast(msg) {
  const t = el('div', 'toast', '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 2400);
  while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
}

// ---------- run lifecycle ----------
function startRun(stageIdx, snapshot) {
  unlockAudio();
  screenStack.length = 0;
  game = new Game({
    stage: stageIdx,
    save,
    snapshot,
    hooks: {
      sfx,
      haptic,
      toast,
      levelUp: showLevelUp,
      boss: () => { toast('⚠ The Warden has arrived!'); $('#boss-bar').classList.remove('hidden'); },
      end: endRun,
    },
  });
  resize();
  paused = false;
  input.reset();
  for (const s of SCREENS) $(`#screen-${s}`).classList.add('hidden');
  $('#hud').classList.remove('hidden');
  $('#boss-bar').classList.add('hidden');
  lastHud = {};
  save.run = game.snapshot();
  persist();
  stopMusic();
  startMusic(stageIdx);
  if (snapshot) toast('Run resumed');
  if (!save.tutorialDone) {
    $('#tutorial').classList.remove('hidden');
    tutorialTimer = 0;
  }
}
let tutorialTimer = -1;

function showLevelUp(choices) {
  const box = $('#choices');
  box.innerHTML = '';
  choices.forEach((c, i) => {
    let icon, name, desc, badge;
    if (c.kind === 'weapon') {
      const w = WEAPONS[c.id];
      icon = `<span style="color:${w.color}">${w.icon}</span>`;
      name = w.name;
      desc = c.level === 1 ? w.desc : describeWeaponUpgrade(c.id, c.level);
      badge = c.level === 1 ? '<span class="badge">NEW</span>' : `<span class="badge up">LV ${c.level}</span>`;
    } else if (c.kind === 'passive') {
      const p = PASSIVES[c.id];
      icon = p.icon;
      name = p.name;
      desc = p.desc;
      badge = `<span class="badge up">LV ${c.level}</span>`;
    } else if (c.kind === 'heal') {
      icon = '♥'; name = 'Repair'; desc = 'Restore 40% HP'; badge = '';
    } else {
      icon = '●'; name = 'Coin Cache'; desc = '+25 coins'; badge = '';
    }
    const b = el('button', 'card', `<div class="icon">${icon}</div><div class="body"><div class="name">${name}${badge}</div><div class="desc">${desc}</div></div>`);
    b.addEventListener('click', () => {
      if (!game || game.state !== 'levelup') return;
      sfx('click');
      haptic(15);
      game.choose(i);
      $('#screen-levelup').classList.add('hidden');
      save.run = game.snapshot();
      persist();
      input.reset();
    });
    box.appendChild(b);
  });
  const rr = $('#btn-reroll');
  rr.classList.toggle('hidden', game.rerolls <= 0);
  rr.textContent = `Reroll (${game.rerolls})`;
  for (const s of SCREENS) $(`#screen-${s}`).classList.toggle('hidden', s !== 'levelup');
  // Swallow taps for a moment so a finger mid-drag can't pick a card by accident.
  box.style.pointerEvents = 'none';
  setTimeout(() => (box.style.pointerEvents = ''), 350);
}
$('#btn-reroll').addEventListener('click', () => { if (game?.reroll()) sfx('click'); });

function describeWeaponUpgrade(id, level) {
  const a = WEAPONS[id].levels[level - 2], b = WEAPONS[id].levels[level - 1];
  const parts = [];
  if (b.dmg !== a.dmg) parts.push(`Damage ${a.dmg}→${b.dmg}`);
  if (b.count !== undefined && b.count !== a.count) parts.push(`${id === 'orbit' ? 'Blades' : 'Shots'} ${a.count}→${b.count}`);
  if (b.pierce !== undefined && b.pierce !== a.pierce) parts.push(`Pierce +${b.pierce - a.pierce}`);
  if (b.chains !== undefined && b.chains !== a.chains) parts.push(`Chains ${a.chains}→${b.chains}`);
  if (b.radius !== undefined && b.radius !== a.radius) parts.push('Bigger radius');
  if (b.blast !== undefined && b.blast !== a.blast) parts.push('Bigger blast');
  if (b.cd !== undefined && b.cd !== a.cd) parts.push('Faster');
  return parts.join(' · ');
}

function pause() {
  if (!game || paused || game.state === 'dead' || game.state === 'won') return;
  paused = true;
  input.reset();
  save.run = game.snapshot();
  persist();
  stopMusic();
  const lo = $('#pause-loadout');
  lo.innerHTML = '';
  for (const [id, lv] of Object.entries(game.weapons)) lo.appendChild(el('span', '', `${WEAPONS[id].icon} ${WEAPONS[id].name} <b>${lv}</b>`));
  for (const [id, lv] of Object.entries(game.passives)) lo.appendChild(el('span', '', `${PASSIVES[id].icon} ${PASSIVES[id].name} <b>${lv}</b>`));
  buildSettings($('#pause-settings'));
  for (const s of SCREENS) $(`#screen-${s}`).classList.toggle('hidden', s !== 'pause');
}
function resume() {
  if (!game) return;
  paused = false;
  input.reset();
  $('#screen-pause').classList.add('hidden');
  if (game.state === 'levelup') $('#screen-levelup').classList.remove('hidden');
  if (audio.music) startMusic(game.stageIdx);
}
$('#btn-pause').addEventListener('click', () => { sfx('click'); pause(); });
$('#btn-resume').addEventListener('click', () => { sfx('click'); unlockAudio(); resume(); });
$('#btn-quit').addEventListener('click', () => {
  confirmDialog('Quit this run? You keep the coins you collected.', () => {
    if (!game) return;
    game.state = 'dead';
    endRun(game.result(), true);
  }, 'Quit');
});

let lastResult = null;
function endRun(result, quit = false) {
  const prevBest = save.best[STAGES[result.stage].id];
  const earned = applyRunResult(save, result);
  const newBest = save.best[STAGES[result.stage].id] !== prevBest;
  const unlocked = result.won && result.stage + 1 < STAGES.length && save.unlockedStages === result.stage + 2 && !(prevBest?.won);
  persist();
  stopMusic();
  lastResult = result;
  const finish = () => {
    $('#hud').classList.add('hidden');
    $('#joystick').classList.add('hidden');
    $('#results-title').textContent = result.won ? 'VICTORY!' : quit ? 'RUN ENDED' : 'DEFEATED';
    $('#results-title').className = result.won ? 'glow-text' : '';
    const st = $('#results-stats');
    st.innerHTML = '';
    const rows = [
      ['Stage', STAGES[result.stage].name],
      ['Survived', fmtTime(result.time)],
      ['Level', result.level],
      ['Kills', result.kills],
      ['Coins earned', `● ${earned}`],
      ['Total coins', `● ${save.coins}`],
    ];
    for (const [k, v] of rows) {
      st.appendChild(el('div', 'k', k));
      st.appendChild(el('div', `v${k.includes('oins') ? ' gold' : ''}`, String(v)));
    }
    if (newBest) st.appendChild(el('div', 'new', '★ NEW PERSONAL BEST ★'));
    if (unlocked) st.appendChild(el('div', 'new', `🔓 ${STAGES[result.stage + 1].name} unlocked!`));
    for (const s of SCREENS) $(`#screen-${s}`).classList.toggle('hidden', s !== 'results');
    game = null;
    paused = false;
  };
  // Let the death/victory moment breathe before the results screen.
  if (quit) finish();
  else setTimeout(finish, 900);
}
$('#btn-retry').addEventListener('click', () => {
  sfx('click');
  const st = lastResult ? lastResult.stage : selectedStage;
  startRun(st, null);
});
$('#btn-menu').addEventListener('click', () => { sfx('click'); screenStack.length = 0; show('title'); });
$('#btn-results-shop').addEventListener('click', () => { sfx('click'); screenStack.length = 0; screenStack.push('title'); show('shop'); });

// Save and pause whenever the app is backgrounded or closed.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (game) pause();
    suspendAudio();
  } else if (!game || !paused) unlockAudio();
});
window.addEventListener('pagehide', () => {
  if (game && game.state !== 'dead' && game.state !== 'won') save.run = game.snapshot();
  persist();
});

// ---------- input: floating joystick + keyboard ----------
const input = (() => {
  const stick = $('#joystick');
  const knob = $('#joystick-knob');
  const R = 55;
  let pid = null, ox = 0, oy = 0, jx = 0, jy = 0;
  const keys = new Set();
  canvas.addEventListener('pointerdown', (e) => {
    unlockAudio();
    if (!game || paused || game.state !== 'play' || pid !== null) return;
    pid = e.pointerId;
    ox = e.clientX; oy = e.clientY;
    jx = jy = 0;
    stick.style.left = `${ox}px`;
    stick.style.top = `${oy}px`;
    knob.style.transform = '';
    stick.classList.remove('hidden');
    canvas.setPointerCapture?.(pid);
    if (tutorialTimer >= 0) tutorialTimer = Math.max(tutorialTimer, 0.01);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      // Drag the base along so reversing direction is instant.
      ox += (dx / d) * (d - R);
      oy += (dy / d) * (d - R);
      dx = e.clientX - ox; dy = e.clientY - oy;
      stick.style.left = `${ox}px`;
      stick.style.top = `${oy}px`;
    }
    jx = dx / R;
    jy = dy / R;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  });
  const up = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    jx = jy = 0;
    stick.classList.add('hidden');
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  window.addEventListener('keydown', (e) => {
    keys.add(e.key.toLowerCase());
    if (e.repeat) return;
    if (e.key === 'Escape' || e.key === 'p') { if (game && !paused) pause(); else if (game && paused) resume(); }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  return {
    read() {
      let kx = 0, ky = 0;
      if (keys.has('a') || keys.has('arrowleft')) kx -= 1;
      if (keys.has('d') || keys.has('arrowright')) kx += 1;
      if (keys.has('w') || keys.has('arrowup')) ky -= 1;
      if (keys.has('s') || keys.has('arrowdown')) ky += 1;
      if (kx || ky) {
        const m = Math.hypot(kx, ky);
        return { x: kx / m, y: ky / m };
      }
      // Small dead zone, then full speed quickly so tiny thumb moves feel responsive.
      const m = Math.hypot(jx, jy);
      if (m < 0.12) return { x: 0, y: 0 };
      const k = Math.min(1, (m - 0.12) / 0.6) / m;
      return { x: jx * k, y: jy * k };
    },
    reset() {
      pid = null;
      jx = jy = 0;
      keys.clear();
      stick.classList.add('hidden');
    },
  };
})();

// ---------- HUD ----------
let lastHud = {};
function setText(id, txt) {
  if (lastHud[id] === txt) return;
  lastHud[id] = txt;
  $(id).textContent = txt;
}
function updateHud() {
  const g = game;
  const xpFrac = Math.min(1, g.xp / g.xpNeeded);
  const w = `${(xpFrac * 100).toFixed(1)}%`;
  if (lastHud.xp !== w) { lastHud.xp = w; $('#xp-fill').style.width = w; }
  setText('#hud-level', `LV ${g.level}`);
  const remain = g.stage.duration - g.time;
  const timeTxt = g.bossSpawned ? 'BOSS' : fmtTime(remain);
  setText('#hud-time', timeTxt);
  $('#hud-time').classList.toggle('boss', g.bossSpawned);
  setText('#hud-kills', `☠ ${g.kills}`);
  setText('#hud-coins', `● ${g.coins}`);
  const lo = Object.entries(g.weapons).map(([id, lv]) => `${WEAPONS[id].icon}${lv}`).join(' ') + '|' + Object.entries(g.passives).map(([id, lv]) => `${PASSIVES[id].icon}${lv}`).join(' ');
  if (lastHud.lo !== lo) {
    lastHud.lo = lo;
    const box = $('#hud-loadout');
    box.innerHTML = '';
    for (const [id, lv] of Object.entries(g.weapons)) box.appendChild(el('span', '', `${WEAPONS[id].icon} <b>${lv}</b>`));
    for (const [id, lv] of Object.entries(g.passives)) box.appendChild(el('span', '', `${PASSIVES[id].icon} <b>${lv}</b>`));
  }
  if (g.boss) {
    const bw = `${Math.max(0, (g.boss.hp / g.boss.maxHp) * 100).toFixed(1)}%`;
    if (lastHud.boss !== bw) { lastHud.boss = bw; $('#boss-fill').style.width = bw; }
  } else if (!lastHud.bossGone && g.bosses > 0) {
    lastHud.bossGone = true;
    $('#boss-bar').classList.add('hidden');
  }
}

// ---------- attract mode ----------
function makeDemo() {
  const demoSave = defaultSave();
  demoSave.settings.damageNumbers = false;
  demoSave.startWeapon = 'orbit';
  const d = new Game({ stage: 0, save: demoSave });
  d.weapons = { blaster: 3, orbit: 2 };
  d.recalc();
  d.time = 40;
  d.nextSwarm = d.nextElite = 1e9;
  d.stage = { ...d.stage, duration: 1e9 };
  d.hurtPlayer = () => {}; // the attract-mode ship can't die
  const s = viewScale(W, H);
  d.viewW = W / s;
  d.viewH = H / s;
  return d;
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game) {
    if (!paused) {
      game.input = input.read();
      game.update(dt);
      if (game && (game.state === 'play' || game.state === 'levelup')) {
        if (now - lastAutosave > 5000) {
          lastAutosave = now;
          save.run = game.snapshot();
          persist();
        }
      }
      if (tutorialTimer >= 0 && game) {
        if (tutorialTimer > 0) tutorialTimer += dt;
        if (tutorialTimer > 2.5) {
          tutorialTimer = -1;
          $('#tutorial').classList.add('hidden');
          save.tutorialDone = true;
          persist();
        }
      }
    }
    if (game) {
      render(ctx, game, W, H, now);
      updateHud();
    }
  } else {
    demo ??= makeDemo();
    const t = now / 1000;
    demo.input = { x: Math.cos(t * 0.4), y: Math.sin(t * 0.55) };
    demo.pendingLevelUps = 0;
    demo.xp = 0;
    demo.time = 40; // keep the attract-mode swarm at a fixed, light difficulty
    demo.update(dt);
    render(ctx, demo, W, H, now);
  }
  requestAnimationFrame(frame);
}

show('title');
requestAnimationFrame(frame);

// Local dev servers skip the worker so edits show up on reload; append ?sw to test offline locally.
const devHost = ['localhost', '127.0.0.1'].includes(location.hostname) && !location.search.includes('sw');
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !devHost) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
