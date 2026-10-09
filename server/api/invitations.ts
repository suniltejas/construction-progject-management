/** Project-scoped, email-delivered invitations for username accounts. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { user } from '../auth/auth-schema.js';
import { appOrigin } from '../auth/auth.js';
import { createInvitedUser, normalizeUsername } from '../auth/invited-user.js';
import { getSessionFromRequest } from '../auth/session.js';
import { invitations, pendingTaskAssignments, projectMemberships, projects, subtasks, taskAssignments } from '../db/schema.js';
import { sendProjectInvitation } from '../mail/send-mail.js';
import { pendingAssigneeId, requireRole, requireUser } from './access.js';
import { ApiError, assert } from './errors.js';
import { acceptInput, inviteInput, parse } from './validation.js';

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function routeId(id: unknown): string {
  assert(typeof id === 'string' && id.length > 0 && id.length <= 100, 400, 'Invalid ID');
  return id;
}

function invitationForToken(token: string) {
  assert(tokenPattern.test(token), 404, 'Invitation not found');
  const invitation = db.select().from(invitations)
    .where(eq(invitations.tokenHash, tokenHash(token))).limit(1).get();
  assert(invitation && !invitation.acceptedAt && !invitation.revokedAt
    && invitation.expiresAt.getTime() > Date.now(), 404, 'Invitation not found or expired');
  return invitation;
}

function existingAccount(email: string, username: string) {
  const byEmail = db.select().from(user).where(eq(user.email, email)).limit(1).get();
  const byUsername = db.select().from(user).where(eq(user.username, username)).limit(1).get();
  assert(!byEmail || byEmail.username === username, 409, 'That email uses a different username');
  assert(!byUsername || byUsername.email === email, 409, 'That username belongs to another account');
  return byEmail;
}

function assertUnreserved(email: string, username: string, now: Date) {
  const byEmail = db.select().from(invitations)
    .where(and(eq(invitations.email, email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt))).all();
  const byUsername = db.select().from(invitations)
    .where(and(eq(invitations.username, username), isNull(invitations.acceptedAt), isNull(invitations.revokedAt))).all();
  assert(!byEmail.some((item) => item.expiresAt > now && item.username !== username),
    409, 'That email has a pending invitation with a different username');
  assert(!byUsername.some((item) => item.expiresAt > now && item.email !== email),
    409, 'That username is reserved by a pending invitation');
}

export const projectInvitationRouter = Router();
export const invitationRouter = Router();

projectInvitationRouter.post('/projects/:id/invitations', async (req, res) => {
  const sender = await requireUser(req);
  const projectId = routeId(req.params.id);
  const { project } = requireRole(projectId, sender.id, ['owner']);
  const input = parse(inviteInput, req.body);
  let username: string;
  try { username = normalizeUsername(input.username); }
  catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Invalid username'); }
  const email = input.email;
  const account = existingAccount(email, username);
  assert(!account || account.id !== project.ownerUserId, 409, 'The project owner already has access');
  if (account) {
    const member = db.select().from(projectMemberships)
      .where(and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, account.id)))
      .limit(1).get();
    assert(!member, 409, 'This user already has project access');
  }

  const now = new Date();
  // Expired rows are retained for audit, but release their open-invite uniqueness slot.
  db.update(invitations).set({ revokedAt: now })
    .where(and(eq(invitations.projectId, projectId), eq(invitations.email, email),
      isNull(invitations.acceptedAt), isNull(invitations.revokedAt), lt(invitations.expiresAt, now))).run();
  assertUnreserved(email, username, now);
  const pending = db.select({ id: invitations.id }).from(invitations)
    .where(and(eq(invitations.projectId, projectId), eq(invitations.email, email),
      isNull(invitations.acceptedAt), isNull(invitations.revokedAt))).limit(1).get();
  assert(!pending, 409, 'An invitation is already pending for this email');

  const token = randomBytes(32).toString('base64url');
  const id = randomUUID();
  const expiresAt = new Date(now.getTime() + invitationLifetimeMs);
  db.insert(invitations).values({ id, projectId, email, username, role: input.role,
    tokenHash: tokenHash(token), invitedByUserId: sender.id, expiresAt }).run();
  try {
    await sendProjectInvitation({ email, username, projectName: project.name,
      inviteUrl: `${appOrigin}/projects/?invite=${encodeURIComponent(token)}`,
      existingUser: Boolean(account) });
  } catch (error) {
    db.update(invitations).set({ revokedAt: new Date() }).where(eq(invitations.id, id)).run();
    console.error('Invitation email failed', error);
    throw new ApiError(502, 'Invitation email could not be sent');
  }
  res.status(201).json({ id, username, email, role: input.role, expiresAt });
});

projectInvitationRouter.delete('/projects/:id/invitations/:invitationId', async (req, res) => {
  const sender = await requireUser(req);
  const projectId = routeId(req.params.id);
  requireRole(projectId, sender.id, ['owner']);
  const id = routeId(req.params.invitationId);
  db.transaction((tx) => {
    const revoked = tx.update(invitations).set({ revokedAt: new Date() })
      .where(and(eq(invitations.id, id), eq(invitations.projectId, projectId),
        isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .returning({ email: invitations.email }).get();
    assert(revoked, 404, 'Pending invitation not found');
    tx.delete(pendingTaskAssignments).where(and(eq(pendingTaskAssignments.projectId, projectId),
      eq(pendingTaskAssignments.email, revoked.email))).run();
    tx.update(subtasks).set({ ownerAssigneeId: null,
      version: sql`${subtasks.version} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(subtasks.projectId, projectId),
        eq(subtasks.ownerAssigneeId, pendingAssigneeId(revoked.email)))).run();
  });
  res.status(204).end();
});

invitationRouter.get('/invitations/:token', (req, res) => {
  const token = routeId(req.params.token);
  const invitation = invitationForToken(token);
  const project = db.select({ name: projects.name }).from(projects)
    .where(eq(projects.id, invitation.projectId)).limit(1).get();
  assert(project, 404, 'Project not found');
  const account = db.select({ id: user.id }).from(user)
    .where(eq(user.email, invitation.email)).limit(1).get();
  res.json({ projectName: project.name, username: invitation.username,
    role: invitation.role, existingUser: Boolean(account) });
});

invitationRouter.post('/invitations/accept', async (req, res) => {
  const { token, password } = parse(acceptInput, req.body);
  const invitation = invitationForToken(token);
  const account = db.select().from(user).where(eq(user.email, invitation.email)).limit(1).get();
  let userId: string;
  let createdUserId: string | undefined;
  if (account) {
    assert(account.username === invitation.username, 409, 'The account username has changed');
    const session = await getSessionFromRequest(req);
    assert(session?.user.id === account.id, 401, 'Sign in as the invited user to accept');
    userId = account.id;
  } else {
    assert(password, 400, 'Set a password to accept this invitation');
    const session = await getSessionFromRequest(req);
    assert(!session?.user, 403, 'Sign out before creating the invited account');
    try {
      const created = await createInvitedUser({ email: invitation.email,
        username: invitation.username, password });
      userId = created.id;
      createdUserId = created.id;
    } catch (error) {
      if (error instanceof Error && /Password must|Username must/.test(error.message)) {
        throw new ApiError(400, error.message);
      }
      throw error;
    }
  }

  const acceptedAt = new Date();
  try {
    db.transaction((tx) => {
      const consumed = tx.update(invitations)
        .set({ acceptedAt, acceptedByUserId: userId })
        .where(and(eq(invitations.id, invitation.id), isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt), gt(invitations.expiresAt, acceptedAt)))
        .returning({ id: invitations.id }).get();
      if (!consumed) throw new ApiError(409, 'Invitation already used or expired');
      tx.insert(projectMemberships).values({ projectId: invitation.projectId,
        userId, role: invitation.role }).run();
      const pending = tx.select({ taskId: pendingTaskAssignments.taskId }).from(pendingTaskAssignments)
        .where(and(eq(pendingTaskAssignments.projectId, invitation.projectId),
          eq(pendingTaskAssignments.email, invitation.email))).all();
      for (const assignment of pending) {
        tx.insert(taskAssignments).values({ projectId: invitation.projectId,
          taskId: assignment.taskId, userId }).onConflictDoNothing().run();
      }
      tx.delete(pendingTaskAssignments).where(and(eq(pendingTaskAssignments.projectId, invitation.projectId),
        eq(pendingTaskAssignments.email, invitation.email))).run();
      tx.update(subtasks).set({ ownerAssigneeId: userId,
        version: sql`${subtasks.version} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(subtasks.projectId, invitation.projectId),
          eq(subtasks.ownerAssigneeId, pendingAssigneeId(invitation.email)))).run();
    });
  } catch (error) {
    // Better Auth's account creation is async and cannot join this SQLite
    // transaction. If the invite changed while it ran, remove the new account
    // only when no other project has gained a reference to it.
    if (createdUserId) {
      const member = db.select({ userId: projectMemberships.userId }).from(projectMemberships)
        .where(eq(projectMemberships.userId, createdUserId)).limit(1).get();
      const owned = db.select({ id: projects.id }).from(projects)
        .where(eq(projects.ownerUserId, createdUserId)).limit(1).get();
      if (!member && !owned) db.delete(user).where(eq(user.id, createdUserId)).run();
    }
    throw error;
  }
  res.json({ projectId: invitation.projectId, username: invitation.username,
    role: invitation.role });
});
