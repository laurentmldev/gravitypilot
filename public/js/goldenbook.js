// Golden book: the top 10 scores of each level, kept by the server. Solo
// games and two-pilot team games ("duo") have separate books.

import { LEVELS } from './levels.js';

const API = 'api/goldenbook'; // relative, so the game also works under a sub-path
const TOP = 10;
const BOOKS = [
  { id: 'solo', label: 'Solo' },
  { id: 'duo', label: 'Two pilots' },
];

/** Resolves to { solo: { 1: [...], ... }, duo: { ... } }. */
export async function fetchBook() {
  const res = await fetch(API, { cache: 'no-store' });
  if (!res.ok) throw new Error(`golden book unavailable (${res.status})`);
  return (await res.json()).books;
}

/** Resolves to { rank, books } or throws with the server's message. */
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

const modeTabs = document.getElementById('book-modes');
const tabs = document.getElementById('book-tabs');
const rows = document.getElementById('book-rows');
const empty = document.getElementById('book-empty');
let books = {};
let shown = { mode: 'solo', level: LEVELS[0].id, mine: null };

function tab(label, selected, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.role = 'tab';
  b.textContent = label;
  b.setAttribute('aria-selected', String(selected));
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Fill the golden book screen. `data` replaces the cached books when given;
 * `view` picks { mode, level } and `mine` highlights a just-signed entry.
 */
export function renderBook(data, view = {}) {
  if (data) books = data;
  shown = { ...shown, ...view };
  const { mode, level, mine } = shown;
  modeTabs.replaceChildren(
    ...BOOKS.map((b) => tab(b.label, b.id === mode, () => renderBook(null, { mode: b.id, mine: null }))),
  );
  tabs.replaceChildren(
    ...LEVELS.map((lvl) => tab(`${lvl.id}. ${lvl.name}`, lvl.id === level, () => renderBook(null, { level: lvl.id }))),
  );
  const list = books[mode]?.[level] || [];
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
  empty.textContent = 'No entries yet for this level.';
  empty.hidden = list.length > 0;
}

export function showBookError(message) {
  rows.replaceChildren();
  empty.hidden = false;
  empty.textContent = message;
}
