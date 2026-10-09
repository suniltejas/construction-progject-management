import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db, sqlite } from './client.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle/', import.meta.url));
try {
  migrate(db, { migrationsFolder });
  console.info('Database migrations applied.');
} finally {
  sqlite.close();
}
