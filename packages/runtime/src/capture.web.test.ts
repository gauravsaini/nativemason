import { describe, expect, it } from 'vitest';
import { captureWeb } from './capture.web.js';
import { LayoutRegistry } from './registry/index.js';
const profile = { window: { width: 412, height: 915 }, pixelRatio: 2.625, fontScale: 1, insets: { top: 24, right: 0, bottom: 24, left: 0 }, root: { x: 10.5, y: 24, width: 391, height: 867 }, orientation: 'portrait' as const };
describe('web capture', () => {
  it('normalizes window measurements to root-relative logical coordinates and preserves source revisions', async () => {
    const registry = new LayoutRegistry('footer', profile); registry.configure({ sessionId: 'session', scenarioId: 'footer', profile });
    registry.register({ id: 'button', parentId: null, kind: 'Pressable', role: 'button', styles: {}, dynamicStyle: false, source: { path: 'App.tsx', hash: 'a'.repeat(64), start: 0, end: 12, line: 1, column: 0 }, host: { getBoundingClientRect: () => ({ x: 20.75, y: 100, width: 40.5, height: 48 }) } });
    const snapshot = await captureWeb(registry);
    expect(snapshot.nodes[0].rect).toEqual({ x: 10.25, y: 76, width: 40.5, height: 48 });
    expect(snapshot.revisions).toEqual({ 'App.tsx': 'a'.repeat(64) }); expect(snapshot.status).toBe('stable');
  });
  it('reports ongoing movement as unstable instead of accepting an arbitrary animation frame', async () => {
    const registry = new LayoutRegistry('footer', profile); let x = 0;
    registry.register({ id: 'moving', parentId: null, kind: 'View', role: null, styles: {}, dynamicStyle: false, source: null, host: { getBoundingClientRect: () => ({ x: ++x, y: 0, width: 40, height: 48 }) } });
    expect((await captureWeb(registry)).status).toBe('unstable');
  });
});
