import 'dotenv/config';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth/auth.js';
import { sqlite } from './db/client.js';
import { appRouter } from './api/routes.js';
import { ApiError } from './api/errors.js';
import { invitationRouter, projectInvitationRouter } from './api/invitations.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

// Better Auth must receive the original request path and unparsed body.
app.all('/projects/api/auth/*splat', toNodeHandler(auth));
app.use('/projects/api', express.json({ limit: '100kb' }));
app.use('/projects/api', invitationRouter);
app.use('/projects/api', projectInvitationRouter);
app.use('/projects/api', appRouter);
app.use('/projects/api', (_req, res) => res.status(404).json({ message: 'API route not found' }));

const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ message: 'Invalid JSON' });
    return;
  }
  console.error('Request failed', error);
  res.status(500).json({ message: 'Server error' });
};
app.use('/projects/api', errorHandler);

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
if (existsSync(dist)) {
  app.use('/projects', express.static(dist, { index: 'index.html', fallthrough: true }));
  app.get('/projects/*splat', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

const port = Number(process.env.PORT || '3000');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');
const host = process.env.HOST || '127.0.0.1';
const userTable = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user'").get();
if (!userTable) throw new Error('Database is not migrated. Run npm run db:migrate first.');
const server = app.listen(port, host, () => console.info(`Construction tracker listening on http://${host}:${port}/projects/`));
process.on('SIGTERM', () => server.close(() => sqlite.close()));
