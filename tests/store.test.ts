import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  allocateTaskId,
  ensureInitialised,
  init,
  listPlans,
  listTasks,
  readCounter,
  readPlan,
  readTask,
  writePlan,
  writeTask,
} from '../src/store.js';
import type { Plan, Task } from '../src/types.js';
import { makeEnv, type TestEnv } from './helpers.js';

let env: TestEnv;

beforeEach(async () => {
  env = await makeEnv();
});

afterEach(async () => {
  await env.cleanup();
});

const samplePlan = (id = 'plan-2026-05-09-test'): Plan => ({
  id,
  title: 'Test plan',
  description: 'desc',
  created_at: '2026-05-09T00:00:00Z',
  created_by: 'alice@laptop',
  status: 'active',
  task_order: [],
});

const sampleTask = (planId: string, id = 'TASK-1'): Task => ({
  id,
  plan_id: planId,
  title: 'Add JWT verification helper',
  description: 'verify signature, expiry, issuer',
  status: 'pending',
  assignee: null,
  claimed_at: null,
  updated_at: '2026-05-09T00:00:00Z',
  depends_on: [],
  blocked_reason: null,
  artifacts: [],
  notes: [{ at: '2026-05-09T00:00:00Z', by: 'alice@laptop', msg: 'created' }],
});

describe('init', () => {
  it('creates the .plan-sync directory tree and a zeroed counter', async () => {
    expect(await readCounter(env.cwd)).toBe(0);
    expect((await fs.stat(path.join(env.cwd, '.plan-sync', 'plans'))).isDirectory()).toBe(true);
    expect((await fs.stat(path.join(env.cwd, '.plan-sync', 'sessions'))).isDirectory()).toBe(true);
  });

  it('is idempotent and preserves the existing counter', async () => {
    await allocateTaskId(env.cwd);
    await allocateTaskId(env.cwd);
    await init(env.cwd);
    expect(await readCounter(env.cwd)).toBe(2);
  });
});

describe('ensureInitialised', () => {
  it('throws when the .plan-sync directory is missing', async () => {
    await fs.rm(path.join(env.cwd, '.plan-sync'), { recursive: true, force: true });
    await expect(ensureInitialised(env.cwd)).rejects.toThrow(/not initialised/);
  });
});

describe('counter', () => {
  it('allocates incrementing TASK ids', async () => {
    expect(await allocateTaskId(env.cwd)).toBe('TASK-1');
    expect(await allocateTaskId(env.cwd)).toBe('TASK-2');
    expect(await allocateTaskId(env.cwd)).toBe('TASK-3');
    expect(await readCounter(env.cwd)).toBe(3);
  });

  it('throws on a corrupt counter file', async () => {
    await fs.writeFile(path.join(env.cwd, '.plan-sync', 'COUNTER'), 'banana\n', 'utf8');
    await expect(readCounter(env.cwd)).rejects.toThrow(/corrupt/);
  });
});

describe('plan + task round trip', () => {
  it('persists and reads back identically', async () => {
    const plan = samplePlan();
    await writePlan(plan, env.cwd);
    const got = await readPlan(plan.id, env.cwd);
    expect(got).toEqual(plan);
  });

  it('writes and reads tasks under the right plan', async () => {
    const plan = samplePlan();
    await writePlan(plan, env.cwd);
    const task = sampleTask(plan.id);
    await writeTask(task, env.cwd);
    expect(await readTask(plan.id, task.id, env.cwd)).toEqual(task);
    expect(await listPlans(env.cwd)).toEqual([plan.id]);
    expect(await listTasks(plan.id, env.cwd)).toEqual([task.id]);
  });
});
