import { createServer } from 'node:net';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createNativeBridge } from './index.js';
const token = 'test-token-at-least-16';
const profile = { window: { width: 412, height: 915 }, pixelRatio: 2.625, fontScale: 1, insets: { top: 24, right: 0, bottom: 24, left: 0 }, root: { x: 0, y: 0, width: 412, height: 915 }, orientation: 'portrait' };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())); });
async function setup(options: { targetId?: string; platform?: 'android' | 'ios' } = {}) {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw Error('No address');
  const port = address.port; await new Promise<void>(resolve => server.close(() => resolve()));
  const bridge = await createNativeBridge({ port, token, scenarioId: 'footer', sessionId: 'session', timeoutMs: 150, ...options }); cleanups.push(() => bridge.close());
  return { port, bridge };
}
async function connect(port: number, suppliedToken = token, identity?: { protocolVersion: 2; platform: 'android' | 'ios'; targetId: string; textFits?: boolean; scenarioActions?: boolean }) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`); await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ type: 'hello', token: suppliedToken, scenarioId: 'footer', protocolVersion: identity?.protocolVersion ?? 1, ...(identity ? { platform: identity.platform, targetId: identity.targetId, capabilities: { textFits: identity.textFits ?? false, scenarioActions: identity.scenarioActions ?? false } } : {}) }));
  return socket;
}
describe('native transport', () => {
  it('validates Android identity, source revisions and reconnects', async () => {
    const { port, bridge } = await setup(); const socket = await connect(port);
    socket.on('message', raw => { const request = JSON.parse(raw.toString()); socket.send(JSON.stringify({ type: 'snapshot', requestId: request.requestId, snapshot: { schemaVersion: 1, sessionId: request.sessionId, snapshotId: 'native-1', platform: 'android', scenarioId: 'footer', profile, revisions: { 'App.tsx': 'a'.repeat(64) }, nodes: [], status: 'stable', generation: 1 } })); });
    expect((await bridge.capture({ 'App.tsx': 'a'.repeat(64) })).platform).toBe('android');
    await expect(bridge.capture({ 'App.tsx': 'b'.repeat(64) })).rejects.toMatchObject({ code: 'STALE_SOURCE' });
    socket.close(); await new Promise<void>(resolve => socket.once('close', () => resolve()));
    const replacement = await connect(port);
    replacement.on('message', raw => { const request = JSON.parse(raw.toString()); replacement.send(JSON.stringify({ type: 'error', requestId: request.requestId, error: { code: 'UNSTABLE_LAYOUT', message: 'Animation ongoing' } })); });
    await expect(bridge.capture({})).rejects.toMatchObject({ code: 'UNSTABLE_LAYOUT' });
  });
  it('rejects absent and unauthorized clients without pretending verification passed', async () => {
    const { port, bridge } = await setup(); const socket = await connect(port, 'wrong');
    await new Promise<void>(resolve => socket.once('close', () => resolve()));
    await expect(bridge.capture({})).rejects.toMatchObject({ code: 'NATIVE_DISCONNECTED' });
  });
  it('fails pending captures on disconnect and bounds response time', async () => {
    const { port, bridge } = await setup(); const socket = await connect(port);
    socket.on('message', () => socket.close());
    await expect(bridge.capture({})).rejects.toMatchObject({ code: 'NATIVE_DISCONNECTED' });
    const silent = await connect(port); silent.on('message', () => {});
    await expect(bridge.capture({})).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});

it('requires matching v2 target identity and accepts text-fit evidence from that target', async () => {
  const { port, bridge } = await setup({ targetId: 'device-1', platform: 'android' });
  const mismatch = await connect(port, token, { protocolVersion: 2, platform: 'android', targetId: 'device-2' });
  await new Promise<void>(resolve => mismatch.once('close', () => resolve()));
  const socket = await connect(port, token, { protocolVersion: 2, platform: 'android', targetId: 'device-1', textFits: true });
  socket.on('message', raw => {
    const request = JSON.parse(raw.toString());
    socket.send(JSON.stringify({ type: 'snapshot', requestId: request.requestId, snapshot: { schemaVersion: 1, sessionId: request.sessionId, snapshotId: 'native-v2', platform: 'android', scenarioId: 'footer', nativeTarget: { targetId: 'device-1', platform: 'android', kind: 'physical' }, profile, revisions: {}, nodes: [{ id: 'label', parentId: null, kind: 'Text', role: null, rect: { x: 0, y: 0, width: 40, height: 20 }, styles: {}, source: null, editable: false, editReason: 'Missing build-time source metadata', textFit: { status: 'supported', fullLineCount: 2, limitedLineCount: 1, fullHeight: 40, availableHeight: 20 } }], status: 'stable', generation: 1 } }));
  });
  const snapshot = await bridge.capture({});
  expect(snapshot.nativeTarget?.targetId).toBe('device-1');
  expect(snapshot.nodes[0]?.textFit).toEqual({ status: 'supported', fullLineCount: 2, limitedLineCount: 1, fullHeight: 40, availableHeight: 20 });
});

it('sends named native actions only to clients that advertise scenario action support', async () => {
  const { port, bridge } = await setup();
  const socket = await connect(port, token, { protocolVersion: 2, platform: 'android', targetId: 'device-1', scenarioActions: true });
  socket.on('message', raw => {
    const request = JSON.parse(raw.toString());
    if (request.type === 'action') socket.send(JSON.stringify({ type: 'action_result', requestId: request.requestId }));
  });
  await expect(bridge.runHook('open-settings', { enabled: true })).resolves.toBeUndefined();
});

it('rejects an authenticated mixed-source snapshot as stale without dropping the connection', async () => {
  const { port, bridge } = await setup(); const socket = await connect(port);
  let mixed = true;
  socket.on('message', raw => {
    const request = JSON.parse(raw.toString());
    const snapshot = { schemaVersion: 1, sessionId: request.sessionId, snapshotId: 'native-mixed', platform: 'android', scenarioId: 'footer', profile, revisions: { 'App.tsx': 'a'.repeat(64) }, nodes: [{ id: 'root', parentId: null, kind: 'View', role: null, rect: { x: 0, y: 0, width: 412, height: 915 }, styles: {}, source: { path: 'App.tsx', hash: (mixed ? 'b' : 'a').repeat(64), start: 0, end: 20, line: 1, column: 0 }, editable: true, editReason: null }], status: 'stable', generation: 1 };
    mixed = false;
    socket.send(JSON.stringify({ type: 'snapshot', requestId: request.requestId, snapshot }));
  });
  await expect(bridge.capture({ 'App.tsx': 'a'.repeat(64) })).rejects.toMatchObject({ code: 'STALE_SOURCE' });
  expect((await bridge.capture({ 'App.tsx': 'a'.repeat(64) })).platform).toBe('android');
});
