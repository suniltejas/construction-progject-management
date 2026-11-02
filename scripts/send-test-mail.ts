/**
 * Send a dummy email through whatever provider is configured (see
 * createMailerFromEnv in server/mail/mail-provider.ts).
 *
 *   npm run mail:test                     uses .env RESEND creds if present
 *   MAIL_PROVIDER=dev npm run mail:test   prints instead of sending
 */
import 'dotenv/config';
import { createMailerFromEnv } from '../server/mail/mail-provider.js';

const RECIPIENTS = ['coder52057@gmail.com', 'sunilvalsank@gmail.com'];

async function main(): Promise<void> {
  const mailer = createMailerFromEnv();
  const subject = 'Fieldline test email';
  const text = [
    'This is a test email from the Fieldline project tracker.',
    '',
    `Sent: ${new Date().toISOString()}`,
    '',
    'If you received this, your email pipeline is working.',
  ].join('\n');

  for (const to of RECIPIENTS) {
    try {
      await mailer.send({ to, subject, text });
      console.info(`Sent to ${to}`);
    } catch (error) {
      console.error(`Failed for ${to}:`, error instanceof Error ? error.message : error);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error : new Error(String(error)));
  process.exitCode = 1;
});
