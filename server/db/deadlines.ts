/** Keep parent deadlines synchronized with the latest child deadline. */
import { eq, sql } from 'drizzle-orm';
import { db } from './client.js';
import { milestones, subtasks, tasks } from './schema.js';

export function latestSubtaskDeadline(taskId: string): string | null {
  return db.select({ due: sql<string | null>`max(${subtasks.due})` }).from(subtasks)
    .where(eq(subtasks.taskId, taskId)).get()?.due ?? null;
}

export function latestTaskDeadline(milestoneId: string): string | null {
  return db.select({ due: sql<string | null>`max(${tasks.due})` }).from(tasks)
    .where(eq(tasks.milestoneId, milestoneId)).get()?.due ?? null;
}

/** Run inside the caller's SQLite transaction after changing a task or subtask. */
export function syncTaskDeadline(taskId: string): void {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return;
  const due = latestSubtaskDeadline(taskId) ?? task.plannedDue ?? task.due;
  if (due !== task.due) {
    db.update(tasks).set({ due, version: sql`${tasks.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(tasks.id, taskId)).run();
  }
  syncMilestoneDeadline(task.milestoneId);
}

/** Run inside the caller's SQLite transaction after changing milestone tasks. */
export function syncMilestoneDeadline(milestoneId: string): void {
  const milestone = db.select().from(milestones).where(eq(milestones.id, milestoneId)).get();
  if (!milestone) return;
  const due = latestTaskDeadline(milestoneId) ?? milestone.plannedDue ?? milestone.due;
  if (due !== milestone.due) {
    db.update(milestones).set({ due, version: sql`${milestones.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(milestones.id, milestoneId)).run();
  }
}
