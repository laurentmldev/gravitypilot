# Gravity Pilot

A 2D space flight game for the browser. Pilot a ship with three commands (turn, thrust, fire) in a world where planets, moons, asteroids, missiles and your own ship all obey Newtonian gravity.

## How to play

Pick a level, then register your nickname and choose one of 5 ships (Arrow, Dart, Falcon, Hornet, Raven) before taking off.

| Action | Pilot 1 | Pilot 2 | Touch (pilot 1) |
| --- | --- | --- | --- |
| Turn left / right | `←` `→` | `A` `D` (`Q` `D` on AZERTY) | ⟲ ⟳ buttons, or tilt the device |
| Engine thrust (while held) | `↑` | `W` (`Z` on AZERTY) | THRUST button |
| Fire (hold to keep firing) | `Space` or `↓` | `S` | FIRE button |
| Pause | `P` or `Esc` | | ❚❚ button |

A lone pilot can use either set of keys. Keys are bound by position, so pilot 2 flies with WASD on a QWERTY keyboard and ZQSD on an AZERTY one, and the labels on screen follow your layout. Each pilot can change their keys on the setup screen (click a key, then press the new one); `P`, `Esc`, `Enter` and `Tab` are reserved.

- Thrust pushes the ship in the direction it points; when you release it the ship keeps its speed.
- Leaving the window on one side brings you back on the opposite side.
- Missiles fly for 5.6 seconds and are pulled by gravity a bit more than ships (×1.35). They can hit your own ship once they are 0.3 seconds old, so watch out for shots that swing around a planet and come back.
- Alien ships appear from time to time and hunt you. They follow exactly the same rules as you: the same three commands, the same engine and turn rate, the same missiles, and they die from the same collisions (including their own missiles). Their autopilot (`public/js/ai.js`) simulates gravity a few seconds ahead to dodge planets, rocks and missiles, and to aim shots that curve under gravity.
- **Lock-on:** keep your nose on an enemy ship for 2 seconds and your next missile is slightly guided toward it. A square blinks around the target while the lock builds and turns red once it holds; each extra ship locking the same target adds a corner. Guidance is gentle and short, and it gives up if the target gets behind the missile, so a moving pilot can still dodge. Aliens lock onto you the same way, so watch for the square around your own ship.
- **Destroyer:** now and then a big alien destroyer shows up. It is twice the size of an alien ship and slower, fires missiles like the others, and also has a short-range laser that burns asteroids and beacons near it. It takes 3 hits (100 points each, 600 for the last), and 1 to 3 small aliens escape from the wreck.
- Aliens arrive more and more often as a game goes on, and one more may fly at a time every 2.5 minutes, so games don't last forever.
- Shoot the green beacons (100 points), asteroids (20, 50 or 100 points as they split into smaller rocks) and alien ships (250 points). Crashing into a planet, the moon, an asteroid or an alien, or being hit by a missile, costs one of your 3 ships.
- Your personal best for each level is kept in the browser.
- **Golden book:** when a game ends with a score in the top 10 of its level, you can sign the golden book (your nickname is filled in) and add a comment. Anyone can read it from the main menu. It is shared by everyone playing on the same server.

### Two pilots

Choose "2 pilots" on the setup screen to share the keyboard with a friend, in one of two modes (phones and tablets without a keyboard only offer 1 pilot):

- **Team:** one shared score, and slightly more aliens (one more at a time, arriving a quarter sooner). The game ends when both pilots are out of ships. Top scores go to a separate "Two pilots" golden book, signed as "Ada & Bob".
- **Versus:** each pilot has their own score, and shooting down the other pilot is worth 300 points. The game ends as soon as one pilot is out of ships, and the higher score wins. Versus games don't go in the golden book.

In both modes missiles and collisions hurt both pilots, just like for aliens, who hunt whichever pilot is closest.

### Phones and tablets

The on-screen buttons fly the ship. On the setup screen you can pick **Tilt to turn** instead of the turn buttons: hold the device like a steering wheel and lean it left or right (the harder the lean, the faster the turn). The way you hold it when the game starts or resumes counts as straight. Motion sensors need the site to be served over HTTPS, and iOS asks for permission the first time.

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

The game is plain JavaScript ES modules served as static files (`public/`), with no build step. Tuning values are at the top of `public/js/main.js` and in `public/js/levels.js`; the sprites are SVG files in `public/sprites/` and can be swapped freely (ship designs are listed in `public/js/pilots.js`).

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

All asset URLs are relative, so the game also works when the proxy serves it under a sub-path (for example `https://example.com/gravitypilot/`).
