import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writePlan, writeTask } from '../src/store.js';
import { writeSession } from '../src/store.js';
import { claim, release, transition, ClaimError } from '../src/claim.js';
import { isStale, STALE_MS } from '../src/session.js';
import type { Plan, Session, Task } from '../src/types.js';
import { makeEnv, type TestEnv } from './helpers.js';

let env: TestEnv;

beforeEach(async () => {
  env = await makeEnv();
});

afterEach(async () => {
  await env.cleanup();
});

const PLAN_ID = 'plan-2026-05-09-test';
const TASK_ID = 'TASK-1';

async function seed(taskOverrides: Partial<Task> = {}): Promise<void> {
  const plan: Plan = {
    id: PLAN_ID,
    title: 'Test plan',
    description: '',
    created_at: '2026-05-09T00:00:00Z',
    created_by: 'alice@laptop',
    status: 'active',
    task_order: [TASK_ID],
  };
  await writePlan(plan, env.cwd);
  const task: Task = {
    id: TASK_ID,
    plan_id: PLAN_ID,
    title: 'Test task',
    description: '',
    status: 'pending',
    assignee: null,
    claimed_at: null,
    updated_at: '2026-05-09T00:00:00Z',
    depends_on: [],
    blocked_reason: null,
    artifacts: [],
    notes: [],
    ...taskOverrides,
  };
  await writeTask(task, env.cwd);
}

async function seedSession(id: string, lastHeartbeat: string): Promise<Session> {
  const session: Session = {
    id,
    agent: 'claude-code',
    machine: 'host',
    user: 'alice',
    started_at: '2026-05-09T00:00:00Z',
    last_heartbeat: lastHeartbeat,
    current_task: null,
  };
  await writeSession(session, env.cwd);
  return session;
}

describe('claim', () => {
  it('moves a pending task to claimed and records the assignee', async () => {
    await seed();
    await seedSession('alice-1', new Date().toISOString());
    const result = await claim(PLAN_ID, TASK_ID, 'alice-1', env.cwd);
    expect(result.status).toBe('claimed');
    expect(result.assignee).toBe('alice-1');
    expect(result.claimed_at).not.toBeNull();
  });

  it('is idempotent for the same session', async () => {
    await seed();
    await seedSession('alice-1', new Date().toISOString());
    await claim(PLAN_ID, TASK_ID, 'alice-1', env.cwd);
    const second = await claim(PLAN_ID, TASK_ID, 'alice-1', env.cwd);
    expect(second.assignee).toBe('alice-1');
  });

  it('rejects when held by a live session', async () => {
    await seed({ status: 'claimed', assignee: 'bob-1', claimed_at: new Date().toISOString() });
    await seedSession('bob-1', new Date().toISOString());
    await seedSession('alice-1', new Date().toISOString());
    await expect(claim(PLAN_ID, TASK_ID, 'alice-1', env.cwd)).rejects.toThrow(ClaimError);
  });

  it('steals a claim from a stale session', async () => {
    const stale = new Date(Date.now() - STALE_MS - 60_000).toISOString();
    await seed({ status: 'claimed', assignee: 'bob-1', claimed_at: stale });
    await seedSession('bob-1', stale);
    await seedSession('alice-1', new Date().toISOString());
    const result = await claim(PLAN_ID, TASK_ID, 'alice-1', env.cwd);
    expect(result.assignee).toBe('alice-1');
  });

  it('treats a missing session as released', async () => {
    await seed({
      status: 'claimed',
      assignee: 'ghost-1',
      claimed_at: '2026-05-09T00:00:00Z',
    });
    // No session file written for ghost-1
    await seedSession('alice-1', new Date().toISOString());
    const result = await claim(PLAN_ID, TASK_ID, 'alice-1', env.cwd);
    expect(result.assignee).toBe('alice-1');
  });
});

describe('transition', () => {
  it('moves claimed → in_progress for the owner', async () => {
    await seed({ status: 'claimed', assignee: 'alice-1', claimed_at: '2026-05-09T00:00:00Z' });
    const result = await transition(PLAN_ID, TASK_ID, 'in_progress', 'alice-1', {}, env.cwd);
    expect(result.status).toBe('in_progress');
  });

  it('rejects invalid transitions', async () => {
    await seed({ status: 'pending' });
    await expect(
      transition(PLAN_ID, TASK_ID, 'done', 'alice-1', { force: true }, env.cwd),
    ).rejects.toThrow(/invalid transition/);
  });

  it('rejects transitions from a non-owner without --force', async () => {
    await seed({ status: 'claimed', assignee: 'bob-1', claimed_at: '2026-05-09T00:00:00Z' });
    await expect(
      transition(PLAN_ID, TASK_ID, 'in_progress', 'alice-1', {}, env.cwd),
    ).rejects.toThrow(/owned by/);
  });

  it('requires a reason when transitioning to blocked', async () => {
    await seed({ status: 'in_progress', assignee: 'alice-1', claimed_at: '2026-05-09T00:00:00Z' });
    await expect(
      transition(PLAN_ID, TASK_ID, 'blocked', 'alice-1', {}, env.cwd),
    ).rejects.toThrow(/reason/);
    const result = await transition(
      PLAN_ID,
      TASK_ID,
      'blocked',
      'alice-1',
      { blockedReason: 'waiting on review' },
      env.cwd,
    );
    expect(result.status).toBe('blocked');
    expect(result.blocked_reason).toBe('waiting on review');
  });
});

describe('release', () => {
  it('moves the task back to pending and clears assignee', async () => {
    await seed({ status: 'in_progress', assignee: 'alice-1', claimed_at: '2026-05-09T00:00:00Z' });
    const result = await release(PLAN_ID, TASK_ID, 'alice-1', {}, env.cwd);
    expect(result.status).toBe('pending');
    expect(result.assignee).toBeNull();
    expect(result.claimed_at).toBeNull();
  });

  it('rejects release from a non-owner without force', async () => {
    await seed({ status: 'claimed', assignee: 'bob-1', claimed_at: '2026-05-09T00:00:00Z' });
    await expect(release(PLAN_ID, TASK_ID, 'alice-1', {}, env.cwd)).rejects.toThrow(/owned by/);
  });

  it('rejects release from terminal states', async () => {
    await seed({ status: 'done' });
    await expect(
      release(PLAN_ID, TASK_ID, 'alice-1', { force: true }, env.cwd),
    ).rejects.toThrow(/terminal/);
  });
});

describe('isStale', () => {
  it('returns false for a fresh heartbeat', () => {
    const session: Session = {
      id: 'x',
      agent: 'claude-code',
      machine: 'h',
      user: 'u',
      started_at: '2026-05-09T00:00:00Z',
      last_heartbeat: new Date().toISOString(),
      current_task: null,
    };
    expect(isStale(session)).toBe(false);
  });

  it('returns true once the heartbeat exceeds STALE_MS', () => {
    const session: Session = {
      id: 'x',
      agent: 'claude-code',
      machine: 'h',
      user: 'u',
      started_at: '2026-05-09T00:00:00Z',
      last_heartbeat: new Date(Date.now() - STALE_MS - 1_000).toISOString(),
      current_task: null,
    };
    expect(isStale(session)).toBe(true);
  });
});
