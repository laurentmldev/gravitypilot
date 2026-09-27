// Pilot setup: ship designs, keyboard layouts and the remembered choices.

export const SHIPS = [
  { id: 'arrow', name: 'Arrow', file: 'ship.svg', color: '#6aa9ff' },
  { id: 'dart', name: 'Dart', file: 'ship-dart.svg', color: '#ff8a4c' },
  { id: 'falcon', name: 'Falcon', file: 'ship-falcon.svg', color: '#3fd07a' },
  { id: 'hornet', name: 'Hornet', file: 'ship-hornet.svg', color: '#f2b705' },
  { id: 'raven', name: 'Raven', file: 'ship-raven.svg', color: '#ff5cc8' },
];

export const shipById = (id) => SHIPS.find((s) => s.id === id) || SHIPS[0];

// Keys are bound by physical position (KeyboardEvent.code), so the defaults
// sit in the same place on every layout: WASD on QWERTY is ZQSD on AZERTY.
// Labels follow the player's actual layout (see keyLabel).
export const ACTIONS = [
  { id: 'left', label: 'Turn left' },
  { id: 'right', label: 'Turn right' },
  { id: 'thrust', label: 'Thrust' },
  { id: 'fire', label: 'Fire' },
];

export const DEFAULT_KEYS = [
  { left: ['ArrowLeft'], right: ['ArrowRight'], thrust: ['ArrowUp'], fire: ['Space', 'ArrowDown'] },
  { left: ['KeyA'], right: ['KeyD'], thrust: ['KeyW'], fire: ['KeyS'] },
];

// Keys the game itself uses: pause, confirm and cancel.
export const RESERVED_KEYS = ['Escape', 'Enter', 'NumpadEnter', 'KeyP', 'Tab'];

const copyKeys = (b) => Object.fromEntries(ACTIONS.map((a) => [a.id, [...b[a.id]]]));
const sameKeys = (a, b) => ACTIONS.every((x) => a[x.id].join() === b[x.id].join());

/** The bindings pilot `i` flies with. */
export function keysOf(setup, i) {
  return setup.keys?.[i] || DEFAULT_KEYS[i];
}

export function isDefaultKeys(setup, i) {
  return !setup.keys?.[i];
}

export function resetKeys(setup, i) {
  setup.keys = [0, 1].map((j) => (j === i ? null : setup.keys?.[j] || null));
}

/** The action a key drives in a set of bindings, or null. */
export function actionOf(bindings, code) {
  for (const a of ACTIONS) if (bindings[a.id].includes(code)) return a.id;
  return null;
}

/**
 * Bind `code` to pilot `i`'s `action`. A key that was already taken moves over,
 * and whatever lost it gets the replaced key(s) back, so nothing is left unbound.
 * Returns an error message, or null.
 */
export function bindKey(setup, i, action, code) {
  if (RESERVED_KEYS.includes(code)) return `${keyLabel(code)} is reserved.`;
  const all = [0, 1].map((j) => copyKeys(keysOf(setup, j)));
  const old = all[i][action];
  if (old.length === 1 && old[0] === code) return null;
  for (let j = 0; j < 2; j++) {
    const other = actionOf(all[j], code);
    if (!other || (j === i && other === action)) continue;
    all[j][other] = all[j][other].filter((c) => c !== code);
    if (!all[j][other].length) all[j][other] = old.filter((c) => c !== code);
  }
  all[i][action] = [code];
  setup.keys = all.map((b, j) => (sameKeys(b, DEFAULT_KEYS[j]) ? null : b));
  return null;
}

function cleanKeys(saved) {
  if (!saved || typeof saved !== 'object') return null;
  const b = {};
  for (const a of ACTIONS) {
    const list = Array.isArray(saved[a.id]) ? saved[a.id].filter((c) => typeof c === 'string' && c.length < 32) : [];
    if (!list.length) return null;
    b[a.id] = list.slice(0, 2);
  }
  return b;
}

// --- Keyboard layout -------------------------------------------------------

const NAMED = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space',
  ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'Alt', AltRight: 'AltGr', Backspace: '⌫', CapsLock: 'Caps',
};
// Letters that move on AZERTY, used until the real layout is known.
const AZERTY = { KeyQ: 'A', KeyA: 'Q', KeyW: 'Z', KeyZ: 'W', Semicolon: 'M', KeyM: ',' };
const learned = new Map();
let layout = 'qwerty';

/** Best guess of the layout before any key is pressed. */
export function guessLayout(langs = typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language]) {
  const lang = String(langs[0] || '').toLowerCase();
  // French and Belgian keyboards are AZERTY; Canada and Switzerland are not.
  return /^fr(-(fr|be|lu|mc))?$/.test(lang) || lang === 'nl-be' ? 'azerty' : 'qwerty';
}

export function currentLayout() {
  return layout;
}

/** Remember what a physical key types, from a real key press. Returns true when the layout changed. */
export function learnKey(code, key) {
  if (!code || typeof key !== 'string' || key.length !== 1 || key === ' ') return false;
  learned.set(code, key.toUpperCase());
  const before = layout;
  if (code === 'KeyQ' || code === 'KeyW') layout = /[AZ]/i.test(key) ? 'azerty' : 'qwerty';
  return layout !== before;
}

/** Ask the browser for the real layout where it can tell (Chromium). */
export async function detectLayout() {
  layout = guessLayout();
  try {
    const map = await navigator.keyboard?.getLayoutMap?.();
    if (!map) return layout;
    for (const [code, key] of map) learnKey(code, key);
  } catch {
    /* not allowed here, keep the guess */
  }
  return layout;
}

/** What is printed on the key with this physical code. */
export function keyLabel(code) {
  if (NAMED[code]) return NAMED[code];
  if (learned.has(code)) return learned.get(code);
  if (layout === 'azerty' && AZERTY[code]) return AZERTY[code];
  return code.replace(/^(Key|Digit)/, '').replace(/^Numpad/, 'Num ');
}

/** "← → turn · ↑ thrust · Space / ↓ fire" for a set of bindings. */
export function keysHelp(bindings) {
  const k = (id) => bindings[id].map(keyLabel).join(' / ');
  return `${k('left')} ${k('right')} turn · ${k('thrust')} thrust · ${k('fire')} fire`;
}

// Play styles. A single pilot always plays "solo".
export const STYLES = {
  solo: { label: 'Solo', book: 'solo' },
  team: { label: 'Team', book: 'duo', help: 'One shared score. A few more aliens show up.' },
  versus: { label: 'Versus', book: null, help: 'Each pilot scores alone, and shooting the other pilot scores too. No golden book.' },
};

export const NAME_MAX = 20;
const STORE = 'gravitypilot.setup';

export function defaultSetup() {
  return { count: 1, mode: 'team', names: ['', ''], ships: ['arrow', 'dart'], keys: [null, null] };
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
      keys: [0, 1].map((i) => cleanKeys(saved.keys?.[i])),
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
