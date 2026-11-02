import { createServer } from 'node:net';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createNativeBridge } from './index.js';
const token = 'test-token-at-least-16';
const profile = { window: { width: 412, height: 915 }, pixelRatio: 2.625, fontScale: 1, insets: { top: 24, right: 0, bottom: 24, left: 0 }, root: { x: 0, y: 0, width: 412, height: 915 }, orientation: 'portrait' };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())); });
async function setup() {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw Error('No address');
  const port = address.port; await new Promise<void>(resolve => server.close(() => resolve()));
  const bridge = await createNativeBridge({ port, token, scenarioId: 'footer', sessionId: 'session', timeoutMs: 150 }); cleanups.push(() => bridge.close());
  return { port, bridge };
}
async function connect(port: number, suppliedToken = token) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`); await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ type: 'hello', token: suppliedToken, scenarioId: 'footer', protocolVersion: 1 }));
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
