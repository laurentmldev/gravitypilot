// Alien pilot. Aliens fly with the same three commands and the same limits as
// the player (see ship.js); the pilot only decides which buttons to press.
// It plans by simulating the world a few seconds ahead with the real gravity
// model, so it has to cope with planets, moons, asteroids and missiles just
// like the player does.

import { accelerationAt, stepBodies, wrapDelta, wrapPosition } from './physics.js';
import { MISSILE, angleDiff, missileLaunch, turnToward, turnRateOf, thrustOf } from './ship.js';

export const PLAN = {
  horizon: 3, // seconds simulated ahead
  dt: 1 / 30, // planning step
  every: 0.15, // replanning period (reaction time)
  standoff: 260, // preferred distance from the player
  cruise: 110, // preferred speed when repositioning
  margin: 12, // extra clearance kept around hazards
  aimNoise: 0.08, // radians; aliens are good pilots, not perfect ones
  range: 520, // don't waste missiles on far targets
  shotPause: [2, 3.5], // seconds the pilot waits between shots
};

const STEPS = Math.round(PLAN.horizon / PLAN.dt);

export function createPilot() {
  return { timer: 0, sincePlan: 0, angle: null, thrustFor: 0, fire: false, holdFire: 0, mode: 'cruise' };
}

/**
 * Decide this step's commands for `self`.
 * `view` = { world, sources, solids, missiles, ships, target, wrapAim } where
 * `sources` are the bodies with mass, `solids` the planet and moon, `ships`
 * every ship (including `self`) and `target` the ship to attack, or null.
 * With `wrapAim: false` the pilot only aims at the target across the screen,
 * never through its edges (missiles still wrap if they miss).
 */
export function pilot(self, view, dt, rng = Math.random) {
  const p = self.pilot;
  p.timer -= dt;
  p.sincePlan += dt;
  p.holdFire -= dt;
  if (p.timer <= 0) {
    plan(self, view, p, rng);
    p.timer = PLAN.every;
    p.sincePlan = 0;
  }
  const cmd = { left: false, right: false, thrust: false, fire: false };
  if (p.angle !== null) {
    const t = turnToward(self, p.angle, dt);
    cmd.left = t.left;
    cmd.right = t.right;
    cmd.thrust = p.sincePlan < p.thrustFor && t.error < 0.35;
    cmd.fire = p.fire && p.holdFire <= 0 && t.error < 0.08;
    if (cmd.fire) {
      p.fire = false;
      p.holdFire = PLAN.shotPause[0] + rng() * (PLAN.shotPause[1] - PLAN.shotPause[0]);
    }
  }
  return cmd;
}

// ---------------------------------------------------------------------------
// Forecast: where everything else will be over the planning horizon
// ---------------------------------------------------------------------------

export function forecast(self, view) {
  const others = view.ships.filter((s) => s !== self);
  const tracked = [...view.sources, ...view.missiles, ...others];
  const clones = tracked.map((b) => ({
    x: b.x,
    y: b.y,
    vx: b.vx,
    vy: b.vy,
    mass: b.mass || 0,
    radius: b.radius,
    wrap: b.wrap,
    gravity: b.gravity,
  }));
  const sources = clones.slice(0, view.sources.length);
  const meta = tracked.map((b) => ({
    body: b,
    radius: b.radius,
    solid: view.sources.includes(b),
    missile: view.missiles.includes(b),
    ownMissile: b.owner === self,
    age: b.kind === 'missile' ? MISSILE.life - b.life : 0,
    life: b.kind === 'missile' ? b.life : Infinity,
  }));
  const frames = [];
  for (let k = 0; k <= STEPS; k++) {
    frames.push(clones.map((c) => ({ x: c.x, y: c.y, mass: c.mass, radius: c.radius })));
    if (k < STEPS) stepBodies(clones, sources, view.world, PLAN.dt);
  }
  return { tracked, meta, frames, world: view.world };
}

function dist2(a, b, world) {
  const dx = wrapDelta(b.x - a.x, world.w);
  const dy = wrapDelta(b.y - a.y, world.h);
  return dx * dx + dy * dy;
}

/** Vector from a to b: the shortest one through the edges, or straight across the screen. */
function towards(a, b, world, wrap) {
  if (!wrap) return { dx: b.x - a.x, dy: b.y - a.y };
  return { dx: wrapDelta(b.x - a.x, world.w), dy: wrapDelta(b.y - a.y, world.h) };
}

