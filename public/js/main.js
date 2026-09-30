import { stepBodies, wrapPosition, delta, distance, circularSpeed } from './physics.js';
import { LEVELS, ASTEROID_SIZES } from './levels.js';
import { SHIP, MISSILE, LOCK, steer, missileLaunch, angleDiff, sizeOf } from './ship.js';
import { createPilot, pilot as alienPilot } from './ai.js';
import { fetchBook, signBook, qualifies, renderBook, showBookError } from './goldenbook.js';
import {
  SHIPS,
  ACTIONS,
  STYLES,
  NAME_MAX,
  shipById,
  loadSetup,
  saveSetup,
  styleOf,
  validateSetup,
  keysOf,
  isDefaultKeys,
  resetKeys,
  actionOf,
  bindKey,
  learnKey,
  detectLayout,
  keyLabel,
  keysHelp,
} from './pilots.js';

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
const VERSUS = { score: 300 }; // for shooting down the other pilot
// Team games get slightly more aliens: one more at a time, arriving sooner.
const TEAM_ALIENS = { extra: 1, sooner: 0.75 };
// Aliens keep coming faster so a game cannot last forever: the wait between
// arrivals shrinks as 1 / (1 + t / pace), and one more alien may fly at a
// time every `extraEvery` seconds (up to `maxExtra` more).
const RAMP = { pace: 120, extraEvery: 150, maxExtra: 3 };
// The destroyer: a big, slow alien with a short-range laser that burns
// asteroids and beacons. It takes 3 hits, and 1 to 3 small aliens escape
// from its wreck.
const DESTROYER = {
  after: 40, // seconds of play before one can show up
  chance: 0.25, // of an alien arrival being a destroyer
  radius: 24,
  size: 76,
  thrust: 120,
  turnRate: 2.5,
  hp: 3,
  hitScore: 100,
  score: 600,
  hurt: 0.4, // seconds of grace after a collision
  laser: { range: 170, cooldown: 0.9, beam: 0.18 },
  escape: [1, 3],
};

