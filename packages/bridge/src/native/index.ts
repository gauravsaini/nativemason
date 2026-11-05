import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { BridgeFault, NativeBindHostSchema, NativeClientMessageSchema, type NativeConnectionOptions, type NativePort, type SourceRevisions, type SpatialSnapshot } from '@nativemason/contracts';

export async function createNativeBridge(options: NativeConnectionOptions): Promise<NativePort & { close(): Promise<void> }> {
  const host=NativeBindHostSchema.safeParse(options.host??'127.0.0.1');
  if(!host.success)throw new BridgeFault('INVALID_INPUT','Native host must be a loopback or private LAN IPv4 interface address');
  const server = new WebSocketServer({ host: host.data, port: options.port, maxPayload: 4 * 1024 * 1024 });
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  let client: WebSocket | undefined;
  let closed = false;
  let connectedPlatform: "android" | "ios" = "android";
  let connectedTargetId: string | undefined;
  let supportsActions = false;
  let handshakeFailure: string | undefined;
  const actions = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pending = new Map<string, { resolve: (snapshot: SpatialSnapshot) => void; reject: (error: Error) => void; expected: SourceRevisions; timer: ReturnType<typeof setTimeout> }>();
  const waiters = new Set<{ resolve: (socket: WebSocket) => void; reject: (error: Error) => void }>();
  function failPending(error: BridgeFault) {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
    for (const item of actions.values()) { clearTimeout(item.timer); item.reject(error); }
    actions.clear();
  }
  server.on('connection', socket => {
    let authenticated = false;
    const helloTimeout = setTimeout(() => socket.close(1008, 'Handshake timeout'), timeoutMs);
    socket.on('message', raw => {
      let decoded: unknown;
      try { decoded = JSON.parse(raw.toString()); } catch { socket.close(1008, 'Invalid protocol message'); return; }
      const parsed = NativeClientMessageSchema.safeParse(decoded);
      if (!parsed.success) {
        if (typeof decoded === 'object' && decoded !== null && 'type' in decoded && decoded.type === 'hello') handshakeFailure = 'Native handshake schema or protocol version is incompatible; rebuild the development runtime';
        // Only correlate validated-schema coherence failures after authentication
        // to an already pending request. Other malformed traffic closes the peer.
        const requestId = typeof decoded === 'object' && decoded !== null && 'requestId' in decoded && typeof decoded.requestId === 'string' ? decoded.requestId : undefined;
        const staleSource = parsed.error.issues.some(issue => issue.code === 'custom' && issue.params?.bridgeCode === 'STALE_SOURCE');
        const item = authenticated && client === socket && requestId ? pending.get(requestId) : undefined;
        if (staleSource && item && requestId) { pending.delete(requestId); clearTimeout(item.timer); item.reject(new BridgeFault('STALE_SOURCE', 'Native snapshot contains inconsistent source metadata')); return; }
        socket.close(1008, 'Invalid protocol message'); return;
      }
      const message = parsed.data;
      if (message.type === 'hello') {
        if (message.protocolVersion === 1 && (options.platform === 'ios' || options.targetId)) { handshakeFailure = 'Protocol v2 required for selected native target'; socket.close(1002, handshakeFailure); return; }
        if (message.protocolVersion === 2 && (!message.platform || !message.targetId || !message.capabilities)) { handshakeFailure = 'Protocol v2 target identity and capabilities required'; socket.close(1002, handshakeFailure); return; }
        if ((options.platform && options.platform !== message.platform) || (options.targetId && options.targetId !== message.targetId)) { handshakeFailure = 'Native target mismatch'; socket.close(1008, handshakeFailure); return; }
        const received = Buffer.from(message.token);
        const expected = Buffer.from(options.token);
        if (authenticated || received.length !== expected.length || !timingSafeEqual(received, expected) || message.scenarioId !== options.scenarioId) { socket.close(1008, 'Handshake rejected'); return; }
        clearTimeout(helloTimeout);
        authenticated = true;
        handshakeFailure = undefined;
        connectedPlatform = message.platform ?? 'android';
        connectedTargetId = message.targetId;
        supportsActions = message.capabilities?.scenarioActions ?? false;

        if (client && client !== socket) { failPending(new BridgeFault('NATIVE_DISCONNECTED', 'Native runtime reconnected')); client.close(1000, 'Replaced by reconnect'); }
        client = socket;
        for (const waiter of waiters) waiter.resolve(socket);
        waiters.clear();
        return;
      }
      if (!authenticated || client !== socket) { socket.close(1008, 'Authenticate first'); return; }
      const action = actions.get(message.requestId);
      if (action) {
        clearTimeout(action.timer); actions.delete(message.requestId);
        if (message.type === 'action_result') action.resolve();
        else if (message.type === 'error') action.reject(new BridgeFault(message.error.code, message.error.message, message.error.details));
        else action.reject(new BridgeFault('VERIFICATION_FAILED', 'Expected native action result'));
        return;
      }
      if (message.type === 'action_result') return;
      const item = pending.get(message.requestId);
      if (!item) return;
      pending.delete(message.requestId);
      clearTimeout(item.timer);
      if (message.type === 'error') { item.reject(new BridgeFault(message.error.code, message.error.message, message.error.details)); return; }
      const snapshot = message.snapshot;
      if (snapshot.platform !== connectedPlatform || snapshot.sessionId !== options.sessionId || snapshot.scenarioId !== options.scenarioId) { item.reject(new BridgeFault('VERIFICATION_FAILED', 'Native snapshot identity mismatch')); return; }
      if (options.targetId && (snapshot.nativeTarget?.targetId !== connectedTargetId || snapshot.nativeTarget?.platform !== connectedPlatform)) { item.reject(new BridgeFault('VERIFICATION_FAILED', 'Native snapshot target mismatch')); return; }
      if (snapshot.status !== 'stable') { item.reject(new BridgeFault('UNSTABLE_LAYOUT', 'Native layout did not settle')); return; }
      for (const [path, hash] of Object.entries(item.expected)) {
        if (snapshot.revisions[path] !== hash) { item.reject(new BridgeFault('STALE_SOURCE', `Native source mismatch for ${path}`)); return; }
      }
      item.resolve(snapshot);
    });
    socket.on('error', () => { /* close reports an actionable disconnect */ });
    socket.on('close', () => {
      clearTimeout(helloTimeout);
      if (client === socket) { client = undefined; failPending(new BridgeFault('NATIVE_DISCONNECTED', 'Native runtime disconnected')); }
    });
  });
  async function connected(): Promise<WebSocket> {
    if (closed) throw new BridgeFault('NATIVE_DISCONNECTED', 'Native bridge is closed');
    if (client?.readyState === WebSocket.OPEN) return client;
    return new Promise((resolve, reject) => {
      const waiter = { resolve: (socket: WebSocket) => { clearTimeout(timer); resolve(socket); }, reject: (error: Error) => { clearTimeout(timer); reject(error); } };
      const timer = setTimeout(() => { waiters.delete(waiter); reject(new BridgeFault('NATIVE_DISCONNECTED', handshakeFailure ?? 'No authenticated native runtime connected')); }, timeoutMs);
      waiters.add(waiter);
    });
  }
  return {
    async runHook(name, value) {
      const socket = await connected();
      if (!supportsActions) throw new BridgeFault('INVALID_INPUT', 'Native runtime does not support scenario actions');
      const requestId = randomUUID();
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { actions.delete(requestId); reject(new BridgeFault('TIMEOUT', 'Native action timed out')); }, timeoutMs);
        actions.set(requestId, { resolve, reject, timer });
        socket.send(JSON.stringify({ type: 'action', requestId, sessionId: options.sessionId, name, value }), error => {
          if (error) { clearTimeout(timer); actions.delete(requestId); reject(new BridgeFault('NATIVE_DISCONNECTED', error.message)); }
        });
      });
    },
    async capture(expectedRevisions) {
      const socket = await connected();
      if (socket.readyState !== WebSocket.OPEN) throw new BridgeFault('NATIVE_DISCONNECTED', 'Native runtime disconnected before capture');
      const requestId = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new BridgeFault('TIMEOUT', 'Native capture timed out')); }, timeoutMs);
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
