#!/usr/bin/env node
import { Command } from 'commander';
import {
  allocateTaskId,
  appendLog,
  ensureInitialised,
  init,
  listPlans,
  listTasks,
  readPlan,
  readTask,
  writePlan,
  writeTask,
} from './store.js';
import type { Plan, Session, Task, TaskStatus } from './types.js';
import { hostUser, nowIso, slugify } from './util.js';
import {
  DEFAULT_GC_DAYS,
  SESSION_ENV,
  currentSessionId,
  gcSessions,
  heartbeat,
  startSession,
} from './session.js';
import { claim, release, transition } from './claim.js';
import { hasRemote, isInsideGitRepo, pullRebase, push, withSync } from './git.js';

const program = new Command();

program
  .name('plan-sync')
  .description('Share task status across Claude Code / Codex sessions via git')
  .version('0.0.1');

program
  .command('init')
  .description('Initialise .plan-sync/ in the current repo')
  .action(async () => {
    await init();
    console.log('Initialised .plan-sync/');
  });

program
  .command('plan')
  .description('Plan operations')
  .addCommand(
    new Command('new')
      .argument('<slug>', 'short slug, kebab-case (e.g. auth-refactor)')
      .option('-t, --title <title>', 'plan title')
      .option('-d, --description <description>', 'plan description', '')
      .action(async (slug: string, opts: { title?: string; description: string }) => {
        await ensureInitialised();
        const date = nowIso().slice(0, 10);
        const id = `plan-${date}-${slugify(slug)}`;
        await withSync(`plan-sync: new plan ${id}`, async () => {
          const plan: Plan = {
            id,
            title: opts.title ?? slug,
            description: opts.description,
            created_at: nowIso(),
            created_by: hostUser(),
            status: 'active',
            task_order: [],
          };
          await writePlan(plan);
        });
        console.log(id);
      }),
  );

program
  .command('task')
  .description('Task operations')
  .addCommand(
    new Command('new')
      .argument('<plan-id>')
      .argument('<title...>')
      .option('-d, --description <description>', 'task description', '')
      .action(async (planId: string, titleParts: string[], opts: { description: string }) => {
        await ensureInitialised();
        const title = titleParts.join(' ');
        const taskId = await withSync(`plan-sync: new task ${planId}`, async () => {
          const plan = await readPlan(planId);
          const id = await allocateTaskId();
          const now = nowIso();
          const task: Task = {
            id,
            plan_id: planId,
            title,
            description: opts.description,
            status: 'pending',
            assignee: null,
            claimed_at: null,
            updated_at: now,
            depends_on: [],
            blocked_reason: null,
            artifacts: [],
            notes: [{ at: now, by: hostUser(), msg: 'created' }],
          };
          await writeTask(task);
          plan.task_order.push(id);
          await writePlan(plan);
          await appendLog(planId, { at: now, by: hostUser(), event: 'task_created', task: id });
          return id;
        });
        console.log(taskId);
      }),
  )
  .addCommand(
    new Command('claim')
      .argument('<plan-id>')
      .argument('<task-id>')
      .action(async (planId: string, taskId: string) => {
        await ensureInitialised();
        const sessionId = currentSessionId();
        const task = await withSync(`plan-sync: claim ${taskId}`, async () => {
          const claimed = await claim(planId, taskId, sessionId);
          await heartbeat(sessionId, taskId);
          return claimed;
        });
        console.log(`claimed ${task.id} as ${sessionId}`);
      }),
  )
  .addCommand(
    new Command('status')
      .argument('<plan-id>')
      .argument('<task-id>')
      .argument('<status>', 'pending | claimed | in_progress | blocked | done | failed')
      .option('-r, --reason <reason>', 'required when status=blocked')
      .option('-f, --force', 'override owner check', false)
      .action(
        async (
          planId: string,
          taskId: string,
          status: string,
          opts: { reason?: string; force: boolean },
        ) => {
          await ensureInitialised();
          const sessionId = currentSessionId();
          const task = await withSync(
            `plan-sync: ${taskId} → ${status}`,
            async () => {
              const updated = await transition(
                planId,
                taskId,
                status as TaskStatus,
                sessionId,
                { blockedReason: opts.reason, force: opts.force },
              );
              const idle =
                updated.status === 'done' ||
                updated.status === 'failed' ||
                updated.status === 'pending';
              await heartbeat(sessionId, idle ? null : taskId);
              return updated;
            },
          );
          console.log(`${task.id} → ${task.status}`);
        },
      ),
  )
  .addCommand(
    new Command('release')
      .argument('<plan-id>')
      .argument('<task-id>')
      .option('-f, --force', 'override owner check', false)
      .action(async (planId: string, taskId: string, opts: { force: boolean }) => {
        await ensureInitialised();
        const sessionId = currentSessionId();
        const task = await withSync(`plan-sync: release ${taskId}`, async () => {
          const released = await release(planId, taskId, sessionId, { force: opts.force });
          await heartbeat(sessionId, null);
          return released;
        });
        console.log(`released ${task.id}`);
      }),
  )
  .addCommand(
    new Command('show')
      .argument('<plan-id>')
      .argument('<task-id>')
      .action(async (planId: string, taskId: string) => {
        await ensureInitialised();
        const task = await readTask(planId, taskId);
        console.log(JSON.stringify(task, null, 2));
      }),
  );

