/** Better Auth owns identity, password hashing, and sessions. Project roles live in app tables. */
import { randomBytes } from 'node:crypto';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { admin, username } from 'better-auth/plugins';
import { db } from '../db/client.js';
import { sendMail } from '../mail/send-mail.js';
import * as schema from './auth-schema.js';

const configuredOrigin = process.env.APP_ORIGIN || process.env.BETTER_AUTH_URL;
if (!configuredOrigin && process.env.NODE_ENV === 'production') {
  throw new Error('APP_ORIGIN is required in production');
}
export const appOrigin = new URL(configuredOrigin || 'http://localhost:5173').origin;

const configuredSecret = process.env.BETTER_AUTH_SECRET;
if (!configuredSecret && process.env.NODE_ENV === 'production') {
  throw new Error('BETTER_AUTH_SECRET is required in production');
}
if (configuredSecret && Buffer.byteLength(configuredSecret, 'utf8') < 32) {
  throw new Error('BETTER_AUTH_SECRET must be at least 32 bytes');
}
const secret = configuredSecret || randomBytes(32).toString('base64url');

export const auth = betterAuth({
  appName: 'Construction Project Tracker',
  baseURL: appOrigin,
  basePath: '/projects/api/auth',
  secret,
  trustedOrigins: [appOrigin],
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: 'Reset your construction tracker password',
        text: `Open this link to reset your password:\n\n${url}\n\nIf you did not request this, you can ignore this message.`,
      });
    },
  },
  // Usernames are assigned by project owners during invitation and remain stable.
  plugins: [username({ immutableUsername: true }), admin()],
  disabledPaths: ['/is-username-available'],
});