const SPRITES = {
  flame: 'flame.svg',
  missile: 'missile.svg',
  planetSmall: 'planet-small.svg',
  planetBig: 'planet-big.svg',
  moon: 'moon.svg',
  asteroid: 'asteroid.svg',
  alien: 'alien.svg',
  destroyer: 'destroyer.svg',
  target: 'target.svg',
  ...Object.fromEntries(SHIPS.map((s) => [`ship-${s.id}`, s.file])),
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
    for (const p of state.pilots) p.trail = [];
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
  const full = sizeOf(ship);
  if (ship.thrusting) {
    const size = full * (0.55 + Math.random() * 0.2);
    const back = full * 0.2 + size * 0.46;
    drawSprite('flame', x - Math.cos(ship.angle) * back, y - Math.sin(ship.angle) * back, size, ship.angle, alpha);
  }
  drawSprite(sprite, x, y, full, ship.angle, alpha);
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

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Input: keyboard (one layout per pilot) and on-screen buttons (pilot 1)
// ---------------------------------------------------------------------------

const blankInput = () => ({ left: false, right: false, thrust: false, fire: false });
const keys = [blankInput(), blankInput()];
const touch = blankInput();

// A second pilot needs a keyboard. Phones and tablets without one only offer
// a single pilot, until a real key press shows that a keyboard is attached.
const touchOnly = window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
let keyboardSeen = false;
const hasKeyboard = () => keyboardSeen || !touchOnly;

// Tilt steering (pilot 1 on phones and tablets): lean the device like a
// steering wheel. The lean past a small dead zone sets how much of the time
// the turn command is held, so a gentle lean gives a gentle turn.
const TILT = { dead: 5, full: 25 }; // degrees
const tilt = { roll: null, neutral: null, acc: 0 };
const tiltAvailable = () => 'DeviceOrientationEvent' in window;

/** Sideways lean of the screen in degrees (positive = right edge down), whatever the screen orientation. */
function screenRoll(e) {
  const angle = ((screen.orientation?.angle ?? window.orientation ?? 0) + 360) % 360;
  if (angle === 90) return e.beta;
  if (angle === 270) return -e.beta;
  if (angle === 180) return -e.gamma;
  return e.gamma;
}

window.addEventListener('deviceorientation', (e) => {
  if (e.beta == null || e.gamma == null) return;
  tilt.roll = screenRoll(e);
  if (tilt.neutral === null) tilt.neutral = tilt.roll;
  document.body.classList.toggle('tilt-live', !!(state?.tilt));
});

function recenterTilt() {
  tilt.neutral = tilt.roll;
  tilt.acc = 0;
}

/** Turn commands from the device lean, for one physics step. */
function tiltTurn() {
  if (!state.tilt || tilt.roll === null || tilt.neutral === null) return { left: false, right: false };
  const lean = tilt.roll - tilt.neutral;
  const duty = Math.max(0, Math.min(1, (Math.abs(lean) - TILT.dead) / (TILT.full - TILT.dead)));
  tilt.acc += duty;
  if (tilt.acc < 1) return { left: false, right: false };
  tilt.acc -= 1;
  return { left: lean < 0, right: lean > 0 };
}

async function askTiltPermission() {
  // iOS asks the player first, and only from a tap.
  if (typeof DeviceOrientationEvent.requestPermission !== 'function') return true;
  try {
    return (await DeviceOrientationEvent.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

function clearKeys() {
  for (const k of keys) Object.assign(k, blankInput());
}

/** Which pilot and action a key drives. A lone pilot can also use pilot 2's keys. */
function keyAction(code) {
  const count = state?.pilots.length || 1;
  for (let i = 0; i < 2; i++) {
    const action = actionOf(keysOf(setup, i), code);
    if (action) return { pilot: count === 1 ? 0 : i, action };
  }
  return null;
}

function commandsFor(index) {
  const k = keys[index];
  const t = index === 0 ? touch : blankInput();
  const lean = index === 0 ? tiltTurn() : { left: false, right: false };
  return {
    left: k.left || t.left || lean.left,
    right: k.right || t.right || lean.right,
    thrust: k.thrust || t.thrust,
    fire: k.fire || t.fire,
  };
}

window.addEventListener('keydown', (e) => {
  // Every key press tells us a little more about the keyboard layout.
  if (learnKey(e.code, e.key)) refreshKeyLabels();
  // On-screen keyboards type into fields and have no arrow keys: only other
  // presses prove a real keyboard.
  const inField = e.target.closest && e.target.closest('input, textarea');
  if (!keyboardSeen && e.code && (!inField || /^(Arrow|Tab|Escape)/.test(e.code))) {
    keyboardSeen = true;
    if (isShown('setup')) renderSetup();
  }
  if (capture) {
    e.preventDefault();
    captureKey(e.code);
    return;
  }
  // Typing a nickname or comment must not steer a ship or restart the game.
  if (e.target.closest && e.target.closest('input, textarea')) return;
  if (bookReturn) {
    if (e.code === 'Escape') closeBook();
    return;
  }
  if (isShown('setup')) {
    if (e.code === 'Escape') showMenu(setupLevel);
    else if (e.code === 'Enter' && !e.target.closest('button')) setupForm.requestSubmit();
    return;
  }
  const hit = keyAction(e.code);
  if (hit) {
    keys[hit.pilot][hit.action] = true;
    e.preventDefault();
  }
  if (e.repeat) return;

  if (state.mode === 'menu') {
    const n = Number(e.key);
    if (n >= 1 && n <= LEVELS.length) openSetup(n - 1);
    else if (e.code === 'Enter') openSetup(state.levelIndex);
  } else if (state.mode === 'gameover') {
    if (e.code === 'Enter') startGame(state.levelIndex);
    else if (e.code === 'Escape' || e.code === 'KeyM') showMenu();
  } else if (e.code === 'KeyP' || e.code === 'Escape') {
    togglePause();
  }
});

window.addEventListener('keyup', (e) => {
  const hit = keyAction(e.code);
  if (hit) keys[hit.pilot][hit.action] = false;
});

window.addEventListener('blur', () => {
  clearKeys();
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
let setup = loadSetup();

const rand = (a, b) => a + Math.random() * (b - a);

function allBodies() {
  const s = state;
  return [...s.massive, ...s.asteroids, ...ships(), ...s.missiles, ...s.targets, ...s.particles, ...s.beams];
}

/** Ships flown by the pilots that are currently in play. */
function pilotShips() {
  return state.pilots.filter((p) => p.ship).map((p) => p.ship);
}

/** Every ship in play: the pilots' and the aliens'. */
function ships() {
  return [...pilotShips(), ...state.aliens];
}

/** Build a level. With `play` = null this is the empty preview behind the menu. */
function buildWorld(levelIndex, play = null) {
  const level = LEVELS[levelIndex];
  const cx = world.w / 2;
  const cy = world.h / 2;
  const style = play ? styleOf(play) : 'solo';
  const aliens = { ...level.aliens };
  if (style === 'team') {
    aliens.max += TEAM_ALIENS.extra;
    aliens.first = aliens.first.map((t) => t * TEAM_ALIENS.sooner);
    aliens.every = aliens.every.map((t) => t * TEAM_ALIENS.sooner);
  }
  const s = {
    level,
    levelIndex,
    style,
    aliensRule: aliens,
    mode: 'menu',
    pilots: [],
    massive: [],
    planet: null,
    moon: null,
    aliens: [],
    missiles: [],
    asteroids: [],
    targets: [],
    particles: [],
    beams: [], // destroyer laser shots, drawn for a moment
    teamScore: 0, // solo and team games share one score
    time: 0,
    endTimer: null,
    targetTimers: [],
    asteroidTimer: level.asteroids ? rand(...level.asteroids.every) : 0,
    alienTimer: rand(...aliens.first),
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

  if (play) {
    for (let i = 0; i < play.count; i++) {
      const design = shipById(play.ships[i]);
      s.pilots.push({
        index: i,
        name: play.names[i].trim(),
        sprite: `ship-${design.id}`,
        color: design.color,
        ship: null,
        lives: PLAYER.lives,
        score: 0, // used in versus games
        respawnTimer: 0,
        trail: [],
        trailTimer: 0,
      });
    }
  }
  return s;
}

function startGame(levelIndex, play = setup) {
  if (play.count === 2 && !hasKeyboard()) play = { ...play, count: 1 };
  state = buildWorld(levelIndex, play);
  state.mode = 'playing';
  state.tilt = !!play.tilt && document.body.classList.contains('touch') && tiltAvailable();
  document.body.classList.toggle('tilt-live', state.tilt && tilt.roll !== null);
  recenterTilt();
  clearKeys();
  for (const p of state.pilots) spawnShip(p);
  for (let i = 0; i < state.level.targets; i++) spawnTarget();
  showOverlay(null);
  document.getElementById('hud').hidden = false;
  touchPanel.classList.add('active');
  updateHud(true);
}

function showMenu(levelIndex = state ? state.levelIndex : 0) {
  state = buildWorld(levelIndex);
  document.body.classList.remove('tilt-live');
  document.getElementById('hud').hidden = true;
  touchPanel.classList.remove('active');
  renderLevelList();
  refreshKeyLabels();
  showOverlay('menu');
}

function togglePause() {
  if (state.mode === 'playing') {
    state.mode = 'paused';
    showOverlay('paused');
  } else if (state.mode === 'paused') {
    state.mode = 'playing';
    recenterTilt(); // however the device is held now counts as straight
    showOverlay(null);
  }
}

/** Pilot 1 starts on the left, pilot 2 on the right, both orbiting the same way. */
function spawnPoint(index) {
  const s = state;
  const side = index === 0 ? -1 : 1;
  if (s.planet) {
    const r = s.level.shipOrbit;
    const v = circularSpeed(s.planet.mass, r);
    return {
      x: s.planet.x + side * r,
      y: s.planet.y,
      vx: s.planet.vx,
      vy: s.planet.vy + side * v, // same direction as the moon
      angle: (side * Math.PI) / 2,
    };
  }
  return { x: world.w * (index === 0 ? 0.3 : 0.7), y: world.h / 2, vx: 0, vy: 0, angle: index === 0 ? 0 : Math.PI };
}

function spawnShip(pilot) {
  const p = spawnPoint(pilot.index);
  wrapPosition(p, world);
  pilot.ship = {
    kind: 'ship',
    crew: pilot,
    ...p,
    ax: 0,
    ay: 0,
    radius: SHIP.radius,
    mass: 0,
    thrusting: false,
    fireCooldown: 0,
    invulnerable: PLAYER.invulnerable,
  };
  pilot.trail = [];
}

function isSpawnClear(pilot) {
  const p = spawnPoint(pilot.index);
  const hazards = [...state.asteroids, ...ships(), ...state.missiles, ...(state.moon ? [state.moon] : [])];
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
    } while (pilotShips().some((sh) => distance(t, sh, world) < 220) && ++tries < 30);
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
  const m = {
    kind: 'missile',
    ...missileLaunch(ship),
    ax: 0,
    ay: 0,
    radius: MISSILE.radius,
    mass: 0,
    gravity: MISSILE.gravity,
    life: MISSILE.life,
    owner: ship,
    homing: null,
  };
  // The first missile fired after a lock is guided; the lock is then spent.
  if (ship.lock && ship.lock.target && ship.lock.time >= LOCK.time) {
    m.homing = ship.lock.target;
    m.homingLeft = LOCK.homing.time;
    ship.lock = null;
  }
  wrapPosition(m, world);
  state.missiles.push(m);
}

/** Pilot commands, identical for the players and the aliens. */
function command(ship, cmd, dt) {
  steer(ship, cmd, dt);
  ship.fireCooldown -= dt;
  const inFlight = state.missiles.filter((m) => m.owner === ship).length;
  if (cmd.fire && ship.fireCooldown <= 0 && inFlight < MISSILE.maxPerShip) {
    fireMissile(ship);
    ship.fireCooldown = MISSILE.cooldown;
  }
}

function newAlien(at, destroyer = false) {
  return {
    kind: 'alien',
    x: at.x,
    y: at.y,
    vx: at.vx,
    vy: at.vy,
    ax: 0,
    ay: 0,
    angle: at.angle ?? rand(0, Math.PI * 2),
    radius: SHIP.radius,
    mass: 0,
    thrusting: false,
    fireCooldown: ALIEN.warpIn, // no shooting while warping in
    warp: ALIEN.warpIn,
    pilot: createPilot(),
    ...(destroyer && {
      destroyer: true,
      radius: DESTROYER.radius,
      size: DESTROYER.size,
      thrust: DESTROYER.thrust,
      turnRate: DESTROYER.turnRate,
      hp: DESTROYER.hp,
      hurt: 0,
      laserCooldown: DESTROYER.laser.cooldown,
    }),
  };
}

function spawnAlien(destroyer = false) {
  const s = state;
  // Appear somewhere clear: away from the pilots, planets, moons and rocks.
  const room = destroyer ? 60 : 0;
  let spot = null;
  for (let tries = 0; tries < 40 && !spot; tries++) {
    const c = { x: rand(0, world.w), y: rand(0, world.h) };
    const clear =
      pilotShips().every((sh) => distance(c, sh, world) > 350) &&
      s.massive.every((b) => distance(c, b, world) > b.radius + 150 + room) &&
      [...s.asteroids, ...s.aliens].every((b) => distance(c, b, world) > 120 + room);
    if (clear) spot = c;
  }
  if (!spot) return;
  const a = rand(0, Math.PI * 2);
  s.aliens.push(newAlien({ ...spot, vx: Math.cos(a) * 20, vy: Math.sin(a) * 20 }, destroyer));
  explode(spot.x, spot.y, destroyer ? 48 : 24, '#c58bff', destroyer ? 140 : 90);
}

/** How many aliens may fly at once, and how long until the next one: both ramp up with time. */
function alienPace() {
  const s = state;
  const extra = Math.min(RAMP.maxExtra, Math.floor(s.time / RAMP.extraEvery));
  return { max: s.aliensRule.max + extra, wait: rand(...s.aliensRule.every) / (1 + s.time / RAMP.pace) };
}

/** The destroyer burns the nearest asteroid or beacon within laser range. */
function fireLaser(d) {
  const s = state;
  const reach = (b) => (b.wrap === false ? Math.hypot(b.x - d.x, b.y - d.y) : distance(d, b, world)) - b.radius;
  let prey = null;
  let best = DESTROYER.laser.range;
  for (const b of [...s.asteroids, ...s.targets]) {
    if (b.dead) continue;
    const r = reach(b);
    if (r < best) {
      best = r;
      prey = b;
    }
  }
  if (!prey) return false;
  const { dx, dy } = prey.wrap === false ? { dx: prey.x - d.x, dy: prey.y - d.y } : delta(d, prey, world);
  s.beams.push({ x: d.x, y: d.y, x2: d.x + dx, y2: d.y + dy, life: DESTROYER.laser.beam });
  if (prey.kind === 'asteroid') destroyAsteroid(prey, d);
  else {
    prey.dead = true;
    explode(prey.x, prey.y, 14, '#7dff9b', 100);
  }
  return true;
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

function nearestPilotShip(from) {
  let best = null;
  let bestD = Infinity;
  for (const sh of pilotShips()) {
    const d = distance(from, sh, world);
    if (d < bestD) {
      bestD = d;
      best = sh;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Lock-on and guided missiles
// ---------------------------------------------------------------------------

/** The ships `ship` may lock onto: aliens hunt pilots; pilots hunt aliens, and each other in versus. */
function lockCandidates(ship) {
  if (ship.kind === 'alien') return pilotShips().filter((p) => !p.invulnerable);
  const foes = state.aliens.filter((a) => !a.warp);
  if (state.style === 'versus') foes.push(...pilotShips().filter((o) => o !== ship && !o.invulnerable));
  return foes;
}

function updateLocks(dt) {
  const live = new Set(ships());
  for (const sh of live) {
    if (sh.warp) continue;
    const lock = sh.lock || (sh.lock = { target: null, time: 0 });
    if (lock.target && !live.has(lock.target)) Object.assign(lock, { target: null, time: 0 });
    // The enemy closest to the ship's heading, if it sits within the cone.
    let best = null;
    let bestErr = Infinity;
    for (const t of lockCandidates(sh)) {
      const { dx, dy } = delta(sh, t, world);
      const d = Math.hypot(dx, dy);
      if (d > LOCK.range) continue;
      const err = Math.abs(angleDiff(Math.atan2(dy, dx) - sh.angle));
      if (err < LOCK.cone + Math.atan2(t.radius, d) && err < bestErr) {
        bestErr = err;
        best = t;
      }
    }
    if (best && best === lock.target) {
      lock.time = Math.min(LOCK.time, lock.time + dt);
    } else if (best && !lock.target) {
      lock.target = best;
      lock.time = dt;
    } else if (lock.target) {
      lock.time -= dt * LOCK.decay;
      if (lock.time <= 0) Object.assign(lock, { target: null, time: 0 });
    }
  }
}

/** Guided missiles bend gently toward their target, until it gets behind them or guidance runs out. */
function steerHomingMissiles(dt) {
  const live = new Set(ships());
  for (const m of state.missiles) {
    m.ax = 0;
    m.ay = 0;
    if (!m.homing) continue;
    m.homingLeft -= dt;
    if (m.homingLeft <= 0 || !live.has(m.homing)) {
      m.homing = null;
      continue;
    }
    const { dx, dy } = delta(m, m.homing, world);
    const err = angleDiff(Math.atan2(dy, dx) - Math.atan2(m.vy, m.vx));
    if (Math.abs(err) > LOCK.homing.cone) {
      m.homing = null; // dodged
      continue;
    }
    const v = Math.hypot(m.vx, m.vy) || 1;
    const a = Math.max(-1, Math.min(1, err * 3)) * LOCK.homing.accel;
    m.ax = (-m.vy / v) * a;
    m.ay = (m.vx / v) * a;
  }
}

function update(dt) {
  const s = state;
  if (s.mode === 'paused') return;
  s.time += dt;
  const playing = s.mode === 'playing';

  // Pilots: the players' buttons, and the alien autopilots
  if (playing) {
    for (const p of s.pilots) {
      if (!p.ship) continue;
      command(p.ship, commandsFor(p.index), dt);
      p.ship.invulnerable = Math.max(0, p.ship.invulnerable - dt);
    }
  }
  updateLocks(dt);
  steerHomingMissiles(dt);
  if (s.aliens.length) {
    const view = {
      world,
      sources: [...s.massive, ...s.asteroids],
      solids: s.massive,
      missiles: s.missiles,
      ships: ships(),
      target: null,
    };
    for (const a of s.aliens) {
      a.warp = Math.max(0, a.warp - dt);
      view.target = playing ? nearestPilotShip(a) : null; // hunt the closest pilot
      command(a, alienPilot(a, view, dt), dt);
      if (a.destroyer) {
        a.hurt = Math.max(0, a.hurt - dt);
        a.laserCooldown -= dt;
        if (a.laserCooldown <= 0 && !a.warp && fireLaser(a)) a.laserCooldown = DESTROYER.laser.cooldown;
      }
    }
  }
  for (const b of s.beams) b.life -= dt;
  s.beams = s.beams.filter((b) => b.life > 0);

  // Gravity: planet, moon and asteroids attract everything (and each other);
  // ships, missiles and beacons are too light to attract anything.
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

  // Alien ships appear from time to time, a little more often as time goes on.
  s.alienTimer -= dt;
  if (s.alienTimer <= 0) {
    const pace = alienPace();
    if (s.aliens.length < pace.max) {
      const destroyer =
        playing && s.time > DESTROYER.after && !s.aliens.some((a) => a.destroyer) && Math.random() < DESTROYER.chance;
      spawnAlien(destroyer);
    }
    s.alienTimer = pace.wait;
  }

  // Ship trails
  for (const p of s.pilots) {
    if (!p.ship) continue;
    p.trailTimer -= dt;
    if (p.trailTimer <= 0) {
      p.trail.push({ x: p.ship.x, y: p.ship.y });
      if (p.trail.length > TRAIL.length) p.trail.shift();
      p.trailTimer = TRAIL.every;
    }
  }

  if (!playing) return;

  // Respawns
  for (const p of s.pilots) {
    if (p.ship || p.lives <= 0) continue;
    p.respawnTimer -= dt;
    if (p.respawnTimer <= 0 && isSpawnClear(p)) spawnShip(p);
  }

  // Game over: in versus as soon as one pilot is out of ships, otherwise
  // when every pilot is.
  const out = (p) => !p.ship && p.lives <= 0;
  const over = s.style === 'versus' ? s.pilots.some(out) : s.pilots.every(out);
  if (over) {
    if (s.endTimer === null) s.endTimer = 1.8;
    s.endTimer -= dt;
    if (s.endTimer <= 0) gameOver();
  }
}

function hit(a, b) {
  // Asteroids don't wrap, so they must not collide across the window edges.
  const d = a.wrap === false || b.wrap === false ? Math.hypot(a.x - b.x, a.y - b.y) : distance(a, b, world);
  return d < a.radius + b.radius;
}

/** The pilot who fired a missile, or null for an alien's missile. */
function shooter(m) {
  return m.owner && m.owner.kind === 'ship' ? m.owner.crew : null;
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
      addScore(shooter(m), TARGET.score);
      explode(t.x, t.y, 20, '#7dff9b', 140);
      continue;
    }
    const a = s.asteroids.find((a) => !a.dead && hit(m, a));
    if (a) {
      m.dead = true;
      destroyAsteroid(a, m);
      addScore(shooter(m), ASTEROID_SIZES[a.size].score);
      continue;
    }
    const alien = s.aliens.find((al) => !al.dead && missileHitsShip(m, al));
    if (alien) {
      m.dead = true;
      const destroyer = alien.destroyer;
      const killed = damageAlien(alien, true);
      addScore(shooter(m), !destroyer ? ALIEN.score : killed ? DESTROYER.score : DESTROYER.hitScore);
      continue;
    }
    const victim = s.pilots.find((p) => p.ship && !p.ship.invulnerable && missileHitsShip(m, p.ship));
    if (victim) {
      m.dead = true;
      const by = shooter(m);
      if (s.style === 'versus' && by && by !== victim) addScore(by, VERSUS.score);
      killShip(victim);
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

  // Aliens obey the same rules: planets, moons, rocks and other ships are
  // deadly. The destroyer's armour takes a hit from rocks and ships instead.
  for (const al of s.aliens) {
    if (al.dead) continue;
    if (solids.some((b) => hit(al, b))) {
      killAlien(al);
      continue;
    }
    const rock = s.asteroids.find((a) => !a.dead && hit(al, a));
    if (rock) destroyAsteroid(rock, al);
    const other = s.aliens.find((o) => o !== al && !o.dead && hit(al, o));
    if (other) damageAlien(other);
    if (rock || other) damageAlien(al);
  }

  // Pilots' ships. Respawn protection covers rocks, missiles and other ships,
  // but planets and moons are always solid.
  for (const p of s.pilots) {
    const ship = p.ship;
    if (!ship) continue;
    const crashed = solids.some((b) => hit(ship, b));
    const shielded = ship.invulnerable > 0;
    const rock = !shielded && s.asteroids.find((a) => !a.dead && hit(ship, a));
    const alien = !shielded && s.aliens.find((a) => !a.dead && hit(ship, a));
    const mate = !shielded && s.pilots.find((o) => o !== p && o.ship && !o.ship.invulnerable && hit(ship, o.ship));
    if (rock) destroyAsteroid(rock, ship);
    if (alien) damageAlien(alien);
    if (mate) killShip(mate);
    if (crashed || rock || alien || mate) killShip(p);
  }
}

/**
 * One hit on an alien. Small aliens die; the destroyer loses armour, with a
 * short grace after collisions so one crash doesn't count several times.
 * Returns true when the alien is destroyed.
 */
function damageAlien(a, byMissile = false) {
  if (a.dead) return false;
  if (a.destroyer && !byMissile && a.hurt > 0) return false;
  if (a.destroyer && a.hp > 1) {
    a.hp -= 1;
    a.hurt = DESTROYER.hurt;
    a.flash = 0.25;
    explode(a.x, a.y, 14, '#ffffff', 110);
    return false;
  }
  killAlien(a);
  return true;
}

function killAlien(a) {
  a.dead = true;
  explode(a.x, a.y, a.destroyer ? 70 : 36, '#c58bff', a.destroyer ? 220 : 170);
  explode(a.x, a.y, 16, '#ffffff', 90);
  if (!a.destroyer) return;
  // Small aliens escape from the wreck and join the fight.
  const [lo, hi] = DESTROYER.escape;
  const n = lo + Math.floor(Math.random() * (hi - lo + 1));
  const turn = rand(0, Math.PI * 2);
  for (let k = 0; k < n; k++) {
    const dir = turn + (k / n) * Math.PI * 2;
    const pod = newAlien({
      x: a.x + Math.cos(dir) * 24,
      y: a.y + Math.sin(dir) * 24,
      vx: a.vx + Math.cos(dir) * 70,
      vy: a.vy + Math.sin(dir) * 70,
      angle: dir,
    });
    pod.warp = 0;
    pod.fireCooldown = 1;
    wrapPosition(pod, world);
    state.aliens.push(pod);
  }
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

function killShip(pilot) {
  const ship = pilot.ship;
  if (!ship) return;
  explode(ship.x, ship.y, 40, '#ffb14a', 180);
  explode(ship.x, ship.y, 20, pilot.color, 100);
  pilot.ship = null;
  pilot.trail = [];
  pilot.lives -= 1;
  pilot.respawnTimer = 2;
  updateHud();
}

/** Points go to the shooting pilot in versus, to the shared score otherwise. */
function addScore(pilot, points) {
  if (!pilot) return; // aliens don't score
  if (state.style === 'versus') pilot.score += points;
  else state.teamScore += points;
  updateHud();
}

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------

/** "Ada & Bob" for a team, the nickname for a solo pilot. */
function crewName(s) {
  return s.pilots.map((p) => p.name).join(' & ');
}

function gameOver() {
  const s = state;
  s.mode = 'gameover';
  const title = document.getElementById('gameover-title');
  const line = document.getElementById('gameover-score');
  if (s.style === 'versus') {
    const [a, b] = s.pilots;
    title.textContent = a.score === b.score ? 'Draw!' : `${(a.score > b.score ? a : b).name} wins!`;
    line.textContent = `${a.name} ${a.score} · ${b.name} ${b.score}`;
  } else {
    const best = saveBest(s.levelIndex, s.style, s.teamScore);
    title.textContent = 'Game over';
    const label = s.style === 'team' ? 'Team score' : 'Score';
    line.textContent =
      s.teamScore >= best && s.teamScore > 0 ? `New best: ${s.teamScore}` : `${label} ${s.teamScore} · Best ${best}`;
  }
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

/** After a game, offer to sign if the score makes the level's top 10. */
async function offerGoldenBook(s) {
  entryForm.hidden = true;
  entryDone.hidden = true;
  pendingEntry = null;
  const book = STYLES[s.style].book; // versus games have no golden book
  if (!book || s.teamScore <= 0) return;
  const game = s;
  let books;
  try {
    books = await fetchBook();
  } catch {
    return; // no server-side book (e.g. offline): just skip it
  }
  if (state !== game || !qualifies(books[book]?.[game.level.id] || [], game.teamScore)) return;
  pendingEntry = { mode: book, level: game.level.id, score: game.teamScore };
  entryError.hidden = true;
  entryForm.querySelector('.made-it').textContent =
    game.pilots.length > 1 ? 'Your team made the top 10! Sign the golden book.' : 'You made the top 10! Sign the golden book.';
  entryForm.hidden = false;
  const nick = document.getElementById('entry-nickname');
  nick.value = crewName(game); // the nicknames registered before the game
  nick.maxLength = book === 'duo' ? 2 * NAME_MAX + 3 : NAME_MAX;
  const comment = document.getElementById('entry-comment');
  comment.value = '';
  comment.focus();
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
    const { rank, books } = await signBook({ ...pendingEntry, nickname, comment });
    const { mode, level } = pendingEntry;
    const mine = books[mode][level][rank - 1];
    pendingEntry = null;
    entryForm.hidden = true;
    entryDone.textContent = `Signed! ${mode === 'duo' ? 'Your team is' : 'You are'} #${rank} in the golden book.`;
    entryDone.hidden = false;
    openBook(books, { mode, level, mine });
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

async function openBook(books = null, view = null) {
  bookReturn = overlays.find((id) => isShown(id)) || 'menu';
  showOverlay('book');
  const where = view || { mode: state.style === 'team' ? 'duo' : 'solo', level: state.level.id, mine: null };
  if (books) {
    renderBook(books, where);
    return;
  }
  renderBook({}, where);
  try {
    renderBook(await fetchBook(), where);
  } catch (err) {
    showBookError(`The golden book is unavailable right now (${err.message}).`);
  }
}

function closeBook() {
  showOverlay(bookReturn || 'menu');
  bookReturn = null;
}

// ---------------------------------------------------------------------------
// Best scores (per level and play style, kept in the browser)
// ---------------------------------------------------------------------------

function bestKey(levelIndex, style) {
  const id = LEVELS[levelIndex].id;
  return style === 'team' ? `gravitypilot.best.team.${id}` : `gravitypilot.best.${id}`;
}

function getBest(levelIndex, style = 'solo') {
  try {
    return Number(localStorage.getItem(bestKey(levelIndex, style))) || 0;
  } catch {
    return 0;
  }
}

function saveBest(levelIndex, style, score) {
  const best = Math.max(getBest(levelIndex, style), score);
  try {
    localStorage.setItem(bestKey(levelIndex, style), String(best));
  } catch {
    /* storage unavailable */
  }
  return best;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawTrail(trail, color) {
  if (trail.length < 2) return;
  ctx.lineWidth = 1.5;
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1];
    const b = trail[i];
    // Broken where the ship wrapped around an edge
    if (Math.abs(a.x - b.x) > world.w / 2 || Math.abs(a.y - b.y) > world.h / 2) continue;
    ctx.strokeStyle = rgba(color, (i / trail.length) * 0.5);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

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

  for (const p of s.pilots) drawTrail(p.trail, p.color);

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
    if (m.homing) {
      // Guided missiles glow red.
      ctx.fillStyle = 'rgba(255, 70, 70, 0.35)';
      ctx.beginPath();
      ctx.arc(m.x, m.y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    drawSprite('missile', m.x, m.y, MISSILE.size, 0, Math.min(1, m.life * 2));
  }

  for (const b of s.beams) {
    ctx.strokeStyle = `rgba(255, 60, 200, ${Math.min(1, (b.life / DESTROYER.laser.beam) * 1.5)})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
  }

  for (const a of s.aliens) {
    const alpha = a.warp ? 1 - a.warp / ALIEN.warpIn : 1;
    const sprite = a.destroyer ? 'destroyer' : 'alien';
    drawWrapped(a, sizeOf(a) / 2, (x, y) => {
      drawShip(a, sprite, x, y, alpha);
      if (a.destroyer && a.flash > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${a.flash * 1.6})`;
        ctx.beginPath();
        ctx.arc(x, y, a.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    if (a.flash) a.flash = Math.max(0, a.flash - 1 / 60);
  }

  const labels = s.pilots.length > 1;
  for (const p of s.pilots) {
    const ship = p.ship;
    if (!ship || (ship.invulnerable && Math.floor(ship.invulnerable * 8) % 2)) continue;
    drawWrapped(ship, SHIP.size / 2, (x, y) => {
      drawShip(ship, p.sprite, x, y);
      if (labels) {
        // Name tags tell the two pilots apart.
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = p.color;
        ctx.fillText(p.name, x, y - SHIP.size * 0.75);
      }
    });
  }

  drawLocks();

  for (const p of s.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
}

/**
 * Lock markers: a square blinks around a ship while someone locks onto it and
 * turns red once locked. Each extra ship locking the same target adds a
 * corner bracket instead of another square.
 */
function drawLocks() {
  const s = state;
  const byTarget = new Map();
  for (const sh of ships()) {
    const lock = sh.lock;
    if (!lock || !lock.target || lock.time <= 0) continue;
    if (!byTarget.has(lock.target)) byTarget.set(lock.target, []);
    byTarget.get(lock.target).push(lock.time >= LOCK.time);
  }
  const blinkOn = Math.floor(s.time * 6) % 2 === 0;
  for (const [target, locks] of byTarget) {
    locks.sort((a, b) => b - a); // a finished lock draws the square
    const h = sizeOf(target) / 2 + 8;
    drawWrapped(target, h + 10, (x, y) => {
      ctx.lineWidth = 2;
      locks.forEach((locked, k) => {
        if (!locked && !blinkOn) return;
        ctx.strokeStyle = locked ? '#ff3b3b' : '#ffd34d';
        if (k === 0) {
          ctx.strokeRect(x - h, y - h, h * 2, h * 2);
          return;
        }
        // Corners 1 to 3: top right, bottom right, bottom left, just outside the square.
        const c = [
          [1, -1],
          [1, 1],
          [-1, 1],
        ][(k - 1) % 3];
        const o = h + 5;
        const arm = 9;
        ctx.beginPath();
        ctx.moveTo(x + c[0] * (o - arm), y + c[1] * o);
        ctx.lineTo(x + c[0] * o, y + c[1] * o);
        ctx.lineTo(x + c[0] * o, y + c[1] * (o - arm));
        ctx.stroke();
      });
    });
  }
}

// ---------------------------------------------------------------------------
// DOM overlays and HUD
// ---------------------------------------------------------------------------

const overlays = ['menu', 'setup', 'paused', 'gameover', 'book'];
function showOverlay(name) {
  for (const id of overlays) document.getElementById(id).hidden = id !== name;
}
function isShown(id) {
  return !document.getElementById(id).hidden;
}

let hudCache = '';
function updateHud(force = false) {
  const s = state;
  const versus = s.style === 'versus';
  const best = versus ? 0 : Math.max(getBest(s.levelIndex, s.style), s.teamScore);
  const key = JSON.stringify([s.levelIndex, s.style, s.teamScore, best, s.pilots.map((p) => [p.score, p.lives])]);
  if (!force && key === hudCache) return;
  hudCache = key;
  document.getElementById('hud-level').textContent = `${s.level.id}. ${s.level.name}`;
  document.getElementById('hud-score-wrap').hidden = versus;
  document.getElementById('hud-best-wrap').hidden = versus;
  document.getElementById('hud-score-label').textContent = s.style === 'team' ? 'Team' : 'Score';
  document.getElementById('hud-score').textContent = s.teamScore;
  document.getElementById('hud-best').textContent = best;
  document.getElementById('hud-pilots').replaceChildren(
    ...s.pilots.map((p) => {
      const el = document.createElement('span');
      el.className = `hud-pilot${!p.ship && p.lives <= 0 ? ' out' : ''}`;
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color;
      const lives = '▲'.repeat(Math.max(0, p.lives));
      el.append(dot, `${p.name} ${versus ? `${p.score} ` : ''}${lives}`);
      return el;
    }),
  );
}

function renderLevelList() {
  const list = document.getElementById('level-list');
  list.replaceChildren(
    ...LEVELS.map((lvl, i) => {
      const b = document.createElement('button');
      const best = getBest(i, 'solo');
      const team = getBest(i, 'team');
      const bests = [best && `Best ${best}`, team && `Team ${team}`].filter(Boolean).join(' · ');
      b.innerHTML = `<span class="num">LEVEL ${lvl.id}</span>
        <span class="name"></span><span class="desc"></span>
        ${bests ? '<span class="best"></span>' : ''}`;
      b.querySelector('.name').textContent = lvl.name;
      b.querySelector('.desc').textContent = lvl.description;
      if (bests) b.querySelector('.best').textContent = bests;
      b.addEventListener('click', () => openSetup(i));
      b.addEventListener('mouseenter', () => {
        if (state.levelIndex !== i) state = buildWorld(i); // preview the level behind the menu
      });
      return b;
    }),
  );
}

// ---------------------------------------------------------------------------
// Pilot setup: nicknames, number of pilots, team or versus, ships
// ---------------------------------------------------------------------------

const setupForm = document.getElementById('setup-form');
const setupError = document.getElementById('setup-error');
let setupLevel = 0;

function openSetup(levelIndex) {
  setupLevel = levelIndex;
  capture = null;
  if (state.levelIndex !== levelIndex) state = buildWorld(levelIndex);
  const lvl = LEVELS[levelIndex];
  document.getElementById('setup-title').textContent = `Level ${lvl.id} · ${lvl.name}`;
  setupError.hidden = true;
  renderSetup();
  showOverlay('setup');
  const first = setupForm.querySelector('input[name="name"]');
  if (first && !first.value) first.focus();
}

function renderSetup() {
  document.getElementById('setup-count').hidden = !hasKeyboard();
  if (!hasKeyboard()) setup.count = 1;
  document.getElementById('setup-steer-wrap').hidden = !(document.body.classList.contains('touch') && tiltAvailable());
  for (const b of document.querySelectorAll('#setup-steer button')) {
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(b.dataset.tilt === (setup.tilt ? '1' : '0')));
  }
  for (const b of document.querySelectorAll('#setup-count button')) {
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(Number(b.dataset.count) === setup.count));
  }
  const modeSeg = document.getElementById('setup-mode');
  modeSeg.hidden = setup.count === 1;
  for (const b of modeSeg.querySelectorAll('button')) {
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(b.dataset.mode === setup.mode));
  }
  const help = document.getElementById('setup-mode-help');
  help.hidden = setup.count === 1;
  help.textContent = STYLES[setup.mode].help;

  const holder = document.getElementById('setup-pilots');
  holder.replaceChildren(
    ...Array.from({ length: setup.count }, (_, i) => {
      const box = document.createElement('fieldset');
      box.className = 'pilot';
      box.style.setProperty('--pilot', shipById(setup.ships[i]).color);
      const legend = document.createElement('legend');
      legend.textContent = setup.count === 1 ? 'Pilot' : `Pilot ${i + 1}`;
      const name = document.createElement('input');
      name.name = 'name';
      name.maxLength = NAME_MAX;
      name.placeholder = 'Nickname';
      name.autocomplete = 'off';
      name.value = setup.names[i];
      name.setAttribute('aria-label', `${legend.textContent} nickname`);
      name.addEventListener('input', () => {
        setup.names[i] = name.value;
        setupError.hidden = true;
      });
      const picker = document.createElement('div');
      picker.className = 'ship-picker';
      for (const design of SHIPS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-pressed', String(setup.ships[i] === design.id));
        b.disabled = setup.count === 2 && setup.ships[1 - i] === design.id; // one ship per pilot
        b.title = design.name;
        const img = document.createElement('img');
        img.src = `sprites/${design.file}`;
        img.alt = '';
        b.append(img, design.name);
        b.addEventListener('click', () => {
          setup.ships[i] = design.id;
          renderSetup();
        });
        picker.append(b);
      }
      box.append(legend, name, picker, keyMap(i));
      return box;
    }),
  );
}

// --- Key bindings --------------------------------------------------------

let capture = null; // { pilot, action } while waiting for a key press

function keyMap(i) {
  const grid = document.createElement('div');
  grid.className = 'keymap';
  for (const a of ACTIONS) {
    const label = document.createElement('span');
    label.textContent = a.label;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'key';
    b.dataset.pilot = i;
    b.dataset.action = a.id;
    const waiting = capture?.pilot === i && capture.action === a.id;
    b.classList.toggle('waiting', waiting);
    b.textContent = waiting ? 'Press a key…' : keysOf(setup, i)[a.id].map(keyLabel).join(' / ');
    b.setAttribute('aria-label', `${a.label}: ${b.textContent}. Click to change.`);
    b.addEventListener('click', () => {
      capture = waiting ? null : { pilot: i, action: a.id };
      setupError.hidden = true;
      renderSetup();
      if (capture) setupForm.querySelector('.key.waiting')?.focus();
    });
    grid.append(label, b);
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'link';
  reset.textContent = 'Default keys';
  reset.hidden = isDefaultKeys(setup, i);
  reset.addEventListener('click', () => {
    resetKeys(setup, i);
    saveSetup(setup);
    renderSetup();
  });
  grid.append(reset);
  return grid;
}

function captureKey(code) {
  const { pilot, action } = capture;
  capture = null;
  if (code !== 'Escape') {
    const error = bindKey(setup, pilot, action, code);
    setupError.textContent = error || '';
    setupError.hidden = !error;
    if (!error) saveSetup(setup);
  }
  renderSetup();
  setupForm.querySelector(`.key[data-pilot="${pilot}"][data-action="${action}"]`)?.focus();
}

/** Redraw key names once the real keyboard layout is known. */
function refreshKeyLabels() {
  document.getElementById('help-p1').textContent = keysHelp(keysOf(setup, 0));
  document.getElementById('help-p2').textContent = keysHelp(keysOf(setup, 1));
  for (const b of document.querySelectorAll('.keymap .key:not(.waiting)')) {
    b.textContent = keysOf(setup, Number(b.dataset.pilot))[b.dataset.action].map(keyLabel).join(' / ');
  }
}

detectLayout().then(refreshKeyLabels);

for (const b of document.querySelectorAll('#setup-count button')) {
  b.addEventListener('click', () => {
    setup.count = Number(b.dataset.count);
    if (setup.count === 2 && setup.ships[0] === setup.ships[1]) {
      setup.ships[1] = SHIPS.find((d) => d.id !== setup.ships[0]).id;
    }
    renderSetup();
  });
}
for (const b of document.querySelectorAll('#setup-steer button')) {
  b.addEventListener('click', async () => {
    const on = b.dataset.tilt === '1';
    if (on && !(await askTiltPermission())) {
      setupError.textContent = 'Motion sensors are not available, so the turn buttons stay.';
      setupError.hidden = false;
      return;
    }
    setup.tilt = on;
    setupError.hidden = true;
    renderSetup();
  });
}
for (const b of document.querySelectorAll('#setup-mode button')) {
  b.addEventListener('click', () => {
    setup.mode = b.dataset.mode;
    renderSetup();
  });
}

setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  setup.names = setup.names.map((n) => n.trim());
  const error = validateSetup(setup);
  if (error) {
    setupError.textContent = error;
    setupError.hidden = false;
    return;
  }
  saveSetup(setup);
  startGame(setupLevel);
});

document.getElementById('btn-setup-back').addEventListener('click', () => showMenu(setupLevel));
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
window.gravityPilot = {
  get state() {
    return state;
  },
  get setup() {
    return setup;
  },
  world,
  startGame,
  showMenu,
  openSetup,
  spawnAlien,
  damageAlien,
  alienPace,
  step(n = 1) {
    for (let i = 0; i < n; i++) update(DT);
  },
};
