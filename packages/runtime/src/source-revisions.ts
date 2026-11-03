import { BridgeFault, type SpatialNode, type SourceRevisions } from '@nativemason/contracts';
const revisions = new Map<string, string>();
/** Called at the end of successfully evaluated development application modules. */
export function registerSourceRevision(path: string, hash: string): void {
  if (typeof __DEV__ !== 'undefined' ? !__DEV__ : process.env.NODE_ENV === 'production') return;
  if (!path || path.startsWith('/') || path.split('/').includes('..') || !/^[a-f0-9]{64}$/.test(hash)) return;
  revisions.set(path, hash);
}
export function loadedSourceRevisions(): SourceRevisions { return Object.fromEntries(revisions); }
export function captureSourceRevisions(nodes: readonly SpatialNode[]): SourceRevisions {
  const loaded = loadedSourceRevisions();
  const result:SourceRevisions={};
  for (const node of nodes) {
    if (!node.source) continue;
    if (loaded[node.source.path] && loaded[node.source.path] !== node.source.hash) throw new BridgeFault('STALE_SOURCE', 'Mounted source metadata is stale: ' + node.source.path);
    result[node.source.path] = node.source.hash;
    for(const dependency of node.source.dependencies??[]){if(!loaded[dependency])throw new BridgeFault('STALE_SOURCE','Required style module has not loaded: '+dependency);result[dependency]=loaded[dependency];}
  }
  return result;
}
declare const __DEV__: boolean;
