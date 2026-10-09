import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { user } from '../auth/auth-schema.js';

// App-owned tables. Better Auth's four tables live in ../auth/auth-schema.ts.
// IDs remain text so an existing browser export can retain its UUIDs.
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull().references(() => user.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  location: text('location').notNull().default(''),
  lead: text('lead').notNull().default(''),
  start: text('start').notNull(),
  end: text('end').notNull(),
  stage: text('stage').notNull().default('Planning'),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text('updated_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  index('projects_owner_idx').on(table.ownerUserId),
  check('projects_stage_check', sql`${table.stage} in ('Planning', 'In progress', 'On hold', 'Completed')`),
  check('projects_version_check', sql`${table.version} > 0`),
]);

// The owner is represented by projects.ownerUserId; these rows only grant
// delegated editor/viewer access and are scoped to one project.
export const projectMemberships = sqliteTable('project_memberships', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['editor', 'viewer'] }).notNull(),
  createdAt: text('created_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.userId] }),
  index('project_memberships_user_idx').on(table.userId),
  check('project_memberships_role_check', sql`${table.role} in ('editor', 'viewer')`),
]);

export const milestones = sqliteTable('milestones', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  due: text('due').notNull(),
  plannedDue: text('planned_due'),
  status: text('status').notNull().default('Upcoming'),
  migrationBucket: integer('migration_bucket', { mode: 'boolean' }).notNull().default(false),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text('updated_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  uniqueIndex('milestones_project_id_id_uq').on(table.projectId, table.id),
  index('milestones_project_due_idx').on(table.projectId, table.due),
  check('milestones_status_check', sql`${table.status} in ('Upcoming', 'At risk', 'Complete')`),
  check('milestones_version_check', sql`${table.version} > 0`),
]);

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  milestoneId: text('milestone_id').notNull(),
  name: text('name').notNull(),
  // Legacy free-text owner/crew label, never used as an access grant.
  ownerLabel: text('owner_label').notNull().default(''),
  due: text('due').notNull(),
  plannedDue: text('planned_due'),
  status: text('status').notNull().default('Not started'),
  priority: text('priority').notNull().default('Normal'),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text('updated_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  uniqueIndex('tasks_project_id_id_uq').on(table.projectId, table.id),
  index('tasks_project_due_idx').on(table.projectId, table.due),
  index('tasks_project_milestone_idx').on(table.projectId, table.milestoneId),
  foreignKey({
    columns: [table.projectId, table.milestoneId],
    foreignColumns: [milestones.projectId, milestones.id],
    name: 'tasks_same_project_milestone_fk',
  }).onDelete('cascade'),
  check('tasks_status_check', sql`${table.status} in ('Not started', 'In progress', 'Blocked', 'Done')`),
  check('tasks_priority_check', sql`${table.priority} in ('Normal', 'High', 'Critical')`),
  check('tasks_version_check', sql`${table.version} > 0`),
]);

// Subtasks inherit their parent task's milestone. An owner can be an active
// project user ID or a pending invitation ID until that invitation is accepted.
// The composite key prevents a subtask from pointing at another project's task.
export const subtasks = sqliteTable('subtasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  taskId: text('task_id').notNull(),
  name: text('name').notNull(),
  due: text('due'),
  ownerAssigneeId: text('owner_assignee_id'),
  status: text('status').notNull().default('Not started'),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text('updated_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  index('subtasks_task_idx').on(table.projectId, table.taskId, table.createdAt),
  index('subtasks_owner_idx').on(table.projectId, table.ownerAssigneeId),
  foreignKey({
    columns: [table.projectId, table.taskId],
    foreignColumns: [tasks.projectId, tasks.id],
    name: 'subtasks_same_project_task_fk',
  }).onDelete('cascade'),
  check('subtasks_status_check', sql`${table.status} in ('Not started', 'In progress', 'Blocked', 'Done')`),
  check('subtasks_name_check', sql`length(trim(${table.name})) > 0`),
  check('subtasks_version_check', sql`${table.version} > 0`),
]);

// A task can be assigned to several users. The API checks that each assignee
// is the project owner or an active member before inserting a row.
export const taskAssignments = sqliteTable('task_assignments', {
  projectId: text('project_id').notNull(),
  taskId: text('task_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  primaryKey({ columns: [table.taskId, table.userId] }),
  index('task_assignments_user_idx').on(table.userId, table.projectId),
  foreignKey({
    columns: [table.projectId, table.taskId],
    foreignColumns: [tasks.projectId, tasks.id],
    name: 'task_assignments_same_project_task_fk',
  }).onDelete('cascade'),
]);

// Invitation tokens are never stored in plaintext. A pending invitation can
// reserve a username until acceptance or expiry; the service enforces this.
export const invitations = sqliteTable('invitations', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  username: text('username').notNull(),
  role: text('role', { enum: ['editor', 'viewer'] }).notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  invitedByUserId: text('invited_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
  acceptedByUserId: text('accepted_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  createdAt: text('created_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  index('invitations_project_idx').on(table.projectId),
  index('invitations_email_idx').on(table.email),
  index('invitations_username_idx').on(table.username),
  uniqueIndex('invitations_open_project_email_uq').on(table.projectId, table.email)
    .where(sql`${table.acceptedAt} is null and ${table.revokedAt} is null`),
  check('invitations_role_check', sql`${table.role} in ('editor', 'viewer')`),
  check('invitations_normalized_email_check', sql`${table.email} = lower(trim(${table.email}))`),
  check('invitations_normalized_username_check', sql`${table.username} = lower(trim(${table.username}))`),
]);

// An invitation can receive tasks before its recipient has a Better Auth
// account. The email is stable across an expired invitation and its reissue.
// Acceptance moves these rows into task_assignments in one transaction.
export const pendingTaskAssignments = sqliteTable('pending_task_assignments', {
  projectId: text('project_id').notNull(),
  taskId: text('task_id').notNull(),
  email: text('email').notNull(),
  createdAt: text('created_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (table) => [
  primaryKey({ columns: [table.taskId, table.email] }),
  index('pending_task_assignments_email_idx').on(table.projectId, table.email),
  foreignKey({
    columns: [table.projectId, table.taskId],
    foreignColumns: [tasks.projectId, tasks.id],
    name: 'pending_task_assignments_same_project_task_fk',
  }).onDelete('cascade'),
  check('pending_task_assignments_normalized_email_check', sql`${table.email} = lower(trim(${table.email}))`),
]);
