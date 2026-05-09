export type TaskStatus =
  | 'pending'
  | 'claimed'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'failed';

export type PlanStatus = 'active' | 'paused' | 'done' | 'abandoned';

export interface Note {
  at: string;
  by: string;
  msg: string;
}

export interface Task {
  id: string;
  plan_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignee: string | null;
  claimed_at: string | null;
  updated_at: string;
  depends_on: string[];
  blocked_reason: string | null;
  artifacts: string[];
  notes: Note[];
}

export interface Plan {
  id: string;
  title: string;
  description: string;
  created_at: string;
  created_by: string;
  status: PlanStatus;
  task_order: string[];
}

export interface Session {
  id: string;
  agent: 'claude-code' | 'codex' | 'other';
  machine: string;
  user: string;
  started_at: string;
  last_heartbeat: string;
  current_task: string | null;
}
