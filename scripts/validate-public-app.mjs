import { createHash, randomUUID } from 'node:crypto';
import console from 'node:console';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers/promises';
import { URL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function options(args) {
  const values = {};
  const allowed = new Set(['project-root', 'web-url', 'source-path', 'kind', 'ready-timeout-ms', 'output', 'scenario', 'native-port']);
  const seen = new Set();
  for (let i = 2; i < args.length; i++) {
    const key = args[i];
    if (key === '--apply-revert') {
      if (seen.has(key)) throw new Error(`Duplicate option ${key}`);
      seen.add(key);
      values.applyRevert = true;
      continue;
    }
    const name = key.startsWith('--') ? key.slice(2) : '';
    if (!allowed.has(name)) throw new Error(`Unsupported option ${key}`);
    if (seen.has(key)) throw new Error(`Duplicate option ${key}`);
    seen.add(key);
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Expected a value after ${key}`);
    values[name] = args[++i];
  }
  for (const key of ['project-root', 'web-url', 'source-path']) if (!values[key]) throw new Error(`Missing --${key}`);
  return values;
}

const args = options(process.argv);
const projectRoot = path.resolve(args['project-root']);
const sourcePath = path.posix.normalize(args['source-path'].replaceAll('\\', '/'));
if (path.posix.isAbsolute(sourcePath) || sourcePath === '..' || sourcePath.startsWith('../')) throw new Error('--source-path must be project-relative');
const sourceFile = path.resolve(projectRoot, sourcePath);
if (!sourceFile.startsWith(`${projectRoot}${path.sep}`)) throw new Error('--source-path must stay inside --project-root');
const kind = args.kind ?? 'Text';
if (kind !== 'Text') throw new Error('--kind must be Text because this runner applies a fontSize mutation');
const webUrl = new URL(args['web-url']);
if (!['http:', 'https:'].includes(webUrl.protocol) || webUrl.username || webUrl.password) throw new Error('--web-url must be an absolute http(s) URL without credentials');
const deadlineMs = Number(args['ready-timeout-ms'] ?? 30000);
if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 300000) throw new Error('--ready-timeout-ms must be 1..300000');
const nativePort = Number(args['native-port'] ?? 19500);
if (!Number.isInteger(nativePort) || nativePort < 1024 || nativePort > 65535) throw new Error('--native-port must be an integer in 1024..65535');
const outputDir = path.resolve(args.output ?? 'artifacts/public-app-validation/runs');
const stamp = `${new Date().toISOString().replaceAll(/[-:.]/g, '')}-${randomUUID().slice(0, 8)}`;
const outputFile = path.join(outputDir, `${path.basename(projectRoot)}-${stamp}.json`);
const profile = {
  window: { width: 412, height: 915 }, root: { x: 0, y: 0, width: 412, height: 915 },
  pixelRatio: 1, fontScale: 1, insets: { top: 0, right: 0, bottom: 0, left: 0 }, orientation: 'portrait',
};
const result = {
  startedAt: new Date().toISOString(), projectRoot, webUrl: args['web-url'], sourcePath, kind,
  mode: args.applyRevert ? 'apply-revert' : 'preview-reset', status: 'unavailable', steps: [],
  sourceBeforeHash: null, sourceAfterHash: null, sourceRestored: null, errors: [],
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const client = new Client({ name: 'public-app-validation', version: '0.2.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectRoot, 'node_modules/nativemason/bin/nativemason.js')],
  cwd: projectRoot, stderr: 'pipe',
});
let sessionId;
let receipt;
let trialId;
let trialBaselineSnapshotId;

async function call(tool, input) {
  const mutating = ['commit_rn_ast_patch', 'simulate_layout_mutation', 'revert_commit'].includes(tool);
  const output = await client.callTool({ name: tool, arguments: input }, undefined, { timeout: mutating ? 120000 : 15000 });
  if (output.isError) throw new Error(`${tool}: ${JSON.stringify(output.content)}`);
  return output.structuredContent ?? JSON.parse(output.content.find(item => item.type === 'text').text);
}

async function captureReady() {
  const end = Date.now() + deadlineMs;
  let latest;
  while (Date.now() < end) {
    latest = await call('inspect_ui_spatial_graph', { sessionId });
    const targets = latest.snapshot.nodes.filter(node => node.editable && node.kind === kind && node.source?.path === sourcePath);
    if (targets.length) return { ...latest, targets };
    await setTimeout(300);
  }
  throw new Error(`No editable ${kind} node from ${sourcePath} appeared within ${deadlineMs}ms`);
}

async function cleanup() {
  if (!sessionId) return;
  try { await call('close_session', { sessionId }); } catch (error) { result.errors.push(`close_session: ${error.message}`); }
}

try {
  const original = await readFile(sourceFile);
  result.sourceBeforeHash = hash(original);
  await client.connect(transport);
  const opened = await call('open_session', {
    projectRoot, webUrl: webUrl.href, scenarioId: args.scenario ?? 'public-validation', profile,
    nativePort, nativeToken: 'public-app-validation',
  });
  sessionId = opened.sessionId;
  result.steps.push('open');

  await call('load_wireframe_spec', {
    sessionId,
    spec: { schemaVersion: 1, scenarioId: args.scenario ?? 'public-validation', profile, requiredElementIds: [], constraints: [] },
  });
  result.steps.push('load-spec');
  let finalBaseline;
  let target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const selected = finalBaseline?.targets.find(node => node.id === target?.id)
      ?? finalBaseline?.targets.find(node => node.rect.width > 8 && node.rect.height > 8)
      ?? finalBaseline?.targets[0]
      ?? (await captureReady()).targets[0];
    const spec = {
      schemaVersion: 1, scenarioId: args.scenario ?? 'public-validation', profile,
      requiredElementIds: [selected.id],
      constraints: [{ id: 'public-box-preserved', type: 'minTouchTarget', elementId: selected.id, width: 8, height: 8, tolerance: 0 }],
    };
    await call('load_wireframe_spec', { sessionId, spec });
    result.steps.push(`load-target-spec-${attempt + 1}`);
    finalBaseline = await captureReady();
    target = finalBaseline.targets.find(node => node.id === selected.id);
    if (target) break;
  }
  if (!target || !finalBaseline) throw new Error(`No stable ${kind} element from ${sourcePath} after loading the measured target spec`);
  result.steps.push('capture-ready');
  result.target = { id: target.id, kind: target.kind, source: target.source, rect: target.rect, styles: target.styles };
  result.baselineSnapshotId = finalBaseline.snapshot.snapshotId;
  result.baselineRevisions = finalBaseline.snapshot.revisions;

  const value = target.styles.fontSize;
  const patch = { fontSize: typeof value === 'number' ? value + 1 : 17 };
  result.patch = patch;
  const trial = await call('simulate_layout_mutation', {
    sessionId, baselineSnapshotId: finalBaseline.snapshot.snapshotId, elementId: target.id, patch,
  });
  trialId = trial.trialId;
  trialBaselineSnapshotId = finalBaseline.snapshot.snapshotId;
  result.trial = { trialId: trial.trialId, results: trial.results, webDiagnostics: trial.webDiagnostics };
  result.steps.push('trial');
  if (!trial.results?.length || trial.results.some(item => item.status !== 'pass')) throw new Error('Trial did not pass every requested layout constraint');
  const input = { sessionId, trialId: trial.trialId, expectedRevisions: finalBaseline.snapshot.revisions };
  result.preview = await call('commit_rn_ast_patch', { ...input, mode: 'preview' });
  result.steps.push('preview');

  if (args.applyRevert) {
    const applied = await call('commit_rn_ast_patch', { ...input, mode: 'apply' });
    receipt = applied.receipt;
    result.applied = applied;
    result.steps.push('apply');
    if (!receipt?.commitId) throw new Error('Apply returned no commit receipt; automatic revert is unavailable');
    if (applied.webStatus !== 'passed') throw new Error(`Applied web verification status was ${applied.webStatus}`);
    await captureReady();
    result.steps.push('reload-capture');
    result.reverted = await call('revert_commit', { sessionId, commitId: receipt.commitId });
    result.steps.push('revert');
  } else {
    result.reset = await call('simulate_layout_mutation', {
      sessionId, baselineSnapshotId: finalBaseline.snapshot.snapshotId, patch: null,
    });
    result.steps.push('reset');
  }
  result.status = 'passed';
} catch (error) {
  result.errors.push(error instanceof Error ? error.message : String(error));
  if (receipt?.commitId && sessionId && !result.steps.includes('revert')) {
    try {
      result.reverted = await call('revert_commit', { sessionId, commitId: receipt.commitId });
      result.steps.push('revert-after-error');
    } catch (revertError) {
      result.errors.push(`revert conflict: ${revertError instanceof Error ? revertError.message : String(revertError)}`);
    }
  }
  if (trialId && sessionId && !result.steps.includes('reset') && !result.steps.includes('revert') && !result.steps.includes('revert-after-error')) {
    try {
      await call('simulate_layout_mutation', { sessionId, baselineSnapshotId: trialBaselineSnapshotId, patch: null });
      result.steps.push('reset-after-error');
    } catch (resetError) {
      result.errors.push(`trial reset: ${resetError instanceof Error ? resetError.message : String(resetError)}`);
    }
  }
} finally {
  await cleanup();
  try {
    const current = await readFile(sourceFile);
    result.sourceAfterHash = hash(current);
    result.sourceRestored = result.sourceAfterHash === result.sourceBeforeHash;
    if (!result.sourceRestored) {
      result.errors.push('Source hash differs from its starting value; no direct file overwrite was attempted');
      result.status = 'failed';
    }
  } catch (error) {
    result.errors.push(`source read after workflow: ${error instanceof Error ? error.message : String(error)}`);
    result.status = 'failed';
  }
  result.finishedAt = new Date().toISOString();
  if (result.status === 'passed' && result.errors.length) result.status = 'failed';
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ outputFile, status: result.status, steps: result.steps, sourceRestored: result.sourceRestored, errors: result.errors }));
  await client.close().catch(() => {});
  if (result.status !== 'passed') process.exitCode = 1;
}
