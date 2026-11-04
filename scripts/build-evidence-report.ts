import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { buildEvidenceReport, renderEvidenceHtml, renderEvidenceSummary } from '../packages/bridge/src/evidence/report.js';

const usage = 'Usage: yarn tsx scripts/build-evidence-report.ts --out DIR --repository OWNER/REPO --revision SHA [--web FILE] [--android DIR] [--ios DIR] [--pull-request NUMBER] [--summary-file FILE]';
const allowed = new Set(['--out', '--repository', '--revision', '--web', '--android', '--ios', '--pull-request', '--summary-file']);

function options(argv: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!allowed.has(key) || result.has(key) || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(usage);
    result.set(key, argv[++index]);
  }
  return result;
}

function pullRequestFromEnvironment(): number | undefined {
  const ref = process.env.GITHUB_REF?.match(/^refs\/pull\/(\d+)\//);
  if (ref) return Number(ref[1]);
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return undefined;
  try {
    if (statSync(eventPath).size > 1024 * 1024) return undefined;
    const event = JSON.parse(readFileSync(eventPath, 'utf8')) as { pull_request?: { number?: unknown } };
    return typeof event.pull_request?.number === 'number' ? event.pull_request.number : undefined;
  } catch { return undefined; }
}

function main(argv: string[]): void {
  const args = options(argv);
  const out = args.get('--out');
  const repository = args.get('--repository') ?? process.env.GITHUB_REPOSITORY;
  const revision = args.get('--revision') ?? process.env.GITHUB_SHA;
  const pullRequestText = args.get('--pull-request');
  const pullRequest = pullRequestText === undefined ? pullRequestFromEnvironment() : Number(pullRequestText);
  if (!out || !repository || !revision || (pullRequestText !== undefined && (!/^\d+$/.test(pullRequestText) || !Number.isSafeInteger(pullRequest)))) throw new Error(usage);
  const report = buildEvidenceReport({
    repository,
    revision,
    ...(pullRequest ? { pullRequest } : {}),
    ...(args.has('--web') ? { webFile: args.get('--web') } : {}),
    ...(args.has('--android') ? { androidDirectory: args.get('--android') } : {}),
    ...(args.has('--ios') ? { iosDirectory: args.get('--ios') } : {}),
  });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'index.html'), renderEvidenceHtml(report), { encoding: 'utf8', mode: 0o600 });
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  const summary = renderEvidenceSummary(report);
  writeFileSync(join(out, 'summary.md'), summary, { encoding: 'utf8', mode: 0o600 });
  const summaryPath = args.get('--summary-file') ?? process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    if (!isAbsolute(summaryPath)) throw new Error('GitHub summary path must be absolute');
    appendFileSync(summaryPath, summary, 'utf8');
  }
  console.log(`EVIDENCE_REPORT_OK runs=${report.runs.length} unavailable=${report.notes.length}`);
}

try { main(process.argv.slice(2)); }
catch (error) {
  console.error(error instanceof Error && error.message === usage ? usage : 'Unable to build a validated visual evidence report.');
  process.exitCode = 1;
}
