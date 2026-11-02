import { RnStylePatchSchema, type Constraint, type ConstraintResult, type DeviceProfile, type NormalizedPatch, type OverlayScene, type Rect, type Result, type SpatialDelta, type SpatialSnapshot, type WireframeSpec } from '@rn-layout/contracts';

/** Convert a window-space rectangle to root-space without applying insets twice. */
export function normalizeRect(rect: Rect, root: Rect): Rect {
  return { ...rect, x: rect.x - root.x, y: rect.y - root.y };
}

export function safeAreaRect(profile: DeviceProfile): Rect {
  const { window: win, root, insets } = profile;
  const left = Math.max(root.x, insets.left);
  const top = Math.max(root.y, insets.top);
  const right = Math.min(root.x + root.width, win.width - insets.right);
  const bottom = Math.min(root.y + root.height, win.height - insets.bottom);
  return { x: left - root.x, y: top - root.y, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function normalizePatch(patch: unknown): Result<NormalizedPatch> {
  const parsed = RnStylePatchSchema.safeParse(patch);
  return parsed.success ? { ok: true, value: Object.freeze(parsed.data) } : {
    ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message },
  };
}

function idsFor(rule: Constraint): string[] {
  switch (rule.type) {
    case 'rect': case 'minTouchTarget': case 'insideSafeArea': return [rule.elementId];
    case 'align': return rule.elementIds;
    default: return [rule.first, rule.second];
  }
}
function axisValue(rect: Rect, axis: 'x' | 'y', edge: 'start' | 'center' | 'end'): number {
  const size = axis === 'x' ? rect.width : rect.height;
  return rect[axis] + (edge === 'start' ? 0 : edge === 'center' ? size / 2 : size);
}
function deviation(rule: Constraint, rects: Rect[], profile: DeviceProfile): number {
  const [a, b] = rects;
  switch (rule.type) {
    case 'rect': return Math.max(...(['x', 'y', 'width', 'height'] as const).map(k => Math.abs(a[k] - rule.target[k])));
    case 'minTouchTarget': return Math.max(0, rule.width - a.width, rule.height - a.height);
    case 'align': {
      const values = rects.map(r => axisValue(r, rule.axis, rule.edge));
      return Math.max(...values) - Math.min(...values);
    }
    case 'gap': return Math.abs(axisValue(b, rule.axis, 'start') - axisValue(a, rule.axis, 'end') - rule.value);
    case 'insideSafeArea': {
      const safe = safeAreaRect(profile);
      return Math.max(0, safe.x - a.x, safe.y - a.y, a.x + a.width - safe.x - safe.width, a.y + a.height - safe.y - safe.height);
    }
    case 'disjoint': {
      if (a.width === 0 || a.height === 0 || b.width === 0 || b.height === 0) return 0;
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      return Math.max(0, Math.min(overlapX, overlapY));
    }
  }
}

export function profilesMatch(a: DeviceProfile, b: DeviceProfile): boolean {
  return a.orientation === b.orientation && a.fontScale === b.fontScale && a.pixelRatio === b.pixelRatio &&
    Math.abs(a.window.width - b.window.width) <= 0.01 && Math.abs(a.window.height - b.window.height) <= 0.01 &&
    (['x','y','width','height'] as const).every(k => Math.abs(a.root[k] - b.root[k]) <= 0.01) &&
    (['top','right','bottom','left'] as const).every(k => Math.abs(a.insets[k] - b.insets[k]) <= 0.01);
}

export function evaluateConstraints(snapshot: SpatialSnapshot, spec: WireframeSpec): readonly ConstraintResult[] {
  const nodes = new Map(snapshot.nodes.map(n => [n.id, n]));
  const duplicates = nodes.size !== snapshot.nodes.length;
  const contextMatches = snapshot.scenarioId === spec.scenarioId && profilesMatch(snapshot.profile, spec.profile) && snapshot.status === 'stable' && !duplicates;
  const results: ConstraintResult[] = spec.requiredElementIds.filter(id => !nodes.has(id)).map(id => ({
    constraintId: `required:${id}`, status: 'unavailable', elementIds: [id], deviation: null, tolerance: 0, message: `Required element ${id} is missing`,
  }));
  if (!contextMatches) results.push({ constraintId: 'capture-context', status: 'unavailable', elementIds: [], deviation: null, tolerance: 0, message: 'Scenario, profile, unique IDs and stable capture must match the specification' });
  for (const rule of spec.constraints) {
    const ids = idsFor(rule);
    if (!contextMatches || ids.some(id => !nodes.has(id))) {
      results.push({ constraintId: rule.id, status: 'unavailable', elementIds: ids, deviation: null, tolerance: rule.tolerance, message: 'Required element or matching stable capture unavailable' });
      continue;
    }
    const amount = deviation(rule, ids.map(id => nodes.get(id)!.rect), snapshot.profile);
    const tolerance = rule.pixelAware ? Math.max(rule.tolerance, 2 / snapshot.profile.pixelRatio) : rule.tolerance;
    results.push({ constraintId: rule.id, status: amount <= tolerance ? 'pass' : 'fail', elementIds: ids, deviation: amount, tolerance, message: amount <= tolerance ? 'Within tolerance' : `Deviation ${amount} exceeds tolerance ${tolerance}` });
  }
  return results;
}

export function diffSnapshots(before: SpatialSnapshot, after: SpatialSnapshot): SpatialDelta {
  const old = new Map(before.nodes.map(n => [n.id, n]));
  const next = new Map(after.nodes.map(n => [n.id, n]));
  return {
    added: [...next.keys()].filter(id => !old.has(id)).sort(),
    removed: [...old.keys()].filter(id => !next.has(id)).sort(),
    changed: [...next.keys()].filter(id => old.has(id)).sort().flatMap(id => {
      const a = old.get(id)!.rect, b = next.get(id)!.rect;
      if ((['x','y','width','height'] as const).every(k => a[k] === b[k])) return [];
      return [{ id, before: { ...a }, after: { ...b }, delta: { x: b.x-a.x, y: b.y-a.y, width: b.width-a.width, height: b.height-a.height } }];
    }),
  };
}
export function buildOverlayScene(snapshot: SpatialSnapshot, spec: WireframeSpec): OverlayScene {
  return {
    width: snapshot.profile.window.width, height: snapshot.profile.window.height,
    marks: [...snapshot.nodes].sort((a,b) => a.id.localeCompare(b.id)).map((n,i) => ({ label:i+1,id:n.id,rect:{...n.rect,x:n.rect.x+snapshot.profile.root.x,y:n.rect.y+snapshot.profile.root.y} })),
    targets: spec.constraints.flatMap(c => c.type === 'rect' ? [{ id:c.elementId,rect:{...c.target,x:c.target.x+snapshot.profile.root.x,y:c.target.y+snapshot.profile.root.y} }] : []),
  };
}
