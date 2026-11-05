import { captureSourceRevisions } from './source-revisions.js';
import { BridgeFault, type SpatialSnapshot } from '@nativemason/contracts';
import { LayoutRegistry, nextFrame, toSpatialNodes, validateSnapshot } from './registry/index.js';

export async function captureWeb(registry: LayoutRegistry): Promise<SpatialSnapshot> {
  if (registry.autoRoot && [...registry.entries.values()].filter(entry => entry.parentId === null).length !== 1) throw new BridgeFault('INVALID_INPUT', 'Automatic root requires exactly one instrumented root host');
  if (!registry.entries.has(registry.rootId)) throw new BridgeFault('MISSING_ELEMENT', `Designated root ${registry.rootId} is not mounted`);
  let capturedProfile = registry.profile;
  let previous = '';
  let stable = false;
  let nodes: SpatialSnapshot['nodes'] = [];
  const generation = registry.generation;
  for (let frame = 0; frame < 12; frame++) {
    await nextFrame();
    const root = registry.entries.get(registry.rootId)?.host.getBoundingClientRect?.();
    if (!root) throw new BridgeFault('MISSING_ELEMENT', `Designated root ${registry.rootId} has no web host`);
    capturedProfile = { ...registry.profile, root: { x: root.x, y: root.y, width: root.width, height: root.height } };
    const rectangles = new Map<string, SpatialSnapshot['nodes'][number]['rect']>();
    for (const entry of registry.entries.values()) {
      const rect = entry.host.getBoundingClientRect?.();
      if (!rect) throw new BridgeFault('MISSING_ELEMENT', `No web host for ${entry.id}`);
      rectangles.set(entry.id, { x: rect.x - root.x, y: rect.y - root.y, width: rect.width, height: rect.height });
    }
    nodes = toSpatialNodes(registry, rectangles);
    const key = JSON.stringify(nodes.map(node => node.rect));
    if (key === previous && generation === registry.generation) { stable = true; break; }
    previous = key;
  }
  const revisions = captureSourceRevisions(nodes);
  return validateSnapshot({ schemaVersion: 1, sessionId: registry.sessionId, snapshotId: `web-${Date.now()}-${++captureSequence}`, platform: 'web', scenarioId: registry.scenarioId, profile: capturedProfile, revisions, nodes, status: stable ? 'stable' : 'unstable', generation: registry.generation });
}
let captureSequence = 0;
