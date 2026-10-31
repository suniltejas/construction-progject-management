import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { latestSubtaskDeadline, latestTaskDeadline, syncMilestoneDeadline, syncTaskDeadline } from '../db/deadlines.js';
import { attachments, milestones, notes, pendingTaskAssignments, projectMemberships, projects, subtasks, taskAssignments, tasks } from '../db/schema.js';
import { classify, storedFilePath, withUploadFile } from '../files/storage.js';
import { listMembers, loadWorkspace, pendingAssigneeId, requireRole, requireUser, taskForClient, validAssignees } from './access.js';
import { ApiError, assert } from './errors.js';
import { memberPatch, milestoneInput, milestonePatch, noteBodyInput, parse, projectInput, projectPatch, subtaskInput, subtaskPatch, taskInput, taskPatch } from './validation.js';

export const appRouter = Router();

function routeId(value: unknown): string {
  assert(typeof value === 'string' && value.length > 0 && value.length <= 100, 400, 'Invalid ID');
  return value;
}

function checkDates(start: string, end: string) {
  assert(end >= start, 400, 'Target finish must be after start date');
}

function existingTask(id: string) {
  const task = db.select().from(tasks).where(eq(tasks.id, id)).limit(1).get();
  assert(task, 404, 'Task not found');
  return task;
}

function existingSubtask(id: string) {
  const subtask = db.select().from(subtasks).where(eq(subtasks.id, id)).limit(1).get();
  assert(subtask, 404, 'Subtask not found');
  return subtask;
}

function existingMilestone(id: string) {
  const milestone = db.select().from(milestones).where(eq(milestones.id, id)).limit(1).get();
  assert(milestone, 404, 'Milestone not found');
  return milestone;
}

function requireMilestone(projectId: string, milestoneId: string) {
  const milestone = db.select({ id: milestones.id }).from(milestones)
    .where(and(eq(milestones.projectId, projectId), eq(milestones.id, milestoneId))).limit(1).get();
  assert(milestone, 400, 'Select a milestone from this project');
}

function fullTask(id: string) {
  const task = existingTask(id);
  const assigned = db.select({ userId: taskAssignments.userId }).from(taskAssignments)
    .where(eq(taskAssignments.taskId, id)).all();
  const pending = db.select({ email: pendingTaskAssignments.email }).from(pendingTaskAssignments)
    .where(eq(pendingTaskAssignments.taskId, id)).all();
  return taskForClient(task, [
    ...assigned.map((item) => item.userId),
    ...pending.map((item) => pendingAssigneeId(item.email)),
  ]);
}

function viewerCanSeeTask(taskId: string, userId: string): boolean {
  const assigned = db.select({ taskId: taskAssignments.taskId }).from(taskAssignments)
    .where(and(eq(taskAssignments.taskId, taskId), eq(taskAssignments.userId, userId))).limit(1).get();
  if (assigned) return true;
  const ownedChild = db.select({ id: subtasks.id }).from(subtasks)
    .where(and(eq(subtasks.taskId, taskId), eq(subtasks.ownerAssigneeId, userId))).limit(1).get();
  return Boolean(ownedChild);
}

function viewerCanSeeAttachment(projectId: string, userId: string, parentType: 'task' | 'milestone', parentId: string): boolean {
  if (parentType === 'task') return viewerCanSeeTask(parentId, userId);
  const milestoneTasks = db.select({ id: tasks.id }).from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.milestoneId, parentId))).all();
  return milestoneTasks.some((task) => viewerCanSeeTask(task.id, userId));
}

const taskFileGuard: RequestHandler = async (req, res, next) => {
  try {
    const user = await requireUser(req);
    const task = existingTask(routeId(req.params.id));
    requireRole(task.projectId, user.id, ['owner', 'editor']);
    res.locals.fileUser = user;
    res.locals.fileParent = task;
    next();
  } catch (error) { next(error); }
};

const milestoneFileGuard: RequestHandler = async (req, res, next) => {
  try {
    const user = await requireUser(req);
    const milestone = existingMilestone(routeId(req.params.id));
    requireRole(milestone.projectId, user.id, ['owner', 'editor']);
    res.locals.fileUser = user;
    res.locals.fileParent = milestone;
    next();
  } catch (error) { next(error); }
};

function saveAttachment(req: Request, res: Response, parentType: 'task' | 'milestone') {
  const file = req.file;
  const parent = res.locals.fileParent as { id: string; projectId: string };
  const user = res.locals.fileUser as { id: string };
  if (!file) throw new ApiError(400, 'No file uploaded');
  try {
    return db.insert(attachments).values({
      id: file.filename, projectId: parent.projectId, parentType, parentId: parent.id,
      originalName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size,
      uploadedUserId: user.id,
    }).returning().get();
  } catch (error) {
    try { unlinkSync(storedFilePath(file.filename)); } catch { /* ignore */ }
    throw error;
  }
}

