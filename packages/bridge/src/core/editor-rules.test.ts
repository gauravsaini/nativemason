import { describe, expect, it } from 'vitest';
import { WireframeSpecSchema, type SpatialSnapshot } from '@nativemason/contracts';
import fixture from '../../../contracts/fixtures/footer.json';
import { evaluateConstraints, evaluateDefaultRules, generateFixCandidates, inferConstraints } from './index.js';

const spec = WireframeSpecSchema.parse(fixture);
function snapshot(): SpatialSnapshot {
  return { schemaVersion: 1, sessionId: 's', snapshotId: 'snap', scenarioId: spec.scenarioId, profile: structuredClone(spec.profile), platform: 'web', revisions: {}, generation: 1, status: 'stable', nodes: [
    { id: 'a', parentId: 'parent', kind: 'View', role: null, rect: { x: 0, y: 0, width: 40, height: 40 }, styles: {}, source: null, editable: true, editReason: null },
    { id: 'b', parentId: 'parent', kind: 'View', role: null, rect: { x: 48, y: 0, width: 40, height: 40 }, styles: {}, source: null, editable: true, editReason: null },
    { id: 'parent', parentId: null, kind: 'View', role: null, rect: { x: 0, y: 0, width: 100, height: 100 }, styles: {}, source: null, editable: true, editReason: null },
  ] };
}

describe('layout suggestions, inference, text fit, and default rules', () => {
  it('generates bounded deterministic gap candidates only for failed constraints', () => {
    const s = snapshot();
    const constraint = { id: 'gap', type: 'gap' as const, axis: 'x' as const, first: 'a', second: 'b', value: 16, tolerance: 0 };
    const input = { ...spec, requiredElementIds: ['a', 'b', 'parent'], constraints: [constraint] };
    const candidates = generateFixCandidates(s, input);
    expect(candidates).toEqual(generateFixCandidates(s, input));
    expect(candidates).toHaveLength(3);
    expect(candidates.map(c => c.mutations)).toContainEqual([{ elementId: 'parent', patch: { columnGap: 16 } }]);
    expect(generateFixCandidates(s, input, 1)).toEqual(candidates.slice(0, 1));
    expect(() => generateFixCandidates(s, input, 0)).toThrow(/limit/);
  });

  it('does not propose changes for unavailable captures or passing constraints', () => {
    const s = snapshot();
    const constraint = { id: 'gap', type: 'gap' as const, axis: 'x' as const, first: 'a', second: 'b', value: 8, tolerance: 0 };
    const input = { ...spec, requiredElementIds: ['a', 'b'], constraints: [constraint] };
    expect(generateFixCandidates(s, input)).toEqual([]);
    expect(generateFixCandidates({ ...s, status: 'unstable' }, { ...input, constraints: [{ ...constraint, value: 20 }] })).toEqual([]);
  });

  it('infers constraints in stable ID order and excludes rectangles when requested', () => {
    const s = snapshot();
    const inferred = inferConstraints(s, { tolerance: 0, includeRectangles: false });
    expect(inferred.requiredElementIds).toEqual(['a', 'b', 'parent']);
    expect(inferred.constraints.some(c => c.type === 'rect')).toBe(false);
    expect(inferred.constraints.some(c => c.type === 'gap' && c.axis === 'x' && c.value === 8)).toBe(true);
    expect(() => inferConstraints({ ...s, status: 'unstable' })).toThrow(/stable snapshot/);
    expect(() => inferConstraints(s, { tolerance: Number.NaN })).toThrow(/finite/);
  });

  it('requires equivalent unconstrained text measurement and honors full line count and pixel tolerance', () => {
    const s = snapshot();
    const node = { ...s.nodes[0], authoredTextProps: { numberOfLines: 2 }, textFit: { status: 'supported' as const, fullLineCount: 3, limitedLineCount: 2, fullHeight: 30, availableHeight: 28 } };
    const rule = { id: 'text', type: 'textFits' as const, elementId: node.id, tolerance: 0, pixelAware: false };
    let result = evaluateConstraints({ ...s, nodes: [node] }, { ...spec, requiredElementIds: [node.id], constraints: [rule] }).at(-1)!;
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/exceeding the authored limit/);
    result = evaluateConstraints({ ...s, nodes: [{ ...node, textFit: { status: 'unavailable', reason: 'native equivalent unavailable' } }] }, { ...spec, requiredElementIds: [node.id], constraints: [rule] }).at(-1)!;
    expect(result).toMatchObject({ status: 'unavailable', deviation: null, message: 'native equivalent unavailable' });
    result = evaluateConstraints({ ...s, nodes: [{ ...node, authoredTextProps: undefined, textFit: { status: 'supported', fullLineCount: 1, fullHeight: 28.5, availableHeight: 28 } }] }, { ...spec, requiredElementIds: [node.id], constraints: [{ ...rule, pixelAware: true }] }).at(-1)!;
    expect(result.status).toBe('pass');
  });

  it('keeps native clipping unavailable and classifies measured layout rules conservatively', () => {
    const s = snapshot();
    const findings = evaluateDefaultRules(s);
    expect(findings.some(f => f.code === 'CLIPPING_EVIDENCE' && f.severity === 'unavailable')).toBe(true);
    expect(findings.some(f => f.code === 'MINIMUM_LAYOUT_BOX' && f.severity === 'confirmed')).toBe(false);
    const unstable = evaluateDefaultRules({ ...s, status: 'unstable' });
    expect(unstable).toEqual([{ code: 'UNSTABLE_LAYOUT', severity: 'unavailable', elementIds: [], message: 'Default rules require a settled capture' }]);
  });
});

