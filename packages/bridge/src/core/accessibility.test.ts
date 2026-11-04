import { describe, expect, it } from 'vitest';
import type { SpatialNode, SpatialSnapshot } from '@nativemason/contracts';
import { inspectAccessibility, solidContrastRatio } from './accessibility.js';

const node = (overrides: Partial<SpatialNode> = {}): SpatialNode => ({
  id: 'control', parentId: null, kind: 'Pressable', role: null,
  rect: { x: 0, y: 0, width: 40, height: 40 }, styles: {}, source: null,
  editable: false, editReason: null, ...overrides,
});
const snapshot = (nodes: SpatialNode[], platform: SpatialSnapshot['platform'] = 'web'): SpatialSnapshot => ({
  schemaVersion: 1, sessionId: 'session', snapshotId: 'snapshot', platform, scenarioId: 'screen',
  profile: { window: { width: 100, height: 100 }, pixelRatio: 1, fontScale: 1,
    insets: { top: 0, right: 0, bottom: 0, left: 0 }, root: { x: 0, y: 0, width: 100, height: 100 }, orientation: 'portrait' },
  revisions: {}, nodes, status: 'stable', generation: 1,
});

describe('solidContrastRatio', () => {
  it('returns 21:1 for black and white and 1:1 for equal colors', () => {
    expect(solidContrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 10);
    expect(solidContrastRatio([64, 128, 192], [64, 128, 192])).toBe(1);
  });
});

describe('inspectAccessibility', () => {
  it('uses computed web names, distinguishing a nonempty name from an empty one', () => {
    const findings = inspectAccessibility(snapshot([
      node({ id: 'named', accessibility: { direction: 'ltr', browser: { name: '  Save  ', focusOrder: 0, focusOrderSource: 'dom-sequential-estimate', contrast: { status: 'unavailable' } } } }),
      node({ id: 'empty', accessibility: { direction: 'ltr', browser: { name: '  ', focusOrder: null, focusOrderSource: 'dom-sequential-estimate', contrast: { status: 'unavailable' } } } }),
    ]));
    expect(findings.filter(item => item.code === 'ACCESSIBLE_NAME').map(item => [item.elementIds[0], item.status])).toEqual([['named', 'pass'], ['empty', 'fail']]);
  });

  it('treats authored native labels as authored evidence and missing derived names as unavailable', () => {
    const findings = inspectAccessibility(snapshot([
      node({ id: 'authored', accessibility: { direction: 'ltr', authoredLabel: 'Continue' } }),
      node({ id: 'derived', accessibility: { direction: 'unknown' } }),
    ], 'ios'));
    expect(findings.find(item => item.code === 'ACCESSIBLE_NAME' && item.elementIds[0] === 'authored')?.status).toBe('advisory');
    expect(findings.find(item => item.code === 'ACCESSIBLE_NAME' && item.elementIds[0] === 'derived')?.status).toBe('unavailable');
  });

  it('marks DOM focus order as advisory and unavailable focus data as unavailable', () => {
    const findings = inspectAccessibility(snapshot([
      node({ id: 'estimated', accessibility: { direction: 'ltr', browser: { name: 'Go', focusOrder: 2, focusOrderSource: 'dom-sequential-estimate', contrast: { status: 'unavailable' } } } }),
      node({ id: 'unknown', accessibility: { direction: 'ltr', browser: { name: null, focusOrder: null, focusOrderSource: 'dom-sequential-estimate', contrast: { status: 'unavailable' } } } }),
    ]));
    expect(findings.find(item => item.code === 'FOCUS_ORDER' && item.elementIds[0] === 'estimated')?.status).toBe('advisory');
    expect(findings.find(item => item.code === 'FOCUS_ORDER' && item.elementIds[0] === 'unknown')?.status).toBe('unavailable');
  });

  it('retains an advisory DOM focus estimate for a tabbable control hidden from the accessibility tree',()=>{
    const findings=inspectAccessibility(snapshot([node({id:'hidden-tabbable',accessibility:{direction:'ltr',hidden:true,browser:{name:null,focusOrder:1,focusOrderSource:'dom-sequential-estimate',contrast:{status:'unavailable'}}}})]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({code:'FOCUS_ORDER',status:'advisory',elementIds:['hidden-tabbable']});
  });

  it('reports unavailable, passing, and failing measured text contrast', () => {
    const findings = inspectAccessibility(snapshot([
      node({ id: 'unavailable', kind: 'Text', accessibility: { direction: 'ltr', browser: { name: null, focusOrder: null, focusOrderSource: 'dom-sequential-estimate', contrast: { status: 'unavailable', reason: 'Background is translucent' } } } }),
      node({ id: 'pass', kind: 'Text', accessibility: { direction: 'ltr', browser: { name: null, focusOrder: null, focusOrderSource: 'dom-sequential-estimate', contrast: { status: 'measured', ratio: 4.5, requiredRatio: 4.5 } } } }),
      node({ id: 'fail', kind: 'Text', accessibility: { direction: 'ltr', browser: { name: null, focusOrder: null, focusOrderSource: 'dom-sequential-estimate', contrast: { status: 'measured', ratio: 3, requiredRatio: 4.5 } } } }),
    ]));
    expect(findings.filter(item => item.code === 'TEXT_CONTRAST').map(item => [item.elementIds[0], item.status])).toEqual([['unavailable', 'unavailable'], ['pass', 'pass'], ['fail', 'fail']]);
  });

  it('keeps RTL physical-spacing and unknown direction findings advisory or unavailable', () => {
    const findings = inspectAccessibility(snapshot([
      node({ id: 'rtl', styles: { marginLeft: 8 }, accessibility: { direction: 'rtl' } }),
      node({ id: 'unknown', kind: 'View', accessibility: { direction: 'unknown' } }),
    ]));
    expect(findings.find(item => item.code === 'RTL_PHYSICAL_SPACING')?.status).toBe('advisory');
    expect(inspectAccessibility(snapshot([node({ id: 'direction-unknown', kind: 'View', accessibility: { direction: 'unknown' } })]))
      .find(item => item.code === 'RTL_EVIDENCE')?.status).toBe('unavailable');
  });
});
