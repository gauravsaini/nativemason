import { RnStylePatchSchema, type SuggestionCandidate, type InferenceOptions, type RuleFinding, type Constraint, type ConstraintResult, type DeviceProfile, type NormalizedPatch, type OverlayScene, type Rect, type Result, type SpatialDelta, type SpatialSnapshot, type WireframeSpec } from '@nativemason/contracts';

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
    case 'textFits': case 'rect': case 'minTouchTarget': case 'insideSafeArea': return [rule.elementId];
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
    case 'textFits': return 0;
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
    if (rule.type === 'textFits') {
      const node = nodes.get(rule.elementId)!;
      const evidence = node.textFit;
      const tolerance = rule.pixelAware ? Math.max(rule.tolerance, 2 / snapshot.profile.pixelRatio) : rule.tolerance;
      if (!evidence || evidence.status !== 'supported' || evidence.fullLineCount === undefined || evidence.fullHeight === undefined || evidence.availableHeight === undefined) {
        results.push({constraintId:rule.id,status:'unavailable',elementIds:ids,deviation:null,tolerance,message:evidence?.reason ?? 'Equivalent unconstrained text measurement unavailable'});
      } else {
        const overflow = Math.max(0, evidence.fullHeight - evidence.availableHeight);
        const lineLimit = node.authoredTextProps?.numberOfLines;
        const tooManyLines = lineLimit !== undefined && evidence.fullLineCount > lineLimit;
        const passed = !tooManyLines && overflow <= tolerance;
        results.push({constraintId:rule.id,status:passed?'pass':'fail',elementIds:ids,deviation:overflow,tolerance,message:passed?'Unconstrained text fits the measured box and line limit':tooManyLines?`Full text requires ${evidence.fullLineCount} lines, exceeding the authored limit ${lineLimit}`:`Full text exceeds available height by ${overflow} logical units`});
      }
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


/** Bounded deterministic proposals; only a browser trial can establish whether they help. */
export function generateFixCandidates(snapshot: SpatialSnapshot, spec: WireframeSpec, limit = 12): readonly SuggestionCandidate[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Candidate limit must be an integer from 1 to 100');
  const nodes = new Map(snapshot.nodes.map(node => [node.id, node]));
  const failed = new Set(evaluateConstraints(snapshot, spec).filter(result => result.status === 'fail').map(result => result.constraintId));
  const candidates: SuggestionCandidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: SuggestionCandidate) => {
    const key = JSON.stringify(candidate.mutations);
    if (!seen.has(key)) { seen.add(key); candidates.push(candidate); }
  };
  for (const rule of spec.constraints) {
    if (!failed.has(rule.id)) continue;
    if (rule.type !== 'gap' && rule.type !== 'align') continue;
    const selected = idsFor(rule).map(id => nodes.get(id));
    if (selected.some(node => !node)) continue;
    const members = selected as NonNullable<typeof selected[number]>[];
    const parentId = members[0].parentId;
    const parent = parentId && members.every(node => node.parentId === parentId) ? nodes.get(parentId) : undefined;
    if (rule.type === 'gap') {
      if (parent?.editable) {
        const property = rule.axis === 'x' ? 'columnGap' : 'rowGap';
        add({mutations:[{elementId:parent.id,patch:{[property]:rule.value}}],reason:'Set the shared parent spacing on the requested axis',constraintIds:[rule.id]});
        add({mutations:[{elementId:parent.id,patch:{flexDirection:rule.axis === 'x'?'row':'column',[property]:rule.value}}],reason:'Arrange siblings on the requested axis with explicit spacing',constraintIds:[rule.id]});
      }
      const [first,second] = members;
      if (second.editable) {
        const property = rule.axis === 'x' ? 'marginLeft' : 'marginTop';
        const current = typeof second.styles[property] === 'number' ? second.styles[property] as number : 0;
        const correction = axisValue(first.rect,rule.axis,'end') + rule.value - axisValue(second.rect,rule.axis,'start');
        add({mutations:[{elementId:second.id,patch:{[property]:current+correction}}],reason:'Adjust the second element spacing by the measured gap error',constraintIds:[rule.id]});
      }
    } else {
      const alignment: 'flex-start'|'flex-end'|'center' = rule.edge === 'start' ? 'flex-start' : rule.edge === 'end' ? 'flex-end' : 'center';
      const crossAxis = parent && (String(parent.styles.flexDirection ?? 'column').startsWith('row') ? 'y':'x');
      if (parent?.editable && crossAxis === rule.axis) add({mutations:[{elementId:parent.id,patch:{alignItems:alignment}}],reason:'Align siblings along their parent cross axis',constraintIds:[rule.id]});
      if (parent?.editable && crossAxis !== rule.axis) add({mutations:[{elementId:parent.id,patch:{flexDirection:rule.axis==='y'?'row':'column',alignItems:alignment}}],reason:'Arrange siblings so the requested alignment is on the parent cross axis',constraintIds:[rule.id]});
      const mutations = members.filter(node => node.editable).map(node => ({elementId:node.id,patch:{alignSelf:alignment}}));
      if (mutations.length && crossAxis === rule.axis) add({mutations,reason:'Align the selected siblings without changing the parent default',constraintIds:[rule.id]});
    }
    if (candidates.length >= limit) break;
  }
  return candidates.slice(0,limit);
}

