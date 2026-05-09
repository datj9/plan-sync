import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import type { Plan, Session, Task } from './types.js';
import {
  counterFile,
  logFile,
  planDir,
  planFile,
  plansDir,
  rootDir,
  sessionFile,
  sessionsDir,
  taskFile,
} from './paths.js';

export async function ensureInitialised(cwd?: string): Promise<void> {
  const root = rootDir(cwd);
  try {
    await fs.access(root);
  } catch {
    throw new Error(
      `plan-sync not initialised in ${cwd ?? process.cwd()}. Run \`plan-sync init\` first.`,
    );
  }
}

export async function init(cwd?: string): Promise<void> {
  const root = rootDir(cwd);
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(plansDir(cwd), { recursive: true });
  await fs.mkdir(sessionsDir(cwd), { recursive: true });
  const counter = counterFile(cwd);
  try {
    await fs.access(counter);
  } catch {
    await fs.writeFile(counter, '0\n', 'utf8');
  }
}

export async function readCounter(cwd?: string): Promise<number> {
  const raw = await fs.readFile(counterFile(cwd), 'utf8');
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`COUNTER file is corrupt: "${raw.trim()}"`);
  }
  return n;
}

export async function writeCounter(value: number, cwd?: string): Promise<void> {
  await fs.writeFile(counterFile(cwd), `${value}\n`, 'utf8');
}

export async function allocateTaskId(cwd?: string): Promise<string> {
  const current = await readCounter(cwd);
  const next = current + 1;
  await writeCounter(next, cwd);
  return `TASK-${next}`;
}

export async function writePlan(plan: Plan, cwd?: string): Promise<void> {
  const dir = planDir(plan.id, cwd);
  await fs.mkdir(path.join(dir, 'tasks'), { recursive: true });
  await fs.mkdir(path.join(dir, 'artifacts'), { recursive: true });
  await fs.writeFile(planFile(plan.id, cwd), yaml.dump(plan), 'utf8');
  // Initialise empty log if missing.
  const log = logFile(plan.id, cwd);
  try {
    await fs.access(log);
  } catch {
    await fs.writeFile(log, '', 'utf8');
  }
}

export async function readPlan(planId: string, cwd?: string): Promise<Plan> {
  const raw = await fs.readFile(planFile(planId, cwd), 'utf8');
  return yaml.load(raw) as Plan;
}

export async function listPlans(cwd?: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(plansDir(cwd), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function writeTask(task: Task, cwd?: string): Promise<void> {
  await fs.writeFile(taskFile(task.plan_id, task.id, cwd), yaml.dump(task), 'utf8');
}

export async function readTask(planId: string, taskId: string, cwd?: string): Promise<Task> {
  const raw = await fs.readFile(taskFile(planId, taskId, cwd), 'utf8');
  return yaml.load(raw) as Task;
}

export async function listTasks(planId: string, cwd?: string): Promise<string[]> {
  const dir = path.join(planDir(planId, cwd), 'tasks');
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, ''));
  } catch {
    return [];
  }
}

export async function writeSession(session: Session, cwd?: string): Promise<void> {
  await fs.writeFile(sessionFile(session.id, cwd), yaml.dump(session), 'utf8');
}

export async function appendLog(
  planId: string,
  entry: Record<string, unknown>,
  cwd?: string,
): Promise<void> {
  await fs.appendFile(logFile(planId, cwd), `${JSON.stringify(entry)}\n`, 'utf8');
}