appRouter.get('/session', async (req, res) => {
  const session = await import('../auth/session.js').then(({ getSessionFromRequest }) => getSessionFromRequest(req));
  const user = session?.user;
  res.json({ user: user ? { id: user.id, username: user.username, email: user.email } : null });
});

appRouter.get('/workspace', async (req, res) => {
  const user = await requireUser(req);
  res.json(loadWorkspace(user.id));
});

appRouter.post('/projects', async (req, res) => {
  const user = await requireUser(req);
  const input = parse(projectInput, req.body);
  checkDates(input.start, input.end);
  const project = db.insert(projects).values({ id: randomUUID(), ownerUserId: user.id, ...input })
    .returning().get();
  res.status(201).json({ ...project, role: 'owner' });
});

appRouter.patch('/projects/:id', async (req, res) => {
  const user = await requireUser(req);
  const id = routeId(req.params.id);
  const { project } = requireRole(id, user.id, ['owner']);
  const { version, ...input } = parse(projectPatch, req.body);
  checkDates(input.start ?? project.start, input.end ?? project.end);
  const updated = db.update(projects).set({ ...input, version: sql`${projects.version} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(projects.id, id), eq(projects.version, version))).returning().get();
  assert(updated, 409, 'Project changed elsewhere. Refresh and try again');
  res.json({ ...updated, role: 'owner' });
});

appRouter.delete('/projects/:id', async (req, res) => {
  const user = await requireUser(req);
  const id = routeId(req.params.id);
  requireRole(id, user.id, ['owner']);
  db.delete(projects).where(eq(projects.id, id)).run();
  res.status(204).end();
});

appRouter.post('/milestones', async (req, res) => {
  const user = await requireUser(req);
  const input = parse(milestoneInput, req.body);
  requireRole(input.projectId, user.id, ['owner']);
  const milestone = db.insert(milestones).values({ id: randomUUID(), ...input, plannedDue: input.due }).returning().get();
  res.status(201).json(milestone);
});

appRouter.patch('/milestones/:id', async (req, res) => {
  const user = await requireUser(req);
  const id = routeId(req.params.id);
  const milestone = existingMilestone(id);
  requireRole(milestone.projectId, user.id, ['owner']);
  const { version, projectId, due, ...input } = parse(milestonePatch, req.body);
  assert(projectId === undefined || projectId === milestone.projectId, 400, 'A milestone cannot move projects');
  const plannedDue = due ?? milestone.plannedDue ?? milestone.due;
  const updated = db.update(milestones).set({ ...input, plannedDue,
    due: latestTaskDeadline(id) ?? plannedDue,
    version: sql`${milestones.version} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(milestones.id, id), eq(milestones.version, version))).returning().get();
  assert(updated, 409, 'Milestone changed elsewhere. Refresh and try again');
  res.json(updated);
});

appRouter.delete('/milestones/:id', async (req, res) => {
  const user = await requireUser(req);
  const id = routeId(req.params.id);
  const milestone = existingMilestone(id);
  requireRole(milestone.projectId, user.id, ['owner']);
  const linked = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.milestoneId, id)).limit(1).get();
  assert(!linked, 409, 'Reassign tasks before deleting this milestone');
  db.delete(milestones).where(eq(milestones.id, id)).run();
  res.status(204).end();
});

appRouter.post('/tasks', async (req, res) => {
  const user = await requireUser(req);
  const { owner, assigneeUserIds, ...input } = parse(taskInput, req.body);
  requireRole(input.projectId, user.id, ['owner', 'editor']);
  requireMilestone(input.projectId, input.milestoneId);
  const assignees = validAssignees(input.projectId, assigneeUserIds);
  const id = randomUUID();
  db.transaction((tx) => {
    tx.insert(tasks).values({ id, ...input, ownerLabel: owner, plannedDue: input.due }).run();
    for (const userId of assignees.userIds) tx.insert(taskAssignments)
      .values({ taskId: id, projectId: input.projectId, userId }).run();
    for (const email of assignees.pendingEmails) tx.insert(pendingTaskAssignments)
      .values({ taskId: id, projectId: input.projectId, email }).run();
    syncMilestoneDeadline(input.milestoneId);
  });
  res.status(201).json(fullTask(id));
});

