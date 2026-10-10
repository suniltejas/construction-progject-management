/**
 * Pluggable email delivery. The rest of the app depends only on the `Mailer`
 * interface here; concrete providers (Resend now, others later) live in this
 * file and are selected by `createMailerFromEnv`. To switch providers, add a
 * function returning a `Mailer` and wire it into the factory — no app code
 * that calls `sendMail`/`sendProjectInvitation` needs to change.
 */

export interface EmailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

export type MailProviderKind = 'resend' | 'dev';

export interface MailEnv {
  MAIL_PROVIDER?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  APP_ORIGIN?: string;
  BETTER_AUTH_URL?: string;
  NODE_ENV?: string;
}

export function createResendMailer(config: {
  apiKey: string;
  from: string;
  endpoint?: string;
}): Mailer {
  return {
    async send(message: EmailMessage): Promise<void> {
      const response = await fetch(config.endpoint ?? 'https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: config.from,
          to: Array.isArray(message.to) ? message.to : [message.to],
          subject: message.subject,
          ...(message.html ? { html: message.html } : {}),
          text: message.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Resend rejected email (HTTP ${response.status})`);
    },
  };
}

export function createDevMailer(): Mailer {
  return {
    async send(message: EmailMessage): Promise<void> {
      const to = Array.isArray(message.to) ? message.to.join(', ') : message.to;
      console.info(`[development email] To: ${to}\nSubject: ${message.subject}\n${message.text}`);
    },
  };
}

export function createMailerFromEnv(env: MailEnv = process.env): Mailer {
  const override = env.MAIL_PROVIDER;
  if (override && override !== 'auto') {
    if (override === 'dev') return createDevMailer();
    if (override === 'resend') {
      if (!env.RESEND_API_KEY) throw new Error('MAIL_PROVIDER=resend requires RESEND_API_KEY');
      if (!env.RESEND_FROM) throw new Error('MAIL_PROVIDER=resend requires RESEND_FROM');
      return createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM });
    }
    throw new Error(`Unknown MAIL_PROVIDER: ${override} (expected "resend" or "dev")`);
  }

  if (!env.RESEND_API_KEY) {
    const origin = env.APP_ORIGIN || env.BETTER_AUTH_URL || 'http://localhost:5173';
    const parsedOrigin = new URL(origin);
    const localDevelopment = env.NODE_ENV !== 'production'
      && parsedOrigin.protocol === 'http:'
      && (parsedOrigin.hostname === 'localhost' || parsedOrigin.hostname === '127.0.0.1');
    if (!localDevelopment) throw new Error('RESEND_API_KEY and RESEND_FROM are required to send email');
    return createDevMailer();
  }

  if (!env.RESEND_FROM) throw new Error('RESEND_FROM is required to send email');
  return createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM });
}
