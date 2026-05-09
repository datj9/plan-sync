import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { init } from '../src/store.js';

export interface TestEnv {
  cwd: string;
  cleanup: () => Promise<void>;
}

export async function makeEnv(): Promise<TestEnv> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-sync-test-'));
  await init(cwd);
  return {
    cwd,
    cleanup: () => fs.rm(cwd, { recursive: true, force: true }),
  };
}
