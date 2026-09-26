import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Deployed behind a reverse proxy: trust X-Forwarded-* headers.
  app.set('trust proxy', true);

  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
  app.use(express.static(publicDir, { maxAge: '1h' }));

  return app;
}
