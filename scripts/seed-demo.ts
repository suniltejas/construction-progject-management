/**
 * Seed the local development database with demo projects, milestones, tasks,
 * subtasks, notes, files, assignments and task dependencies.
 *
 * Re-runnable: it deletes any project with a demo name (cascading its children)
 * before inserting fresh data. Does not touch unrelated projects.
 * Usage: pnpm run seed:demo
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { db, sqlite } from '../server/db/client.js';
import { user } from '../server/auth/auth-schema.js';
import {
  projects, milestones, tasks, subtasks, taskAssignments, taskDependencies,
  notes, attachments, projectMemberships,
} from '../server/db/schema.js';
import { syncMilestoneDeadline, syncTaskDeadline } from '../server/db/deadlines.js';

const filesDir = resolve(process.env.FILES_DIR || './data/files');
const id = () => randomUUID();

function isoDate(offset = 0): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
const stamp = (offset = 0) => `${isoDate(offset)} 12:00:00`;

const DEMO_PROJECTS = [
  'Riverside Medical Centre',
  'Harbour Bridge Retrofit',
  'Northgate Apartments',
  'City Library Renovation',
];

function buildPdf(text: string): Buffer {
  const objects: string[] = [];
  objects.push('<</Type /Catalog /Pages 2 0 R>>');
  objects.push('<</Type /Pages /Kids [3 0 R] /Count 1>>');
  objects.push('<</Type /Page /Parent 2 0 R /MediaBox [0 0 420 200] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>>');
  const stream = `BT /F1 18 Tf 24 110 Td (${text}) Tj ET`;
  objects.push(`<</Length ${Buffer.byteLength(stream, 'latin1')}>>\nstream\n${stream}\nendstream`);
  objects.push('<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>');
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1} /Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

type NoteParent = 'task' | 'subtask';
type FileParent = 'task' | 'milestone';
type MilestoneStatus = 'Upcoming' | 'At risk' | 'Complete';
type TaskStatus = 'Not started' | 'In progress' | 'Blocked' | 'Done';
type Priority = 'Normal' | 'High' | 'Critical';

interface Ctx {
  ownerId: string;
  extraMembers: { userId: string; role: 'editor' | 'viewer' }[];
}

function addMilestone(projectId: string, name: string, due: string, status: MilestoneStatus): string {
  const mid = id();
  db.insert(milestones).values({ id: mid, projectId, name, due, plannedDue: due, status }).run();
  return mid;
}

function addTask(input: {
  projectId: string; milestoneId: string; name: string; crew: string; due: string;
  status?: TaskStatus; priority?: Priority; assignees?: string[]; predecessors?: string[];
  completedOffset?: number;
}): string {
  const tid = id();
  db.insert(tasks).values({
    id: tid, projectId: input.projectId, milestoneId: input.milestoneId, name: input.name,
    ownerLabel: input.crew, due: input.due, plannedDue: input.due,
    status: input.status || 'Not started', priority: input.priority || 'Normal',
    completedAt: input.status === 'Done' ? stamp(input.completedOffset ?? 0) : null,
  }).run();
  for (const userId of input.assignees || []) {
    db.insert(taskAssignments).values({ taskId: tid, projectId: input.projectId, userId }).run();
  }
  for (const predecessorTaskId of input.predecessors || []) {
    db.insert(taskDependencies).values({ taskId: tid, projectId: input.projectId, predecessorTaskId }).run();
  }
  return tid;
}

function addSubtask(input: {
  projectId: string; taskId: string; name: string; due: string;
  ownerAssigneeId?: string | null; crewLabel?: string; status?: TaskStatus;
}): string {
  const sid = id();
  db.insert(subtasks).values({
    id: sid, projectId: input.projectId, taskId: input.taskId, name: input.name,
    due: input.due, ownerAssigneeId: input.ownerAssigneeId ?? null,
    crewLabel: input.crewLabel || '', status: input.status || 'Not started',
  }).run();
  return sid;
}

function addNote(projectId: string, parentType: NoteParent, parentId: string, body: string, authorUserId: string): void {
  db.insert(notes).values({ id: id(), projectId, parentType, parentId, body, authorUserId }).run();
}

function addAttachment(
  projectId: string, parentType: FileParent, parentId: string,
  originalName: string, mimeType: string, data: Buffer, uploadedUserId: string,
): void {
  mkdirSync(filesDir, { recursive: true });
  const fid = id();
  writeFileSync(join(filesDir, fid), data);
  db.insert(attachments).values({
    id: fid, projectId, parentType, parentId, originalName, mimeType,
    sizeBytes: data.length, uploadedUserId,
  }).run();
}

function addMembership(projectId: string, userId: string, role: 'editor' | 'viewer'): void {
  db.insert(projectMemberships).values({ projectId, userId, role }).run();
}

function seed(ctx: Ctx): void {
  const { ownerId } = ctx;
  const editorMember = ctx.extraMembers.find((m) => m.role === 'editor')?.userId;
  const viewerMember = ctx.extraMembers.find((m) => m.role === 'viewer')?.userId;

  // ---------------------------------------------------------------- Riverside
  const p1 = id();
  db.insert(projects).values({
    id: p1, ownerUserId: ownerId, name: 'Riverside Medical Centre', location: 'Lagos',
    lead: 'Eng. Ada', start: isoDate(-60), end: isoDate(120), stage: 'In progress',
  }).run();
  if (editorMember) addMembership(p1, editorMember, 'editor');

  const p1m1 = addMilestone(p1, 'Site preparation', isoDate(-35), 'Complete');
  const p1m2 = addMilestone(p1, 'Foundation', isoDate(5), 'At risk');
  const p1m3 = addMilestone(p1, 'Structure', isoDate(45), 'Upcoming');
  const p1m4 = addMilestone(p1, 'Handover', isoDate(105), 'Upcoming');

  addTask({ projectId: p1, milestoneId: p1m1, name: 'Clear and level site', crew: 'Earthworks', due: isoDate(-36), status: 'Done', priority: 'Critical', assignees: [ownerId], completedOffset: -33 });
  addTask({ projectId: p1, milestoneId: p1m1, name: 'Set up site office', crew: 'Logistics', due: isoDate(-32), status: 'Done', priority: 'Normal', completedOffset: -30 });
  addTask({ projectId: p1, milestoneId: p1m1, name: 'Site safety induction', crew: 'HSE', due: isoDate(-30), status: 'Done', priority: 'High', completedOffset: -28 });

  const excavate = addTask({ projectId: p1, milestoneId: p1m2, name: 'Excavate footings', crew: 'Earthworks', due: isoDate(8), status: 'In progress', priority: 'Critical', assignees: editorMember ? [ownerId, editorMember] : [ownerId] });
  addSubtask({ projectId: p1, taskId: excavate, name: 'Mark out grid lines', due: isoDate(-4), ownerAssigneeId: ownerId, crewLabel: 'Survey', status: 'Done' });
  const machine = addSubtask({ projectId: p1, taskId: excavate, name: 'Machine excavation', due: isoDate(4), ownerAssigneeId: editorMember ?? ownerId, crewLabel: 'Earthworks', status: 'In progress' });
  addSubtask({ projectId: p1, taskId: excavate, name: 'Hand-dig service trenches', due: isoDate(8), ownerAssigneeId: ownerId, crewLabel: 'Groundworks', status: 'Not started' });

  const pour = addTask({ projectId: p1, milestoneId: p1m2, name: 'Pour foundation concrete', crew: 'Concrete', due: isoDate(12), status: 'Blocked', priority: 'High', predecessors: [excavate] });
  addTask({ projectId: p1, milestoneId: p1m2, name: 'Apply tanking / waterproofing', crew: 'Waterproofing', due: isoDate(16), status: 'Not started', priority: 'Normal', predecessors: [pour] });

  const columns = addTask({ projectId: p1, milestoneId: p1m3, name: 'Erect structural columns', crew: 'Steel', due: isoDate(45), status: 'Not started', priority: 'High' });
  const beams = addTask({ projectId: p1, milestoneId: p1m3, name: 'Beam formwork', crew: 'Formwork', due: isoDate(50), status: 'Not started', priority: 'Normal' });
  const roof = addTask({ projectId: p1, milestoneId: p1m3, name: 'Roof slab pour', crew: 'Concrete', due: isoDate(58), status: 'Not started', priority: 'Critical', predecessors: [columns, beams] });

  const snag = addTask({ projectId: p1, milestoneId: p1m4, name: 'Compile snag list', crew: 'Handover', due: isoDate(100), status: 'Not started', priority: 'Normal' });
  addTask({ projectId: p1, milestoneId: p1m4, name: 'Final inspection', crew: 'Handover', due: isoDate(105), status: 'Not started', priority: 'High', predecessors: [snag] });

  addNote(p1, 'task', excavate, 'Ground water encountered at 2.1m — pump installed and running.', ownerId);
  addNote(p1, 'task', excavate, 'Engineer sign-off required before pouring concrete.', ownerId);
  addNote(p1, 'task', pour, 'Concrete supplier confirmed for 07:00; book pump truck.', ownerId);
  addNote(p1, 'subtask', machine, 'Pump running overnight; supervisor on site.', ownerId);
  addNote(p1, 'task', roof, 'Confirm crane availability for the roof slab pour.', ownerId);

  addAttachment(p1, 'task', excavate, 'riverside-site-plan.png', 'image/png', PNG_1PX, ownerId);
  addAttachment(p1, 'milestone', p1m2, 'foundation-details.pdf', 'application/pdf', buildPdf('Foundation details'), ownerId);
  addAttachment(p1, 'task', roof, 'roof-slab-notes.txt', 'text/plain', Buffer.from('Roof slab pour notes\n- 120m3 C35/45\n- Cure 7 days\n', 'utf8'), ownerId);

  // ------------------------------------------------------------ Harbour Bridge
  const p2 = id();
  db.insert(projects).values({
    id: p2, ownerUserId: ownerId, name: 'Harbour Bridge Retrofit', location: 'Port', lead: 'M. Okoro',
    start: isoDate(-90), end: isoDate(80), stage: 'In progress',
  }).run();
  if (viewerMember) addMembership(p2, viewerMember, 'viewer');

  const p2m1 = addMilestone(p2, 'Survey & design', isoDate(-70), 'Complete');
  const p2m2 = addMilestone(p2, 'Deck repairs', isoDate(20), 'At risk');
  const p2m3 = addMilestone(p2, 'Cable replacement', isoDate(65), 'Upcoming');

  addTask({ projectId: p2, milestoneId: p2m1, name: 'Topographic survey', crew: 'Survey', due: isoDate(-62), status: 'Done', priority: 'Normal', completedOffset: -60 });
  addTask({ projectId: p2, milestoneId: p2m1, name: 'Load assessment', crew: 'Engineering', due: isoDate(-58), status: 'Done', priority: 'High', completedOffset: -55 });

  const joints = addTask({ projectId: p2, milestoneId: p2m2, name: 'Replace expansion joints', crew: 'Bridge crew', due: isoDate(18), status: 'In progress', priority: 'Critical', assignees: viewerMember ? [viewerMember] : [ownerId] });
  addTask({ projectId: p2, milestoneId: p2m2, name: 'Repaint steelwork', crew: 'Painters', due: isoDate(24), status: 'Not started', priority: 'High', predecessors: [joints] });
  addTask({ projectId: p2, milestoneId: p2m2, name: 'Deck resurfacing', crew: 'Roadworks', due: isoDate(30), status: 'Blocked', priority: 'Normal', predecessors: [joints] });

  const orderCables = addTask({ projectId: p2, milestoneId: p2m3, name: 'Order stay cables', crew: 'Procurement', due: isoDate(40), status: 'In progress', priority: 'High' });
  addTask({ projectId: p2, milestoneId: p2m3, name: 'Install stay cables', crew: 'Cable crew', due: isoDate(60), status: 'Not started', priority: 'Critical', predecessors: [orderCables] });

  addNote(p2, 'task', joints, 'Night-works permit approved for lane closures.', ownerId);
  addNote(p2, 'task', joints, 'Two joints already replaced; four remaining.', ownerId);
  addAttachment(p2, 'milestone', p2m2, 'deck-repair-method.pdf', 'application/pdf', buildPdf('Deck repair method statement'), ownerId);
  addAttachment(p2, 'task', joints, 'bridge-joint-photo.png', 'image/png', PNG_1PX, ownerId);

  // ---------------------------------------------------------------- Northgate
  const p3 = id();
  db.insert(projects).values({
    id: p3, ownerUserId: ownerId, name: 'Northgate Apartments', location: 'Northgate', lead: 'S. Patel',
    start: isoDate(10), end: isoDate(300), stage: 'Planning',
  }).run();
  if (viewerMember) addMembership(p3, viewerMember, 'viewer');
  else if (editorMember) addMembership(p3, editorMember, 'viewer');

  const p3m1 = addMilestone(p3, 'Planning & permits', isoDate(15), 'Upcoming');
  const p3m2 = addMilestone(p3, 'Groundworks', isoDate(75), 'Upcoming');

  const planning = addTask({ projectId: p3, milestoneId: p3m1, name: 'Submit planning application', crew: 'Consultants', due: isoDate(12), status: 'Not started', priority: 'High', assignees: viewerMember ? [viewerMember] : [] });
  addTask({ projectId: p3, milestoneId: p3m1, name: 'Geotechnical survey', crew: 'Survey', due: isoDate(18), status: 'Not started', priority: 'Normal' });
  addTask({ projectId: p3, milestoneId: p3m1, name: 'Appoint main contractor', crew: 'Procurement', due: isoDate(30), status: 'Not started', priority: 'High', predecessors: [planning] });
  addTask({ projectId: p3, milestoneId: p3m2, name: 'Piling works', crew: 'Groundworks', due: isoDate(75), status: 'Not started', priority: 'Critical', predecessors: [planning] });

  addNote(p3, 'task', planning, 'Awaiting heritage impact report before submission.', ownerId);
  addAttachment(p3, 'task', planning, 'planning-application.txt', 'text/plain', Buffer.from('Planning application draft\n', 'utf8'), ownerId);

  // ------------------------------------------------------------ City Library
  const p4 = id();
  db.insert(projects).values({
    id: p4, ownerUserId: ownerId, name: 'City Library Renovation', location: 'City Centre', lead: 'L. Chen',
    start: isoDate(-120), end: isoDate(-10), stage: 'On hold',
  }).run();
  if (viewerMember) addMembership(p4, viewerMember, 'viewer');

  const p4m1 = addMilestone(p4, 'Strip-out', isoDate(-95), 'Complete');
  const p4m2 = addMilestone(p4, 'Fit-out', isoDate(-15), 'Complete');

  addTask({ projectId: p4, milestoneId: p4m1, name: 'Strip out shelving', crew: 'Demolition', due: isoDate(-97), status: 'Done', priority: 'Normal', completedOffset: -90 });
  addTask({ projectId: p4, milestoneId: p4m1, name: 'Asbestos survey & removal', crew: 'Specialist', due: isoDate(-88), status: 'Done', priority: 'Critical', completedOffset: -85 });
  addTask({ projectId: p4, milestoneId: p4m2, name: 'Install raised flooring', crew: 'Fit-out', due: isoDate(-32), status: 'Done', priority: 'Normal', completedOffset: -30 });
  addTask({ projectId: p4, milestoneId: p4m2, name: 'Install new shelving', crew: 'Joinery', due: isoDate(-20), status: 'Done', priority: 'High', completedOffset: -18 });
  const signage = addTask({ projectId: p4, milestoneId: p4m2, name: 'Install signage', crew: 'Fit-out', due: isoDate(-5), status: 'Blocked', priority: 'Normal', assignees: viewerMember ? [viewerMember] : [] });

  addNote(p4, 'task', signage, 'Signage artwork pending client approval.', ownerId);
  addAttachment(p4, 'task', signage, 'signage-layout.png', 'image/png', PNG_1PX, ownerId);
}

async function main(): Promise<void> {
  const users = db.select().from(user).all();
  if (!users.length) throw new Error('No accounts exist yet. Run `pnpm run owner:create` first.');
  const owner = users.find((entry) => entry.username === 'admin') ?? users[0];
  const extraMembers = users
    .filter((entry) => entry.id !== owner.id)
    .slice(0, 2)
    .map((entry, index) => ({ userId: entry.id, role: (index === 0 ? 'editor' : 'viewer') as 'editor' | 'viewer' }));

  const existing = db.select({ id: projects.id }).from(projects)
    .where(inArray(projects.name, DEMO_PROJECTS)).all();
  for (const project of existing) db.delete(projects).where(eq(projects.id, project.id)).run();

  seed({ ownerId: owner.id, extraMembers });

  // Recalculate task/milestone deadlines from children (same logic as the app).
  for (const task of db.select({ id: tasks.id }).from(tasks).all()) syncTaskDeadline(task.id);
  for (const milestone of db.select({ id: milestones.id }).from(milestones).all()) syncMilestoneDeadline(milestone.id);

  const counts = {
    projects: db.select().from(projects).all().length,
    milestones: db.select().from(milestones).all().length,
    tasks: db.select().from(tasks).all().length,
    subtasks: db.select().from(subtasks).all().length,
    notes: db.select().from(notes).all().length,
    files: db.select().from(attachments).all().length,
    dependencies: db.select().from(taskDependencies).all().length,
  };
  console.info(`Seeded demo data as owner "${owner.username}" (${owner.id}).`);
  console.info(`Totals now in DB: ${JSON.stringify(counts)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => sqlite.close());
