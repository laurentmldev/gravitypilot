import fs from 'node:fs';
import path from 'node:path';

// The golden book is a plain text file with one JSON entry per line, so it can
// be read, backed up or edited by hand on the host. Entries are appended; the
// top 10 per level is computed when reading.

export const LEVEL_IDS = [1, 2, 3, 4];
export const TOP = 10;
export const LIMITS = { nickname: 20, comment: 200, score: 10_000_000 };

/** Remove control characters and trim. */
function clean(text, max) {
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .trim()
    .slice(0, max);
}

/** Validate a submission; returns { entry } or { error }. */
export function validate(body) {
  const level = Number(body?.level);
  const score = Number(body?.score);
  const nickname = clean(body?.nickname, LIMITS.nickname);
  const comment = clean(body?.comment, LIMITS.comment);
  if (!LEVEL_IDS.includes(level)) return { error: 'invalid level' };
  if (!Number.isInteger(score) || score <= 0 || score > LIMITS.score) return { error: 'invalid score' };
  if (!nickname) return { error: 'nickname required' };
  return { entry: { level, score, nickname, comment } };
}

/** Best first; on equal scores the earlier entry keeps its place. */
function rank(entries) {
  return [...entries].sort((a, b) => b.score - a.score || a.date.localeCompare(b.date)).slice(0, TOP);
}

/** Does `score` make it into a top-10 list? */
export function qualifies(top, score) {
  return score > 0 && (top.length < TOP || score > top[top.length - 1].score);
}

export class GoldenBook {
  constructor(file) {
    this.file = file;
    this.entries = [];
    this.writing = Promise.resolve();
    this.load();
  }

  load() {
    let text = '';
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    this.entries = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (LEVEL_IDS.includes(e.level) && Number.isFinite(e.score)) this.entries.push(e);
      } catch {
        /* skip a corrupted line rather than losing the whole book */
      }
    }
  }

  /** Top 10 of every level: { "1": [...], "2": [...], ... } */
  top() {
    const out = {};
    for (const id of LEVEL_IDS) out[id] = rank(this.entries.filter((e) => e.level === id));
    return out;
  }

  /** Add an entry if it makes the top 10. Resolves to its rank (1-10) or null. */
  async add({ level, score, nickname, comment }) {
    const top = this.top()[level];
    if (!qualifies(top, score)) return null;
    const entry = { level, score, nickname, comment, date: new Date().toISOString() };
    this.entries.push(entry);
    // Serialise appends so concurrent submissions never interleave in the file.
    this.writing = this.writing.then(async () => {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      await fs.promises.appendFile(this.file, `${JSON.stringify(entry)}\n`, 'utf8');
    });
    await this.writing;
    return this.top()[level].indexOf(entry) + 1;
  }
}
