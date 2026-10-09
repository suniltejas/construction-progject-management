import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { user } from '../auth/auth-schema.js';
import { getSessionFromRequest } from '../auth/session.js';
import { invitations, milestones, pendingTaskAssignments, projectMemberships, projects, subtasks, taskAssignments, tasks } from '../db/schema.js';
import { ApiError, assert } from './errors.js';

export type ProjectRole = 'owner' | 'editor' | 'viewer';

/** Stable browser identifier for an invited email; it is never a user ID. */
export function pendingAssigneeId(email: string): string {
  return `pending:${createHash('sha256').update(email).digest('base64url')}`;
}

export async function requireUser(req: Request) {
  const session = await getSessionFromRequest(req);
  if (!session?.user) throw new ApiError(401, 'Sign in to continue');
  return session.user;
}

export function projectAccess(projectId: string, userId: string) {
  const [project] = db.select().from(projects).where(eq(projects.id, projectId)).limit(1).all();
  assert(project, 404, 'Project not found');
  if (project.ownerUserId === userId) return { project, role: 'owner' as const };
  const [membership] = db.select().from(projectMemberships)
    .where(and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, userId))).limit(1).all();
  assert(membership, 404, 'Project not found');
  return { project, role: membership.role as 'editor' | 'viewer' };
}

export function requireRole(projectId: string, userId: string, allowed: readonly ProjectRole[]) {
  const access = projectAccess(projectId, userId);
  assert(allowed.includes(access.role), 403, 'You do not have permission for this action');
  return access;
}

export function validAssignees(projectId: string, assigneeUserIds: string[]) {
  const ids = [...new Set(assigneeUserIds)];
  const [project] = db.select().from(projects).where(eq(projects.id, projectId)).limit(1).all();
  assert(project, 404, 'Project not found');
  const members = db.select({ userId: projectMemberships.userId }).from(projectMemberships)
    .where(eq(projectMemberships.projectId, projectId)).all();
  const allowed = new Set([project.ownerUserId, ...members.map((member) => member.userId)]);
  const pending = db.select({ email: invitations.email }).from(invitations)
    .where(and(eq(invitations.projectId, projectId), isNull(invitations.acceptedAt),
      isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date()))).all();
  const pendingById = new Map(pending.map((invite) => [pendingAssigneeId(invite.email), invite.email]));
  const userIds: string[] = [];
  const pendingEmails: string[] = [];
  for (const id of ids) {
    if (allowed.has(id)) userIds.push(id);
    else if (pendingById.has(id)) pendingEmails.push(pendingById.get(id)!);
    else throw new ApiError(400, 'Every assignee must be a project member or active invitee');
  }
  return { userIds, pendingEmails };
}

export function taskForClient(task: typeof tasks.$inferSelect, assigneeUserIds: string[]) {
  const { ownerLabel, ...rest } = task;
  return { ...rest, owner: ownerLabel, assigneeUserIds };
}

