import { BridgeFault, SpatialSnapshotSchema, type SpatialSnapshot } from '@rn-layout/contracts';
import { LayoutRegistry, nextFrame, toSpatialNodes } from './registry/index.js';

export async function captureWeb(registry: LayoutRegistry): Promise<SpatialSnapshot> {
  let previous = '';
  let stable = false;
  let nodes: SpatialSnapshot['nodes'] = [];
  const generation = registry.generation;
  for (let frame = 0; frame < 12; frame++) {
    await nextFrame();
    const rectangles = new Map<string, SpatialSnapshot['nodes'][number]['rect']>();
    for (const entry of registry.entries.values()) {
      const rect = entry.host.getBoundingClientRect?.();
      if (!rect) throw new BridgeFault('MISSING_ELEMENT', `No web host for ${entry.id}`);
      rectangles.set(entry.id, { x: rect.x - registry.profile.root.x, y: rect.y - registry.profile.root.y, width: rect.width, height: rect.height });
    }
    nodes = toSpatialNodes(registry, rectangles);
    const key = JSON.stringify(nodes.map(node => node.rect));
    if (key === previous && generation === registry.generation) { stable = true; break; }
    previous = key;
  }
  const revisions = Object.fromEntries(nodes.filter(node => node.source).map(node => [node.source!.path, node.source!.hash]));
  return SpatialSnapshotSchema.parse({ schemaVersion: 1, sessionId: registry.sessionId, snapshotId: `web-${Date.now()}-${++captureSequence}`, platform: 'web', scenarioId: registry.scenarioId, profile: registry.profile, revisions, nodes, status: stable ? 'stable' : 'unstable', generation: registry.generation });
}
let captureSequence = 0;
