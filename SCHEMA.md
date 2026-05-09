# plan-sync schema (draft v0)

## Layout

```
.plan-sync/
├── plans/
│   └── <plan-id>/
│       ├── plan.yaml              # plan metadata
│       ├── tasks/
│       │   └── <task-id>.yaml     # one file per task — avoids merge conflicts
│       ├── artifacts/             # output files (logs, diffs, generated docs)
│       └── log.jsonl              # append-only event stream
└── sessions/
    └── <session-id>.yaml          # active session heartbeat + claim
```

One task per file is deliberate: concurrent sessions editing different tasks won't collide in git. The append-only `log.jsonl` is the audit trail — never edit, only append.

## plan.yaml

```yaml
id: plan-2026-05-09-auth-refactor
title: Refactor auth middleware
description: |
  Replace legacy session-token middleware with JWT verification.
created_at: 2026-05-09T06:42:00Z
created_by: dat@laptop
status: active                      # active | paused | done | abandoned
task_order:                         # defines execution order; cycles disallowed
  - TASK-121
  - TASK-122
  - TASK-123
```

## tasks/<task-id>.yaml

```yaml
id: TASK-123
plan_id: plan-2026-05-09-auth-refactor
title: Add JWT verification helper
description: |
  Create verifyJwt() with signature check, expiry check, issuer check.
status: pending                     # pending | claimed | in_progress | blocked | done | failed
assignee: null                      # session id, or null
claimed_at: null
updated_at: 2026-05-09T06:42:00Z
depends_on: []                      # task ids (e.g. TASK-122) that must reach status=done first
blocked_reason: null                # required when status=blocked
artifacts:                          # paths relative to artifacts/ dir
  - TASK-123/diff.patch
  - TASK-123/test-output.log
notes:                              # append-only; newest last
  - { at: 2026-05-09T06:42:00Z, by: dat@laptop, msg: "created" }
```

## sessions/<session-id>.yaml

```yaml
id: claude-code-dat-laptop-7f3a
agent: claude-code                  # claude-code | codex | other
machine: dat-laptop
user: dat
started_at: 2026-05-09T06:30:00Z
last_heartbeat: 2026-05-09T06:42:00Z
current_task: task-001              # null when idle
```

A session is considered stale if `last_heartbeat` is older than 10 minutes. Stale sessions release their claims automatically on next read.

## log.jsonl (append-only)

One JSON object per line. No deletes, no edits.

```jsonl
{"at":"2026-05-09T06:42:00Z","by":"claude-code-dat-laptop-7f3a","event":"claim","task":"TASK-123"}
{"at":"2026-05-09T06:43:10Z","by":"claude-code-dat-laptop-7f3a","event":"status","task":"TASK-123","from":"claimed","to":"in_progress"}
{"at":"2026-05-09T06:55:00Z","by":"claude-code-dat-laptop-7f3a","event":"artifact","task":"TASK-123","path":"TASK-123/diff.patch"}
{"at":"2026-05-09T06:56:00Z","by":"claude-code-dat-laptop-7f3a","event":"status","task":"TASK-123","from":"in_progress","to":"done"}
```

## Concurrency rules

- **Claim before work**: a session must transition a task `pending → claimed` (writing `assignee` + `claimed_at`) before doing any work. The CLI rejects the claim if `assignee` is non-null and the holder's session isn't stale.
- **Heartbeat every minute** while a task is claimed. Missed heartbeats > 10 min release the claim.
- **Git is the merge layer**: pull before claim, push after every status transition. Conflicts on a task file mean two sessions claimed simultaneously — last-write loses, attacker re-pulls and re-tries.
- **No cross-task atomicity**: if you need to update two tasks together, do them sequentially. The log.jsonl preserves intent.

## Decisions

- **Coordination**: Git-only. No daemon. Pull-claim-push per state transition. Accept 1–2s latency.
- **Task IDs**: `TASK-<n>` where `<n>` is a monotonic integer (e.g. `TASK-123`). The next-id is read from `.plan-sync/COUNTER` (single line, integer), incremented and committed atomically with the new task file.
- **Plan IDs**: `plan-<YYYY-MM-DD>-<slug>` (e.g. `plan-2026-05-09-auth-refactor`). Slug kebab-case, ≤4 words.

## Counter file

```
.plan-sync/COUNTER
```

Contents: a single integer on one line, e.g. `124`. To allocate `TASK-124`:

1. `git pull --rebase`
2. Read `COUNTER`, write `COUNTER + 1`
3. Create `tasks/TASK-124.yaml`
4. Commit both files together (one commit)
5. `git push`
6. If push rejected → `git pull --rebase` (counter conflict resolves by taking max), re-allocate next number, retry

## Artifact storage

**Inline in repo.** All artifacts live at `.plan-sync/plans/<plan-id>/artifacts/<TASK-id>/*` and are git-tracked alongside everything else.

Constraints to keep this sane:

- Each artifact file ≤ 1 MB. Logs above that should be truncated or summarized before saving.
- Total artifacts per plan ≤ 50 MB. Past that, evict — move old artifacts off-repo or delete.
- Prefer text formats (logs, diffs, generated markdown). No binaries. No screenshots, recordings, or build blobs.
- If a session needs to "save" something larger, write a summary instead and link to the original location (path, URL, ticket).
