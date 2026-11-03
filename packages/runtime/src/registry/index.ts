import { BridgeFault, SpatialSnapshotSchema, type SpatialSnapshot, type BrowserRuntime, type DeviceProfile, type RnStylePatch, type SourceRef, type SpatialNode, type TextFitEvidence, type LayoutMutation, type NativeTarget } from '@nativemason/contracts';

export interface HostNode {
  getBoundingClientRect?: () => { x: number; y: number; width: number; height: number };
  measure?: (callback: (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => void) => void;
  measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
}
export interface Registration {
  id: string;
  parentId: string | null;
  kind: SpatialNode['kind'];
  role: string | null;
  styles: Record<string, unknown>;
  source: SourceRef | null;
  dynamicStyle: boolean;
  authoredTextProps?: SpatialNode['authoredTextProps'];
  measuredLineCount?: number;
  textFit?: TextFitEvidence;
  measurementSignature?: string;
  authoredSignature?:string;
  autoIdBase?:string;
  autoIdInstance?:string;
  host: HostNode;
}
export class LayoutRegistry {
  readonly entries = new Map<string, Registration>();
  readonly overrides = new Map<string, RnStylePatch>();
  readonly listeners = new Set<() => void>();
  generation = 0;
  revision = 0;
  sessionId = 'unconfigured';
  scenarioId: string;
  profile: DeviceProfile;
  rootId: string;
  windowOrigin = { x: 0, y: 0 };
  configured = false;
  nativeTarget?: NativeTarget;
  textProbes = false;
  autoRoot = false;
  private readonly autoIds = new Map<string, Map<string, string>>();
  claimAutoId(base: string, instance: string): string {
    let claims = this.autoIds.get(base);
    if (!claims) { claims = new Map(); this.autoIds.set(base, claims); }
    const existing = claims.get(instance);
    if (existing) return existing;
    const id = claims.size ? `${base}#${instance}` : base;
    claims.set(instance, id);
    return id;
  }
  runtime?: BrowserRuntime;
  constructor(scenarioId: string, profile: DeviceProfile, rootId: string) {
    this.scenarioId = scenarioId;
    this.profile = profile;
    this.rootId = rootId;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getRevision = () => this.revision;
  notify() {
    this.revision++;
    this.listeners.forEach(listener => listener());
  }
  register(entry: Registration) {
    if(entry.autoIdBase&&entry.autoIdInstance){let claims=this.autoIds.get(entry.autoIdBase);if(!claims){claims=new Map();this.autoIds.set(entry.autoIdBase,claims);}claims.set(entry.autoIdInstance,entry.id); }
    const old = this.entries.get(entry.id);
    if (this.autoRoot && entry.parentId === null && !this.entries.has(this.rootId)) this.rootId = entry.id;
    if (old && old.host !== entry.host) throw new BridgeFault('DUPLICATE_ELEMENT', `Duplicate layoutId: ${entry.id}`);
    const comparable = (value: Registration) => ({ ...value, host: null, measuredLineCount: undefined, textFit: undefined,measurementSignature:undefined });
    if (!old || JSON.stringify(comparable(old)) !== JSON.stringify(comparable(entry))) this.generation++;
    const preserve = old?.measurementSignature === entry.measurementSignature;
    this.entries.set(entry.id, { ...entry, ...(preserve && old?.measuredLineCount !== undefined ? { measuredLineCount: old.measuredLineCount } : {}), ...(preserve && old?.textFit ? { textFit: old.textFit } : {}) });
  }
  unregister(id: string, host: HostNode) {
    if (this.entries.get(id)?.host === host) {
      const entry=this.entries.get(id)!;
      if(entry.autoIdBase&&entry.autoIdInstance){const claims=this.autoIds.get(entry.autoIdBase);claims?.delete(entry.autoIdInstance);if(!claims?.size)this.autoIds.delete(entry.autoIdBase);}
      this.entries.delete(id);
      this.generation++;
    }
  }
  updateTextMetrics(id: string, measuredLineCount: number) {
    const entry = this.entries.get(id);
    if (!entry || entry.measuredLineCount === measuredLineCount) return;
    this.entries.set(id, { ...entry, measuredLineCount });
    this.notify();
  }
  updateTextFit(id: string, textFit: TextFitEvidence) {
    const entry = this.entries.get(id);
    if (!entry || JSON.stringify(entry.textFit) === JSON.stringify(textFit)) return;
    this.entries.set(id, { ...entry, textFit });
    this.notify();
  }
  setTrialBatch(mutations: readonly LayoutMutation[]) {
    const ids = new Set<string>();
    for (const mutation of mutations) {
      if (!this.entries.has(mutation.elementId)) throw new BridgeFault('MISSING_ELEMENT', 'Unknown layoutId: ' + mutation.elementId);
      if (ids.has(mutation.elementId)) throw new BridgeFault('INVALID_INPUT', 'Duplicate mutation target');
      ids.add(mutation.elementId);
    }
    this.overrides.clear();
    for (const mutation of mutations) this.overrides.set(mutation.elementId, mutation.patch);
    this.notify();
  }
  configure(input: Parameters<BrowserRuntime['configure']>[0]) {
    if (input.scenarioId !== this.scenarioId) throw new BridgeFault('INVALID_INPUT', `Scenario mismatch: expected ${this.scenarioId}`);
    if (JSON.stringify(input.profile) !== JSON.stringify(this.profile)) this.generation++;
    this.sessionId = input.sessionId;
    this.profile = input.profile;
    this.configured = true;
    this.notify();
  }
  setTrial(id: string, patch: RnStylePatch) {
    if (!this.entries.has(id)) throw new BridgeFault('MISSING_ELEMENT', `Unknown layoutId: ${id}`);
    this.overrides.clear();
    this.overrides.set(id, patch);
    this.notify();
  }
  resetTrial() {
    this.overrides.clear();
    this.notify();
  }
}

export const nextFrame = () => new Promise<void>(resolve => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 16);
});
export async function settleReact() { await nextFrame(); await nextFrame(); }

