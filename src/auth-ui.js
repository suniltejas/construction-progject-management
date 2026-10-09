import { createAuthClient } from 'better-auth/client';
import { usernameClient } from 'better-auth/client/plugins';
import { api } from './api.js';

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: `${import.meta.env.BASE_URL}api/auth`,
  plugins: [usernameClient()],
});

const authScreen = document.querySelector('#authScreen');
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function formError(form, message) {
  const error = form.querySelector('.auth-error');
  error.textContent = message;
  error.hidden = false;
}

function renderLogin(onAuthenticated, { notice = '', username = '', afterSignIn } = {}) {
  authScreen.hidden = false;
  authScreen.innerHTML = `<div class="auth-card"><div class="auth-brand"><span class="brand-mark">F<span></span></span><span>Fieldline<small>Project tracker</small></span></div><p class="eyebrow">Welcome back</p><h1>Sign in to your workspace</h1><p class="auth-intro">Use the username provided by your project owner.</p>${notice ? '<p class="auth-notice" id="authNotice"></p>' : ''}<form id="loginForm"><label>Username<input name="username" required autocomplete="username" autofocus></label><label>Password<input name="password" type="password" required autocomplete="current-password"></label><p class="auth-error" role="alert" hidden></p><button class="button primary" type="submit">Sign in</button></form></div>`;
  if (notice) authScreen.querySelector('#authNotice').textContent = notice;
  const form = authScreen.querySelector('#loginForm');
  if (username) form.elements.username.value = username;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const { username, password } = Object.fromEntries(new FormData(form));
    try {
      const { error } = await authClient.signIn.username({ username, password });
      if (error) throw new Error(error.message || 'Sign in failed');
      if (afterSignIn) await afterSignIn();
      await onAuthenticated();
    } catch (error) { formError(form, error.message); }
    finally { button.disabled = false; }
  });
}

async function renderInvitation(token, onAuthenticated) {
  authScreen.hidden = false;
  authScreen.innerHTML = '<div class="auth-card"><p>Checking your invitation…</p></div>';
  let invitation;
  try { invitation = await api.invitation(token); }
  catch (error) {
    authScreen.innerHTML = `<div class="auth-card"><h1>Invitation unavailable</h1><p class="auth-intro">${escapeHtml(error.message)}</p><button id="showLogin" class="button primary" type="button">Sign in</button></div>`;
    authScreen.querySelector('#showLogin').addEventListener('click', () => { history.replaceState({}, '', location.pathname); renderLogin(onAuthenticated); });
    return;
  }
  if (invitation.existingUser) {
    authScreen.innerHTML = `<div class="auth-card"><div class="auth-brand"><span class="brand-mark">F<span></span></span><span>Fieldline<small>Project tracker</small></span></div><p class="eyebrow">Project invitation</p><h1>Join ${escapeHtml(invitation.projectName)}</h1><p class="auth-intro">Sign in as <strong>${escapeHtml(invitation.username)}</strong> to accept your ${escapeHtml(invitation.role)} access.</p><button id="joinLogin" class="button primary" type="button">Sign in and join</button></div>`;
    authScreen.querySelector('#joinLogin').addEventListener('click', () => renderLogin(onAuthenticated, {
      notice: `Sign in to accept your invitation to ${invitation.projectName}.`,
      username: invitation.username,
      afterSignIn: async () => { await api.acceptInvitation(token); history.replaceState({}, '', location.pathname); },
    }));
    return;
  }
  authScreen.innerHTML = `<div class="auth-card"><div class="auth-brand"><span class="brand-mark">F<span></span></span><span>Fieldline<small>Project tracker</small></span></div><p class="eyebrow">Project invitation</p><h1>Join ${escapeHtml(invitation.projectName)}</h1><p class="auth-intro">Your username is <strong>${escapeHtml(invitation.username)}</strong>. Set a password of at least 12 characters for ${escapeHtml(invitation.role)} access.</p><form id="acceptForm"><label>New password<input name="password" type="password" required minlength="12" autocomplete="new-password"></label><label>Confirm password<input name="confirmPassword" type="password" required minlength="12" autocomplete="new-password"></label><p class="auth-error" role="alert" hidden></p><button class="button primary" type="submit">Create account and join</button></form></div>`;
  const form = authScreen.querySelector('#acceptForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { password, confirmPassword } = Object.fromEntries(new FormData(form));
    if (password !== confirmPassword) return formError(form, 'Passwords do not match');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api.acceptInvitation(token, password);
      history.replaceState({}, '', location.pathname);
      renderLogin(onAuthenticated, { notice: 'Account created. Sign in to open the project.', username: invitation.username });
    } catch (error) { formError(form, error.message); }
    finally { button.disabled = false; }
  });
}

export async function showAuthScreen(onAuthenticated) {
  document.querySelector('#appShell').hidden = true;
  const params = new URLSearchParams(location.search);
  const token = params.get('invite');
  if (token) await renderInvitation(token, onAuthenticated);
  else renderLogin(onAuthenticated, { notice: params.get('error') ? 'This invitation link is invalid or expired. Ask the project owner for a new invitation.' : '' });
}

export function hideAuthScreen() {
  authScreen.hidden = true;
  document.querySelector('#appShell').hidden = false;
}
