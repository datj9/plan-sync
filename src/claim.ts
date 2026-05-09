import type { Task, TaskStatus } from './types.js';
import { appendLog, readTask, writeTask } from './store.js';
import { isStale, readSession } from './session.js';
import { hostUser, nowIso } from './util.js';

export class ClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaimError';
  }
}

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['claimed'],
  claimed: ['in_progress', 'pending', 'failed'],
  in_progress: ['blocked', 'done', 'failed', 'pending'],
  blocked: ['in_progress', 'pending', 'failed'],
  done: [],
  failed: ['pending'],
};

function assertTransition(from: TaskStatus, to: TaskStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new ClaimError(`invalid transition: ${from} → ${to}`);
  }
}

async function isHeldByLiveSession(task: Task, cwd?: string): Promise<boolean> {
  if (!task.assignee) return false;
  try {
    const session = await readSession(task.assignee, cwd);
    return !isStale(session);
  } catch {
    // Session file missing → treat as released.
    return false;
  }
}

export async function claim(
  planId: string,
  taskId: string,
  sessionId: string,
  cwd?: string,
): Promise<Task> {
  const task = await readTask(planId, taskId, cwd);
  if (task.status === 'done' || task.status === 'failed') {
    throw new ClaimError(`task ${taskId} is terminal (${task.status}), cannot claim`);
  }
  if (task.status === 'pending') {
    return writeClaim(task, sessionId, planId, taskId, cwd);
  }
  // Task is held — either by us (idempotent), a live session (reject), or stale (steal).
  if (task.assignee === sessionId) return task;
  if (await isHeldByLiveSession(task, cwd)) {
    throw new ClaimError(
      `task ${taskId} held by session ${task.assignee} (status=${task.status})`,
    );
  }
  return writeClaim(task, sessionId, planId, taskId, cwd);
}

async function writeClaim(
  task: Task,
  sessionId: string,
  planId: string,
  taskId: string,
  cwd?: string,
): Promise<Task> {
  const now = nowIso();
  const updated: Task = {
    ...task,
    status: 'claimed',
    assignee: sessionId,
    claimed_at: now,
    updated_at: now,
    notes: [...task.notes, { at: now, by: hostUser(), msg: `claimed by ${sessionId}` }],
  };
  await writeTask(updated, cwd);
  await appendLog(planId, { at: now, by: sessionId, event: 'claim', task: taskId }, cwd);
  return updated;
}

export async function transition(
  planId: string,
  taskId: string,
  to: TaskStatus,
  sessionId: string,
  options: { blockedReason?: string; force?: boolean } = {},
  cwd?: string,
): Promise<Task> {
  const task = await readTask(planId, taskId, cwd);
  if (!options.force && task.assignee !== sessionId) {
    throw new ClaimError(
      `task ${taskId} is owned by ${task.assignee ?? '(none)'}, not ${sessionId}`,
    );
  }
  assertTransition(task.status, to);
  if (to === 'blocked' && !options.blockedReason) {
    throw new ClaimError('blocked transitions require a reason');
  }
  const now = nowIso();
  const updated: Task = {
    ...task,
    status: to,
    blocked_reason: to === 'blocked' ? (options.blockedReason ?? null) : null,
    updated_at: now,
    notes: [...task.notes, { at: now, by: hostUser(), msg: `→ ${to}` }],
  };
  await writeTask(updated, cwd);
  await appendLog(
    planId,
    { at: now, by: sessionId, event: 'status', task: taskId, from: task.status, to },
    cwd,
  );
  return updated;
}

export async function release(
  planId: string,
  taskId: string,
  sessionId: string,
  options: { force?: boolean } = {},
  cwd?: string,
): Promise<Task> {
  const task = await readTask(planId, taskId, cwd);
  if (!options.force && task.assignee !== sessionId) {
    throw new ClaimError(
      `task ${taskId} is owned by ${task.assignee ?? '(none)'}, not ${sessionId}`,
    );
  }
  if (task.status === 'done' || task.status === 'failed') {
    throw new ClaimError(`task ${taskId} is terminal (${task.status}), cannot release`);
  }
  const now = nowIso();
  const updated: Task = {
    ...task,
    status: 'pending',
    assignee: null,
    claimed_at: null,
    updated_at: now,
    blocked_reason: null,
    notes: [...task.notes, { at: now, by: hostUser(), msg: `released by ${sessionId}` }],
  };
  await writeTask(updated, cwd);
  await appendLog(planId, { at: now, by: sessionId, event: 'release', task: taskId }, cwd);
  return updated;
}