program
  .command('session')
  .description('Session operations')
  .addCommand(
    new Command('start')
      .option('-a, --agent <agent>', 'agent kind: claude-code | codex | other', 'other')
      .action(async (opts: { agent: string }) => {
        await ensureInitialised();
        const agent = (['claude-code', 'codex', 'other'] as const).includes(
          opts.agent as Session['agent'],
        )
          ? (opts.agent as Session['agent'])
          : 'other';
        const session = await withSync(
          `plan-sync: session start`,
          () => startSession(agent),
        );
        console.log(session.id);
        console.error(`# To use this session, run:\n# export ${SESSION_ENV}=${session.id}`);
      }),
  )
  .addCommand(
    new Command('heartbeat')
      .option('-t, --task <task-id>', 'task id currently being worked on (omit if idle)')
      .action(async (opts: { task?: string }) => {
        await ensureInitialised();
        const sessionId = currentSessionId();
        const session = await withSync(`plan-sync: heartbeat ${sessionId}`, () =>
          heartbeat(sessionId, opts.task ?? null),
        );
        console.log(`heartbeat ${session.id} @ ${session.last_heartbeat}`);
      }),
  )
  .addCommand(
    new Command('gc')
      .description(
        `Remove session files whose last_heartbeat is older than --days (default ${DEFAULT_GC_DAYS})`,
      )
      .option('-d, --days <n>', 'age threshold in days', String(DEFAULT_GC_DAYS))
      .action(async (opts: { days: string }) => {
        await ensureInitialised();
        const days = Number.parseInt(opts.days, 10);
        if (!Number.isFinite(days) || days < 0) {
          console.error(`error: --days must be a non-negative integer (got "${opts.days}")`);
          process.exit(1);
        }
        const removed = await withSync(`plan-sync: session gc (>${days}d)`, () =>
          gcSessions({ olderThanDays: days }),
        );
        if (removed.length === 0) {
          console.log('no sessions to remove');
          return;
        }
        for (const id of removed) console.log(`removed ${id}`);
      }),
  );

program
  .command('sync')
  .description('Pull --rebase then push (no-op if remote is up to date)')
  .action(async () => {
    if (!(await isInsideGitRepo())) {
      console.error('error: not inside a git repository');
      process.exit(1);
    }
    if (!(await hasRemote('origin'))) {
      console.error('error: no `origin` remote configured');
      process.exit(1);
    }
    await pullRebase();
    await push();
    console.log('synced');
  });

program
  .command('ls')
  .description('List plans and tasks')
  .action(async () => {
    await ensureInitialised();
    const plans = await listPlans();
    if (plans.length === 0) {
      console.log('(no plans)');
      return;
    }
    for (const planId of plans) {
      const tasks = await listTasks(planId);
      console.log(`${planId}  (${tasks.length} task${tasks.length === 1 ? '' : 's'})`);
      for (const taskId of tasks) {
        const t = await readTask(planId, taskId);
        const assignee = t.assignee ?? '-';
        console.log(`  ${t.id}  [${t.status}]  ${assignee}  ${t.title}`);
      }
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`error: ${message}`);
  process.exit(1);
});
