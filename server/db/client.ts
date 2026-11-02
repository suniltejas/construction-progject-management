import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as authSchema from '../auth/auth-schema.js';
import * as appSchema from './schema.js';

const configuredPath = process.env.DATABASE_PATH || './data/fieldline.sqlite';
const databasePath = configuredPath === ':memory:' ? configuredPath : resolve(configuredPath);
if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });

export const sqlite = new Database(databasePath);
sqlite.exec(`PRAGMA foreign_keys = ON`);
sqlite.exec(`PRAGMA journal_mode = WAL`);
sqlite.exec(`PRAGMA busy_timeout = 5000`);

export const db = drizzle(sqlite, { schema: { ...authSchema, ...appSchema } });
