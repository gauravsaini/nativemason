import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpatialSnapshot, VisualEvidenceRun } from '@nativemason/contracts';
import { buildEvidenceReport, renderEvidenceHtml, renderEvidenceSummary } from './report.js';

const oldHash = 'a'.repeat(64);
const newHash = 'b'.repeat(64);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function snapshot(platform: 'web' | 'android' | 'ios', hash: string, targetId?: string, kind?: 'emulator' | 'simulator' | 'physical', path = 'src/App.tsx'): SpatialSnapshot {
  return {
    schemaVersion: 1, sessionId: 'session', snapshotId: `snapshot-${hash[0]}`, platform, scenarioId: 'broken-footer',
    profile: { window: { width: 320, height: 640 }, pixelRatio: 1, fontScale: 1, insets: { top: 0, right: 0, bottom: 0, left: 0 }, root: { x: 0, y: 0, width: 320, height: 640 }, orientation: 'portrait' },
    revisions: { [path]: hash },
    nodes: [{ id: 'box', parentId: null, kind: 'View', role: null, rect: { x: 8, y: 12, width: 100, height: 40 }, styles: {}, source: { path, hash, start: 0, end: 1, line: 1, column: 0 }, editable: true, editReason: null }],
    status: 'stable', generation: 1,
    ...(targetId && kind ? { nativeTarget: { targetId, platform: platform as 'android' | 'ios', kind } } : {}),
  };
}

function webRun(overrides: Partial<VisualEvidenceRun> = {}): VisualEvidenceRun {
  return { id: 'web-run', title: 'Web run', target: 'web', before: snapshot('web', oldHash), after: snapshot('web', newHash), results: [], nativeStatus: 'unavailable', notes: [], ...overrides };
}

function nativeFiles(physical = false, passed = true): { directory: string } {
  const directory = mkdtempSync(join(tmpdir(), 'evidence-report-'));
  roots.push(directory);
  const kind = physical ? 'physical' : 'emulator';
  const before = snapshot('android', oldHash, 'emulator-test', kind);
  const after = snapshot('android', newHash, 'emulator-test', kind);
  const receipt = { commitId: 'receipt-1', path: 'src/App.tsx', oldHash, newHash, diff: '<script>raw receipt diff</script>', nativeStatus: passed ? 'passed' : 'failed' };
  const acceptance = {
    target: { targetId: 'emulator-test', platform: 'android', kind }, preview: {}, applied: {},
    verified: { receipt, snapshot: after, results: [{ constraintId: 'inside', status: passed ? 'pass' : 'fail', elementIds: ['box'], deviation: 0, tolerance: 2, message: '<img src=x onerror=alert(1)>' }], delta: { added: [], removed: [], changed: [] }, passed },
  };
  writeFileSync(join(directory, 'calibration.json'), JSON.stringify(before));
  writeFileSync(join(directory, 'acceptance.json'), JSON.stringify(acceptance));
  return { directory };
}

