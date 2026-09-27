import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_KEYS,
  defaultSetup,
  keysOf,
  bindKey,
  resetKeys,
  actionOf,
  guessLayout,
  learnKey,
  keyLabel,
} from '../public/js/pilots.js';

test('rebinding moves a taken key and hands back the replaced one', () => {
  const setup = defaultSetup();
  // Pilot 1 takes W for thrust: pilot 2 loses W and gets ↑ instead.
  assert.equal(bindKey(setup, 0, 'thrust', 'KeyW'), null);
  assert.deepEqual(keysOf(setup, 0).thrust, ['KeyW']);
  assert.deepEqual(keysOf(setup, 1).thrust, ['ArrowUp']);
  // Moving a key within one pilot swaps the two actions.
  bindKey(setup, 0, 'left', 'ArrowRight');
  assert.deepEqual(keysOf(setup, 0).left, ['ArrowRight']);
  assert.deepEqual(keysOf(setup, 0).right, ['ArrowLeft']);
  // Every action of both pilots still has a key, and no key drives two actions.
  const seen = new Set();
  for (const i of [0, 1]) {
    for (const codes of Object.values(keysOf(setup, i))) {
      assert.ok(codes.length > 0);
      for (const c of codes) {
        assert.ok(!seen.has(c), c);
        seen.add(c);
      }
    }
  }
  resetKeys(setup, 0);
  assert.deepEqual(keysOf(setup, 0), DEFAULT_KEYS[0]);
});

test('reserved keys cannot be bound, and bindings back at default are stored as default', () => {
  const setup = defaultSetup();
  assert.match(bindKey(setup, 1, 'fire', 'KeyP'), /reserved/);
  assert.equal(actionOf(keysOf(setup, 1), 'KeyS'), 'fire');
  bindKey(setup, 1, 'fire', 'KeyE');
  bindKey(setup, 1, 'fire', 'KeyS');
  assert.equal(setup.keys[1], null);
});

test('labels follow the keyboard layout', () => {
  assert.equal(guessLayout(['fr-FR']), 'azerty');
  assert.equal(guessLayout(['fr-CA']), 'qwerty');
  assert.equal(guessLayout(['en-US']), 'qwerty');
  assert.equal(keyLabel('ArrowUp'), '↑');
  learnKey('KeyW', 'z');
  assert.equal(keyLabel('KeyW'), 'Z');
  assert.equal(keyLabel('KeyQ'), 'A'); // not typed yet, guessed from AZERTY
});
