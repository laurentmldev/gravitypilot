// Ship rules shared by the player and the aliens: both fly with exactly the
// same three commands (turn, thrust, fire) and the same limits.

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
  if (cmd.left) ship.angle -= SHIP.turnRate * dt;
  if (cmd.right) ship.angle += SHIP.turnRate * dt;
  ship.thrusting = !!cmd.thrust;
  ship.ax = cmd.thrust ? Math.cos(ship.angle) * SHIP.thrust : 0;
  ship.ay = cmd.thrust ? Math.sin(ship.angle) * SHIP.thrust : 0;
}

/** Where a missile fired now would start, and its velocity. */
export function missileLaunch(ship, angle = ship.angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const nose = SHIP.size * 0.45;
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
  const deadband = SHIP.turnRate * dt;
  return { left: d < -deadband, right: d > deadband, error: Math.abs(d) };
}
