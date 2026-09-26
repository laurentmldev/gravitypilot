import { stepBodies, wrapPosition, delta, distance, circularSpeed } from './physics.js';
import { LEVELS, ASTEROID_SIZES } from './levels.js';
import { SHIP, MISSILE, steer, missileLaunch } from './ship.js';
import { createPilot, pilot } from './ai.js';
import { fetchBook, signBook, qualifies, renderBook, showBookError } from './goldenbook.js';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const BASE = 800; // world units on the window's shorter side
const DT = 1 / 120; // fixed physics step
const MAX_STEPS = 12;

const PLAYER = { lives: 3, invulnerable: 2.5 };
const ALIEN = { score: 250, warpIn: 1.2 };
const TARGET = { radius: 10, size: 22, score: 100, respawn: 1.5 };
const TRAIL = { every: 0.04, length: 45 };

const SPRITES = {
  ship: 'ship.svg',
  flame: 'flame.svg',
  missile: 'missile.svg',
  planetSmall: 'planet-small.svg',
  planetBig: 'planet-big.svg',
  moon: 'moon.svg',
  asteroid: 'asteroid.svg',
  alien: 'alien.svg',
  target: 'target.svg',
};

// ---------------------------------------------------------------------------
// Canvas and world size
// ---------------------------------------------------------------------------

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const world = { w: BASE, h: BASE };
let scale = 1;
let dpr = 1;
let stars = [];

function resize() {
  const cw = window.innerWidth;
  const ch = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  scale = Math.min(cw, ch) / BASE;
  const oldW = world.w;
  const oldH = world.h;
  world.w = cw / scale;
  world.h = ch / scale;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;
  // Keep the scene centred when the window changes size.
  if (state) {
    const sx = (world.w - oldW) / 2;
    const sy = (world.h - oldH) / 2;
    for (const b of allBodies()) {
      b.x += sx;
      b.y += sy;
      if (b.wrap !== false) wrapPosition(b, world);
    }
    state.trail = [];
  }
  makeStars();
}

function makeStars() {
  const count = Math.round((world.w * world.h) / 3500);
  stars = Array.from({ length: count }, () => ({
    x: Math.random() * world.w,
    y: Math.random() * world.h,
    r: Math.random() < 0.9 ? 0.8 : 1.5,
    a: 0.25 + Math.random() * 0.6,
  }));
}

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

const images = {};

function loadSprites() {
  return Promise.all(
    Object.entries(SPRITES).map(
      ([key, file]) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = resolve;
          img.onerror = resolve;
          img.src = `sprites/${file}`;
          images[key] = img;
        }),
    ),
  );
}

function drawSprite(name, x, y, size, angle = 0, alpha = 1) {
  const img = images[name];
  if (!img || !img.naturalWidth) return;
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}

function drawShip(ship, sprite, x, y, alpha = 1) {
  if (ship.thrusting) {
    const size = SHIP.size * (0.55 + Math.random() * 0.2);
    const back = SHIP.size * 0.2 + size * 0.46;
    drawSprite('flame', x - Math.cos(ship.angle) * back, y - Math.sin(ship.angle) * back, size, ship.angle, alpha);
  }
  drawSprite(sprite, x, y, SHIP.size, ship.angle, alpha);
}

/** Draw a wrapping body, plus its copies on the far side when it straddles an edge. */
function drawWrapped(body, reach, draw) {
  const xs = [0];
  const ys = [0];
  if (body.x < reach) xs.push(world.w);
  if (body.x > world.w - reach) xs.push(-world.w);
  if (body.y < reach) ys.push(world.h);
  if (body.y > world.h - reach) ys.push(-world.h);
  for (const ox of xs) for (const oy of ys) draw(body.x + ox, body.y + oy);
}

// ---------------------------------------------------------------------------
// Input: keyboard and on-screen buttons
// ---------------------------------------------------------------------------

