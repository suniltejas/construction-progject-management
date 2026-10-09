import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Generate migrations from both Better Auth and app schemas. Deployments set
// DATABASE_PATH to the same absolute SQLite path used by the Node server.
export default defineConfig({
  dialect: 'sqlite',
  schema: ['./server/auth/auth-schema.ts', './server/db/schema.ts'],
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_PATH || './data/fieldline.sqlite' },
  breakpoints: true,
});