export function toSpatialNodes(registry: LayoutRegistry, rectangles: Map<string, SpatialNode['rect']>): SpatialNode[] {
  const sites = new Map<string, number>();
  for (const entry of registry.entries.values()) {
    if (entry.source) {
      const key = `${entry.source.path}:${entry.source.start}`;
      sites.set(key, (sites.get(key) ?? 0) + 1);
    }
  }
  return [...registry.entries.values()].map(entry => {
    const repeated = entry.source && (sites.get(`${entry.source.path}:${entry.source.start}`) ?? 0) > 1;
    const editReason = !entry.source ? 'Missing build-time source metadata' : entry.dynamicStyle ? 'Dynamic style expression' : repeated ? 'Source site has multiple mounted instances' : null;
    const rect = rectangles.get(entry.id);
    if (!rect) throw new BridgeFault('MISSING_ELEMENT', `No measurement for ${entry.id}`);
    return { id: entry.id, parentId: entry.parentId, kind: entry.kind, role: entry.role, rect, styles: { ...entry.styles, ...registry.overrides.get(entry.id) }, source: entry.source, editable: editReason === null, editReason, ...(entry.textFit ? { textFit: entry.textFit } : {}), ...(entry.authoredTextProps ? { authoredTextProps: entry.authoredTextProps } : {}), ...(entry.measuredLineCount === undefined ? {} : { measuredLineCount: entry.measuredLineCount }) };
  });
}

/** Boundary validation preserves the frozen machine-readable failure contract. */
export function validateSnapshot(input: unknown): SpatialSnapshot {
  const result = SpatialSnapshotSchema.safeParse(input);
  if (result.success) return result.data;
  const stale = result.error.issues.some(issue => issue.code === 'custom' && issue.params?.bridgeCode === 'STALE_SOURCE');
  throw new BridgeFault(stale ? 'STALE_SOURCE' : 'INVALID_INPUT', stale ? 'Mounted elements contain inconsistent source revisions' : result.error.message);
}