const keys = { left: false, right: false, thrust: false, fire: false };
const touch = { left: false, right: false, thrust: false, fire: false };
const input = () => ({
  left: keys.left || touch.left,
  right: keys.right || touch.right,
  thrust: keys.thrust || touch.thrust,
  fire: keys.fire || touch.fire,
});

const KEYMAP = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'thrust',
  KeyW: 'thrust',
  Space: 'fire',
};

window.addEventListener('keydown', (e) => {
  // Typing a nickname or comment must not steer the ship or restart the game.
  if (e.target.closest && e.target.closest('input, textarea')) return;
  if (bookReturn) {
    if (e.code === 'Escape') closeBook();
    return;
  }
  const action = KEYMAP[e.code];
  if (action) {
    keys[action] = true;
    e.preventDefault();
  }
  if (e.repeat) return;

  if (state.mode === 'menu') {
    const n = Number(e.key);
    if (n >= 1 && n <= LEVELS.length) startGame(n - 1);
    else if (e.code === 'Enter') startGame(state.levelIndex);
  } else if (state.mode === 'gameover') {
    if (e.code === 'Enter' || e.code === 'Space') startGame(state.levelIndex);
    else if (e.code === 'Escape' || e.code === 'KeyM') showMenu();
  } else if (e.code === 'KeyP' || e.code === 'Escape') {
    togglePause();
  }
});

window.addEventListener('keyup', (e) => {
  const action = KEYMAP[e.code];
  if (action) keys[action] = false;
});

window.addEventListener('blur', () => {
  Object.keys(keys).forEach((k) => (keys[k] = false));
  if (state.mode === 'playing') togglePause();
});

const touchPanel = document.getElementById('touch');
function enableTouchUi() {
  document.body.classList.add('touch');
}
if (window.matchMedia('(pointer: coarse)').matches) enableTouchUi();
window.addEventListener('touchstart', enableTouchUi, { once: true, passive: true });

