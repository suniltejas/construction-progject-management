import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as authSchema from '../auth/auth-schema.js';
import * as appSchema from './schema.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle/', import.meta.url));

function freshDatabase(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  migrate(drizzle(sqlite, { schema: { ...authSchema, ...appSchema } }), { migrationsFolder });
  sqlite.exec(`
    INSERT INTO user (id, name, email, username) VALUES
      ('owner', 'Owner', 'owner@example.com', 'owner'),
      ('viewer', 'Viewer', 'viewer@example.com', 'viewer');
    INSERT INTO projects (id, owner_user_id, name, start, end) VALUES
      ('p1', 'owner', 'First', '2026-01-01', '2026-12-31'),
      ('p2', 'owner', 'Second', '2026-01-01', '2026-12-31');
    INSERT INTO milestones (id, project_id, name, due) VALUES
      ('m1', 'p1', 'First milestone', '2026-05-01'),
      ('m2', 'p2', 'Second milestone', '2026-05-01');
  `);
  return sqlite;
}

test('task milestone and task assignment must belong to the same project', () => {
  const sqlite = freshDatabase();
  try {
    assert.throws(() => sqlite.prepare(`INSERT INTO tasks (id, project_id, milestone_id, name, due)
      VALUES ('bad', 'p1', 'm2', 'Wrong milestone', '2026-04-01')`).run(), /FOREIGN KEY constraint failed/);
    sqlite.prepare(`INSERT INTO tasks (id, project_id, milestone_id, name, due)
      VALUES ('t1', 'p1', 'm1', 'Valid task', '2026-04-01')`).run();
    assert.throws(() => sqlite.prepare(`INSERT INTO task_assignments (project_id, task_id, user_id)
      VALUES ('p2', 't1', 'viewer')`).run(), /FOREIGN KEY constraint failed/);
    sqlite.prepare(`INSERT INTO task_assignments (project_id, task_id, user_id)
      VALUES ('p1', 't1', 'viewer')`).run();
    assert.throws(() => sqlite.prepare(`INSERT INTO pending_task_assignments (project_id, task_id, email)
      VALUES ('p2', 't1', 'future@example.com')`).run(), /FOREIGN KEY constraint failed/);
    assert.throws(() => sqlite.prepare(`INSERT INTO pending_task_assignments (project_id, task_id, email)
      VALUES ('p1', 't1', 'Future@example.com')`).run(), /CHECK constraint failed/);
    sqlite.prepare(`INSERT INTO pending_task_assignments (project_id, task_id, email)
      VALUES ('p1', 't1', 'future@example.com')`).run();
    assert.throws(() => sqlite.prepare(`INSERT INTO subtasks (id, project_id, task_id, name)
      VALUES ('bad-child', 'p2', 't1', 'Wrong project')`).run(), /FOREIGN KEY constraint failed/);
    assert.throws(() => sqlite.prepare(`INSERT INTO subtasks (id, project_id, task_id, name)
      VALUES ('blank-child', 'p1', 't1', '   ')`).run(), /CHECK constraint failed/);
    sqlite.prepare(`INSERT INTO subtasks (id, project_id, task_id, name)
      VALUES ('s1', 'p1', 't1', 'First step')`).run();
    sqlite.prepare(`DELETE FROM projects WHERE id = 'p1'`).run();
    assert.equal((sqlite.prepare(`SELECT count(*) AS count FROM tasks WHERE id = 't1'`).get() as { count: number }).count, 0);
    assert.equal((sqlite.prepare(`SELECT count(*) AS count FROM task_assignments WHERE task_id = 't1'`).get() as { count: number }).count, 0);
    assert.equal((sqlite.prepare(`SELECT count(*) AS count FROM pending_task_assignments WHERE task_id = 't1'`).get() as { count: number }).count, 0);
    assert.equal((sqlite.prepare(`SELECT count(*) AS count FROM subtasks WHERE id = 's1'`).get() as { count: number }).count, 0);
  } finally {
    sqlite.close();
  }
});

test('project membership and invitation constraints reject invalid role or duplicate open invite', () => {
  const sqlite = freshDatabase();
  try {
    assert.throws(() => sqlite.prepare(`INSERT INTO project_memberships (project_id, user_id, role)
      VALUES ('p1', 'viewer', 'owner')`).run(), /CHECK constraint failed/);
    sqlite.prepare(`INSERT INTO project_memberships (project_id, user_id, role)
      VALUES ('p1', 'viewer', 'viewer')`).run();
    assert.throws(() => sqlite.prepare(`INSERT INTO invitations
      (id, project_id, email, username, role, token_hash, expires_at)
      VALUES ('bad', 'p1', 'Viewer@example.com', 'viewer2', 'viewer', 'hash0', 2000000000000)`).run(), /CHECK constraint failed/);
    sqlite.prepare(`INSERT INTO invitations
      (id, project_id, email, username, role, token_hash, expires_at)
      VALUES ('i1', 'p1', 'viewer@example.com', 'viewer2', 'viewer', 'hash1', 2000000000000)`).run();
    assert.throws(() => sqlite.prepare(`INSERT INTO invitations
      (id, project_id, email, username, role, token_hash, expires_at)
      VALUES ('i2', 'p1', 'viewer@example.com', 'viewer2', 'editor', 'hash2', 2000000000000)`).run(), /UNIQUE constraint failed/);
    sqlite.prepare(`UPDATE invitations SET revoked_at = 1800000000000 WHERE id = 'i1'`).run();
    sqlite.prepare(`INSERT INTO invitations
      (id, project_id, email, username, role, token_hash, expires_at)
      VALUES ('i2', 'p1', 'viewer@example.com', 'viewer2', 'editor', 'hash2', 2000000000000)`).run();
  } finally {
    sqlite.close();
  }
});
