import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { sendMail } from './send-mail.js';

const originalFetch = globalThis.fetch;
const originalKey = process.env.RESEND_API_KEY;
const originalFrom = process.env.RESEND_FROM;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalKey;
  if (originalFrom === undefined) delete process.env.RESEND_FROM;
  else process.env.RESEND_FROM = originalFrom;
});

test('sends invitations through the Resend API with escaped HTML', async () => {
  process.env.RESEND_API_KEY = 'test-key';
  process.env.RESEND_FROM = 'Projects <projects@example.com>';
  let called = false;
  globalThis.fetch = async (input, init) => {
    called = true;
    assert.equal(input, 'https://api.resend.com/emails');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-key');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.from, 'Projects <projects@example.com>');
    assert.deepEqual(body.to, ['invitee@example.com']);
    assert.equal(body.subject, 'Invitation');
    assert.equal(body.text, 'Hello <invitee>\nOpen link');
    assert.equal(body.html, '<p>Hello &lt;invitee&gt;<br>Open link</p>');
    return new Response(JSON.stringify({ id: 'email-id' }), { status: 200 });
  };
  await sendMail({ to: 'invitee@example.com', subject: 'Invitation', text: 'Hello <invitee>\nOpen link' });
  assert.equal(called, true);
});

test('reports a rejected Resend request', async () => {
  process.env.RESEND_API_KEY = 'test-key';
  process.env.RESEND_FROM = 'projects@example.com';
  globalThis.fetch = async () => new Response('{}', { status: 403 });
  await assert.rejects(
    sendMail({ to: 'invitee@example.com', subject: 'Invitation', text: 'Hello' }),
    /Resend rejected email \(HTTP 403\)/,
  );
});
