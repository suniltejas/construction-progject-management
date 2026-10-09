import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const migrationsFolder = fileURLToPath(new URL('../../drizzle/', import.meta.url));
const password = 'CorrectHorseBatteryStaple42!';

type Json = Record<string, any>;
type ResponseData = { status: number; data: Json; cookie: string };

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert(address && typeof address !== 'string');
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function sessionCookie(response: Response): string {
  return response.headers.getSetCookie()
    .map((header) => header.split(';', 1)[0])
    .filter(Boolean).join('; ');
}

test('project API enforces username auth, invitations and project roles', { timeout: 90_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldline-api-test-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    DATABASE_PATH: join(directory, 'test.sqlite'),
    APP_ORIGIN: origin,
    BETTER_AUTH_SECRET: 'integration-test-secret-at-least-32-bytes-long',
    NODE_ENV: 'development',
    PORT: String(port),
    HOST: '127.0.0.1',
  };
  Object.assign(process.env, env);

  // The first account is bootstrapped by a trusted local command in production.
  // Create a second account without project membership to exercise tenant isolation.
  const { db, sqlite } = await import('../db/client.js');
  const { createInvitedUser } = await import('../auth/invited-user.js');
  migrate(db, { migrationsFolder });
  const owner = await createInvitedUser({ email: 'owner@example.test', username: 'siteowner', password });
  const outsider = await createInvitedUser({ email: 'outside@example.test', username: 'outsider', password });
  sqlite.close();

  let child: ChildProcessWithoutNullStreams | undefined;
  let output = '';
  const request = async (path: string, options: { method?: string; body?: Json; cookie?: string } = {}): Promise<ResponseData> => {
    const response = await fetch(`${origin}/projects/api${path}`, {
      method: options.method || 'GET',
      headers: {
        origin,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const raw = await response.text();
    let data: Json = {};
    if (raw) {
      try { data = JSON.parse(raw) as Json; }
      catch { data = { raw }; }
    }
    return { status: response.status, data, cookie: sessionCookie(response) };
  };
  const expectStatus = async (path: string, status: number, options: { method?: string; body?: Json; cookie?: string } = {}) => {
    const result = await request(path, options);
    assert.equal(result.status, status, `${options.method || 'GET'} ${path}: ${JSON.stringify(result.data)}`);
    return result;
  };
  const signIn = async (username: string) => {
    const result = await expectStatus('/auth/sign-in/username', 200, {
      method: 'POST', body: { username, password },
    });
    assert.match(result.cookie, /session_token=/);
    return result.cookie;
  };
  const issueInvitation = async (projectId: string, username: string, email: string, role: 'editor' | 'viewer', cookie: string) => {
    const before = output.length;
    const issued = await expectStatus(`/projects/${projectId}/invitations`, 201, {
      method: 'POST', cookie, body: { username, email, role },
    });
    for (let attempt = 0; attempt < 40; attempt++) {
      const match = output.slice(before).match(/\/projects\/\?invite=([A-Za-z0-9_-]+)/);
      if (match) return { token: match[1], id: issued.data.id as string };
      await delay(25);
    }
    throw new Error(`Invitation link was not logged in local development. Output: ${output}`);
  };
  const invitationToken = async (projectId: string, username: string, email: string, role: 'editor' | 'viewer', cookie: string) =>
    (await issueInvitation(projectId, username, email, role, cookie)).token;

  try {
    child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: projectRoot, env, stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output += chunk; });
    child.stderr.on('data', (chunk: string) => { output += chunk; });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`Server exited before ready: ${output}`);
      try {
        const response = await fetch(`${origin}/projects/api/session`);
        if (response.ok) break;
      } catch { /* server still starting */ }
      if (attempt === 99) throw new Error(`Server did not start: ${output}`);
      await delay(50);
    }

    await t.test('authentication blocks anonymous reads and public sign-up', async () => {
      await expectStatus('/workspace', 401);
      const signUp = await request('/auth/sign-up/email', {
        method: 'POST', body: { name: 'Public', email: 'public@example.test', password },
      });
      assert.notEqual(signUp.status, 200);
    });

    const ownerCookie = await signIn(owner.username);
    const outsiderCookie = await signIn(outsider.username);
    const ownerSession = await expectStatus('/session', 200, { cookie: ownerCookie });
    assert.equal(ownerSession.data.user.username, owner.username);

    const projectInput = (name: string) => ({ name, location: 'Site', lead: '', start: '2026-01-01', end: '2026-12-31', stage: 'Planning' });
    const projectA = (await expectStatus('/projects', 201, { method: 'POST', cookie: ownerCookie, body: projectInput('Alpha') })).data;
    const projectB = (await expectStatus('/projects', 201, { method: 'POST', cookie: ownerCookie, body: projectInput('Beta') })).data;
    const milestoneInput = (projectId: string, name: string) => ({ projectId, name, due: '2026-06-01', status: 'Upcoming' });
    const milestoneA = (await expectStatus('/milestones', 201, { method: 'POST', cookie: ownerCookie, body: milestoneInput(projectA.id, 'Foundation') })).data;
    const milestoneHidden = (await expectStatus('/milestones', 201, { method: 'POST', cookie: ownerCookie, body: milestoneInput(projectA.id, 'Finishing') })).data;
    const milestoneB = (await expectStatus('/milestones', 201, { method: 'POST', cookie: ownerCookie, body: milestoneInput(projectB.id, 'Other site') })).data;

    await t.test('emailed invitations create username accounts and cannot be reused', async () => {
      const editorToken = await invitationToken(projectA.id, 'editor1', 'editor@example.test', 'editor', ownerCookie);
      const editorInfo = await expectStatus(`/invitations/${editorToken}`, 200);
      assert.equal(editorInfo.data.username, 'editor1');
      assert.equal(editorInfo.data.projectName, 'Alpha');
      await expectStatus('/invitations/accept', 200, { method: 'POST', body: { token: editorToken, password } });
      const reused = await request('/invitations/accept', { method: 'POST', body: { token: editorToken, password } });
      assert.notEqual(reused.status, 200);

      const viewerToken = await invitationToken(projectA.id, 'viewer1', 'viewer@example.test', 'viewer', ownerCookie);
      await expectStatus('/invitations/accept', 200, { method: 'POST', body: { token: viewerToken, password } });
    });

    const editorCookie = await signIn('editor1');
    const viewerCookie = await signIn('viewer1');
    const members = (await expectStatus(`/projects/${projectA.id}/members`, 200, { cookie: ownerCookie })).data.members as Json[];
    const editor = members.find((member) => member.username === 'editor1');
    const viewer = members.find((member) => member.username === 'viewer1');
    assert(editor && viewer);

    const taskInput = (projectId: string, milestoneId: string, name: string, assigneeUserIds: string[]) => ({
      projectId, milestoneId, name, owner: 'Crew A', due: '2026-05-01',
      status: 'Not started', priority: 'Normal', assigneeUserIds,
    });
    const assigned = (await expectStatus('/tasks', 201, {
      method: 'POST', cookie: ownerCookie,
      body: taskInput(projectA.id, milestoneA.id, 'Assigned task', [viewer.userId]),
    })).data;
    const hidden = (await expectStatus('/tasks', 201, {
      method: 'POST', cookie: ownerCookie,
      body: taskInput(projectA.id, milestoneHidden.id, 'Hidden task', [editor.userId]),
    })).data;
    await expectStatus('/tasks', 201, {
      method: 'POST', cookie: ownerCookie,
      body: taskInput(projectB.id, milestoneB.id, 'Other project task', []),
    });

    await t.test('viewer sees only assigned tasks and linked milestone context', async () => {
      const workspace = (await expectStatus('/workspace', 200, { cookie: viewerCookie })).data;
      assert.deepEqual(workspace.tasks.map((item: Json) => item.id), [assigned.id]);
      assert.deepEqual(workspace.milestones.map((item: Json) => item.id), [milestoneA.id]);
      assert.deepEqual(workspace.projects.map((item: Json) => item.id), [projectA.id]);
      assert.equal(workspace.projects[0].name, 'Alpha');
      assert.equal(workspace.projects[0].location, undefined);
      assert.deepEqual(workspace.tasks[0].assigneeUserIds, [viewer.userId]);
      await expectStatus('/tasks', 403, {
        method: 'POST', cookie: viewerCookie,
        body: taskInput(projectA.id, milestoneA.id, 'Disallowed', [viewer.userId]),
      });
      await expectStatus(`/tasks/${assigned.id}`, 403, {
        method: 'PATCH', cookie: viewerCookie, body: { version: assigned.version, name: 'Disallowed' },
      });
      await expectStatus(`/projects/${projectA.id}/members`, 403, { cookie: viewerCookie });
    });

    await t.test('editor can edit tasks but cannot manage ownership or other projects', async () => {
      const workspace = (await expectStatus('/workspace', 200, { cookie: editorCookie })).data;
      assert.deepEqual(new Set(workspace.tasks.map((item: Json) => item.id)), new Set([assigned.id, hidden.id]));
      assert.deepEqual(new Set(workspace.milestones.map((item: Json) => item.id)), new Set([milestoneA.id, milestoneHidden.id]));
      assert.deepEqual(workspace.projects.map((item: Json) => item.id), [projectA.id]);
      await expectStatus('/tasks', 400, {
        method: 'POST', cookie: editorCookie,
        body: taskInput(projectA.id, milestoneB.id, 'Wrong milestone', []),
      });
      await expectStatus('/tasks', 400, {
        method: 'POST', cookie: editorCookie,
        body: taskInput(projectA.id, milestoneA.id, 'Wrong assignee', [outsider.id]),
      });
      await expectStatus('/tasks', 404, {
        method: 'POST', cookie: editorCookie,
        body: taskInput(projectB.id, milestoneB.id, 'Other site', []),
      });
      await expectStatus(`/tasks/${hidden.id}`, 403, { method: 'DELETE', cookie: editorCookie });
      await expectStatus(`/projects/${projectA.id}/members/${viewer.userId}`, 403, {
        method: 'PATCH', cookie: editorCookie, body: { role: 'editor' },
      });
      await expectStatus('/milestones', 403, {
        method: 'POST', cookie: editorCookie, body: milestoneInput(projectA.id, 'Disallowed'),
      });
    });

    await t.test('task updates use version checks and milestone remains in project', async () => {
      const updated = (await expectStatus(`/tasks/${assigned.id}`, 200, {
        method: 'PATCH', cookie: editorCookie,
        body: { version: assigned.version, name: 'Updated task', milestoneId: milestoneHidden.id },
      })).data;
      assert.equal(updated.milestoneId, milestoneHidden.id);
      assert.equal(updated.version, assigned.version + 1);
      await expectStatus(`/tasks/${assigned.id}`, 409, {
        method: 'PATCH', cookie: ownerCookie, body: { version: assigned.version, name: 'Stale update' },
      });
      await expectStatus(`/tasks/${assigned.id}`, 400, {
        method: 'PATCH', cookie: ownerCookie, body: { version: updated.version, milestoneId: milestoneB.id },
      });
    });

    await t.test('subtasks inherit task visibility and enforce project roles', async () => {
      const visible = (await expectStatus('/subtasks', 201, {
        method: 'POST', cookie: editorCookie,
        body: { taskId: assigned.id, name: 'Pour concrete', due: '2026-07-10',
          ownerAssigneeId: viewer.userId, status: 'Not started' },
      })).data;
      const privateChild = (await expectStatus('/subtasks', 201, {
        method: 'POST', cookie: ownerCookie,
        body: { taskId: hidden.id, name: 'Inspect another area', due: '2026-06-10',
          ownerAssigneeId: editor.userId },
      })).data;
      const afterCreate = (await expectStatus('/workspace', 200, { cookie: ownerCookie })).data;
      assert.equal(afterCreate.tasks.find((task: Json) => task.id === assigned.id).due, '2026-07-10');
      assert.equal(afterCreate.milestones.find((item: Json) => item.id === milestoneHidden.id).due, '2026-07-10');
      const viewerWorkspace = (await expectStatus('/workspace', 200, { cookie: viewerCookie })).data;
      assert.deepEqual(viewerWorkspace.subtasks.map((item: Json) => item.id), [visible.id]);
      assert.equal(viewerWorkspace.subtasks[0].taskId, assigned.id);
      assert.equal(viewerWorkspace.subtasks[0].ownerAssigneeId, viewer.userId);
      const childOnlyParent = (await expectStatus('/tasks', 201, {
        method: 'POST', cookie: ownerCookie,
        body: taskInput(projectA.id, milestoneA.id, 'Subtask-owned parent', []),
      })).data;
      const ownedOnly = (await expectStatus('/subtasks', 201, {
        method: 'POST', cookie: ownerCookie,
        body: { taskId: childOnlyParent.id, name: 'Viewer step', due: '2026-08-01',
          ownerAssigneeId: viewer.userId },
      })).data;
      const sibling = (await expectStatus('/subtasks', 201, {
        method: 'POST', cookie: ownerCookie,
        body: { taskId: childOnlyParent.id, name: 'Editor step', due: '2026-09-01',
          ownerAssigneeId: editor.userId },
      })).data;
      const subtaskOwnerWorkspace = (await expectStatus('/workspace', 200, { cookie: viewerCookie })).data;
      assert(subtaskOwnerWorkspace.tasks.some((task: Json) => task.id === childOnlyParent.id));
      assert(subtaskOwnerWorkspace.subtasks.some((item: Json) => item.id === ownedOnly.id));
      assert(!subtaskOwnerWorkspace.subtasks.some((item: Json) => item.id === sibling.id));
      await expectStatus(`/tasks/${childOnlyParent.id}`, 204, { method: 'DELETE', cookie: ownerCookie });
      const editorWorkspace = (await expectStatus('/workspace', 200, { cookie: editorCookie })).data;
      assert.deepEqual(new Set(editorWorkspace.subtasks.map((item: Json) => item.id)),
        new Set([visible.id, privateChild.id]));
      await expectStatus('/subtasks', 403, {
        method: 'POST', cookie: viewerCookie,
        body: { taskId: assigned.id, name: 'Not allowed', due: '2026-07-01', ownerAssigneeId: viewer.userId },
      });
      await expectStatus('/subtasks', 404, {
        method: 'POST', cookie: outsiderCookie,
        body: { taskId: assigned.id, name: 'Other project', due: '2026-07-01', ownerAssigneeId: outsider.id },
      });
      await expectStatus('/subtasks', 400, {
        method: 'POST', cookie: editorCookie,
        body: { taskId: assigned.id, name: 'Wrong owner', due: '2026-07-01', ownerAssigneeId: outsider.id },
      });
      await expectStatus(`/subtasks/${visible.id}`, 403, {
        method: 'PATCH', cookie: viewerCookie, body: { version: visible.version, status: 'Done' },
      });
      const updated = (await expectStatus(`/subtasks/${visible.id}`, 200, {
        method: 'PATCH', cookie: editorCookie,
        body: { version: visible.version, name: 'Pour foundation concrete', due: '2026-04-01', status: 'Done' },
      })).data;
      assert.equal(updated.version, visible.version + 1);
      const afterMove = (await expectStatus('/workspace', 200, { cookie: ownerCookie })).data;
      assert.equal(afterMove.tasks.find((task: Json) => task.id === assigned.id).due, '2026-04-01');
      assert.equal(afterMove.milestones.find((item: Json) => item.id === milestoneHidden.id).due, '2026-06-10');
      await expectStatus(`/subtasks/${visible.id}`, 409, {
        method: 'PATCH', cookie: ownerCookie, body: { version: visible.version, status: 'Blocked' },
      });
      await expectStatus(`/subtasks/${visible.id}`, 403, { method: 'DELETE', cookie: editorCookie });
      await expectStatus(`/subtasks/${visible.id}`, 204, { method: 'DELETE', cookie: ownerCookie });
      const after = (await expectStatus('/workspace', 200, { cookie: viewerCookie })).data;
      assert.deepEqual(after.subtasks, []);
      const restored = (await expectStatus('/workspace', 200, { cookie: ownerCookie })).data;
      assert.equal(restored.tasks.find((task: Json) => task.id === assigned.id).due, '2026-05-01');
      assert.equal(restored.milestones.find((item: Json) => item.id === milestoneHidden.id).due, '2026-06-10');
      await expectStatus(`/subtasks/${privateChild.id}`, 204, { method: 'DELETE', cookie: ownerCookie });
      const fullyRestored = (await expectStatus('/workspace', 200, { cookie: ownerCookie })).data;
      assert.equal(fullyRestored.milestones.find((item: Json) => item.id === milestoneHidden.id).due, '2026-05-01');
    });

    await t.test('owner changes and removes project membership', async () => {
      await expectStatus(`/projects/${projectA.id}/members/${viewer.userId}`, 200, {
        method: 'PATCH', cookie: ownerCookie, body: { role: 'editor' },
      });
      let workspace = (await expectStatus('/workspace', 200, { cookie: viewerCookie })).data;
      assert.equal(workspace.tasks.length, 2);
      await expectStatus(`/projects/${projectA.id}/members/${viewer.userId}`, 200, {
        method: 'PATCH', cookie: ownerCookie, body: { role: 'viewer' },
      });
      workspace = (await expectStatus('/workspace', 200, { cookie: viewerCookie })).data;
      assert.equal(workspace.tasks.length, 1);
      await expectStatus(`/projects/${projectA.id}/members/${viewer.userId}`, 204, {
        method: 'DELETE', cookie: ownerCookie,
      });
      workspace = (await expectStatus('/workspace', 200, { cookie: viewerCookie })).data;
      assert.deepEqual(workspace.projects, []);
      assert.deepEqual(workspace.tasks, []);
      const ownerWorkspace = (await expectStatus('/workspace', 200, { cookie: ownerCookie })).data;
      const task = ownerWorkspace.tasks.find((item: Json) => item.id === assigned.id);
      assert.deepEqual(task.assigneeUserIds, []);
    });

    await t.test('unrelated signed-in user sees no projects or tasks', async () => {
      const workspace = (await expectStatus('/workspace', 200, { cookie: outsiderCookie })).data;
      assert.deepEqual(workspace.projects, []);
      assert.deepEqual(workspace.tasks, []);
      await expectStatus(`/projects/${projectA.id}/members`, 404, { cookie: outsiderCookie });
    });

    await t.test('existing account accepts an invite only while signed in as that email', async () => {
      const token = await invitationToken(projectB.id, outsider.username, outsider.email, 'viewer', ownerCookie);
      const info = await expectStatus(`/invitations/${token}`, 200);
      assert.equal(info.data.existingUser, true);
      const wrongAccount = await request('/invitations/accept', {
        method: 'POST', cookie: editorCookie, body: { token },
      });
      assert.notEqual(wrongAccount.status, 200);
      await expectStatus('/invitations/accept', 200, {
        method: 'POST', cookie: outsiderCookie, body: { token },
      });
      const workspace = (await expectStatus('/workspace', 200, { cookie: outsiderCookie })).data;
      assert.deepEqual(workspace.projects.map((item: Json) => item.id), [projectB.id]);
      assert.deepEqual(workspace.tasks, []);
      assert.deepEqual(workspace.milestones, []);
    });

    await t.test('an invited username can receive tasks before signup and see them immediately after', async () => {
      const issued = await issueInvitation(projectA.id, 'future1', 'future@example.test', 'viewer', ownerCookie);
      const editorMembers = (await expectStatus(`/projects/${projectA.id}/members`, 200,
        { cookie: editorCookie })).data;
      const pending = editorMembers.invitations.find((invite: Json) => invite.username === 'future1');
      assert(pending?.assigneeId?.startsWith('pending:'));
      assert.equal(pending.email, undefined);
      const planned = (await expectStatus('/tasks', 201, {
        method: 'POST', cookie: editorCookie,
        body: taskInput(projectA.id, milestoneA.id, 'Ready on first login', [pending.assigneeId]),
      })).data;
      const assignedChild = (await expectStatus('/subtasks', 201, {
        method: 'POST', cookie: editorCookie,
        body: { taskId: planned.id, name: 'Prepare formwork', due: '2026-07-01',
          ownerAssigneeId: pending.assigneeId },
      })).data;
      assert.deepEqual(planned.assigneeUserIds, [pending.assigneeId]);
      const before = (await expectStatus('/workspace', 200, { cookie: ownerCookie })).data;
      assert.deepEqual(before.tasks.find((task: Json) => task.id === planned.id).assigneeUserIds,
        [pending.assigneeId]);
      assert.equal(before.subtasks.find((subtask: Json) => subtask.id === assignedChild.id).ownerAssigneeId,
        pending.assigneeId);

      // Expiry and reissue to the same email must keep preassigned work.
      const raw = new Database(env.DATABASE_PATH);
      try { raw.prepare('UPDATE invitations SET expires_at = ? WHERE id = ?').run(Date.now() - 1, issued.id); }
      finally { raw.close(); }
      const replacement = await issueInvitation(projectA.id, 'future1', 'future@example.test', 'viewer', ownerCookie);
      const ownerMembers = (await expectStatus(`/projects/${projectA.id}/members`, 200,
        { cookie: ownerCookie })).data;
      assert.equal(ownerMembers.invitations.find((invite: Json) => invite.id === replacement.id)?.assigneeId,
        pending.assigneeId);
      await expectStatus('/invitations/accept', 200, {
        method: 'POST', body: { token: replacement.token, password },
      });
      const futureCookie = await signIn('future1');
      const after = (await expectStatus('/workspace', 200, { cookie: futureCookie })).data;
      assert.deepEqual(after.tasks.map((task: Json) => task.id), [planned.id]);
      assert.deepEqual(after.milestones.map((milestone: Json) => milestone.id), [milestoneA.id]);
      const promoted = after.tasks[0].assigneeUserIds[0];
      assert(promoted && promoted !== pending.assigneeId);
      assert.equal(after.subtasks.find((subtask: Json) => subtask.id === assignedChild.id).ownerAssigneeId,
        promoted);
      assert.equal(after.subtasks.find((subtask: Json) => subtask.id === assignedChild.id).version,
        assignedChild.version + 1);
      const check = new Database(env.DATABASE_PATH, { readonly: true });
      try {
        const pendingCount = check.prepare('SELECT count(*) as n FROM pending_task_assignments WHERE task_id = ?')
          .get(planned.id) as { n: number };
        assert.equal(pendingCount.n, 0);
      } finally { check.close(); }
    });

    await t.test('expired and owner-revoked links cannot be accepted', async () => {
      const expired = await issueInvitation(projectB.id, 'lateuser', 'late@example.test', 'viewer', ownerCookie);
      const raw = new Database(env.DATABASE_PATH);
      try {
        raw.prepare('UPDATE invitations SET expires_at = ? WHERE id = ?')
          .run(Date.now() - 1, expired.id);
      } finally {
        raw.close();
      }
      await expectStatus(`/invitations/${expired.token}`, 404);
      await expectStatus('/invitations/accept', 404, {
        method: 'POST', body: { token: expired.token, password },
      });
      // An expired row no longer reserves this project/email, so the owner can reissue.
      const replacement = await issueInvitation(projectB.id, 'lateuser', 'late@example.test', 'viewer', ownerCookie);
      await expectStatus(`/invitations/${replacement.token}`, 200);
      const pendingOwner = (await expectStatus(`/projects/${projectB.id}/members`, 200,
        { cookie: ownerCookie })).data.invitations.find((invite: Json) => invite.id === replacement.id);
      const taskB = (await expectStatus('/workspace', 200, { cookie: ownerCookie })).data.tasks
        .find((task: Json) => task.projectId === projectB.id);
      const child = (await expectStatus('/subtasks', 201, {
        method: 'POST', cookie: ownerCookie,
        body: { taskId: taskB.id, name: 'Pending owner', due: '2026-07-01',
          ownerAssigneeId: pendingOwner.assigneeId },
      })).data;
      await expectStatus(`/projects/${projectB.id}/invitations/${replacement.id}`, 204, {
        method: 'DELETE', cookie: ownerCookie,
      });
      const afterRevocation = (await expectStatus('/workspace', 200, { cookie: ownerCookie })).data;
      assert.equal(afterRevocation.subtasks.find((item: Json) => item.id === child.id).ownerAssigneeId, null);
      assert.equal(afterRevocation.subtasks.find((item: Json) => item.id === child.id).version,
        child.version + 1);
      await expectStatus(`/invitations/${replacement.token}`, 404);
      await expectStatus('/invitations/accept', 404, {
        method: 'POST', body: { token: replacement.token, password },
      });
    });
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise<void>((resolve) => child!.once('exit', () => resolve())), delay(2_000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    const resolvedDirectory = resolve(directory);
    assert(resolvedDirectory.startsWith(`${resolve(tmpdir())}${sep}`)
      && basename(resolvedDirectory).startsWith('fieldline-api-test-'));
    rmSync(resolvedDirectory, { recursive: true, force: true });
  }
});
