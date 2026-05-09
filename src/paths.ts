import path from 'node:path';

export const ROOT_DIR_NAME = '.plan-sync';

export function rootDir(cwd: string = process.cwd()): string {
  return path.join(cwd, ROOT_DIR_NAME);
}

export function counterFile(cwd?: string): string {
  return path.join(rootDir(cwd), 'COUNTER');
}

export function plansDir(cwd?: string): string {
  return path.join(rootDir(cwd), 'plans');
}

export function planDir(planId: string, cwd?: string): string {
  return path.join(plansDir(cwd), planId);
}

export function taskFile(planId: string, taskId: string, cwd?: string): string {
  return path.join(planDir(planId, cwd), 'tasks', `${taskId}.yaml`);
}

export function planFile(planId: string, cwd?: string): string {
  return path.join(planDir(planId, cwd), 'plan.yaml');
}

export function logFile(planId: string, cwd?: string): string {
  return path.join(planDir(planId, cwd), 'log.jsonl');
}

export function sessionsDir(cwd?: string): string {
  return path.join(rootDir(cwd), 'sessions');
}

export function sessionFile(sessionId: string, cwd?: string): string {
  return path.join(sessionsDir(cwd), `${sessionId}.yaml`);
}
