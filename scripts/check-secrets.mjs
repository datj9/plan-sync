#!/usr/bin/env node
// Pre-commit secret scanner. Examines only the lines being ADDED in the
// staged diff, not the full file. Exits 1 with details if a match is found.
import { execFileSync } from 'node:child_process';

const PATTERNS = [
  { name: 'AWS Access Key ID', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'GitHub Token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: 'Slack Token', regex: /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'Stripe Key', regex: /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
  { name: 'Google API Key', regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  {
    name: 'Private Key Block',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED |)PRIVATE KEY-----/g,
  },
  {
    name: 'JWT',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    name: 'Generic secret assignment',
    regex:
      /(api[-_]?key|secret|password|access[-_]?token|auth[-_]?token|client[-_]?secret)["'\s]*[:=]\s*["'][A-Za-z0-9!@#$%^&*()_\-+=/]{20,}["']/gi,
  },
];

const SKIP_PATHS = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)\.lock$/,
  /(^|\/)scripts\/check-secrets\.mjs$/,
];

const NUL = String.fromCharCode(0);

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function stagedFiles() {
  const out = git(['diff', '--cached', '--name-only', '--diff-filter=ACMRT']);
  return out.split('\n').filter(Boolean);
}

function stagedDiff(file) {
  return git(['diff', '--cached', '-U0', '--', file]);
}

function addedLines(diff) {
  const lines = diff.split('\n');
  const added = [];
  for (const line of lines) {
    if (line.startsWith('+++')) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
  }
  return added.join('\n');
}

function isLikelyBinary(str) {
  return str.slice(0, 4096).includes(NUL);
}

function truncate(s, n = 24) {
  return s.length > n ? s.slice(0, n) + '...' : s;
}

const findings = [];
for (const file of stagedFiles()) {
  if (SKIP_PATHS.some((re) => re.test(file))) continue;
  let diff;
  try {
    diff = stagedDiff(file);
  } catch {
    continue;
  }
  const content = addedLines(diff);
  if (!content || isLikelyBinary(content)) continue;
  for (const { name, regex } of PATTERNS) {
    regex.lastIndex = 0;
    const matches = content.matchAll(regex);
    for (const m of matches) {
      findings.push({ file, pattern: name, sample: truncate(m[0]) });
    }
  }
}

if (findings.length > 0) {
  console.error('');
  console.error('Pre-commit hook: potential secrets in staged changes');
  console.error('---------------------------------------------------');
  for (const f of findings) {
    console.error('  ' + f.file + ': ' + f.pattern + '  ->  ' + f.sample);
  }
  console.error('');
  console.error('Remove the value (use an env var or .env.example placeholder),');
  console.error('or override with `git commit --no-verify` if confirmed false positive.');
  process.exit(1);
}
