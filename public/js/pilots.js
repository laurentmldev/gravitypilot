// Pilot setup: ship designs, keyboard layouts and the remembered choices.

export const SHIPS = [
  { id: 'arrow', name: 'Arrow', file: 'ship.svg', color: '#6aa9ff' },
  { id: 'dart', name: 'Dart', file: 'ship-dart.svg', color: '#ff8a4c' },
  { id: 'falcon', name: 'Falcon', file: 'ship-falcon.svg', color: '#3fd07a' },
  { id: 'hornet', name: 'Hornet', file: 'ship-hornet.svg', color: '#f2b705' },
  { id: 'raven', name: 'Raven', file: 'ship-raven.svg', color: '#ff5cc8' },
];

export const shipById = (id) => SHIPS.find((s) => s.id === id) || SHIPS[0];

// Two pilots share one keyboard: pilot 1 on the arrows, pilot 2 on WASD.
export const KEYSETS = [
  {
    keys: { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'thrust', Space: 'fire', ArrowDown: 'fire' },
    help: '← → turn · ↑ thrust · Space or ↓ fire',
  },
  {
    keys: { KeyA: 'left', KeyD: 'right', KeyW: 'thrust', KeyS: 'fire' },
    help: 'A D turn · W thrust · S fire',
  },
];

// Play styles. A single pilot always plays "solo".
export const STYLES = {
  solo: { label: 'Solo', book: 'solo' },
  team: { label: 'Team', book: 'duo', help: 'One shared score. A few more aliens show up.' },
  versus: { label: 'Versus', book: null, help: 'Each pilot scores alone, and shooting the other pilot scores too. No golden book.' },
};

export const NAME_MAX = 20;
const STORE = 'gravitypilot.setup';

export function defaultSetup() {
  return { count: 1, mode: 'team', names: ['', ''], ships: ['arrow', 'dart'] };
}

export function loadSetup() {
  const d = defaultSetup();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!saved) {
      // Carry over the nickname used for the golden book before pilots existed.
      d.names[0] = localStorage.getItem('gravitypilot.nickname') || '';
      return d;
    }
    return {
      count: saved.count === 2 ? 2 : 1,
      mode: saved.mode === 'versus' ? 'versus' : 'team',
      names: [0, 1].map((i) => String(saved.names?.[i] ?? '').slice(0, NAME_MAX)),
      ships: [0, 1].map((i) => shipById(saved.ships?.[i] ?? d.ships[i]).id),
    };
  } catch {
    return d;
  }
}

export function saveSetup(setup) {
  try {
    localStorage.setItem(STORE, JSON.stringify(setup));
  } catch {
    /* storage unavailable */
  }
}

/** The play style for a setup: solo, team or versus. */
export function styleOf(setup) {
  return setup.count === 2 ? setup.mode : 'solo';
}

/** Returns an error message, or null when the pilots are ready to fly. */
export function validateSetup(setup) {
  const names = setup.names.slice(0, setup.count).map((n) => n.trim());
  if (names.some((n) => !n)) return setup.count === 2 ? 'Both pilots need a nickname.' : 'Enter your nickname.';
  if (setup.count === 2 && names[0].toLowerCase() === names[1].toLowerCase()) return 'Pick two different nicknames.';
  if (setup.count === 2 && setup.ships[0] === setup.ships[1]) return 'Pick two different ships.';
  return null;
}
