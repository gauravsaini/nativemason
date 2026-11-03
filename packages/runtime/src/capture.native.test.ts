import { describe, expect, it, vi } from 'vitest';
import { LayoutRegistry } from './registry/index.js';
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, Dimensions: { get: () => ({ width: 384, height: 749.8666666666667 }) }, PixelRatio: { get: () => 3.75, getFontScale: () => 1 } }));
import { captureNative } from './capture.native.js';

// Android edge-to-edge regression: Dimensions.window excludes system bars,
// while SafeAreaProvider frame includes them; measureInWindow also adds a
// viewport offset that measure().pageY intentionally omits in RN0.88.
describe('native coordinate contract', () => {
  it('uses the safe-area window frame and surface measurements without counting system insets twice', async () => {
    const profile = { window: { width: 384, height: 832 }, pixelRatio: 3.75, fontScale: 1, insets: { top: 34.13333511352539, right: 0, bottom: 48, left: 0 }, root: { x: 0, y: 0, width: 384, height: 832 }, orientation: 'portrait' as const };
    const registry = new LayoutRegistry('footer', profile, 'screen');
    function host(x: number, y: number, width: number, height: number) {
      return {
        measure: (callback: (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => void) => callback(x, y, width, height, x, y),
        measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(x, y - 34.133331298828125, width, height),
      };
    }
    registry.register({ id: 'screen', parentId: null, kind: 'View', role: null, styles: {}, source: null, dynamicStyle: false, host: host(0, 0, 384, 832) });
    registry.register({ id: 'footer', parentId: 'screen', kind: 'View', role: null, styles: {}, source: null, dynamicStyle: false, host: host(16, 712, 352, 72) });
    const snapshot = await captureNative(registry);
    expect(snapshot.profile.window).toEqual({ width: 384, height: 832 });
    expect(snapshot.profile.root).toEqual({ x: 0, y: 0, width: 384, height: 832 });
    const footer = snapshot.nodes.find(node => node.id === 'footer')!;
    expect(footer.rect.y + footer.rect.height).toBe(snapshot.profile.window.height - snapshot.profile.insets.bottom);
    expect(snapshot.status).toBe('stable');
  });
});

describe('explicit native root identity', () => {
  it('selects the designated root even when another top-level element registers first, and subtracts the safe-area frame origin once', async () => {
    const profile = { window: { width: 384, height: 832 }, pixelRatio: 3.75, fontScale: 1, insets: { top: 34, right: 0, bottom: 48, left: 0 }, root: { x: 0, y: 0, width: 384, height: 832 }, orientation: 'portrait' as const };
    const registry = new LayoutRegistry('footer', profile, 'screen');
    registry.windowOrigin = { x: 10, y: 20 };
    const host = (x: number, y: number, width: number, height: number) => ({ measure: (cb: (...args: number[]) => void) => cb(0, 0, width, height, x, y) });
    registry.register({ id: 'earlier-root', parentId: null, kind: 'View', role: null, styles: {}, source: null, dynamicStyle: false, host: host(110, 120, 40, 40) });
    registry.register({ id: 'screen', parentId: null, kind: 'View', role: null, styles: {}, source: null, dynamicStyle: false, host: host(10, 20, 384, 832) });
    const snapshot = await captureNative(registry);
    expect(snapshot.profile.root).toEqual({ x: 0, y: 0, width: 384, height: 832 });
    expect(snapshot.nodes.find(node => node.id === 'earlier-root')?.rect).toEqual({ x: 100, y: 100, width: 40, height: 40 });
  });
  it('rejects a missing designated root instead of guessing another top-level node', async () => {
    const profile = { window: { width: 384, height: 832 }, pixelRatio: 3.75, fontScale: 1, insets: { top: 0, right: 0, bottom: 0, left: 0 }, root: { x: 0, y: 0, width: 384, height: 832 }, orientation: 'portrait' as const };
    const registry = new LayoutRegistry('footer', profile, 'absent');
    await expect(captureNative(registry)).rejects.toMatchObject({ code: 'MISSING_ELEMENT' });
  });
});
