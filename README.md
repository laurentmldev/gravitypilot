# Gravity Pilot

A 2D space flight game for the browser. Pilot a ship with three commands (turn, thrust, fire) in a world where planets, moons, asteroids, missiles and your own ship all obey Newtonian gravity.

## How to play

| Action | Keyboard | Touch |
| --- | --- | --- |
| Turn left / right | `←` `→` (or `A` `D`) | ⟲ ⟳ buttons |
| Engine thrust (while held) | `↑` (or `W`) | THRUST button |
| Fire | `Space` (hold to keep firing) | FIRE button |
| Pause | `P` or `Esc` | ❚❚ button |

- Thrust pushes the ship in the direction it points; when you release it the ship keeps its speed.
- Leaving the window on one side brings you back on the opposite side.
- Shoot the green beacons (100 points) and asteroids (20, 50 or 100 points as they split into smaller rocks). Crashing into a planet, the moon or an asteroid costs one of your 3 ships.
- Best scores are kept per level in the browser.

### Levels

1. **Deep space**: no planet.
2. **Small planet**: one small planet.
3. **Planet and moon**: a bigger planet with a satellite in orbit.
4. **Asteroid field**: planet, satellite and asteroids passing by.

Gravity is computed between every pair of massive bodies (planet, moon, asteroids), and the ship, missiles and beacons are pulled by all of them. You start each level on a circular orbit around the planet.

## Development

Requires Node.js 20 or newer.

```sh
npm install
npm start        # http://localhost:8080
npm test
```

The game is plain JavaScript ES modules served as static files (`public/`), with no build step. Tuning values are at the top of `public/js/main.js` and in `public/js/levels.js`; the sprites are SVG files in `public/sprites/` and can be swapped freely.

## Production (Docker Compose)

```sh
docker compose up -d --build
```

The container serves plain HTTP on port 8080 and is meant to sit behind a reverse proxy that handles TLS. `GET /healthz` returns `{"status":"ok"}` for health checks.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST_PORT` | `8080` | Port published on the host |
| `BIND_ADDR` | `0.0.0.0` | Host address to bind; use `127.0.0.1` when the proxy runs on the same host |

All asset URLs are relative, so the game also works when the proxy serves it under a sub-path (for example `https://example.com/gravitypilot/`).
