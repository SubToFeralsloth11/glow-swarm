# Glow Swarm

A neon survival shooter built for phones. Drag anywhere to fly, your weapons fire on their own. Survive the swarm, pick upgrades as you level, crack open elite treasure, and take down the Warden when the timer runs out.

**Play:** https://subtoferalsloth11.github.io/glow-swarm/

## Features

- **One-thumb controls:** a floating joystick appears wherever you touch. WASD or arrow keys work on desktop, and Esc/P pauses.
- **Three stages:** Nebula Drift, Inferno Belt and The Void. Each one ends in a boss fight, and clearing a stage unlocks the next.
- **Build each run:** 5 weapons (Pulse Blaster, Orbit Blades, Chain Zap, Nova Pulse, Seeker Missiles) and 8 passives, each with 5 levels. You can hold up to 4 weapons.
- **Progress between runs:** coins buy permanent boosts (HP, damage, speed, magnet, greed, XP, rerolls, Second Life) and unlock new starting weapons.
- **Saves:** progress, records and settings live in `localStorage`. A run in progress is saved every 5 seconds, after each level-up, on pause and whenever the app goes to the background. **Continue Run** picks it up again.
- **Installable PWA:** it works offline after the first visit. Add it to your home screen for fullscreen play.
- Sound effects and music are generated in code, so there are no audio files. Vibration, damage numbers and the volume toggles are all in Settings.

## Development

No build step. Serve the folder and open it:

```sh
npm run serve        # http://localhost:8080
npm test             # simulation + save tests (Node 22+)
node tests/sim.mjs 0 2 5   # balance probe: stage, meta level, runs
```

| Path | Role |
|---|---|
| `src/data.js` | All tunable content: stages, enemies, weapons, passives, meta shop, XP curve |
| `src/game.js` | Headless run simulation (no DOM), so it can be tested in Node |
| `src/render.js` | Canvas renderer. Every shape is drawn once into a cached, supersampled sprite, and frames allocate nothing. Fixed colour language: enemies are warm and hostile, XP is green crystals, coins are gold, and player shots are cyan/white. Enemy bullets are red-hot orbs drawn on top of everything. |
| `src/main.js` | Screens, input, game loop, save wiring |
| `src/save.js` | Validated `localStorage` persistence and run-result accounting |
| `src/audio.js` | WebAudio synth sound effects and generative music |
| `sw.js` | Service worker that precaches every asset and serves it cache-first |

The service worker's cache name is `glowswarm-dev` locally. The deploy workflow (`.github/workflows/pages.yml`) runs the tests, stamps the cache name with the commit SHA and publishes to GitHub Pages. That way every deploy ships a fresh, consistent offline cache. While developing locally, hard-reload or unregister the worker in DevTools to see changes.