appRouter.patch('/tasks/:id', async (req, res) => {
  const user = await requireUser(req);
  const id = routeId(req.params.id);
  const task = existingTask(id);
  requireRole(task.projectId, user.id, ['owner', 'editor']);
  const { version, projectId, owner, assigneeUserIds, due, ...input } = parse(taskPatch, req.body);
  assert(projectId === undefined || projectId === task.projectId, 400, 'A task cannot move projects');
  if (input.milestoneId) requireMilestone(task.projectId, input.milestoneId);
  const assignees = assigneeUserIds === undefined ? undefined : validAssignees(task.projectId, assigneeUserIds);
  db.transaction((tx) => {
    const plannedDue = due ?? task.plannedDue ?? task.due;
    const updated = tx.update(tasks).set({ ...input, plannedDue,
      due: latestSubtaskDeadline(id) ?? plannedDue,
      ...(owner === undefined ? {} : { ownerLabel: owner }),
      version: sql`${tasks.version} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(tasks.id, id), eq(tasks.version, version))).returning({ id: tasks.id }).get();
    if (!updated) throw new ApiError(409, 'Task changed elsewhere. Refresh and try again');
    if (assignees !== undefined) {
      tx.delete(taskAssignments).where(eq(taskAssignments.taskId, id)).run();
      tx.delete(pendingTaskAssignments).where(eq(pendingTaskAssignments.taskId, id)).run();
      for (const userId of assignees.userIds) tx.insert(taskAssignments)
        .values({ taskId: id, projectId: task.projectId, userId }).run();
      for (const email of assignees.pendingEmails) tx.insert(pendingTaskAssignments)
        .values({ taskId: id, projectId: task.projectId, email }).run();
    }
    syncMilestoneDeadline(task.milestoneId);
    if (input.milestoneId && input.milestoneId !== task.milestoneId) syncMilestoneDeadline(input.milestoneId);
  });
  res.json(fullTask(id));
});

appRouter.delete('/tasks/:id', async (req, res) => {
  const user = await requireUser(req);
  const id = routeId(req.params.id);
  const task = existingTask(id);
  requireRole(task.projectId, user.id, ['owner']);
  db.transaction((tx) => {
    tx.delete(tasks).where(eq(tasks.id, id)).run();
    syncMilestoneDeadline(task.milestoneId);
  });
  res.status(204).end();
});

appRouter.post('/subtasks', async (req, res) => {
  const user = await requireUser(req);
  const input = parse(subtaskInput, req.body);
  const task = existingTask(input.taskId);
  requireRole(task.projectId, user.id, ['owner', 'editor']);
  validAssignees(task.projectId, [input.ownerAssigneeId]);
  const subtask = db.transaction((tx) => {
    const created = tx.insert(subtasks).values({ id: randomUUID(), projectId: task.projectId, ...input })
      .returning().get();
    syncTaskDeadline(task.id);
    return created;
  });
  res.status(201).json(subtask);
});

appRouter.patch('/subtasks/:id', async (req, res) => {
  const user = await requireUser(req);
  const id = routeId(req.params.id);
  const subtask = existingSubtask(id);
  requireRole(subtask.projectId, user.id, ['owner', 'editor']);
  const { version, ownerAssigneeId, ...input } = parse(subtaskPatch, req.body);
  if (ownerAssigneeId) validAssignees(subtask.projectId, [ownerAssigneeId]);
  const updated = db.transaction((tx) => {
    const result = tx.update(subtasks).set({ ...input,
      ...(ownerAssigneeId === undefined ? {} : { ownerAssigneeId: ownerAssigneeId || null }),
      version: sql`${subtasks.version} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(subtasks.id, id), eq(subtasks.version, version))).returning().get();
    assert(result, 409, 'Subtask changed elsewhere. Refresh and try again');
    if (input.due !== undefined) syncTaskDeadline(subtask.taskId);
    return result;
  });
  res.json(updated);
});

appRouter.delete('/subtasks/:id', async (req, res) => {
  const user = await requireUser(req);
  const id = routeId(req.params.id);
  const subtask = existingSubtask(id);
  requireRole(subtask.projectId, user.id, ['owner']);
  db.transaction((tx) => {
    tx.delete(subtasks).where(eq(subtasks.id, id)).run();
    syncTaskDeadline(subtask.taskId);
  });
  res.status(204).end();
});

appRouter.post('/tasks/:id/notes', async (req, res) => {
  const user = await requireUser(req);
  const task = existingTask(routeId(req.params.id));
  requireRole(task.projectId, user.id, ['owner', 'editor']);
  const { body } = parse(noteBodyInput, req.body);
  const note = db.insert(notes).values({
    id: randomUUID(), projectId: task.projectId, parentType: 'task', parentId: task.id,
    body, authorUserId: user.id,
  }).returning().get();
  res.status(201).json({ ...note, authorUsername: user.username });
});

