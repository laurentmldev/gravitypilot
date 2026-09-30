import test from 'node:test';
import assert from 'node:assert/strict';
import { stepBodies, distance, circularSpeed } from '../public/js/physics.js';
import { SHIP, MISSILE, steer, missileLaunch } from '../public/js/ship.js';
import { createPilot, pilot, leadAngle } from '../public/js/ai.js';

const DT = 1 / 120;

function seeded(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function alienAt(x, y, vx, vy, angle = 0) {
  return { kind: 'alien', x, y, vx, vy, angle, ax: 0, ay: 0, radius: SHIP.radius, mass: 0, fireCooldown: 0, pilot: createPilot() };
}

/**
 * Minimal copy of the game rules: the alien is flown only through the same
 * commands as the player, and dies on contact with any solid or armed missile.
 */
function run({ world, solids = [], alien, target = null, seconds, usePilot = true }) {
  const rng = seeded(42);
  const missiles = [];
  const result = { alienDead: false, targetHit: false, shots: 0 };
  for (let t = 0; t < seconds; t += DT) {
    const ships = [alien, ...(target ? [target] : [])];
    const view = { world, sources: solids, solids, missiles, ships, target };
    const cmd = usePilot ? pilot(alien, view, DT, rng) : {};
    steer(alien, cmd, DT);
    alien.fireCooldown -= DT;
    if (cmd.fire && alien.fireCooldown <= 0 && missiles.length < MISSILE.maxPerShip) {
      missiles.push({ kind: 'missile', ...missileLaunch(alien), radius: MISSILE.radius, mass: 0, gravity: MISSILE.gravity, life: MISSILE.life, owner: alien });
      alien.fireCooldown = MISSILE.cooldown;
      result.shots++;
    }
    stepBodies([...solids, ...ships, ...missiles], solids, world, DT);
    for (const m of missiles) m.life -= DT;
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      if (m.life <= 0 || solids.some((s) => distance(m, s, world) < s.radius + m.radius)) {
        missiles.splice(i, 1);
      } else if (target && distance(m, target, world) < target.radius + m.radius) {
        result.targetHit = true;
        return result;
      } else if (MISSILE.life - m.life > MISSILE.armTime && distance(m, alien, world) < alien.radius + m.radius) {
        result.alienDead = 'own missile';
        return result;
      }
    }
    if (solids.some((s) => distance(alien, s, world) < s.radius + alien.radius)) {
      result.alienDead = 'crashed';
      return result;
    }
  }
  return result;
}

function planetAndMoon(world) {
  const planet = { kind: 'planet', x: world.w / 2, y: world.h / 2, vx: 0, vy: 0, radius: 52, mass: 3.2e6 };
  const v = circularSpeed(planet.mass + 1.6e5, 190);
  const moon = { kind: 'moon', x: planet.x, y: planet.y - 190, vx: v, vy: 0, radius: 15, mass: 1.6e5 };
  return [planet, moon];
}

test('lead angle hits a target moving across', () => {
  const self = { x: 0, y: 0, vx: 0, vy: 0 };
  const target = { x: 300, y: 0, vx: 0, vy: 100 };
  const a = leadAngle(self, target, { w: 2000, h: 2000 });
  assert.ok(a > 0.2 && a < 0.4, `angle ${a}`);
});

test('an alien falling onto a planet steers clear of it', () => {
  const world = { w: 1280, h: 800 };
  const solids = () => planetAndMoon(world).slice(0, 1);
  const start = () => alienAt(world.w / 2 - 250, world.h / 2, 60, 0);
  // Without a pilot the same ship crashes...
  assert.equal(run({ world, solids: solids(), alien: start(), seconds: 20, usePilot: false }).alienDead, 'crashed');
  // ...with the pilot it survives.
  assert.equal(run({ world, solids: solids(), alien: start(), seconds: 20 }).alienDead, false);
});

test('an alien shoots down a drifting target in open space', () => {
  const world = { w: 1280, h: 800 };
  const target = { kind: 'ship', x: 900, y: 300, vx: -20, vy: 30, radius: SHIP.radius, mass: 0, angle: 0 };
  const r = run({ world, alien: alienAt(300, 500, 0, 0), target, seconds: 15 });
  assert.equal(r.alienDead, false);
  assert.ok(r.targetHit, `no hit after ${r.shots} shots`);
});

test('an alien hunts a player orbiting a planet with a moon and survives', () => {
  const world = { w: 1280, h: 800 };
  const solids = planetAndMoon(world);
  const [planet] = solids;
  const target = {
    kind: 'ship', x: planet.x - 310, y: planet.y, vx: 0, vy: -circularSpeed(planet.mass, 310),
    radius: SHIP.radius, mass: 0, angle: 0,
  };
  const r = run({ world, solids, alien: alienAt(100, 100, 0, 0), target, seconds: 40 });
  assert.equal(r.alienDead, false);
  assert.ok(r.shots > 0, 'the alien should have fired');
});
