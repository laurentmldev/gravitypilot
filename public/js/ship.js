// Ship rules shared by the player and the aliens: both fly with exactly the
// same three commands (turn, thrust, fire). A ship may carry its own
// `turnRate`, `thrust` and `size` (the alien destroyer is big and slow);
// otherwise the SHIP values apply.

export const SHIP = { radius: 12, size: 38, turnRate: 3.6, thrust: 170 };
export const MISSILE = {
  speed: 340,
  life: 5.6,
  radius: 3,
  size: 10,
  cooldown: 0.22,
  maxPerShip: 8,
  // A fresh missile cannot hit the ship that fired it, so it can clear the nose.
  armTime: 0.3,
  // Missiles feel gravity a bit more than ships do, so shots curve visibly.
  gravity: 1.35,
};

// Lock-on: keep the nose on an enemy ship for `time` seconds and the next
// missile is slightly guided toward it. Guidance is weak and short-lived, so
// a pilot who keeps moving can still dodge it.
export const LOCK = {
  time: 2,
  cone: 0.2, // radians of slack around the target's bearing
  range: 650,
  decay: 3, // looking away drains the lock this many times faster than it builds
  homing: { accel: 110, time: 3.5, cone: 1.2 },
};

/** Normalise an angle to (-π, π]. */
export function angleDiff(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Apply one step of pilot commands: rotation and engine thrust.
 * `cmd` is { left, right, thrust, fire }; gravity is added by the physics step.
 */
export function steer(ship, cmd, dt) {
  const turn = turnRateOf(ship) * dt;
  if (cmd.left) ship.angle -= turn;
  if (cmd.right) ship.angle += turn;
  ship.thrusting = !!cmd.thrust;
  ship.ax = cmd.thrust ? Math.cos(ship.angle) * thrustOf(ship) : 0;
  ship.ay = cmd.thrust ? Math.sin(ship.angle) * thrustOf(ship) : 0;
}

export const turnRateOf = (ship) => ship.turnRate ?? SHIP.turnRate;
export const thrustOf = (ship) => ship.thrust ?? SHIP.thrust;
export const sizeOf = (ship) => ship.size ?? SHIP.size;

/** Where a missile fired now would start, and its velocity. */
export function missileLaunch(ship, angle = ship.angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const nose = sizeOf(ship) * 0.45;
  return {
    x: ship.x + cos * nose,
    y: ship.y + sin * nose,
    vx: ship.vx + cos * MISSILE.speed,
    vy: ship.vy + sin * MISSILE.speed,
  };
}

/** Turn commands that bring the ship's heading toward `target` without overshooting. */
export function turnToward(ship, target, dt) {
  const d = angleDiff(target - ship.angle);
  const deadband = turnRateOf(ship) * dt;
  return { left: d < -deadband, right: d > deadband, error: Math.abs(d) };
}