export function loadWorkspace(userId: string) {
  const owned = db.select().from(projects).where(eq(projects.ownerUserId, userId)).all();
  const memberships = db.select().from(projectMemberships).where(eq(projectMemberships.userId, userId)).all();
  const projectList = [...owned];
  for (const membership of memberships) {
    const [project] = db.select().from(projects).where(eq(projects.id, membership.projectId)).limit(1).all();
    if (project && !projectList.some((item) => item.id === project.id)) projectList.push(project);
  }
  const roleByProject = new Map<string, ProjectRole>();
  for (const project of owned) roleByProject.set(project.id, 'owner');
  for (const membership of memberships) {
    if (!roleByProject.has(membership.projectId)) roleByProject.set(membership.projectId, membership.role);
  }
  const visibleProjects: Record<string, unknown>[] = [];
  const visibleMilestones: (typeof milestones.$inferSelect)[] = [];
  const visibleTasks: ReturnType<typeof taskForClient>[] = [];
  const visibleSubtasks: (typeof subtasks.$inferSelect)[] = [];
  for (const project of projectList) {
    const role = roleByProject.get(project.id);
    if (!role) continue;
    visibleProjects.push(role === 'viewer' ? { id: project.id, name: project.name, role } : { ...project, role });
    let projectTasks = db.select().from(tasks).where(eq(tasks.projectId, project.id)).all();
    const directlyAssignedTaskIds = new Set<string>();
    if (role === 'viewer') {
      const assignments = db.select({ taskId: taskAssignments.taskId }).from(taskAssignments)
        .where(and(eq(taskAssignments.projectId, project.id), eq(taskAssignments.userId, userId))).all();
      for (const assignment of assignments) directlyAssignedTaskIds.add(assignment.taskId);
      const owned = db.select({ taskId: subtasks.taskId }).from(subtasks)
        .where(and(eq(subtasks.projectId, project.id), eq(subtasks.ownerAssigneeId, userId))).all();
      const allowedTaskIds = new Set([...directlyAssignedTaskIds, ...owned.map((item) => item.taskId)]);
      projectTasks = projectTasks.filter((task) => allowedTaskIds.has(task.id));
    }
    const milestoneIds = new Set(projectTasks.map((task) => task.milestoneId));
    const projectMilestones = db.select().from(milestones).where(eq(milestones.projectId, project.id)).all();
    visibleMilestones.push(...(role === 'viewer'
      ? projectMilestones.filter((milestone) => milestoneIds.has(milestone.id))
      : projectMilestones));
    const assignmentRows = projectTasks.length
      ? db.select().from(taskAssignments).where(inArray(taskAssignments.taskId, projectTasks.map((task) => task.id))).all()
      : [];
    const pendingRows = role !== 'viewer' && projectTasks.length
      ? db.select().from(pendingTaskAssignments)
        .where(inArray(pendingTaskAssignments.taskId, projectTasks.map((task) => task.id))).all()
      : [];
    for (const task of projectTasks) {
      const assigneeIds = role === 'viewer'
        ? [userId]
        : [
          ...assignmentRows.filter((assignment) => assignment.taskId === task.id).map((assignment) => assignment.userId),
          ...pendingRows.filter((assignment) => assignment.taskId === task.id)
            .map((assignment) => pendingAssigneeId(assignment.email)),
        ];
      visibleTasks.push(taskForClient(task, assigneeIds));
    }
    if (projectTasks.length) {
      const childRows = db.select().from(subtasks)
        .where(and(eq(subtasks.projectId, project.id),
          inArray(subtasks.taskId, projectTasks.map((task) => task.id))))
        .orderBy(subtasks.createdAt, subtasks.id).all();
      visibleSubtasks.push(...(role === 'viewer'
        ? childRows.filter((child) => directlyAssignedTaskIds.has(child.taskId)
          || child.ownerAssigneeId === userId)
        : childRows));
    }
  }
  return {
    projects: visibleProjects,
    milestones: visibleMilestones,
    tasks: visibleTasks,
    subtasks: visibleSubtasks,
    memberships: [...roleByProject].map(([projectId, role]) => ({ projectId, role })),
  };
}

export function listMembers(projectId: string, userId: string) {
  const { project, role } = requireRole(projectId, userId, ['owner', 'editor']);
  const memberRows = db.select({
    userId: user.id, username: user.username, email: user.email, role: projectMemberships.role,
  }).from(projectMemberships).innerJoin(user, eq(projectMemberships.userId, user.id))
    .where(eq(projectMemberships.projectId, projectId)).all();
  const [owner] = db.select({ userId: user.id, username: user.username, email: user.email })
    .from(user).where(eq(user.id, project.ownerUserId)).limit(1).all();
  const members = [
    ...(owner ? [{ ...owner, email: role === 'owner' ? owner.email : undefined, role: 'owner' as const }] : []),
    ...memberRows.map((member) => ({ ...member, email: role === 'owner' ? member.email : undefined })),
  ];
  const pending = db.select({ id: invitations.id, username: invitations.username,
    email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt })
    .from(invitations).where(and(eq(invitations.projectId, projectId),
      isNull(invitations.acceptedAt), isNull(invitations.revokedAt),
      gt(invitations.expiresAt, new Date()))).all()
    .map((invite) => ({ ...invite, email: role === 'owner' ? invite.email : undefined,
      assigneeId: pendingAssigneeId(invite.email) }));
  return { members, invitations: pending };
}
