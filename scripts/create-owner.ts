/** One-time, local-server bootstrap. Public account creation is disabled. */
import 'dotenv/config';
import { z } from 'zod';
import { db, sqlite } from '../server/db/client.js';
import { user } from '../server/auth/auth-schema.js';
import { createInvitedUser, normalizeUsername } from '../server/auth/invited-user.js';

function readPassword(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
      reject(new Error('Run this command in an interactive terminal to enter the password securely'));
      return;
    }
    let password = '';
    process.stdout.write('Password (12–128 characters): ');
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

async function main() {
  const [usernameArg, emailArg] = process.argv.slice(2);
  if (!usernameArg || !emailArg) throw new Error('Usage: npm run owner:create -- <username> <email>');
  const username = normalizeUsername(usernameArg);
  const email = z.email().parse(emailArg.trim().toLowerCase());
  if (db.select({ id: user.id }).from(user).limit(1).get()) {
    throw new Error('An account already exists. Project owners must invite additional users from the app.');
  }
  const password = await readPassword();
  await createInvitedUser({ username, email, password });
  console.info(`Created ${username}. Sign in and create the first project.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => sqlite.close());
