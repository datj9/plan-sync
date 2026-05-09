# plan-sync

Share task status (within plans) between multiple Claude Code / Codex sessions, file-based and git-tracked. No daemon — just files and git.

## Decisions (locked)

- **Coordination**: Git-only. Pull → mutate → commit → push.
- **State shared**: Full plan + execution context + small text artifacts.
- **Storage**: Inline in repo. Text only, ≤1 MB per file, ≤50 MB per plan.
- **IDs**: Tasks `TASK-<n>` (monotonic int). Plans `plan-<YYYY-MM-DD>-<slug>`.

See [SCHEMA.md](./SCHEMA.md) for the full data model.

## Install (dev)

```bash
npm install
npm run build
npm link        # makes `plan-sync` available globally
```

Or run without installing:

```bash
npm run dev -- <args>
```

## Usage

```bash
plan-sync init
plan-sync session start --agent claude-code         # prints session id
export PLAN_SYNC_SESSION=<that-id>

plan-sync plan new auth-refactor --title "Refactor auth middleware"
plan-sync task new plan-2026-05-09-auth-refactor "Add JWT verification helper"

plan-sync task claim   plan-2026-05-09-auth-refactor TASK-1
plan-sync task status  plan-2026-05-09-auth-refactor TASK-1 in_progress
plan-sync task status  plan-2026-05-09-auth-refactor TASK-1 done
plan-sync task release plan-2026-05-09-auth-refactor TASK-1   # back to pending
plan-sync task show    plan-2026-05-09-auth-refactor TASK-1

plan-sync session heartbeat --task TASK-1            # while working
plan-sync session gc --days 7                        # prune old sessions
plan-sync sync                                       # manual pull --rebase + push
plan-sync ls
```

## Environment

| var | meaning |
|---|---|
| `PLAN_SYNC_SESSION` | required for any claim/status/release/heartbeat operation |
| `PLAN_SYNC_NO_GIT=1` | skip the auto-pull/commit/push wrapper (solo dev / testing) |

Each state-changing command auto-runs `git pull --rebase --autostash` before, and `git add .plan-sync && commit && push` after. On push rejection it pulls + retries once. Skipped when not in a repo, no `origin`, or `PLAN_SYNC_NO_GIT=1`.

## Layout

```
src/
├── cli.ts        # commander entry point
├── store.ts      # file IO (yaml + counter + log)
├── session.ts    # session lifecycle + stale detection + gc
├── claim.ts      # claim / release / status state machine
├── git.ts        # withSync wrapper, pullRebase, push
├── paths.ts      # path helpers
├── types.ts      # Plan, Task, Session
└── util.ts       # nowIso, hostUser, slugify
```

## Tests

```bash
npm test            # 27 tests across store, claim, session
npm run build       # tsc, no emit issues
```

## Pre-commit hook

`npm install` (or `npm run prepare` once) sets `core.hooksPath=hooks`, which enables `hooks/pre-commit`. The hook runs `scripts/check-secrets.mjs` against staged additions and blocks the commit if it detects any of:

- AWS access keys, GitHub tokens, Slack tokens, Stripe keys, Google API keys
- Private key blocks (`-----BEGIN ... PRIVATE KEY-----`)
- JWT-shaped strings
- Generic `api_key=...` / `secret=...` / `password=...` assignments with 20+ char values

To bypass for a verified false positive: `git commit --no-verify`. Use sparingly.

## Status

v0. Working: init, plan new, task new/claim/status/release/show, session start/heartbeat/gc, sync, ls. Auto-sync via git wrapper. 27 tests passing.