for (const btn of touchPanel.querySelectorAll('button')) {
  const action = btn.dataset.action;
  const set = (on) => (e) => {
    e.preventDefault();
    touch[action] = on;
    btn.classList.toggle('pressed', on);
  };
  btn.addEventListener('pointerdown', (e) => {
    set(true)(e);
    try {
      btn.setPointerCapture(e.pointerId); // keep the button held if the finger slides off
    } catch {
      /* synthetic or already released pointer */
    }
  });
  btn.addEventListener('pointerup', set(false));
  btn.addEventListener('pointercancel', set(false));
  btn.addEventListener('lostpointercapture', set(false));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

let state = null;

const rand = (a, b) => a + Math.random() * (b - a);

function allBodies() {
  const s = state;
  return [
    ...s.massive,
    ...s.asteroids,
    ...ships(),
    ...s.missiles,
    ...s.targets,
    ...s.particles,
  ];
}

/** Every ship in play: the player (if alive) and the aliens. */
function ships() {
  return state.ship ? [state.ship, ...state.aliens] : [...state.aliens];
}

function buildWorld(levelIndex) {
  const level = LEVELS[levelIndex];
  const cx = world.w / 2;
  const cy = world.h / 2;
  const s = {
    level,
    levelIndex,
    mode: 'menu',
    massive: [],
    planet: null,
    moon: null,
    ship: null,
    aliens: [],
    missiles: [],
    asteroids: [],
    targets: [],
    particles: [],
    trail: [],
    trailTimer: 0,
    score: 0,
    lives: PLAYER.lives,
    time: 0,
    respawnTimer: 0,
    gameoverTimer: 0,
    targetTimers: [],
    asteroidTimer: level.asteroids ? rand(...level.asteroids.every) : 0,
    alienTimer: rand(...level.aliens.first),
  };

  if (level.planet) {
    s.planet = { kind: 'planet', x: cx, y: cy, vx: 0, vy: 0, ...level.planet };
    s.massive.push(s.planet);
  }
  if (level.moon) {
    const p = s.planet;
    const m = level.moon;
    const v = circularSpeed(p.mass + m.mass, m.orbit);
    const total = p.mass + m.mass;
    // Two-body circular orbit with zero total momentum, so the planet only wobbles.
    s.moon = { kind: 'moon', x: cx, y: cy - m.orbit, vx: (v * p.mass) / total, vy: 0, ...m };
    p.vx = -(v * m.mass) / total;
    s.massive.push(s.moon);
  }
  return s;
}

function startGame(levelIndex) {
  state = buildWorld(levelIndex);
  state.mode = 'playing';
  Object.keys(keys).forEach((k) => (keys[k] = false));
  spawnShip();
  for (let i = 0; i < state.level.targets; i++) spawnTarget();
  showOverlay(null);
  document.getElementById('hud').hidden = false;
  touchPanel.classList.add('active');
  updateHud(true);
}

function showMenu(levelIndex = state ? state.levelIndex : 0) {
  state = buildWorld(levelIndex);
  document.getElementById('hud').hidden = true;
  touchPanel.classList.remove('active');
  renderLevelList();
  showOverlay('menu');
}

function togglePause() {
  if (state.mode === 'playing') {
    state.mode = 'paused';
    showOverlay('paused');
  } else if (state.mode === 'paused') {
    state.mode = 'playing';
    showOverlay(null);
  }
}

function spawnPoint() {
  const s = state;
  if (s.planet) {
    const r = s.level.shipOrbit;
    const v = circularSpeed(s.planet.mass, r);
    return {
      x: s.planet.x - r,
      y: s.planet.y,
      vx: s.planet.vx,
      vy: s.planet.vy - v, // same direction as the moon
      angle: -Math.PI / 2,
    };
  }
  return { x: world.w * 0.3, y: world.h / 2, vx: 0, vy: 0, angle: 0 };
}

function spawnShip() {
  const p = spawnPoint();
  wrapPosition(p, world);
  state.ship = {
    kind: 'ship',
    ...p,
    ax: 0,
    ay: 0,
    radius: SHIP.radius,
    mass: 0,
    thrusting: false,
    fireCooldown: 0,
    invulnerable: PLAYER.invulnerable,
  };
  state.trail = [];
}

function isSpawnClear() {
  const p = spawnPoint();
  const hazards = [...state.asteroids, ...state.aliens, ...state.missiles, ...(state.moon ? [state.moon] : [])];
  return hazards.every((h) => distance(p, h, world) > h.radius + 90);
}

function spawnTarget() {
  const s = state;
  let t;
  if (s.planet) {
    // Beacons are put on circular orbits around the planet.
    const minR = s.planet.radius + 60;
    let r;
    do {
      r = rand(minR, 360);
    } while (s.moon && Math.abs(r - s.moon.orbit) < 40);
    const a = rand(0, Math.PI * 2);
    const v = circularSpeed(s.planet.mass, r) * (Math.random() < 0.5 ? 1 : -1);
    t = {
      x: s.planet.x + Math.cos(a) * r,
      y: s.planet.y + Math.sin(a) * r,
      vx: s.planet.vx - Math.sin(a) * v,
      vy: s.planet.vy + Math.cos(a) * v,
    };
  } else {
    let tries = 0;
    do {
      t = { x: rand(0, world.w), y: rand(0, world.h) };
    } while (s.ship && distance(t, s.ship, world) < 220 && ++tries < 30);
    const a = rand(0, Math.PI * 2);
    const v = rand(5, 25);
    t.vx = Math.cos(a) * v;
    t.vy = Math.sin(a) * v;
  }
  wrapPosition(t, world);
  s.targets.push({ kind: 'target', ...t, radius: TARGET.radius, mass: 0, spin: rand(0, 6) });
}

function spawnAsteroid(size = 'large', at = null) {
  const def = ASTEROID_SIZES[size];
  let a;
  if (at) {
    a = at;
  } else {
    // Enter from a random edge, aimed at a random point in the middle of the window.
    const edge = Math.floor(rand(0, 4));
    const m = def.radius + 10;
    const pos = [
      { x: rand(0, world.w), y: -m },
      { x: world.w + m, y: rand(0, world.h) },
      { x: rand(0, world.w), y: world.h + m },
      { x: -m, y: rand(0, world.h) },
    ][edge];
    const aim = { x: rand(world.w * 0.25, world.w * 0.75), y: rand(world.h * 0.25, world.h * 0.75) };
    const d = Math.hypot(aim.x - pos.x, aim.y - pos.y);
    const v = rand(50, 110);
    a = { ...pos, vx: ((aim.x - pos.x) / d) * v, vy: ((aim.y - pos.y) / d) * v };
  }
  state.asteroids.push({
    kind: 'asteroid',
    size,
    ...a,
    radius: def.radius,
    mass: def.mass,
    wrap: false, // asteroids pass by: they leave the window for good
    angle: rand(0, Math.PI * 2),
    spin: rand(-1.5, 1.5),
  });
}

function fireMissile(ship) {
  const m = { kind: 'missile', ...missileLaunch(ship), radius: MISSILE.radius, mass: 0, life: MISSILE.life, owner: ship };
  wrapPosition(m, world);
  state.missiles.push(m);
}

/** Pilot commands, identical for the player and the aliens. */
function command(ship, cmd, dt) {
  steer(ship, cmd, dt);
  ship.fireCooldown -= dt;
  const inFlight = state.missiles.filter((m) => m.owner === ship).length;
  if (cmd.fire && ship.fireCooldown <= 0 && inFlight < MISSILE.maxPerShip) {
    fireMissile(ship);
    ship.fireCooldown = MISSILE.cooldown;
  }
}

function spawnAlien() {
  const s = state;
  // Appear somewhere clear: away from the player, planets, moons and rocks.
  let spot = null;
  for (let tries = 0; tries < 40 && !spot; tries++) {
    const c = { x: rand(0, world.w), y: rand(0, world.h) };
    const clear =
      (!s.ship || distance(c, s.ship, world) > 350) &&
      s.massive.every((b) => distance(c, b, world) > b.radius + 150) &&
      [...s.asteroids, ...s.aliens].every((b) => distance(c, b, world) > 120);
    if (clear) spot = c;
  }
  if (!spot) return;
  const a = rand(0, Math.PI * 2);
  s.aliens.push({
    kind: 'alien',
    ...spot,
    vx: Math.cos(a) * 20,
    vy: Math.sin(a) * 20,
    ax: 0,
    ay: 0,
    angle: rand(0, Math.PI * 2),
    radius: SHIP.radius,
    mass: 0,
    thrusting: false,
    fireCooldown: ALIEN.warpIn, // no shooting while warping in
    warp: ALIEN.warpIn,
    pilot: createPilot(),
  });
  explode(spot.x, spot.y, 24, '#c58bff', 90);
}

function explode(x, y, count, color, speed = 120) {
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2);
    const v = rand(speed * 0.2, speed);
    const life = rand(0.4, 1.1);
    state.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, maxLife: life, color });
  }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function update(dt) {
  const s = state;
  if (s.mode === 'paused') return;
  s.time += dt;
  const playing = s.mode === 'playing';

  // Pilots: the player's buttons, and the alien autopilots
  const ship = s.ship;
  if (ship && playing) {
    command(ship, input(), dt);
    ship.invulnerable = Math.max(0, ship.invulnerable - dt);
  }
  if (s.aliens.length) {
    const view = {
      world,
      sources: [...s.massive, ...s.asteroids],
      solids: s.massive,
      missiles: s.missiles,
      ships: ships(),
      target: playing ? ship : null,
    };
    for (const a of s.aliens) {
      a.warp = Math.max(0, a.warp - dt);
      command(a, pilot(a, view, dt), dt);
    }
  }

  // Gravity: planet, moon and asteroids attract everything (and each other);
  // the ship, missiles and beacons are too light to attract anything.
  const sources = [...s.massive, ...s.asteroids];
  const bodies = [...sources, ...ships(), ...s.missiles, ...s.targets];
  stepBodies(bodies, sources, world, dt);

  for (const a of s.asteroids) a.angle += a.spin * dt;
  for (const t of s.targets) t.spin += dt * 1.5;

  // Particles drift without gravity; they are just decoration.
  for (const p of s.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  s.particles = s.particles.filter((p) => p.life > 0);

  for (const m of s.missiles) m.life -= dt;

  handleCollisions();

  s.missiles = s.missiles.filter((m) => m.life > 0 && !m.dead);
  s.aliens = s.aliens.filter((a) => !a.dead);
  s.targets = s.targets.filter((t) => !t.dead);
  const margin = 150;
  s.asteroids = s.asteroids.filter(
    (a) => !a.dead && a.x > -margin && a.x < world.w + margin && a.y > -margin && a.y < world.h + margin,
  );

  // Beacons come back after being hit.
  const missing = s.level.targets - s.targets.length - s.targetTimers.length;
  for (let k = 0; k < missing; k++) s.targetTimers.push(TARGET.respawn);
  s.targetTimers = s.targetTimers.map((t) => t - dt);
  while (s.targetTimers.length && s.targetTimers[0] <= 0) {
    s.targetTimers.shift();
    spawnTarget();
  }

  // Asteroids passing by
  if (s.level.asteroids) {
    s.asteroidTimer -= dt;
    if (s.asteroidTimer <= 0) {
      if (s.asteroids.length < s.level.asteroids.max) spawnAsteroid();
      s.asteroidTimer = rand(...s.level.asteroids.every);
    }
  }

  // Alien ships appear from time to time
  s.alienTimer -= dt;
  if (s.alienTimer <= 0) {
    if (s.aliens.length < s.level.aliens.max) spawnAlien();
    s.alienTimer = rand(...s.level.aliens.every);
  }

  // Ship trail
  if (s.ship) {
    s.trailTimer -= dt;
    if (s.trailTimer <= 0) {
      s.trail.push({ x: s.ship.x, y: s.ship.y });
      if (s.trail.length > TRAIL.length) s.trail.shift();
      s.trailTimer = TRAIL.every;
    }
  }

  // Respawn / game over
  if (!ship && playing) {
    if (s.lives > 0) {
      s.respawnTimer -= dt;
      if (s.respawnTimer <= 0 && isSpawnClear()) spawnShip();
    } else {
      s.gameoverTimer -= dt;
      if (s.gameoverTimer <= 0) gameOver();
    }
  }
}

function hit(a, b) {
  // Asteroids don't wrap, so they must not collide across the window edges.
  const d = a.wrap === false || b.wrap === false ? Math.hypot(a.x - b.x, a.y - b.y) : distance(a, b, world);
  return d < a.radius + b.radius;
}

function byPlayer(m) {
  return m.owner && m.owner.kind === 'ship';
}

/** Missiles can hit any ship, including the one that fired them once armed. */
function missileHitsShip(m, ship) {
  if (m.owner === ship && MISSILE.life - m.life < MISSILE.armTime) return false;
  return hit(m, ship);
}

function handleCollisions() {
  const s = state;
  const solids = s.massive;

  // Missiles
  for (const m of s.missiles) {
    if (solids.some((b) => hit(m, b))) {
      m.dead = true;
      explode(m.x, m.y, 5, '#ffb3c1', 60);
      continue;
    }
    const t = s.targets.find((t) => !t.dead && hit(m, t));
    if (t) {
      m.dead = t.dead = true;
      if (byPlayer(m)) addScore(TARGET.score);
      explode(t.x, t.y, 20, '#7dff9b', 140);
      continue;
    }
    const a = s.asteroids.find((a) => !a.dead && hit(m, a));
    if (a) {
      m.dead = true;
      destroyAsteroid(a, m);
      if (byPlayer(m)) addScore(ASTEROID_SIZES[a.size].score);
      continue;
    }
    const alien = s.aliens.find((al) => !al.dead && missileHitsShip(m, al));
    if (alien) {
      m.dead = true;
      killAlien(alien);
      if (byPlayer(m)) addScore(ALIEN.score);
      continue;
    }
    if (s.ship && !s.ship.invulnerable && missileHitsShip(m, s.ship)) {
      m.dead = true;
      killShip();
    }
  }

  // Beacons crashing into something are simply replaced.
  for (const t of s.targets) {
    if (!t.dead && [...solids, ...s.asteroids].some((b) => !b.dead && hit(t, b))) {
      t.dead = true;
      explode(t.x, t.y, 8, '#7dff9b', 60);
    }
  }

  // Asteroids crashing into the planet or the moon
  for (const a of s.asteroids) {
    if (!a.dead && solids.some((b) => hit(a, b))) {
      a.dead = true;
      explode(a.x, a.y, 18, '#c9b39b', 90);
    }
  }

  // Aliens obey the same rules: planets, moons, rocks and other ships are deadly.
  for (const al of s.aliens) {
    if (al.dead) continue;
    const rock = s.asteroids.find((a) => !a.dead && hit(al, a));
    if (rock) destroyAsteroid(rock, al);
    const other = s.aliens.find((o) => o !== al && !o.dead && hit(al, o));
    if (other) killAlien(other);
    if (rock || other || solids.some((b) => hit(al, b))) killAlien(al);
  }

  // Player ship. Respawn protection covers rocks, missiles and aliens, but
  // planets and moons are always solid.
  const ship = s.ship;
  if (ship) {
    const crashed = solids.some((b) => hit(ship, b));
    const rock = !ship.invulnerable && s.asteroids.find((a) => !a.dead && hit(ship, a));
    const alien = !ship.invulnerable && s.aliens.find((a) => !a.dead && hit(ship, a));
    if (rock) destroyAsteroid(rock, ship);
    if (alien) killAlien(alien);
    if (crashed || rock || alien) killShip();
  }
}

function killAlien(a) {
  a.dead = true;
  explode(a.x, a.y, 36, '#c58bff', 170);
  explode(a.x, a.y, 16, '#ffffff', 90);
}

function destroyAsteroid(a, by) {
  a.dead = true;
  explode(a.x, a.y, 16, '#c9b39b', 110);
  const next = ASTEROID_SIZES[a.size].splitInto;
  if (!next) return;
  // Split in two, pushed apart perpendicular to the impact.
  const { dx, dy } = delta(by, a, world);
  const d = Math.hypot(dx, dy) || 1;
  const px = -dy / d;
  const py = dx / d;
  const kick = 45;
  const off = ASTEROID_SIZES[next].radius;
  for (const sign of [1, -1]) {
    spawnAsteroid(next, {
      x: a.x + px * off * sign,
      y: a.y + py * off * sign,
      vx: a.vx + px * kick * sign,
      vy: a.vy + py * kick * sign,
    });
  }
}

function killShip() {
  const s = state;
  if (!s.ship) return;
  explode(s.ship.x, s.ship.y, 40, '#ffb14a', 180);
  explode(s.ship.x, s.ship.y, 20, '#dfe8f5', 100);
  s.ship = null;
  s.trail = [];
  s.lives -= 1;
  s.respawnTimer = 2;
  s.gameoverTimer = 1.8;
  updateHud();
}

function addScore(points) {
  state.score += points;
  updateHud();
}

function gameOver() {
  const s = state;
  s.mode = 'gameover';
  const best = saveBest(s.levelIndex, s.score);
  document.getElementById('gameover-score').textContent =
    s.score >= best && s.score > 0 ? `New best: ${s.score}` : `Score ${s.score} · Best ${best}`;
  touchPanel.classList.remove('active');
  showOverlay('gameover');
  offerGoldenBook(s);
}

// ---------------------------------------------------------------------------
// Golden book
// ---------------------------------------------------------------------------

const entryForm = document.getElementById('entry-form');
const entryError = document.getElementById('entry-error');
const entryDone = document.getElementById('entry-done');
let pendingEntry = null;
let bookReturn = null; // overlay to go back to when the golden book closes

/** After a game, ask for a nickname if the score makes the level's top 10. */
async function offerGoldenBook(s) {
  entryForm.hidden = true;
  entryDone.hidden = true;
  pendingEntry = null;
  if (s.score <= 0) return;
  const game = s;
  let book;
  try {
    book = await fetchBook();
  } catch {
    return; // no server-side book (e.g. offline): just skip it
  }
  if (state !== game || !qualifies(book[game.level.id] || [], game.score)) return;
  pendingEntry = { level: game.level.id, score: game.score };
  entryError.hidden = true;
  entryForm.hidden = false;
  const nick = document.getElementById('entry-nickname');
  try {
    nick.value = localStorage.getItem('gravitypilot.nickname') || '';
  } catch {
    /* storage unavailable */
  }
  document.getElementById('entry-comment').value = '';
  nick.focus();
}

entryForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!pendingEntry) return;
  const nickname = document.getElementById('entry-nickname').value.trim();
  const comment = document.getElementById('entry-comment').value.trim();
  if (!nickname) return;
  const button = entryForm.querySelector('button');
  button.disabled = true;
  try {
    const { rank, levels } = await signBook({ ...pendingEntry, nickname, comment });
    try {
      localStorage.setItem('gravitypilot.nickname', nickname);
    } catch {
      /* storage unavailable */
    }
    const level = pendingEntry.level;
    const mine = levels[level][rank - 1];
    pendingEntry = null;
    entryForm.hidden = true;
    entryDone.textContent = `Signed! You are #${rank} in the golden book.`;
    entryDone.hidden = false;
    openBook(levels, level, mine);
  } catch (err) {
    entryError.textContent = err.message;
    entryError.hidden = false;
  } finally {
    button.disabled = false;
  }
});