appRouter.post('/subtasks/:id/notes', async (req, res) => {
  const user = await requireUser(req);
  const subtask = existingSubtask(routeId(req.params.id));
  requireRole(subtask.projectId, user.id, ['owner', 'editor']);
  const { body } = parse(noteBodyInput, req.body);
  const note = db.insert(notes).values({
    id: randomUUID(), projectId: subtask.projectId, parentType: 'subtask', parentId: subtask.id,
    body, authorUserId: user.id,
  }).returning().get();
  res.status(201).json({ ...note, authorUsername: user.username });
});

appRouter.delete('/notes/:id', async (req, res) => {
  const user = await requireUser(req);
  const id = routeId(req.params.id);
  const note = db.select().from(notes).where(eq(notes.id, id)).limit(1).get();
  assert(note, 404, 'Note not found');
  requireRole(note.projectId, user.id, ['owner', 'editor']);
  db.delete(notes).where(eq(notes.id, id)).run();
  res.status(204).end();
});

appRouter.post('/tasks/:id/files', taskFileGuard, withUploadFile(), (req, res) => {
  const attachment = saveAttachment(req, res, 'task');
  res.status(201).json(attachment);
});

appRouter.post('/milestones/:id/files', milestoneFileGuard, withUploadFile(), (req, res) => {
  const attachment = saveAttachment(req, res, 'milestone');
  res.status(201).json(attachment);
});

appRouter.get('/files/:id', async (req, res) => {
  const user = await requireUser(req);
  const id = routeId(req.params.id);
  const attachment = db.select().from(attachments).where(eq(attachments.id, id)).limit(1).get();
  assert(attachment, 404, 'File not found');
  const access = requireRole(attachment.projectId, user.id, ['owner', 'editor', 'viewer']);
  if (access.role === 'viewer'
    && !viewerCanSeeAttachment(attachment.projectId, user.id, attachment.parentType, attachment.parentId)) {
    throw new ApiError(404, 'File not found');
  }
  const filePath = storedFilePath(attachment.id);
  if (!existsSync(filePath)) throw new ApiError(404, 'File is missing from storage');
  const previewable = classify(attachment.mimeType) !== 'other';
  const download = !previewable || req.query.download === '1' || req.query.download === 'true';
  const name = attachment.originalName.replace(/["\\\r\n]/g, '_');
  res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`);
  res.sendFile(filePath);
});

appRouter.delete('/files/:id', async (req, res) => {
  const user = await requireUser(req);
  const id = routeId(req.params.id);
  const attachment = db.select().from(attachments).where(eq(attachments.id, id)).limit(1).get();
  assert(attachment, 404, 'File not found');
  requireRole(attachment.projectId, user.id, ['owner', 'editor']);
  db.delete(attachments).where(eq(attachments.id, id)).run();
  try { unlinkSync(storedFilePath(attachment.id)); } catch { /* already gone */ }
  res.status(204).end();
});

appRouter.get('/projects/:id/members', async (req, res) => {
  const user = await requireUser(req);
  res.json(listMembers(routeId(req.params.id), user.id));
});

appRouter.patch('/projects/:id/members/:userId', async (req, res) => {
  const user = await requireUser(req);
  const projectId = routeId(req.params.id);
  const memberId = routeId(req.params.userId);
  requireRole(projectId, user.id, ['owner']);
  const { role } = parse(memberPatch, req.body);
  const updated = db.update(projectMemberships).set({ role })
    .where(and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, memberId)))
    .returning().get();
  assert(updated, 404, 'Member not found');
  res.json(updated);
});

appRouter.delete('/projects/:id/members/:userId', async (req, res) => {
  const user = await requireUser(req);
  const projectId = routeId(req.params.id);
  const memberId = routeId(req.params.userId);
  requireRole(projectId, user.id, ['owner']);
  db.transaction((tx) => {
    const deleted = tx.delete(projectMemberships)
      .where(and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, memberId)))
      .returning({ userId: projectMemberships.userId }).get();
    if (!deleted) throw new ApiError(404, 'Member not found');
    tx.delete(taskAssignments).where(and(eq(taskAssignments.projectId, projectId), eq(taskAssignments.userId, memberId))).run();
    tx.update(subtasks).set({ ownerAssigneeId: null,
      version: sql`${subtasks.version} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(subtasks.projectId, projectId), eq(subtasks.ownerAssigneeId, memberId))).run();
  });
  res.status(204).end();
});