describe('visual evidence report input and rendering', () => {
  it('preserves validated web and verified emulator evidence in JSON and renders measured boxes and evidence tables', () => {
    const { directory } = nativeFiles();
    const root = mkdtempSync(join(tmpdir(), 'evidence-web-'));
    roots.push(root);
    const webFile = join(root, 'visual-evidence.json');
    writeFileSync(webFile, JSON.stringify(webRun()));
    const report = buildEvidenceReport({ repository: 'owner/repo', revision: newHash.repeat(1), pullRequest: 42, webFile, androidDirectory: directory });
    expect(report.runs.map(run => [run.target, run.nativeStatus])).toEqual([['web', 'unavailable'], ['android-emulator', 'passed']]);
    expect(report.runs[1].receipt?.commitId).toBe('receipt-1');
    const html = renderEvidenceHtml(report);
    expect(html).toContain('registered measured layout boxes');
    expect(html).toContain('Source revisions');
    expect(html).toContain('Constraint results');
    expect(html).toContain('Commit receipt');
    expect(html).not.toContain('raw receipt diff');
    expect(JSON.stringify(report)).toContain('raw receipt diff');
    expect(renderEvidenceSummary(report)).toContain('android-emulator | passed');
  });

  it('reports missing input as unavailable with no invented runs', () => {
    const report = buildEvidenceReport({ repository: 'owner/repo', revision: newHash, webFile: '/does/not/exist.json' });
    expect(report.runs).toEqual([]);
    expect(report.notes).toHaveLength(3);
    expect(renderEvidenceHtml(report)).toContain('No measured runs are available');
  });

  it('excludes physical-target evidence without publishing its data', () => {
    const { directory } = nativeFiles(true);
    const report = buildEvidenceReport({ repository: 'owner/repo', revision: newHash, androidDirectory: directory });
    expect(report.runs).toEqual([]);
    expect(report.notes.some(note => note.includes('physical-target evidence is excluded'))).toBe(true);
    expect(JSON.stringify(report)).not.toContain('emulator-test');
  });

  it('keeps failed native acceptance labeled failed with only its actual measurements', () => {
    const { directory } = nativeFiles(false, false);
    const report = buildEvidenceReport({ repository: 'owner/repo', revision: newHash, androidDirectory: directory });
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({ nativeStatus: 'failed', results: [{ status: 'fail' }], receipt: { nativeStatus: 'failed' } });
  });

  it('escapes untrusted HTML and keeps unsafe source paths out of the report', () => {
    const after = snapshot('web', newHash, undefined, undefined, 'src/<img>.tsx');
    after.nodes[0].id = '</title><script>alert(2)</script>';
    const xss = webRun({
      title: '<img src=x onerror=alert(1)>', notes: ['</script><script>alert(1)</script>'], after,
      results: [{ constraintId: '<script>bad</script>', status: 'fail', elementIds: [after.nodes[0].id], deviation: 2, tolerance: 1, message: '<svg onload=alert(3)>' }],
    });
    const xssReport = buildEvidenceReport({ repository: 'owner/repo', revision: newHash, webFile: writeRun(xss) });
    const html = renderEvidenceHtml(xssReport);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;svg onload=alert(3)&gt;');
    expect(html).not.toContain('<script>');
    expect(renderEvidenceSummary(xssReport)).not.toContain('onerror');
    const unsafe = webRun({ after: snapshot('web', newHash, undefined, undefined, '../../machine/private') });
    const unsafeHtml = renderEvidenceHtml(buildEvidenceReport({ repository: 'owner/repo', revision: newHash, webFile: writeRun(unsafe) }));
    expect(unsafeHtml).not.toContain('machine/private');
    expect(unsafeHtml).toContain('Web evidence is missing, invalid, unsafe, or exceeds report bounds.');
  });

  it('bounds rendered node count while keeping the full validated snapshots in the manifest object', () => {
    const before = snapshot('web', oldHash);
    const after = snapshot('web', newHash);
    const beforeNodes = Array.from({ length: 300 }, (_, index) => ({ ...before.nodes[0], id: `box-${index}` }));
    const afterNodes = Array.from({ length: 300 }, (_, index) => ({ ...after.nodes[0], id: `box-${index}` }));
    const large = webRun({ before: { ...before, nodes: beforeNodes }, after: { ...after, nodes: afterNodes } });
    const report = buildEvidenceReport({ repository: 'owner/repo', revision: newHash, webFile: writeRun(large) });
    const html = renderEvidenceHtml(report);
    expect(report.runs[0].after.nodes).toHaveLength(300);
    expect(html.match(/<rect x=/g)).toHaveLength(500);
    expect(html).toContain('SVGs show at most 250 boxes');
  });

  it('places boxes on the window frame with the root origin and keeps element colors stable across node order changes', () => {
    const before = snapshot('web', oldHash);
    const after = snapshot('web', newHash);
    before.profile.root.x = after.profile.root.x = 20;
    before.profile.root.y = after.profile.root.y = 30;
    before.nodes = [{ ...before.nodes[0], id: 'z' }, { ...before.nodes[0], id: 'a' }];
    after.nodes = [{ ...after.nodes[0], id: 'm' }, { ...after.nodes[0], id: 'a' }, { ...after.nodes[0], id: 'z' }];
    const report = buildEvidenceReport({ repository: 'owner/repo', revision: newHash, webFile: writeRun(webRun({ before, after })) });
    const svgs = [...renderEvidenceHtml(report).matchAll(/<svg class="layout"[\s\S]*?<\/svg>/g)].map(match => match[0]);
    expect(svgs[0]).toContain('x="28" y="42"');
    const color = (svg: string, id: string) => {
      const title = svg.indexOf(`<title>${id} · registered layout box</title>`);
      return svg.slice(svg.lastIndexOf('<rect x=', title), title).match(/fill="([^"]+)"/)?.[1];
    };
    expect(color(svgs[0], 'z')).toBe(color(svgs[1], 'z'));
  });
});

function writeRun(run: VisualEvidenceRun): string {
  const root = mkdtempSync(join(tmpdir(), 'evidence-run-'));
  roots.push(root);
  const file = join(root, 'run.json');
  writeFileSync(file, JSON.stringify(run));
  return file;
}
