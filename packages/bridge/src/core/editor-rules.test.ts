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
