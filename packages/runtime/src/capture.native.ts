import { Dimensions, PixelRatio, Platform } from 'react-native';
import { BridgeFault, SpatialSnapshotSchema, type DeviceProfile, type SpatialSnapshot } from '@rn-layout/contracts';
import { LayoutRegistry, nextFrame, toSpatialNodes, type Registration } from './registry/index.js';

function measure(entry: Registration): Promise<SpatialSnapshot['nodes'][number]['rect']> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new BridgeFault('TIMEOUT', `Measurement timed out for ${entry.id}`)), 2000);
    if (!entry.host.measureInWindow) { clearTimeout(timeout); reject(new BridgeFault('MISSING_ELEMENT', `Missing native ref for ${entry.id}`)); return; }
    entry.host.measureInWindow((x, y, width, height) => { clearTimeout(timeout); resolve({ x, y, width, height }); });
  });
}
export async function captureNative(registry: LayoutRegistry): Promise<SpatialSnapshot> {
  if (Platform.OS !== 'android') throw new BridgeFault('INVALID_INPUT', 'Native acceptance requires Android');
  const generation = registry.generation;
  let nodes: SpatialSnapshot['nodes'] = [];
  let previous = '';
  let stable = false;
  let profile: DeviceProfile = registry.profile;
  for (let frame = 0; frame < 12; frame++) {
    await nextFrame();
    const entries = [...registry.entries.values()];
    const measured = await Promise.all(entries.map(async entry => [entry.id, await measure(entry)] as const));
    const rootEntry = entries.find(entry => entry.parentId === null);
    const rectangles = new Map(measured);
    const windowSize = Dimensions.get('window');
    const root = (rootEntry && rectangles.get(rootEntry.id)) || { x: 0, y: 0, width: windowSize.width, height: windowSize.height };
    profile = { ...registry.profile, root, window: { width: windowSize.width, height: windowSize.height }, pixelRatio: PixelRatio.get(), fontScale: PixelRatio.getFontScale(), orientation: windowSize.width > windowSize.height ? 'landscape' : 'portrait' };
    const relative = new Map(measured.map(([id, rect]) => [id, { ...rect, x: rect.x - root.x, y: rect.y - root.y }]));
    nodes = toSpatialNodes(registry, relative);
    const key = JSON.stringify(nodes.map(node => node.rect));
    if (key === previous && generation === registry.generation) { stable = true; break; }
    previous = key;
  }
  const revisions = Object.fromEntries(nodes.filter(node => node.source).map(node => [node.source!.path, node.source!.hash]));
  return SpatialSnapshotSchema.parse({ schemaVersion: 1, sessionId: registry.sessionId, snapshotId: `android-${Date.now()}-${++captureSequence}`, platform: 'android', scenarioId: registry.scenarioId, profile, revisions, nodes, status: stable ? 'stable' : 'unstable', generation: registry.generation });
}
let captureSequence = 0;
