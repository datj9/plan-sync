import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import { writeSession } from '../src/store.js';
import { sessionFile } from '../src/paths.js';
import { gcSessions, listSessions } from '../src/session.js';
import type { Session } from '../src/types.js';
import { makeEnv, type TestEnv } from './helpers.js';

let env: TestEnv;

beforeEach(async () => {
  env = await makeEnv();
});

afterEach(async () => {
  await env.cleanup();
});

function makeSession(id: string, lastHeartbeat: string): Session {
  return {
    id,
    agent: 'claude-code',
    machine: 'host',
    user: 'alice',
    started_at: '2026-04-01T00:00:00Z',
    last_heartbeat: lastHeartbeat,
    current_task: null,
  };
}

const dayAgo = (n: number): string => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

describe('listSessions', () => {
  it('returns each readable session file once', async () => {
    await writeSession(makeSession('a', dayAgo(0)), env.cwd);
    await writeSession(makeSession('b', dayAgo(0)), env.cwd);
    const result = await listSessions(env.cwd);
    expect(result.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('returns empty list when sessions/ is missing', async () => {
    expect(await listSessions(env.cwd)).toHaveLength(2 - 2); // baseline 0
  });
});

describe('gcSessions', () => {
  it('removes sessions older than the threshold and keeps fresh ones', async () => {
    await writeSession(makeSession('fresh', dayAgo(0)), env.cwd);
    await writeSession(makeSession('one-day', dayAgo(1)), env.cwd);
    await writeSession(makeSession('ten-days', dayAgo(10)), env.cwd);

    const removed = await gcSessions({ olderThanDays: 7 }, env.cwd);
    expect(removed).toEqual(['ten-days']);

    const remaining = (await listSessions(env.cwd)).map((s) => s.id).sort();
    expect(remaining).toEqual(['fresh', 'one-day']);

    await expect(fs.access(sessionFile('ten-days', env.cwd))).rejects.toThrow();
  });

  it('uses the default threshold (7 days) when olderThanDays is omitted', async () => {
    await writeSession(makeSession('eight-days', dayAgo(8)), env.cwd);
    await writeSession(makeSession('six-days', dayAgo(6)), env.cwd);
    const removed = await gcSessions({}, env.cwd);
    expect(removed).toEqual(['eight-days']);
  });

  it('returns empty list when nothing is stale', async () => {
    await writeSession(makeSession('fresh', dayAgo(0)), env.cwd);
    expect(await gcSessions({ olderThanDays: 7 }, env.cwd)).toEqual([]);
  });

  it('returns empty list when there are no sessions at all', async () => {
    expect(await gcSessions({ olderThanDays: 7 }, env.cwd)).toEqual([]);
  });
});
