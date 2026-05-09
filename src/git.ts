import { spawn } from 'node:child_process';
import { ROOT_DIR_NAME } from './paths.js';

export const NO_GIT_ENV = 'PLAN_SYNC_NO_GIT';

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

function run(args: string[], cwd?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
    child.on('error', (err) => reject(err));
  });
}

async function ok(args: string[], cwd?: string): Promise<RunResult> {
  const result = await run(args, cwd);
  if (result.code !== 0) {
    const command = `git ${args.join(' ')}`;
    throw new Error(`${command} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result;
}

export async function isInsideGitRepo(cwd?: string): Promise<boolean> {
  const result = await run(['rev-parse', '--git-dir'], cwd);
  return result.code === 0;
}

export async function hasRemote(remote: string = 'origin', cwd?: string): Promise<boolean> {
  const result = await run(['remote', 'get-url', remote], cwd);
  return result.code === 0;
}

export async function shouldSync(cwd?: string): Promise<boolean> {
  if (process.env[NO_GIT_ENV] === '1') return false;
  if (!(await isInsideGitRepo(cwd))) return false;
  return hasRemote('origin', cwd);
}

export async function pullRebase(cwd?: string): Promise<void> {
  await ok(['pull', '--rebase', '--autostash'], cwd);
}

export async function push(cwd?: string): Promise<void> {
  const first = await run(['push'], cwd);
  if (first.code === 0) return;
  // Most likely cause: non-fast-forward. Try rebase + push once more.
  await ok(['pull', '--rebase', '--autostash'], cwd);
  await ok(['push'], cwd);
}

export async function addCommitPush(message: string, cwd?: string): Promise<void> {
  await ok(['add', ROOT_DIR_NAME], cwd);
  const staged = await ok(['diff', '--cached', '--name-only'], cwd);
  if (!staged.stdout.trim()) return; // nothing to commit
  await ok(['commit', '-m', message], cwd);
  await push(cwd);
}

export async function withSync<T>(
  message: string,
  op: () => Promise<T>,
  cwd: string = process.cwd(),
): Promise<T> {
  const sync = await shouldSync(cwd);
  if (sync) await pullRebase(cwd);
  const result = await op();
  if (sync) await addCommitPush(message, cwd);
  return result;
}
