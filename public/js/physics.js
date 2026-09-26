// Newtonian gravity in a toroidal (wrap-around) world.
// Units: pixels and seconds. A body's `mass` is its gravitational parameter
// (G * M), so the acceleration it causes at distance r is mass / r².

/** Shortest signed distance from 0 to d on a wrapping axis of length `size`. */
export function wrapDelta(d, size) {
  if (d > size / 2) return d - size;
  if (d < -size / 2) return d + size;
  return d;
}

/** Shortest vector from a to b, taking wrap-around into account. */
export function delta(a, b, world) {
  return { dx: wrapDelta(b.x - a.x, world.w), dy: wrapDelta(b.y - a.y, world.h) };
}

export function distance(a, b, world) {
  const { dx, dy } = delta(a, b, world);
  return Math.hypot(dx, dy);
}

/** Put a body that left the window back on the opposite side. */
export function wrapPosition(body, world) {
  if (body.x < 0) body.x += world.w;
  else if (body.x >= world.w) body.x -= world.w;
  if (body.y < 0) body.y += world.h;
  else if (body.y >= world.h) body.y -= world.h;
}

/**
 * Gravitational acceleration at `point` caused by every source except `self`.
 * Inside a source's radius the pull is capped at its surface value, which
 * keeps the integration stable during the frame a collision is detected.
 */
export function accelerationAt(point, sources, world, self = null) {
  let ax = 0;
  let ay = 0;
  for (const s of sources) {
    if (s === self || !s.mass) continue;
    const { dx, dy } = delta(point, s, world);
    const r = Math.hypot(dx, dy);
    if (r === 0) continue;
    const rMin = s.radius || 1;
    const rEff = Math.max(r, rMin);
    const a = s.mass / (rEff * rEff);
    ax += (a * dx) / r;
    ay += (a * dy) / r;
  }
  return { ax, ay };
}

/**
 * Advance every body by dt with semi-implicit Euler (symplectic, so orbits
 * stay closed over long runs). Accelerations are all computed before any
 * body moves. A body's own `ax`/`ay` (e.g. engine thrust) is added to gravity.
 * Bodies with `wrap: false` are allowed to leave the window.
 */
export function stepBodies(bodies, sources, world, dt) {
  const acc = bodies.map((b) => accelerationAt(b, sources, world, b));
  bodies.forEach((b, i) => {
    b.vx += (acc[i].ax + (b.ax || 0)) * dt;
    b.vy += (acc[i].ay + (b.ay || 0)) * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.wrap !== false) wrapPosition(b, world);
  });
}

/** Speed of a circular orbit of radius r around a body of gravitational parameter `mass`. */
export function circularSpeed(mass, r) {
  return Math.sqrt(mass / r);
}
