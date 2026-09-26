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
- Missiles fly for 5.6 seconds and are pulled by gravity too. They can hit your own ship once they are 0.3 seconds old, so watch out for shots that swing around a planet and come back.
- Alien ships appear from time to time and hunt you. They follow exactly the same rules as you: the same three commands, the same engine and turn rate, the same missiles, and they die from the same collisions (including their own missiles). Their autopilot (`public/js/ai.js`) simulates gravity a few seconds ahead to dodge planets, rocks and missiles, and to aim shots that curve under gravity.
- Shoot the green beacons (100 points), asteroids (20, 50 or 100 points as they split into smaller rocks) and alien ships (250 points). Crashing into a planet, the moon, an asteroid or an alien, or being hit by a missile, costs one of your 3 ships.
- Your personal best for each level is kept in the browser.
- **Golden book:** when a game ends with a score in the top 10 of its level, you can sign the golden book with a nickname and a comment. Anyone can read it from the main menu. It is shared by everyone playing on the same server.

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
npm start        # http://localhost:8080 (golden book in ./data/goldenbook.txt)
npm test
```

The game is plain JavaScript ES modules served as static files (`public/`), with no build step. Tuning values are at the top of `public/js/main.js` and in `public/js/levels.js`; the sprites are SVG files in `public/sprites/` and can be swapped freely.

## Production (Docker Compose)

```sh
docker compose up -d --build
```

The container serves plain HTTP on port 8080 and is meant to sit behind a reverse proxy that handles TLS. `GET /healthz` returns `{"status":"ok"}` for health checks.

The golden book is stored on the host in `./data/goldenbook.txt` (next to `docker-compose.yml`), so it survives rebuilds and redeploys. It is a text file with one JSON entry per line, which you can back up, or edit by hand to remove an entry; restart the container after editing it. The container starts as root only to make that folder writable, then runs as the unprivileged `node` user.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST_PORT` | `8080` | Port published on the host |
| `BIND_ADDR` | `0.0.0.0` | Host address to bind; use `127.0.0.1` when the proxy runs on the same host |
| `DATA_DIR` | `./data` | Host folder holding `goldenbook.txt` |
| `APP_PORT` | `8080` | Port the server listens on inside the container |

### Behind nginx-proxy

[nginx-proxy](https://github.com/nginx-proxy/nginx-proxy) finds the game through `VIRTUAL_HOST`, but it can only forward to containers on a Docker network it is attached to. Otherwise it answers 502 with `no live upstreams`. `docker-compose.proxy.yml` adds that network and the `VIRTUAL_*` variables. Enable it in `.env`:

```sh
COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml
VIRTUAL_HOST=game.example.com
PROXY_NETWORK=nginx-proxy   # see: docker inspect <proxy container> -f '{{json .NetworkSettings.Networks}}'
BIND_ADDR=127.0.0.1         # optional: the host port is then only for local checks
```

Then `docker compose up -d --build` as usual.

All asset URLs are relative, so the game also works when the proxy serves it under a sub-path (for example `https://example.com/gravitypilot/`).
