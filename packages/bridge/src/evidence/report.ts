import {
  CommitReceiptSchema,
  ConstraintResultSchema,
  NativeTargetSchema,
  SpatialSnapshotSchema,
  VisualEvidenceReportSchema,
  VisualEvidenceRunSchema,
  type SpatialSnapshot,
  type SpatialNode,
  type VisualEvidenceReport,
  type VisualEvidenceRun,
} from '@nativemason/contracts';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_SNAPSHOT_NODES = 5_000;
const MAX_RENDERED_NODES = 250;
const MAX_LAYOUT_UNITS = 100_000;
const palette = ['#2563eb', '#dc2626', '#059669', '#7c3aed', '#d97706', '#0891b2'];

export interface EvidenceInputs {
  repository: string;
  revision: string;
  pullRequest?: number;
  webFile?: string;
  androidDirectory?: string;
  iosDirectory?: string;
}

function readJson(path: string): unknown | undefined {
  try {
    if (statSync(path).size > MAX_INPUT_BYTES) return undefined;
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function isRelativeEvidencePath(path: string): boolean {
  const hasControl = [...path].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  return path.length > 0 && !path.startsWith('/') && !path.includes('\\') && !path.includes(':') && !hasControl && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

function hasSafePaths(run: VisualEvidenceRun): boolean {
  const paths = [
    ...Object.keys(run.before.revisions),
    ...Object.keys(run.after.revisions),
    ...run.before.nodes.flatMap(node => node.source ? [node.source.path, ...(node.source.dependencies ?? [])] : []),
    ...run.after.nodes.flatMap(node => node.source ? [node.source.path, ...(node.source.dependencies ?? [])] : []),
    ...(run.receipt ? [run.receipt.path, ...(run.receipt.files?.map(file => file.path) ?? [])] : []),
  ];
  return paths.every(isRelativeEvidencePath);
}

function boundedSnapshot(snapshot: SpatialSnapshot): boolean {
  const { width, height } = snapshot.profile.window;
  if (width > MAX_LAYOUT_UNITS || height > MAX_LAYOUT_UNITS || snapshot.nodes.length > MAX_SNAPSHOT_NODES) return false;
  return snapshot.nodes.every(({ rect }) => [rect.x, rect.y, rect.width, rect.height].every(value => Math.abs(value) <= MAX_LAYOUT_UNITS));
}

function unavailable(message: string): string { return `${message} No measurements were added.`; }

function addRun(value: unknown, label: string, runs: VisualEvidenceRun[], notes: string[]): void {
  const parsed = VisualEvidenceRunSchema.safeParse(value);
  if (!parsed.success || !hasSafePaths(parsed.data) || !boundedSnapshot(parsed.data.before) || !boundedSnapshot(parsed.data.after)) {
    notes.push(unavailable(`${label} evidence is missing, invalid, unsafe, or exceeds report bounds.`));
    return;
  }
  runs.push(parsed.data);
}

function addNativeRun(directory: string | undefined, platform: 'android' | 'ios', runs: VisualEvidenceRun[], notes: string[]): void {
  const label = platform === 'android' ? 'Android emulator' : 'iOS simulator';
  if (!directory) { notes.push(unavailable(`${label} evidence is unavailable.`)); return; }
  const calibrationValue = readJson(join(directory, 'calibration.json'));
  const acceptanceValue = readJson(join(directory, 'acceptance.json')) as Record<string, unknown> | undefined;
  const verified = acceptanceValue?.verified as Record<string, unknown> | undefined;
  const target = NativeTargetSchema.safeParse(acceptanceValue?.target);
  const before = SpatialSnapshotSchema.safeParse(calibrationValue);
  const after = SpatialSnapshotSchema.safeParse(verified?.snapshot);
  const receipt = CommitReceiptSchema.safeParse(verified?.receipt);
  const results = ConstraintResultSchema.array().safeParse(verified?.results);
  const rawTarget = acceptanceValue?.target as { kind?: unknown } | undefined;
  const rawBefore = calibrationValue as { nativeTarget?: { kind?: unknown } } | undefined;
  const rawAfter = verified?.snapshot as { nativeTarget?: { kind?: unknown } } | undefined;
  const isPhysical = rawTarget?.kind === 'physical' || rawBefore?.nativeTarget?.kind === 'physical' || rawAfter?.nativeTarget?.kind === 'physical'
    || target.success && target.data.kind === 'physical'
    || before.success && before.data.nativeTarget?.kind === 'physical'
    || after.success && after.data.nativeTarget?.kind === 'physical';
  if (isPhysical) { notes.push(unavailable(`${label} physical-target evidence is excluded from public reports.`)); return; }
  const expectedKind = platform === 'android' ? 'emulator' : 'simulator';
  const valid = target.success && target.data.platform === platform && target.data.kind === expectedKind
    && before.success && after.success && receipt.success && results.success && results.data.length > 0
    && typeof verified?.passed === 'boolean'
    && before.data.platform === platform && before.data.nativeTarget?.kind === expectedKind
    && after.data.platform === platform && after.data.nativeTarget?.kind === expectedKind
    && (verified.passed !== false || receipt.data.nativeStatus !== 'passed')
    && before.data.nativeTarget.targetId === target.data.targetId
    && after.data.nativeTarget.targetId === target.data.targetId;
  if (!valid) { notes.push(unavailable(`${label} acceptance or calibration evidence is missing or inconsistent.`)); return; }
  const passed = verified.passed === true;
  addRun({
    id: platform === 'android' ? 'android-emulator' : 'ios-simulator',
    title: label,
    target: platform === 'android' ? 'android-emulator' : 'ios-simulator',
    before: before.data,
    after: after.data,
    results: results.data,
    receipt: receipt.data,
    nativeStatus: passed ? 'passed' : 'failed',
    notes: passed ? [] : ['Native acceptance did not pass.'],
  }, label, runs, notes);
}

export function buildEvidenceReport(input: EvidenceInputs): VisualEvidenceReport {
  const runs: VisualEvidenceRun[] = [];
  const notes: string[] = [];
  if (input.webFile) {
    const web = readJson(input.webFile);
    if (web === undefined) notes.push(unavailable('Web evidence is unavailable.'));
    else addRun(web, 'Web', runs, notes);
  } else notes.push(unavailable('Web evidence is unavailable.'));
  addNativeRun(input.androidDirectory, 'android', runs, notes);
  addNativeRun(input.iosDirectory, 'ios', runs, notes);
  return VisualEvidenceReportSchema.parse({
    schemaVersion: 1,
    repository: input.repository,
    revision: input.revision,
    ...(input.pullRequest ? { pullRequest: input.pullRequest } : {}),
    runs,
    notes,
  });
}

function escapeHtml(value: unknown): string {
  const text = String(value);
  const bounded = text.length > 512 ? text.slice(0, 509) + '…' : text;
  return bounded.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function number(value: number): string { return Number(value.toFixed(3)).toString(); }
function rectText(node: SpatialNode | undefined): string {
  if (!node) return '—';
  const { x, y, width, height } = node.rect;
  return `${number(x)}, ${number(y)} · ${number(width)} × ${number(height)}`;
}

function renderSvg(snapshot: SpatialSnapshot, title: string): string {
  const { width, height } = snapshot.profile.window;
  const nodes = snapshot.nodes.slice(0, MAX_RENDERED_NODES);
  const shapes = nodes.map((node, index) => {
    const color = palette[index % palette.length];
    const rect = node.rect;
    return `<rect x="${number(rect.x)}" y="${number(rect.y)}" width="${number(rect.width)}" height="${number(rect.height)}" fill="${color}" fill-opacity=".13" stroke="${color}" stroke-width="1"><title>${escapeHtml(node.id)} · ${escapeHtml(node.kind)}</title></rect>`;
  }).join('');
  return `<svg class="layout" viewBox="0 0 ${number(width)} ${number(height)}" role="img" aria-label="${escapeHtml(title)} registered measured layout boxes"><title>${escapeHtml(title)} · registered measured layout boxes</title><rect width="100%" height="100%" fill="#f8fafc"/>${shapes}</svg>`;
}

function renderRun(run: VisualEvidenceRun): string {
  const beforeById = new Map(run.before.nodes.map(node => [node.id, node]));
  const afterById = new Map(run.after.nodes.map(node => [node.id, node]));
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();
  const visibleIds = ids.slice(0, MAX_RENDERED_NODES);
  const geometryRows = visibleIds.map(id => `<tr><th>${escapeHtml(id)}</th><td>${rectText(beforeById.get(id))}</td><td>${rectText(afterById.get(id))}</td></tr>`).join('');
  const constraints = run.results.length ? run.results.slice(0, MAX_RENDERED_NODES).map(result => `<tr><td>${escapeHtml(result.constraintId)}</td><td>${escapeHtml(result.status)}</td><td>${escapeHtml(result.elementIds.join(', '))}</td><td>${escapeHtml(result.tolerance)}</td><td>${escapeHtml(result.deviation ?? '—')}</td><td>${escapeHtml(result.message)}</td></tr>`).join('') : '<tr><td colspan="6">No constraint results were supplied.</td></tr>';
  const revisions = [...new Set([...Object.keys(run.before.revisions), ...Object.keys(run.after.revisions)])].sort();
  const revisionRows = revisions.slice(0, MAX_RENDERED_NODES).map(path => `<tr><th>${escapeHtml(path)}</th><td><code>${escapeHtml(run.before.revisions[path] ?? '—')}</code></td><td><code>${escapeHtml(run.after.revisions[path] ?? '—')}</code></td></tr>`).join('');
  const receiptFiles = run.receipt?.files?.length ? run.receipt.files : run.receipt ? [run.receipt] : [];
  const receipt = run.receipt ? `<table><caption>Commit receipt</caption><thead><tr><th>Commit</th><th>Status</th><th>File</th><th>Old revision</th><th>New revision</th></tr></thead><tbody>${receiptFiles.slice(0, MAX_RENDERED_NODES).map(file => `<tr><td>${escapeHtml(run.receipt!.commitId)}</td><td>${escapeHtml(run.receipt!.nativeStatus)}</td><td>${escapeHtml(file.path)}</td><td><code>${escapeHtml(file.oldHash)}</code></td><td><code>${escapeHtml(file.newHash)}</code></td></tr>`).join('')}</tbody></table>` : '<p>No commit receipt was supplied.</p>';
  const notes = run.notes.length ? `<ul>${run.notes.slice(0, MAX_RENDERED_NODES).map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul>` : '';
  const truncated = ids.length > MAX_RENDERED_NODES || revisions.length > MAX_RENDERED_NODES || run.results.length > MAX_RENDERED_NODES || receiptFiles.length > MAX_RENDERED_NODES || run.notes.length > MAX_RENDERED_NODES
    ? `<p>Tables and notes show at most ${MAX_RENDERED_NODES} rows; the JSON manifest retains full evidence.</p>` : '';
  return `<section id="${escapeHtml(run.id)}"><h2>${escapeHtml(run.title)}</h2><p>Target: ${escapeHtml(run.target)} · status: <strong>${escapeHtml(run.nativeStatus)}</strong> · scenario: ${escapeHtml(run.after.scenarioId)}</p>${notes}<h3>Registered measured layout boxes</h3><div class="panels"><figure>${renderSvg(run.before, 'Before')}<figcaption>Before · ${escapeHtml(run.before.profile.window.width)} × ${escapeHtml(run.before.profile.window.height)} logical units</figcaption></figure><figure>${renderSvg(run.after, 'After')}<figcaption>After · ${escapeHtml(run.after.profile.window.width)} × ${escapeHtml(run.after.profile.window.height)} logical units</figcaption></figure></div><table><caption>Layout box measurements · x, y · width × height in logical units</caption><thead><tr><th>Element</th><th>Before</th><th>After</th></tr></thead><tbody>${geometryRows || '<tr><td colspan="3">No measured layout boxes.</td></tr>'}</tbody></table>${truncated}<table><caption>Constraint results</caption><thead><tr><th>Constraint</th><th>Status</th><th>Elements</th><th>Tolerance</th><th>Deviation</th><th>Message</th></tr></thead><tbody>${constraints}</tbody></table><table><caption>Source revisions</caption><thead><tr><th>Relative source path</th><th>Before</th><th>After</th></tr></thead><tbody>${revisionRows || '<tr><td colspan="3">No source revisions.</td></tr>'}</tbody></table>${receipt}</section>`;
}

export function renderEvidenceHtml(report: VisualEvidenceReport): string {
  const links = report.runs.map(run => `<li><a href="#${escapeHtml(run.id)}">${escapeHtml(run.title)} (${escapeHtml(run.nativeStatus)})</a></li>`).join('');
  const notes = report.notes.length ? `<section><h2>Unavailable evidence</h2><ul>${report.notes.slice(0, MAX_RENDERED_NODES).map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul></section>` : '';
  const runs = report.runs.map(renderRun).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visual evidence · ${escapeHtml(report.repository)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#172033}h1,h2{line-height:1.2}section{border-top:1px solid #cbd5e1;margin-top:2rem;padding-top:1rem}.panels{display:flex;flex-wrap:wrap;gap:1rem}.panels figure{flex:1 1 280px;margin:0}.layout{display:block;width:min(100%,640px);height:auto;border:1px solid #cbd5e1}table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.9rem}caption{text-align:left;font-weight:700;padding:.5rem 0}th,td{border:1px solid #cbd5e1;padding:.4rem;text-align:left;vertical-align:top}code{overflow-wrap:anywhere}.status{color:#475569}</style></head><body><h1>Visual evidence report</h1><p>${escapeHtml(report.repository)} · revision <code>${escapeHtml(report.revision)}</code>${report.pullRequest ? ` · pull request #${escapeHtml(report.pullRequest)}` : ''}</p><p class="status">SVGs show registered measured layout boxes in app-root-relative logical units. They are not native screenshots. <a href="manifest.json">Download the validated JSON manifest</a>.</p><nav aria-label="Evidence runs"><ul>${links || '<li>No measured runs are available.</li>'}</ul></nav>${notes}${runs}</body></html>`;
}

export function renderEvidenceSummary(report: VisualEvidenceReport): string {
  const rows = ['| Target | Status |', '| --- | --- |', ...report.runs.map(run => `| ${run.target} | ${run.nativeStatus} |`)];
  if (!report.runs.length) rows.push('| unavailable | no measured run |');
  rows.push('', `See the visual evidence report for ${report.repository} at revision ${report.revision}.`);
  return rows.join('\n') + '\n';
}
