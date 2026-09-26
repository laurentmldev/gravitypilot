import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

async function start(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldenbook-'));
  const file = path.join(dir, 'sub', 'goldenbook.txt');
  const server = createApp({ goldenBookFile: file }).listen(0);
  t.after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/goldenbook`;
  const post = (body, ip = '10.0.0.1') =>
    fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify(body),
    });
  return { file, base, post };
}

test('entries are ranked per level and saved as text lines', async (t) => {
  const { file, base, post } = await start(t);
  const empty = await (await fetch(base)).json();
  assert.deepEqual(empty.levels, { 1: [], 2: [], 3: [], 4: [] });

  let res = await post({ level: 2, score: 300, nickname: 'Ada', comment: 'nice orbit' });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).rank, 1);
  res = await post({ level: 2, score: 500, nickname: 'Bob', comment: '' });
  assert.equal((await res.json()).rank, 1);

  const { levels } = await (await fetch(base)).json();
  assert.deepEqual(levels[2].map((e) => e.nickname), ['Bob', 'Ada']);
  assert.equal(levels[1].length, 0);

  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).nickname, 'Ada');
});

test('only a top-10 score can sign, and the book survives a restart', async (t) => {
  const { file, post } = await start(t);
  for (let i = 1; i <= 10; i++) {
    const res = await post({ level: 1, score: i * 100, nickname: `P${i}` }, `10.0.1.${i}`);
    assert.equal(res.status, 201);
  }
  const low = await post({ level: 1, score: 100, nickname: 'Late' }, '10.0.2.1');
  assert.equal(low.status, 409);
  const high = await post({ level: 1, score: 150, nickname: 'Better' }, '10.0.2.2');
  assert.equal((await high.json()).rank, 10);

  const again = createApp({ goldenBookFile: file }).listen(0);
  t.after(() => again.close());
  await new Promise((r) => again.once('listening', r));
  const { levels } = await (await fetch(`http://127.0.0.1:${again.address().port}/api/goldenbook`)).json();
  assert.equal(levels[1].length, 10);
  assert.equal(levels[1][9].nickname, 'Better');
});

test('bad input is rejected and text is cleaned', async (t) => {
  const { post } = await start(t);
  assert.equal((await post({ level: 9, score: 10, nickname: 'x' })).status, 400);
  assert.equal((await post({ level: 1, score: -5, nickname: 'x' })).status, 400);
  assert.equal((await post({ level: 1, score: 1.5, nickname: 'x' })).status, 400);
  assert.equal((await post({ level: 1, score: 10, nickname: '   ' })).status, 400);
  const res = await post({ level: 1, score: 10, nickname: 'a\nb'.padEnd(40, 'z'), comment: 'x'.repeat(500) }, '10.0.3.1');
  const { levels } = await res.json();
  const e = levels[1][0];
  assert.equal(e.nickname.length, 20);
  assert.ok(!e.nickname.includes('\n'));
  assert.equal(e.comment.length, 200);
});

test('submissions are rate limited per client', async (t) => {
  const { post } = await start(t);
  for (let i = 0; i < 5; i++) assert.equal((await post({ level: 3, score: 10 + i, nickname: 'spam' }, '10.9.9.9')).status, 201);
  assert.equal((await post({ level: 3, score: 99, nickname: 'spam' }, '10.9.9.9')).status, 429);
  assert.equal((await post({ level: 3, score: 99, nickname: 'other' }, '10.9.9.8')).status, 201);
});
