import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapDelta, wrapPosition, accelerationAt, stepBodies, circularSpeed } from '../public/js/physics.js';

const world = { w: 1000, h: 800 };

test('wrapDelta takes the short way around', () => {
  assert.equal(wrapDelta(100, 1000), 100);
  assert.equal(wrapDelta(900, 1000), -100);
  assert.equal(wrapDelta(-900, 1000), 100);
});

test('a body leaving the window reappears on the opposite side', () => {
  const b = { x: 1005, y: -3 };
  wrapPosition(b, world);
  assert.equal(b.x, 5);
  assert.equal(b.y, 797);
});

test('gravity points at the source and follows the inverse square law', () => {
  const planet = { x: 500, y: 400, mass: 1e6, radius: 30 };
  const near = accelerationAt({ x: 400, y: 400 }, [planet], world);
  const far = accelerationAt({ x: 300, y: 400 }, [planet], world);
  assert.ok(near.ax > 0);
  assert.equal(near.ay, 0);
  assert.ok(Math.abs(near.ax / far.ax - 4) < 1e-9);
});

test('gravity acts across the window edges', () => {
  const planet = { x: 980, y: 400, mass: 1e6, radius: 30 };
  const { ax } = accelerationAt({ x: 20, y: 400 }, [planet], world);
  assert.ok(ax < 0, 'the nearest image of the planet is to the left');
});

test('a body does not attract itself', () => {
  const planet = { x: 500, y: 400, mass: 1e6, radius: 30 };
  assert.deepEqual(accelerationAt(planet, [planet], world, planet), { ax: 0, ay: 0 });
});

test('without thrust or gravity a ship keeps its speed', () => {
  const ship = { x: 100, y: 100, vx: 30, vy: -10 };
  for (let i = 0; i < 120; i++) stepBodies([ship], [], world, 1 / 120);
  assert.equal(ship.vx, 30);
  assert.equal(ship.vy, -10);
  assert.ok(Math.abs(ship.x - 130) < 1e-9);
});

test('thrust accelerates in its direction', () => {
  const ship = { x: 100, y: 100, vx: 0, vy: 0, ax: 0, ay: -100 };
  for (let i = 0; i < 120; i++) stepBodies([ship], [], world, 1 / 120);
  assert.ok(Math.abs(ship.vy + 100) < 1e-9);
});

test('a circular orbit stays circular over several revolutions', () => {
  const big = { w: 4000, h: 4000 };
  const planet = { x: 2000, y: 2000, vx: 0, vy: 0, mass: 3e6, radius: 50 };
  const r = 250;
  const v = circularSpeed(planet.mass, r);
  const sat = { x: 2000 + r, y: 2000, vx: 0, vy: v };
  const period = (2 * Math.PI * r) / v;
  const steps = Math.round((3 * period) / (1 / 120));
  for (let i = 0; i < steps; i++) stepBodies([sat], [planet], big, 1 / 120);
  const d = Math.hypot(sat.x - 2000, sat.y - 2000);
  assert.ok(Math.abs(d - r) / r < 0.01, `radius drifted to ${d}`);
});