// Comments are a single line: Enter signs the book instead of adding a newline.
document.getElementById('entry-comment').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    entryForm.requestSubmit();
  }
});

async function openBook(levels = null, levelId = state.level.id, mine = null) {
  bookReturn = overlays.find((id) => !document.getElementById(id).hidden) || 'menu';
  showOverlay('book');
  if (levels) {
    renderBook(levels, levelId, mine);
    return;
  }
  renderBook({}, levelId, null);
  try {
    renderBook(await fetchBook(), levelId, null);
  } catch (err) {
    showBookError(`The golden book is unavailable right now (${err.message}).`);
  }
}

function closeBook() {
  showOverlay(bookReturn || 'menu');
  bookReturn = null;
}

// ---------------------------------------------------------------------------
// Best scores (per level, kept in the browser)
// ---------------------------------------------------------------------------

function getBest(levelIndex) {
  try {
    return Number(localStorage.getItem(`gravitypilot.best.${LEVELS[levelIndex].id}`)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(levelIndex, score) {
  const best = Math.max(getBest(levelIndex), score);
  try {
    localStorage.setItem(`gravitypilot.best.${LEVELS[levelIndex].id}`, String(best));
  } catch {
    /* storage unavailable */
  }
  return best;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  const s = state;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  ctx.fillStyle = '#05060d';
  ctx.fillRect(0, 0, world.w, world.h);

  for (const st of stars) {
    ctx.globalAlpha = st.a;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(st.x, st.y, st.r, st.r);
  }
  ctx.globalAlpha = 1;

  // Trail, broken where the ship wrapped around an edge
  if (s.trail.length > 1) {
    ctx.lineWidth = 1.5;
    for (let i = 1; i < s.trail.length; i++) {
      const a = s.trail[i - 1];
      const b = s.trail[i];
      if (Math.abs(a.x - b.x) > world.w / 2 || Math.abs(a.y - b.y) > world.h / 2) continue;
      ctx.strokeStyle = `rgba(106, 169, 255, ${(i / s.trail.length) * 0.5})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  for (const b of s.massive) {
    // Soft atmosphere glow
    const g = ctx.createRadialGradient(b.x, b.y, b.radius * 0.8, b.x, b.y, b.radius * 1.6);
    g.addColorStop(0, b.kind === 'planet' ? 'rgba(120, 200, 255, 0.18)' : 'rgba(220, 220, 230, 0.1)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius * 1.6, 0, Math.PI * 2);
    ctx.fill();
    drawWrapped(b, b.radius, (x, y) => drawSprite(b.sprite, x, y, b.radius * 2));
  }

  for (const t of s.targets) {
    drawWrapped(t, t.radius, (x, y) => drawSprite('target', x, y, TARGET.size, t.spin));
  }

  for (const a of s.asteroids) {
    drawSprite('asteroid', a.x, a.y, a.radius * 2.3, a.angle);
  }

  for (const m of s.missiles) {
    drawSprite('missile', m.x, m.y, MISSILE.size, 0, Math.min(1, m.life * 2));
  }

  for (const a of s.aliens) {
    const alpha = a.warp ? 1 - a.warp / ALIEN.warpIn : 1;
    drawWrapped(a, SHIP.size / 2, (x, y) => drawShip(a, 'alien', x, y, alpha));
  }

  const ship = s.ship;
  if (ship && !(ship.invulnerable && Math.floor(ship.invulnerable * 8) % 2)) {
    drawWrapped(ship, SHIP.size / 2, (x, y) => drawShip(ship, 'ship', x, y));
  }

  for (const p of s.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// DOM overlays and HUD
// ---------------------------------------------------------------------------

const overlays = ['menu', 'paused', 'gameover', 'book'];
function showOverlay(name) {
  for (const id of overlays) document.getElementById(id).hidden = id !== name;
}

let hudCache = '';
function updateHud(force = false) {
  const s = state;
  const best = Math.max(getBest(s.levelIndex), s.score);
  const key = `${s.levelIndex}|${s.score}|${s.lives}|${best}`;
  if (!force && key === hudCache) return;
  hudCache = key;
  document.getElementById('hud-level').textContent = `${s.level.id}. ${s.level.name}`;
  document.getElementById('hud-score').textContent = s.score;
  document.getElementById('hud-best').textContent = best;
  document.getElementById('hud-lives').textContent = '▲'.repeat(Math.max(0, s.lives));
}

function renderLevelList() {
  const list = document.getElementById('level-list');
  list.replaceChildren(
    ...LEVELS.map((lvl, i) => {
      const b = document.createElement('button');
      const best = getBest(i);
      b.innerHTML = `<span class="num">LEVEL ${lvl.id}</span>
        <span class="name"></span><span class="desc"></span>
        ${best ? `<span class="best">Best ${best}</span>` : ''}`;
      b.querySelector('.name').textContent = lvl.name;
      b.querySelector('.desc').textContent = lvl.description;
      b.addEventListener('click', () => startGame(i));
      b.addEventListener('mouseenter', () => {
        if (state.levelIndex !== i) state = buildWorld(i); // preview the level behind the menu
      });
      return b;
    }),
  );
}

document.getElementById('btn-pause').addEventListener('click', togglePause);
document.getElementById('btn-resume').addEventListener('click', togglePause);
document.getElementById('btn-quit').addEventListener('click', () => showMenu());
document.getElementById('btn-retry').addEventListener('click', () => startGame(state.levelIndex));
document.getElementById('btn-menu').addEventListener('click', () => showMenu());
document.getElementById('btn-book').addEventListener('click', () => openBook());
document.getElementById('btn-gameover-book').addEventListener('click', () => openBook());
document.getElementById('btn-book-close').addEventListener('click', closeBook);

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let last = 0;
let acc = 0;

function frame(now) {
  const elapsed = Math.min(0.25, (now - last) / 1000 || 0);
  last = now;
  acc += elapsed;
  let steps = 0;
  while (acc >= DT && steps < MAX_STEPS) {
    update(DT);
    acc -= DT;
    steps++;
  }
  if (steps === MAX_STEPS) acc = 0; // too slow to catch up: drop the backlog
  render();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
showMenu(2);
loadSprites().then(() => requestAnimationFrame(frame));

// Small hook for automated checks and debugging from the console.
window.gravityPilot = { get state() { return state; }, world, startGame, showMenu };
