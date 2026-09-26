import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('server serves the game and a health check', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Gravity Pilot/);

  const js = await fetch(`${base}/js/physics.js`);
  assert.match(js.headers.get('content-type'), /javascript/);
});
