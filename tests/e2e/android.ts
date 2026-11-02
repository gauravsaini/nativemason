/** Real Android acceptance. Never creates or launches an emulator on this host. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { BridgeApplication } from '../../packages/bridge/src/application/index.js';
import { createNativeBridge } from '../../packages/bridge/src/native/index.js';
import { WireframeSpecSchema, type SpatialSnapshot } from '@rn-layout/contracts';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const projectRoot = path.join(root, 'examples/expo-fixture');
const sourcePath = path.join(projectRoot, 'App.tsx');
const artifactRoot = path.join(root, 'artifacts/android-acceptance');
const nativePort = Number(process.env.NM_ANDROID_NATIVE_PORT ?? 19482);
const token = process.env.EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN ?? 'rn-layout-bridge-test-token-0001';
const webUrl = process.env.NM_ANDROID_WEB_URL ?? 'http://127.0.0.1:8081?scenario=broken-footer';
const destination = process.env.NM_ANDROID_SSH;
const explicitSerial = process.env.ADB_SERIAL;
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let serial = explicitSerial;
async function adb(args: string[], useSerial = true) {
  const fullArgs = useSerial && serial ? ['-s', serial, ...args] : args;
  if (destination) {
    if (!/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+$/.test(destination)) throw Error('NM_ANDROID_SSH must be user@host, not a shell command');
    const key = process.env.NM_ANDROID_SSH_KEY ?? path.join(homedir(), '.ssh/id_ed25519_remote');
    const result = await exec('ssh', ['-i', key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', destination, ['adb', ...fullArgs].map(shellQuote).join(' ')], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    return result.stdout;
  }
  if (!explicitSerial) throw Error('Set NM_ANDROID_SSH=user@host for a remote device, or explicitly set ADB_SERIAL for an already running device. This test never starts a local emulator.');
  return (await exec('adb', fullArgs, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })).stdout;
}
async function preflight() {
  const listing = await adb(['devices', '-l'], false);
  const devices = listing.split('\n').map(line => line.trim().split(/\s+/)).filter(parts => parts[1] === 'device');
  if (!serial) {
    if (devices.length !== 1) throw Error(`Expected exactly one connected Android device on ${destination ?? 'explicit local target'}; found ${devices.length}. Set ADB_SERIAL to select one.`);
    serial = devices[0][0];
  }
  if (!devices.some(parts => parts[0] === serial)) throw Error(`Android device ${serial} is absent or not authorized`);
  const sdk = (await adb(['shell', 'getprop', 'ro.build.version.sdk'])).trim();
  if (Number(sdk) < 24) throw Error(`Android API ${sdk} is unsupported; requires API24+`);
  console.log(`ANDROID_TARGET ${destination ?? 'explicit local device'} ${serial} API${sdk}`);
  await adb(['reverse', 'tcp:8081', 'tcp:8081']);
  await adb(['reverse', `tcp:${nativePort}`, `tcp:${nativePort}`]);
  const packages = await adb(['shell', 'pm', 'list', 'packages', 'host.exp.exponent']);
  if (!packages.includes('host.exp.exponent')) throw Error('Expo Go must be installed on the test device before running acceptance');
}
async function main() {
  await preflight();
  await mkdir(artifactRoot, { recursive: true });
  const original = await readFile(sourcePath, 'utf8');
  assert.match(original, /footer:\s*\{\s*flexDirection:\s*['"]column['"]/, 'Fixture must begin with the deliberate column footer');
  const calibration = await createNativeBridge({ port: nativePort, token, scenarioId: 'broken-footer', sessionId: 'android-calibration', timeoutMs: 15_000 });
  let calibrated: SpatialSnapshot | undefined;
  try {
    await adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp://127.0.0.1:8081', 'host.exp.exponent']);
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { calibrated = await calibration.capture({}); break; } catch (error) { lastError = error; }
    }
    if (!calibrated) throw lastError ?? Error('Native calibration unavailable');
    await writeFile(path.join(artifactRoot, 'calibration.json'), JSON.stringify(calibrated, null, 2));
  } finally { await calibration.close(); }
  const app = new BridgeApplication({ artifactsRoot: artifactRoot });
  let sourceChanged = false;
  try {
    const opened = await app.execute('open_session', { projectRoot, webUrl, scenarioId: 'broken-footer', profile: calibrated.profile, nativePort, nativeToken: token });
    const { sessionId } = opened;
    const fixture = JSON.parse(await readFile(path.join(root, 'packages/contracts/fixtures/footer.json'), 'utf8'));
    const spec = WireframeSpecSchema.parse({ ...fixture, profile: calibrated.profile });
    await app.execute('load_wireframe_spec', { sessionId, spec });
    const inspected = await app.execute('inspect_ui_spatial_graph', { sessionId });
    assert.ok(inspected.results.some((result: { status: string }) => result.status === 'fail'), 'Broken fixture must fail before correction');
    const trial = await app.execute('simulate_layout_mutation', { sessionId, baselineSnapshotId: inspected.snapshot.snapshotId, elementId: 'footer', patch: { flexDirection: 'row' } });
    assert.ok('trialId' in trial, 'Mutation must produce a trial rather than a reset result');
    assert.ok(trial.results.length > 0 && trial.results.every((result: { status: string }) => result.status === 'pass'), 'Browser trial must satisfy every required constraint');
    const footer = trial.snapshot.nodes.find((node: { id: string }) => node.id === 'footer');
    assert.ok(footer?.source, 'Footer source metadata must be available');
    const input = { sessionId, trialId: trial.trialId, expectedSourceHash: footer.source.hash };
    const preview = await app.execute('commit_rn_ast_patch', { ...input, mode: 'preview' });
    assert.ok(preview.plan, 'Preview must return an edit plan');
    assert.match(preview.plan.diff, /row/);
    const committed = await app.execute('commit_rn_ast_patch', { ...input, mode: 'apply' });
    sourceChanged = true;
    assert.ok(committed.receipt, 'Apply must return a commit receipt');
    assert.equal(committed.receipt.nativeStatus, 'pending');
    assert.equal(committed.webStatus, 'passed', 'Committed source must re-render and pass browser checks');
    let verified;
    let lastError: unknown;
    for (let attempt = 0; attempt < 10; attempt++) {
      try { verified = await app.execute('verify_native_layout', { sessionId, commitId: committed.receipt.commitId }); break; }
      catch (error) { lastError = error; await pause(1000); }
    }
    if (!verified) throw lastError ?? Error('Native verification unavailable');
    assert.equal(verified.passed, true, JSON.stringify(verified.results));
    assert.equal(verified.receipt.nativeStatus, 'passed');
    assert.equal(verified.snapshot.platform, 'android');
    await writeFile(path.join(artifactRoot, 'acceptance.json'), JSON.stringify(verified, null, 2));
    console.log('ANDROID_ACCEPTANCE_PASSED');
  } finally {
    await app.close();
    if (sourceChanged || await readFile(sourcePath, 'utf8') !== original) await writeFile(sourcePath, original);
  }
}
main().catch(error => { console.error('ANDROID_ACCEPTANCE_INCOMPLETE', error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
