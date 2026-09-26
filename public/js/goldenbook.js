// Golden book: the top 10 scores of each level, kept by the server.

import { LEVELS } from './levels.js';

const API = 'api/goldenbook'; // relative, so the game also works under a sub-path
const TOP = 10;

export async function fetchBook() {
  const res = await fetch(API, { cache: 'no-store' });
  if (!res.ok) throw new Error(`golden book unavailable (${res.status})`);
  return (await res.json()).levels;
}

/** Resolves to { rank, levels } or throws with the server's message. */
export async function signBook(entry) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `could not save (${res.status})`);
  return body;
}

export function qualifies(top, score) {
  return score > 0 && (top.length < TOP || score > top[top.length - 1].score);
}

const tabs = document.getElementById('book-tabs');
const rows = document.getElementById('book-rows');
const empty = document.getElementById('book-empty');
let levels = {};
let shownLevel = LEVELS[0].id;
let highlight = null;

/** Fill the golden book screen; `mine` highlights a just-signed entry. */
export function renderBook(data, levelId = shownLevel, mine = highlight) {
  levels = data || levels;
  shownLevel = levelId;
  highlight = mine;
  tabs.replaceChildren(
    ...LEVELS.map((lvl) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.role = 'tab';
      b.textContent = `${lvl.id}. ${lvl.name}`;
      b.setAttribute('aria-selected', String(lvl.id === levelId));
      b.addEventListener('click', () => renderBook(null, lvl.id));
      return b;
    }),
  );
  const list = levels[levelId] || [];
  rows.replaceChildren(
    ...list.map((e, i) => {
      const tr = document.createElement('tr');
      if (mine && e.date === mine.date && e.nickname === mine.nickname) tr.className = 'mine';
      const cells = [i + 1, e.nickname, e.score, e.comment, new Date(e.date).toLocaleDateString()];
      for (const c of cells) {
        const td = document.createElement('td');
        td.textContent = c; // user text is never parsed as HTML
        tr.append(td);
      }
      return tr;
    }),
  );
  empty.hidden = list.length > 0;
}

export function showBookError(message) {
  rows.replaceChildren();
  empty.hidden = false;
  empty.textContent = message;
}
