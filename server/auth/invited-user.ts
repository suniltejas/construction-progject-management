/** Trusted account creation after the app API has validated and consumed an email invitation. */
import { eq, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { user } from './auth-schema.js';
import { auth } from './auth.js';

export const USERNAME_PATTERN = /^[A-Za-z0-9_.]{3,30}$/;

export function normalizeUsername(value: string): string {
  const username = value.trim();
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('Username must be 3–30 letters, numbers, underscores, or dots');
  }
  return username.toLowerCase();
}

/**
 * Caller must verify the single-use invitation token and its email before calling.
 * `createUser` uses Better Auth's password hashing and credential-account creation.
 */
export async function createInvitedUser(input: {
  email: string;
  username: string;
  password: string;
}): Promise<{ id: string; username: string; email: string }> {
  const email = input.email.trim().toLowerCase();
  const displayUsername = input.username.trim();
  const username = normalizeUsername(displayUsername);
  if (input.password.length < 12 || input.password.length > 128) {
    throw new Error('Password must be between 12 and 128 characters');
  }

  const conflict = await db.select({ id: user.id }).from(user)
    .where(or(eq(user.email, email), eq(user.username, username))).limit(1);
  if (conflict.length) throw new Error('Email or username is already registered');

  await auth.api.createUser({
    body: {
      email,
      name: displayUsername,
      password: input.password,
      role: 'user',
      // The emailed, single-use invitation was checked by the caller, so the
      // invite link establishes control of this address.
      data: { username, displayUsername, emailVerified: true },
    },
  });

  const [created] = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (!created) throw new Error('Better Auth did not create the invited account');
  // Guard against adapter/plugin version drift. The Admin plugin currently
  // forwards these fields on creation, but username sign-in must not silently fail.
  if (created.username !== username || !created.emailVerified) {
    await db.update(user).set({ username, displayUsername, emailVerified: true })
      .where(eq(user.id, created.id));
  }
  return { id: created.id, username, email };
}
