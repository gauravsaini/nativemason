import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { BridgeFault, NativeClientMessageSchema, type NativeConnectionOptions, type NativePort, type SourceRevisions, type SpatialSnapshot } from '@rn-layout/contracts';

export async function createNativeBridge(options: NativeConnectionOptions): Promise<NativePort & { close(): Promise<void> }> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: options.port, maxPayload: 4 * 1024 * 1024 });
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  let client: WebSocket | undefined;
  let closed = false;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pending = new Map<string, { resolve: (snapshot: SpatialSnapshot) => void; reject: (error: Error) => void; expected: SourceRevisions; timer: ReturnType<typeof setTimeout> }>();
  const waiters = new Set<{ resolve: (socket: WebSocket) => void; reject: (error: Error) => void }>();
  function failPending(error: BridgeFault) {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  }
  server.on('connection', socket => {
    let authenticated = false;
    const helloTimeout = setTimeout(() => socket.close(1008, 'Handshake timeout'), timeoutMs);
    socket.on('message', raw => {
      let decoded: unknown;
      try { decoded = JSON.parse(raw.toString()); } catch { socket.close(1008, 'Invalid protocol message'); return; }
      const parsed = NativeClientMessageSchema.safeParse(decoded);
      if (!parsed.success) {
        // Only correlate validated-schema coherence failures after authentication
        // to an already pending request. Other malformed traffic closes the peer.
        const requestId = typeof decoded === 'object' && decoded !== null && 'requestId' in decoded && typeof decoded.requestId === 'string' ? decoded.requestId : undefined;
        const staleSource = parsed.error.issues.some(issue => issue.code === 'custom' && issue.params?.bridgeCode === 'STALE_SOURCE');
        const item = authenticated && client === socket && requestId ? pending.get(requestId) : undefined;
        if (staleSource && item && requestId) { pending.delete(requestId); clearTimeout(item.timer); item.reject(new BridgeFault('STALE_SOURCE', 'Android snapshot contains inconsistent source metadata')); return; }
        socket.close(1008, 'Invalid protocol message'); return;
      }
      const message = parsed.data;
      if (message.type === 'hello') {
        const received = Buffer.from(message.token);
        const expected = Buffer.from(options.token);
        if (authenticated || received.length !== expected.length || !timingSafeEqual(received, expected) || message.scenarioId !== options.scenarioId) { socket.close(1008, 'Handshake rejected'); return; }
        clearTimeout(helloTimeout);
        authenticated = true;
        if (client && client !== socket) { failPending(new BridgeFault('NATIVE_DISCONNECTED', 'Android runtime reconnected')); client.close(1000, 'Replaced by reconnect'); }
        client = socket;
        for (const waiter of waiters) waiter.resolve(socket);
        waiters.clear();
        return;
      }
      if (!authenticated || client !== socket) { socket.close(1008, 'Authenticate first'); return; }
      const item = pending.get(message.requestId);
      if (!item) return;
      pending.delete(message.requestId);
      clearTimeout(item.timer);
      if (message.type === 'error') { item.reject(new BridgeFault(message.error.code, message.error.message, message.error.details)); return; }
      const snapshot = message.snapshot;
      if (snapshot.platform !== 'android' || snapshot.sessionId !== options.sessionId || snapshot.scenarioId !== options.scenarioId) { item.reject(new BridgeFault('VERIFICATION_FAILED', 'Android snapshot identity mismatch')); return; }
      if (snapshot.status !== 'stable') { item.reject(new BridgeFault('UNSTABLE_LAYOUT', 'Android layout did not settle')); return; }
      for (const [path, hash] of Object.entries(item.expected)) {
        if (snapshot.revisions[path] !== hash) { item.reject(new BridgeFault('STALE_SOURCE', `Android source mismatch for ${path}`)); return; }
      }
      item.resolve(snapshot);
    });
    socket.on('error', () => { /* close reports an actionable disconnect */ });
    socket.on('close', () => {
      clearTimeout(helloTimeout);
      if (client === socket) { client = undefined; failPending(new BridgeFault('NATIVE_DISCONNECTED', 'Android runtime disconnected')); }
    });
  });
  async function connected(): Promise<WebSocket> {
    if (closed) throw new BridgeFault('NATIVE_DISCONNECTED', 'Native bridge is closed');
    if (client?.readyState === WebSocket.OPEN) return client;
    return new Promise((resolve, reject) => {
      const waiter = { resolve: (socket: WebSocket) => { clearTimeout(timer); resolve(socket); }, reject: (error: Error) => { clearTimeout(timer); reject(error); } };
      const timer = setTimeout(() => { waiters.delete(waiter); reject(new BridgeFault('NATIVE_DISCONNECTED', 'No authenticated Android runtime connected')); }, timeoutMs);
      waiters.add(waiter);
    });
  }
  return {
    async capture(expectedRevisions) {
      const socket = await connected();
      if (socket.readyState !== WebSocket.OPEN) throw new BridgeFault('NATIVE_DISCONNECTED', 'Android runtime disconnected before capture');
      const requestId = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new BridgeFault('TIMEOUT', 'Android capture timed out')); }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer, expected: expectedRevisions });
        socket.send(JSON.stringify({ type: 'capture', requestId, sessionId: options.sessionId, expectedRevisions }), error => {
          if (error) { const item = pending.get(requestId); if (item) { clearTimeout(item.timer); pending.delete(requestId); reject(new BridgeFault('NATIVE_DISCONNECTED', error.message)); } }
        });
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      const error = new BridgeFault('NATIVE_DISCONNECTED', 'Native bridge closed');
      failPending(error);
      for (const waiter of waiters) waiter.reject(error);
      waiters.clear();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
