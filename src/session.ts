import fs from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import type { Session } from './types.js';
import { sessionFile, sessionsDir } from './paths.js';
import { writeSession } from './store.js';
import { nowIso } from './util.js';

export const STALE_MS = 10 * 60 * 1000;

export const DEFAULT_GC_DAYS = 7;

export const SESSION_ENV = 'PLAN_SYNC_SESSION';

export class SessionNotConfiguredError extends Error {
  constructor() {
    super(`${SESSION_ENV} is not set. Run 'plan-sync session start' and export the printed id.`);
    this.name = 'SessionNotConfiguredError';
  }
}

export class SessionNotFoundError extends Error {
  constructor(id: string) {
    super(`Session ${id} not found in .plan-sync/sessions/.`);
    this.name = 'SessionNotFoundError';
  }
}

export function currentSessionId(): string {
  const id = process.env[SESSION_ENV];
  if (!id) throw new SessionNotConfiguredError();
  return id;
}

export function buildSessionId(agent: Session['agent']): string {
  const user = os.userInfo().username;
  const host = os.hostname().split('.')[0] ?? 'unknown';
  const shortId = crypto.randomBytes(3).toString('hex');
  return `${agent}-${user}-${host}-${shortId}`;
}

export async function startSession(agent: Session['agent'], cwd?: string): Promise<Session> {
  const id = buildSessionId(agent);
  const now = nowIso();
  const session: Session = {
    id,
    agent,
    machine: os.hostname().split('.')[0] ?? 'unknown',
    user: os.userInfo().username,
    started_at: now,
    last_heartbeat: now,
    current_task: null,
  };
  await writeSession(session, cwd);
  return session;
}

export async function readSession(id: string, cwd?: string): Promise<Session> {
  try {
    const raw = await fs.readFile(sessionFile(id, cwd), 'utf8');
    return yaml.load(raw) as Session;
  } catch {
    throw new SessionNotFoundError(id);
  }
}

export async function heartbeat(
  id: string,
  currentTask: string | null,
  cwd?: string,
): Promise<Session> {
  const session = await readSession(id, cwd);
  const updated: Session = {
    ...session,
    last_heartbeat: nowIso(),
    current_task: currentTask,
  };
  await writeSession(updated, cwd);
  return updated;
}

export function isStale(session: Session, now: Date = new Date()): boolean {
  const last = new Date(session.last_heartbeat).getTime();
  return now.getTime() - last > STALE_MS;
}

export async function listSessions(cwd?: string): Promise<Session[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(sessionsDir(cwd));
  } catch {
    return [];
  }
  const yamls = entries.filter((f) => f.endsWith('.yaml'));
  const sessions: Session[] = [];
  for (const file of yamls) {
    const id = file.replace(/\.yaml$/, '');
    try {
      sessions.push(await readSession(id, cwd));
    } catch {
      // Skip unreadable session file (corrupt/partial); GC won't touch it either.
    }
  }
  return sessions;
}

export async function gcSessions(
  options: { olderThanDays?: number } = {},
  cwd?: string,
): Promise<string[]> {
  const days = options.olderThanDays ?? DEFAULT_GC_DAYS;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const sessions = await listSessions(cwd);
  const removed: string[] = [];
  for (const session of sessions) {
    const last = new Date(session.last_heartbeat).getTime();
    if (Number.isFinite(last) && last < cutoff) {
      await fs.rm(sessionFile(session.id, cwd), { force: true });
      removed.push(session.id);
    }
  }
  return removed;
}