/** Is tracked body i dangerous to `self` at time t? */
function hazardAt(fc, i, t) {
  const m = fc.meta[i];
  if (m.missile) {
    if (t >= m.life) return false;
    if (m.ownMissile && m.age + t < MISSILE.armTime) return false;
  }
  return m.radius > 0;
}

/**
 * Fly `self` through the forecast with a simple manoeuvre: turn toward
 * `angle` (null = keep heading) and thrust for `thrust` seconds once roughly
 * aligned. Returns the time of the first predicted collision (Infinity if
 * none) and the path followed.
 */
export function simulateShip(self, angle, thrust, fc) {
  const { world, frames } = fc;
  const s = { x: self.x, y: self.y, vx: self.vx, vy: self.vy };
  let heading = self.angle;
  const path = [{ x: s.x, y: s.y }];
  const dt = PLAN.dt;
  const turnRate = turnRateOf(self);
  const power = thrustOf(self);
  for (let k = 0; k < STEPS; k++) {
    const t = k * dt;
    let aligned = true;
    if (angle !== null) {
      const d = angleDiff(angle - heading);
      const turn = turnRate * dt;
      heading += Math.max(-turn, Math.min(turn, d));
      aligned = Math.abs(d) < 0.35;
    }
    const g = accelerationAt(s, frames[k], world);
    const on = t < thrust && aligned ? power : 0;
    s.vx += (g.ax + Math.cos(heading) * on) * dt;
    s.vy += (g.ay + Math.sin(heading) * on) * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    wrapPosition(s, world);
    path.push({ x: s.x, y: s.y });
    const next = frames[k + 1];
    for (let i = 0; i < next.length; i++) {
      if (!hazardAt(fc, i, t + dt)) continue;
      const r = self.radius + fc.meta[i].radius + PLAN.margin;
      if (dist2(s, next[i], world) < r * r) return { hit: t + dt, path, end: s };
    }
  }
  return { hit: Infinity, path, end: s };
}

/**
 * Fly a missile fired at `angle` from where `self` is now. Returns how close
 * it comes to the ship at index `targetIdx` (Infinity if it dies first), and
 * whether it would come back to hit `self` (following `selfPath`).
 */
export function simulateMissile(self, angle, fc, targetIdx, selfPath, wrapAim = true) {
  const { world, frames } = fc;
  const m = missileLaunch(self, angle);
  const dt = PLAN.dt;
  let best = Infinity;
  for (let k = 0; k < STEPS; k++) {
    const t = (k + 1) * dt;
    const g = accelerationAt(m, frames[k], world);
    m.vx += g.ax * MISSILE.gravity * dt;
    m.vy += g.ay * MISSILE.gravity * dt;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    // Without wrap aiming, a shot only counts until it leaves the screen.
    if (!wrapAim && (m.x < 0 || m.x >= world.w || m.y < 0 || m.y >= world.h)) {
      return { miss: best, time: Infinity, selfHit: false };
    }
    wrapPosition(m, world);
    const next = frames[k + 1];
    const target = next[targetIdx];
    const { dx: tx, dy: ty } = towards(m, target, world, wrapAim);
    const d = Math.hypot(tx, ty) - fc.meta[targetIdx].radius - MISSILE.radius;
    if (d < best) best = d;
    if (d <= 0) return { miss: 0, time: t, selfHit: false };
    for (let i = 0; i < next.length; i++) {
      if (!fc.meta[i].solid) continue;
      const r = fc.meta[i].radius + MISSILE.radius;
      if (dist2(m, next[i], world) < r * r) return { miss: best, time: t, selfHit: false };
    }
    if (t > MISSILE.armTime && selfPath[k + 1]) {
      const r = self.radius + MISSILE.radius + 8;
      if (dist2(m, selfPath[k + 1], world) < r * r) return { miss: best, time: t, selfHit: true };
    }
  }
  return { miss: best, time: Infinity, selfHit: false };
}

