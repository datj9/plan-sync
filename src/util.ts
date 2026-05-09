import os from 'node:os';

export function nowIso(): string {
  return new Date().toISOString();
}

export function hostUser(): string {
  const user = os.userInfo().username;
  const host = os.hostname().split('.')[0] ?? 'unknown';
  return `${user}@${host}`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
