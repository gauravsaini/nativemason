import { captureSourceRevisions } from './source-revisions.js';
import { PixelRatio, Platform } from 'react-native';
import { BridgeFault, type DeviceProfile, type SpatialSnapshot } from '@nativemason/contracts';
import { LayoutRegistry, nextFrame, toSpatialNodes, validateSnapshot, type Registration } from './registry/index.js';

function measure(entry: Registration): Promise<SpatialSnapshot['nodes'][number]['rect']> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new BridgeFault('TIMEOUT', `Measurement timed out for ${entry.id}`)), 2000);
    if (Platform.OS === 'ios' && entry.host.measureInWindow) {
      entry.host.measureInWindow((x, y, width, height) => { clearTimeout(timeout); resolve({ x, y, width, height }); });
      return;
    }
    if (!entry.host.measure) { clearTimeout(timeout); reject(new BridgeFault('MISSING_ELEMENT', `Missing native measure ref for ${entry.id}`)); return; }
    // RN0.88 measure().pageX/pageY omit the viewport offset. The legacy
    // measureInWindow and DOM-like bounding rect include it on Android.
    entry.host.measure((_x, _y, width, height, pageX, pageY) => { clearTimeout(timeout); resolve({ x: pageX, y: pageY, width, height }); });
  });
}
export async function captureNative(registry: LayoutRegistry): Promise<SpatialSnapshot> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') throw new BridgeFault('INVALID_INPUT', 'Native acceptance requires Android or iOS');
  if (registry.autoRoot && [...registry.entries.values()].filter(entry => entry.parentId === null).length !== 1) throw new BridgeFault('INVALID_INPUT', 'Automatic root requires exactly one instrumented root host');
  if (!registry.entries.has(registry.rootId)) throw new BridgeFault('MISSING_ELEMENT', `Designated root ${registry.rootId} is not mounted`);
  const generation = registry.generation;
  let nodes: SpatialSnapshot['nodes'] = [];
  let previous = '';
  let stable = false;
  let profile: DeviceProfile = registry.profile;
  for (let frame = 0; frame < 12; frame++) {
    await nextFrame();
    const entries = [...registry.entries.values()];
    const measured = await Promise.all(entries.map(async entry => [entry.id, await measure(entry)] as const));
    const rectangles = new Map(measured);
    const root = rectangles.get(registry.rootId);
    if (!root) throw new BridgeFault('MISSING_ELEMENT', `Designated root ${registry.rootId} disappeared`);
    const canonicalRoot = { ...root, x: root.x - registry.windowOrigin.x, y: root.y - registry.windowOrigin.y };
    const window = registry.profile.window;
    profile = { ...registry.profile, root: canonicalRoot, window, pixelRatio: PixelRatio.get(), fontScale: PixelRatio.getFontScale(), orientation: window.width > window.height ? 'landscape' : 'portrait' };
    const relative = new Map(measured.map(([id, rect]) => [id, { ...rect, x: rect.x - root.x, y: rect.y - root.y }]));
    nodes = toSpatialNodes(registry, relative);
    const key = JSON.stringify(nodes.map(node => ({ rect: node.rect, textFit: node.textFit })));
    if (key === previous && generation === registry.generation) { stable = true; break; }
    previous = key;
  }
  const revisions = captureSourceRevisions(nodes);
  return validateSnapshot({ schemaVersion: 1, sessionId: registry.sessionId, snapshotId: `${Platform.OS}-${Date.now()}-${++captureSequence}`, platform: Platform.OS, scenarioId: registry.scenarioId, profile, revisions, nodes, status: stable ? 'stable' : 'unstable', generation: registry.generation, ...(registry.nativeTarget ? { nativeTarget: registry.nativeTarget } : {}) });
}
let captureSequence = 0;