/** Straight-line lead angle, ignoring gravity; the gravity-aware sweep refines it. */
export function leadAngle(self, target, world, wrap = true) {
  const { dx: rx, dy: ry } = towards(self, target, world, wrap);
  const ux = target.vx - self.vx;
  const uy = target.vy - self.vy;
  const s = MISSILE.speed;
  const a = ux * ux + uy * uy - s * s;
  const b = 2 * (rx * ux + ry * uy);
  const c = rx * rx + ry * ry;
  const disc = b * b - 4 * a * c;
  let t = -1;
  if (disc >= 0 && a !== 0) {
    const t1 = (-b - Math.sqrt(disc)) / (2 * a);
    const t2 = (-b + Math.sqrt(disc)) / (2 * a);
    t = Math.min(...[t1, t2].filter((x) => x > 0));
  }
  if (!(t > 0) || !Number.isFinite(t)) return Math.atan2(ry, rx);
  return Math.atan2(ry + uy * t, rx + ux * t);
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function plan(self, view, p, rng) {
  const fc = forecast(self, view);
  const coast = simulateShip(self, null, 0, fc);

  // 1. Danger ahead: find the manoeuvre that keeps us alive the longest.
  if (coast.hit < Infinity) {
    let best = { score: score(coast.hit, 0, 0), angle: null, thrust: 0 };
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const turn = Math.abs(angleDiff(angle - self.angle));
      for (const thrust of [0.5, 1.2, 2.5]) {
        const r = simulateShip(self, angle, thrust, fc);
        const sc = score(r.hit, turn, thrust);
        if (sc > best.score) best = { score: sc, angle, thrust };
      }
    }
    p.mode = 'evade';
    p.angle = best.angle;
    p.thrustFor = best.thrust;
    p.fire = false;
    return;
  }

  // 2. Safe: reposition toward a comfortable distance from the target, away
  // from planets, as long as the manoeuvre itself is predicted to be safe.
  const desired = desiredVelocity(self, view);
  const dvx = desired.x - self.vx;
  const dvy = desired.y - self.vy;
  const dv = Math.hypot(dvx, dvy);
  if (dv > 45) {
    const angle = Math.atan2(dvy, dvx);
    const thrust = Math.min(dv / thrustOf(self) + 0.1, 1.5);
    if (simulateShip(self, angle, thrust, fc).hit === Infinity) {
      p.mode = 'maneuver';
      p.angle = angle;
      p.thrustFor = thrust;
      p.fire = false;
      return;
    }
  }

  // 3. Attack: sweep firing angles around the lead angle and keep the one
  // whose simulated missile passes closest to the target's predicted path.
  const target = view.target;
  p.mode = 'attack';
  p.thrustFor = 0;
  p.fire = false;
  if (!target) {
    p.angle = dv > 1 ? Math.atan2(dvy, dvx) : self.angle;
    return;
  }
  const targetIdx = fc.tracked.indexOf(target);
  const wrap = view.wrapAim !== false;
  const lead = leadAngle(self, target, view.world, wrap);
  let best = { miss: Infinity, angle: lead };
  for (let j = -6; j <= 6; j++) {
    const angle = lead + j * 0.06;
    const r = simulateMissile(self, angle, fc, targetIdx, coast.path, wrap);
    if (!r.selfHit && r.miss < best.miss) best = { miss: r.miss, angle };
  }
  p.angle = best.angle + (rng() - 0.5) * 2 * PLAN.aimNoise;
  const { dx, dy } = towards(self, target, view.world, wrap);
  p.fire = best.miss <= 2 && Math.hypot(dx, dy) < PLAN.range;
}

function score(hitTime, turn, thrust) {
  // Survive as long as possible; among equally safe options prefer small
  // turns and short burns.
  const survive = Math.min(hitTime, PLAN.horizon + 1);
  return survive * 10 - turn * 0.5 - thrust * 0.3;
}

function desiredVelocity(self, view) {
  const { world } = view;
  let x = 0;
  let y = 0;
  const target = view.target;
  if (target) {
    // Close in the way the pilot will shoot: across the screen unless wrap aiming.
    const { dx, dy } = towards(self, target, world, view.wrapAim !== false);
    const d = Math.hypot(dx, dy) || 1;
    const speed = Math.max(-PLAN.cruise, Math.min(PLAN.cruise, 0.6 * (d - PLAN.standoff)));
    x += (dx / d) * speed;
    y += (dy / d) * speed;
  }
  // Keep clear of planets and moons.
  for (const s of view.solids) {
    const dx = wrapDelta(self.x - s.x, world.w);
    const dy = wrapDelta(self.y - s.y, world.h);
    const d = Math.hypot(dx, dy) || 1;
    const reach = s.radius + 180;
    if (d < reach) {
      const push = 90 * (1 - d / reach);
      x += (dx / d) * push;
      y += (dy / d) * push;
    }
  }
  return { x, y };
}