/** Produces an editable proposal, never an automatically accepted design specification. */
export function inferConstraints(snapshot: SpatialSnapshot, options: InferenceOptions = {}): WireframeSpec {
  const tolerance = options.tolerance ?? 2;
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('Inference tolerance must be finite and nonnegative');
  if (snapshot.status !== 'stable' || new Set(snapshot.nodes.map(node=>node.id)).size !== snapshot.nodes.length) throw new Error('Inference requires a stable snapshot with unique element IDs');
  const constraints: Constraint[] = [];
  const ordered = [...snapshot.nodes].sort((a,b)=>a.id.localeCompare(b.id));
  const safe = safeAreaRect(snapshot.profile);
  for (const node of ordered) {
    const id = encodeURIComponent(node.id);
    if (options.includeRectangles !== false) constraints.push({id:`inferred:rect:${id}`,type:'rect',elementId:node.id,target:{...node.rect},tolerance});
    if (node.rect.x >= safe.x && node.rect.y >= safe.y && node.rect.x+node.rect.width <= safe.x+safe.width && node.rect.y+node.rect.height <= safe.y+safe.height) constraints.push({id:`inferred:safe:${id}`,type:'insideSafeArea',elementId:node.id,tolerance});
  }
  const groups = new Map<string|null,typeof ordered>();
  for (const node of ordered) { const group=groups.get(node.parentId) ?? []; group.push(node); groups.set(node.parentId,group); }
  for (const group of groups.values()) for (const axis of ['x','y'] as const) {
    for (const edge of ['start','center','end'] as const) {
      const sorted=[...group].sort((a,b)=>axisValue(a.rect,axis,edge)-axisValue(b.rect,axis,edge)||a.id.localeCompare(b.id));
      let cluster: typeof ordered=[];
      const flush=()=>{if(cluster.length>1)constraints.push({id:`inferred:align:${axis}:${edge}:${cluster.map(n=>encodeURIComponent(n.id)).join(':')}`,type:'align',axis,edge,elementIds:cluster.map(n=>n.id),tolerance});};
      for(const node of sorted) {if(cluster.length && axisValue(node.rect,axis,edge)-axisValue(cluster[0].rect,axis,edge)>tolerance){flush();cluster=[];}cluster.push(node);}flush();
    }
    const sorted=[...group].sort((a,b)=>a.rect[axis]-b.rect[axis]||a.id.localeCompare(b.id));
    for(let i=1;i<sorted.length;i++){
      const a=sorted[i-1],b=sorted[i],cross=axis==='x'?'y':'x',size=cross==='x'?'width':'height';
      const gap=axisValue(b.rect,axis,'start')-axisValue(a.rect,axis,'end');
      const crossOverlap=Math.min(a.rect[cross]+a.rect[size],b.rect[cross]+b.rect[size])-Math.max(a.rect[cross],b.rect[cross]);
      if(gap>=0&&crossOverlap>0)constraints.push({id:`inferred:gap:${axis}:${encodeURIComponent(a.id)}:${encodeURIComponent(b.id)}`,type:'gap',axis,first:a.id,second:b.id,value:gap,tolerance});
    }
  }
  return {schemaVersion:1,scenarioId:snapshot.scenarioId,profile:structuredClone(snapshot.profile),requiredElementIds:ordered.map(node=>node.id),constraints};
}

/** Advisory overlap and measured-box rules do not establish hit targets or design intent. */
export function evaluateDefaultRules(snapshot: SpatialSnapshot): readonly RuleFinding[] {
  const findings: RuleFinding[]=[];
  if(snapshot.status!=='stable')return [{code:'UNSTABLE_LAYOUT',severity:'unavailable',elementIds:[],message:'Default rules require a settled capture'}];
  const minimum=snapshot.platform==='ios'?44:48;
  const safe=safeAreaRect(snapshot.profile);
  const ordered=[...snapshot.nodes].sort((a,b)=>a.id.localeCompare(b.id));
  for(const node of ordered){
    if((node.kind==='Pressable'||node.role==='button')&&(node.rect.width<minimum||node.rect.height<minimum))findings.push({code:'MINIMUM_LAYOUT_BOX',severity:'confirmed',elementIds:[node.id],message:`Measured box is ${node.rect.width} × ${node.rect.height}; recommended minimum is ${minimum} × ${minimum}. This does not measure effective touchability.`});
    if(node.parentId!==null&&(node.rect.x<safe.x-2||node.rect.y<safe.y-2||node.rect.x+node.rect.width>safe.x+safe.width+2||node.rect.y+node.rect.height>safe.y+safe.height+2))findings.push({code:'SAFE_AREA',severity:'advisory',elementIds:[node.id],message:'Measured element extends outside the safe area; confirm whether edge-to-edge rendering is intentional'});
  }
  for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++){
    const a=ordered[i],b=ordered[j];
    if(a.parentId===null||a.parentId!==b.parentId)continue;
    const x=Math.min(a.rect.x+a.rect.width,b.rect.x+b.rect.width)-Math.max(a.rect.x,b.rect.x);
    const y=Math.min(a.rect.y+a.rect.height,b.rect.y+b.rect.height)-Math.max(a.rect.y,b.rect.y);
    if(x>2&&y>2)findings.push({code:'SIBLING_OVERLAP',severity:'advisory',elementIds:[a.id,b.id],message:'Sibling rectangles overlap; explicit disjoint constraints are required to classify intentional layering as a violation'});
  }
  if(snapshot.platform==='web'){
    if(!snapshot.webDiagnostics)findings.push({code:'CLIPPING_EVIDENCE',severity:'unavailable',elementIds:[],message:'Browser clipping diagnostics are unavailable'});
    else for(const warning of snapshot.webDiagnostics.warnings)findings.push({code:warning.code,severity:warning.severity==='confirmed'?'confirmed':'unavailable',elementIds:[warning.elementId],message:warning.message});
  }else findings.push({code:'CLIPPING_EVIDENCE',severity:'unavailable',elementIds:[],message:'Native clipping is not established by the registered layout boxes'});
  return findings;
}
