/**
 * Manually reset the password for an existing account (e.g. the admin user).
 * Runs against the local DATABASE_PATH and hashes the new password with the
 * same hasher Better Auth uses on creation, so sign-in keeps working.
 * Usage: npm run reset-password -- <username>
 */
import 'dotenv/config';
import { db, sqlite } from '../server/db/client.js';
import { user, account, session } from '../server/auth/auth-schema.js';
import { eq, and } from 'drizzle-orm';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

const USERNAME_PATTERN = /^[A-Za-z0-9_.]{3,30}$/;

function normalizeUsername(value: string): string {
  const username = value.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('Username must be 3–30 letters, numbers, underscores, or dots');
  }
  return username;
}

function readPassword(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
      reject(new Error('Run this command in an interactive terminal to enter the password securely'));
      return;
    }
    let password = '';
    process.stdout.write('New password (12–128 characters): ');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const restore = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (buffer: Buffer) => {
      for (const value of buffer.toString('utf8')) {
        if (value === '\u0003') { restore(); reject(new Error('Cancelled')); return; }
        if (value === '\r' || value === '\n') { restore(); resolve(password); return; }
        if (value === '\u007f' || value === '\b') password = password.slice(0, -1);
        else if (value !== '\u001b') password += value;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function confirmYes(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
      reject(new Error('Confirmation requires an interactive terminal'));
      return;
    }
    let answer = '';
    process.stdout.write('This changes the current password and ends existing sessions. Continue? [y/N] ');
    const restore = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (buffer: Buffer) => {
      for (const value of buffer.toString('utf8')) {
        if (value === '\u0003') { restore(); reject(new Error('Cancelled')); return; }
        if (value === '\r' || value === '\n') {
          restore();
          resolve(answer.trim().toLowerCase() === 'y');
          return;
        }
        if (value === '\u007f' || value === '\b') { answer = answer.slice(0, -1); return; }
        if (value !== '\u001b') { answer += value; process.stdout.write(value); }
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

async function main() {
  const [usernameArg] = process.argv.slice(2);
  if (!usernameArg) throw new Error('Usage: npm run reset-password -- <username>');
  const username = normalizeUsername(usernameArg);

  const [existing] = await db.select().from(user).where(eq(user.username, username)).limit(1);
  if (!existing) throw new Error(`No user with username "${username}".`);

  const proceed = await confirmYes();
  if (!proceed) throw new Error('Aborted; nothing changed.');

  const password = await readPassword();
  if (password.length < 12 || password.length > 128) {
    throw new Error('Password must be between 12 and 128 characters');
  }

  const hash = await hashPassword(password);
  const valid = await verifyPassword({ hash, password });
  if (!valid) throw new Error('Hash verification failed; refusing to write an unhashable password');

  const rows = await db.update(account).set({ password: hash })
    .where(and(eq(account.userId, existing.id), eq(account.providerId, 'credential')))
    .execute();
  if (!rows.changes) {
    throw new Error('No credential account found for this user; nothing was changed.');
  }

  await db.delete(session).where(eq(session.userId, existing.id));

  console.info(`Reset password for "${username}". Existing sessions were invalidated; sign in again with the new password.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => sqlite.close());
