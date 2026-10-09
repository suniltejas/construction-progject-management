/** Resend delivery for invitations and password resets. */

type Mail = { to: string; subject: string; text: string };

function textAsHtml(value: string): string {
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return `<p>${escaped.replace(/\n/g, '<br>')}</p>`;
}

export async function sendMail({ to, subject, text }: Mail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey) {
    const origin = process.env.APP_ORIGIN || process.env.BETTER_AUTH_URL || 'http://localhost:5173';
    const parsedOrigin = new URL(origin);
    const localDevelopment = process.env.NODE_ENV !== 'production'
      && parsedOrigin.protocol === 'http:'
      && (parsedOrigin.hostname === 'localhost' || parsedOrigin.hostname === '127.0.0.1');
    if (!localDevelopment) throw new Error('RESEND_API_KEY and RESEND_FROM are required to send email');
    // Local development has no mail provider. The link is visible only in the server terminal.
    console.info(`[development email] To: ${to}\nSubject: ${subject}\n${text}`);
    return;
  }

  if (!from) throw new Error('RESEND_FROM is required to send email');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, html: textAsHtml(text), text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Resend rejected email (HTTP ${response.status})`);
}

export async function sendProjectInvitation(input: {
  email: string;
  username: string;
  projectName: string;
  inviteUrl: string;
  existingUser?: boolean;
}): Promise<void> {
  await sendMail({
    to: input.email,
    subject: `Invitation to ${input.projectName}`,
    text: [
      `You have been invited to the ${input.projectName} construction project.`,
      `Your sign-in username is ${input.username}.`,
      input.existingUser
        ? 'Sign in, then open this link to accept the invitation:'
        : 'Open this link to accept the invitation and set your password:',
      input.inviteUrl,
      'If you did not expect this invitation, you can ignore this message.',
    ].join('\n\n'),
  });
}
