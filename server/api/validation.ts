import { z } from 'zod';
import { ApiError } from './errors.js';

const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => text(max).min(1);
const date = z.iso.date();

export const projectInput = z.strictObject({
  name: required(160),
  location: text(160).default(''),
  lead: text(160).default(''),
  start: date,
  end: date,
  stage: z.enum(['Planning', 'In progress', 'On hold', 'Completed']).default('Planning'),
});
export const projectPatch = z.strictObject({
  name: required(160).optional(),
  location: text(160).optional(),
  lead: text(160).optional(),
  start: date.optional(),
  end: date.optional(),
  stage: z.enum(['Planning', 'In progress', 'On hold', 'Completed']).optional(),
  version: z.number().int().positive(),
});

export const milestoneInput = z.strictObject({
  projectId: required(100),
  name: required(160),
  due: date,
  status: z.enum(['Upcoming', 'At risk', 'Complete']).default('Upcoming'),
});
export const milestonePatch = z.strictObject({
  projectId: required(100).optional(),
  name: required(160).optional(),
  due: date.optional(),
  status: z.enum(['Upcoming', 'At risk', 'Complete']).optional(),
  version: z.number().int().positive(),
});

export const taskInput = z.strictObject({
  projectId: required(100),
  milestoneId: required(100),
  name: required(200),
  owner: text(160).default(''),
  due: date,
  status: z.enum(['Not started', 'In progress', 'Blocked', 'Done']).default('Not started'),
  priority: z.enum(['Normal', 'High', 'Critical']).default('Normal'),
  assigneeUserIds: z.array(required(100)).max(100).default([]),
});
export const taskPatch = z.strictObject({
  projectId: required(100).optional(),
  milestoneId: required(100).optional(),
  name: required(200).optional(),
  owner: text(160).optional(),
  due: date.optional(),
  status: z.enum(['Not started', 'In progress', 'Blocked', 'Done']).optional(),
  priority: z.enum(['Normal', 'High', 'Critical']).optional(),
  assigneeUserIds: z.array(required(100)).max(100).optional(),
  version: z.number().int().positive(),
});

export const subtaskInput = z.strictObject({
  taskId: required(100),
  name: required(200),
  due: date,
  ownerAssigneeId: required(100),
  status: z.enum(['Not started', 'In progress', 'Blocked', 'Done']).default('Not started'),
});
export const subtaskPatch = z.strictObject({
  name: required(200).optional(),
  due: date.optional(),
  ownerAssigneeId: text(100).optional(),
  status: z.enum(['Not started', 'In progress', 'Blocked', 'Done']).optional(),
  version: z.number().int().positive(),
});

export const inviteInput = z.strictObject({
  username: required(30),
  email: z.email().max(254).transform((value) => value.trim().toLowerCase()),
  role: z.enum(['editor', 'viewer']),
});
export const acceptInput = z.strictObject({ token: required(200), password: z.string().optional() });
export const memberPatch = z.strictObject({ role: z.enum(['editor', 'viewer']) });

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiError(400, result.error.issues[0]?.message || 'Invalid input');
  }
  return result.data;
}