it('offers minimum box dimensions without claiming effective touchability',()=>{
 const s=snapshot();s.nodes[0].styles={maxWidth:44,maxHeight:45};
 const input={...spec,requiredElementIds:['a'],constraints:[{id:'minimum',type:'minTouchTarget' as const,elementId:'a',width:48,height:48,tolerance:0}]};
 const candidates=generateFixCandidates(s,input);
 expect(candidates).toHaveLength(1);expect(candidates[0].mutations).toEqual([{elementId:'a',patch:{minWidth:48,minHeight:48,maxWidth:48,maxHeight:48}}]);
 expect(candidates[0].reason).toContain('effective touchability');
 s.nodes[0].editable=false;expect(generateFixCandidates(s,input)).toEqual([]);
});

it('uses root-relative safe bounds and proposes wrapping for measured row overflow',()=>{
 const s=snapshot();s.nodes[0].rect={x:350,y:30,width:40,height:40};s.nodes[1].rect={x:390,y:30,width:40,height:40};s.nodes[2].rect={x:350,y:24,width:70,height:100};s.nodes[2].styles={flexDirection:'row'};
 const input={...spec,requiredElementIds:['b'],constraints:[{id:'safe',type:'insideSafeArea' as const,elementId:'b',tolerance:0}]};
 const before=JSON.stringify(s);const candidates=generateFixCandidates(s,input);
 expect(candidates.map(candidate=>candidate.mutations)).toContainEqual([{elementId:'b',patch:{marginLeft:-18}}]);
 expect(candidates.map(candidate=>candidate.mutations)).toContainEqual([{elementId:'parent',patch:{flexWrap:'wrap'}}]);
 expect(JSON.stringify(s)).toBe(before);
 expect(generateFixCandidates(s,input,1)).toEqual(candidates.slice(0,1));
});

it('offers overlap corrections only when disjointness is explicitly required',()=>{
 const s=snapshot();s.nodes[1].rect.x=20;
 expect(generateFixCandidates(s,{...spec,requiredElementIds:[],constraints:[]})).toEqual([]);
 const input={...spec,requiredElementIds:['a','b'],constraints:[{id:'separate',type:'disjoint' as const,first:'a',second:'b',tolerance:0}]};
 const candidates=generateFixCandidates(s,input);
 expect(candidates.map(candidate=>candidate.mutations)).toContainEqual([{elementId:'b',patch:{marginLeft:20}}]);
 expect(candidates.map(candidate=>candidate.mutations)).toContainEqual([{elementId:'parent',patch:{flexDirection:'column',gap:0}}]);
});

it('uses supported full-text evidence without fabricating a line limit or shrinking typography',()=>{
 const s=snapshot();s.platform='android';s.nodes[0]={...s.nodes[0],kind:'Text',styles:{flexShrink:1,fontSize:16},textFit:{status:'supported',fullLineCount:3,fullHeight:60,availableHeight:40},authoredTextProps:{numberOfLines:2}};
 const input={...spec,requiredElementIds:['a'],constraints:[{id:'fit',type:'textFits' as const,elementId:'a',tolerance:0}]};
 const candidates=generateFixCandidates(s,input);
 expect(candidates.map(candidate=>candidate.mutations)).toContainEqual([{elementId:'a',patch:{height:60,minHeight:60}}]);
 expect(candidates.map(candidate=>candidate.mutations)).toContainEqual([{elementId:'a',patch:{width:100,flexShrink:0}}]);
 expect(candidates.every(candidate=>candidate.mutations.every(mutation=>!('fontSize' in mutation.patch)&&!('numberOfLines' in mutation.patch)))).toBe(true);
 s.nodes[0].textFit={status:'unavailable',reason:'Probe does not match this text'};expect(generateFixCandidates(s,input)).toEqual([]);
});

it('merges equivalent proposals across constraints and ignores empty safe areas',()=>{
 const s=snapshot();const rule={id:'one',type:'minTouchTarget' as const,elementId:'a',width:48,height:48,tolerance:0};
 const candidates=generateFixCandidates(s,{...spec,requiredElementIds:['a'],constraints:[rule,{...rule,id:'two'}]});
 expect(candidates).toHaveLength(1);expect(candidates[0].constraintIds).toEqual(['one','two']);
 s.profile.insets={top:s.profile.window.height,right:0,bottom:0,left:0};
 expect(generateFixCandidates(s,{...spec,profile:s.profile,requiredElementIds:['a'],constraints:[{id:'safe',type:'insideSafeArea',elementId:'a',tolerance:0}]})).toEqual([]);
});
