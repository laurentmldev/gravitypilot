import { createApp } from './src/app.js';

// In Docker the container starts as root only so the entrypoint can fix the
// data directory's owner; drop to the unprivileged user straight away.
if (process.env.RUN_AS && process.getuid?.() === 0) {
  process.setgid(process.env.RUN_AS);
  process.setuid(process.env.RUN_AS);
}

const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '0.0.0.0';

const server = createApp().listen(port, host, () => {
  console.log(`Gravity Pilot listening on http://${host}:${port}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
