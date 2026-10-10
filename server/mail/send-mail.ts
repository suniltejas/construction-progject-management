/** Email delivery for invitations and password resets. Public API used by the API layer. */
import { createMailerFromEnv, type EmailMessage } from './mail-provider.js';

function textAsHtml(value: string): string {
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return `<p>${escaped.replace(/\n/g, '<br>')}</p>`;
}

export async function sendMail(message: EmailMessage): Promise<void> {
  const html = message.html ?? textAsHtml(message.text);
  await createMailerFromEnv().send({ ...message, html });
}

export function buildInvitationMessage(input: {
  email: string;
  username: string;
  projectName: string;
  inviteUrl: string;
  existingUser?: boolean;
}): EmailMessage {
  return {
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
  };
}

export async function sendProjectInvitation(input: {
  email: string;
  username: string;
  projectName: string;
  inviteUrl: string;
  existingUser?: boolean;
}): Promise<void> {
  await sendMail(buildInvitationMessage(input));
}

// TODO: Implement real email delivery here once the full provider is ready.
// Sending is disabled for now — admins share the creation link manually.
export async function sendInvitationEmail(_message: EmailMessage): Promise<void> {
  return;
}
