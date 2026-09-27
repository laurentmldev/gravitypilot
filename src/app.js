import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoldenBook, validate } from './goldenbook.js';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');

export function createApp({ goldenBookFile = process.env.GOLDENBOOK_FILE || path.join(rootDir, 'data', 'goldenbook.txt') } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Deployed behind a reverse proxy: trust X-Forwarded-* headers.
  app.set('trust proxy', true);

  const book = new GoldenBook(goldenBookFile);
  const recent = new Map(); // ip -> timestamps of recent submissions

  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

  app.get('/api/goldenbook', (req, res) => {
    res.set('Cache-Control', 'no-store');
    // `levels` (the solo book) is kept for older clients.
    res.json({ levels: book.top('solo'), books: book.all() });
  });

  app.post('/api/goldenbook', express.json({ limit: '2kb' }), async (req, res, next) => {
    // A light rate limit: 5 entries per minute per client.
    const now = Date.now();
    const times = (recent.get(req.ip) || []).filter((t) => now - t < 60_000);
    if (times.length >= 5) return res.status(429).json({ error: 'too many entries, try again later' });

    const { entry, error } = validate(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const rank = await book.add(entry);
      if (!rank) return res.status(409).json({ error: 'score is not in the top 10' });
      times.push(now);
      if (recent.size > 10_000) recent.clear();
      recent.set(req.ip, times);
      res.status(201).json({ rank, levels: book.top(entry.mode), books: book.all() });
    } catch (err) {
      next(err);
    }
  });

  app.use(express.static(publicDir, { maxAge: '1h' }));

  return app;
}
