import { describe, expect, it } from 'vitest';
import { BridgeFault, type DesignIntent } from '@nativemason/contracts';
import { importDesignIntent } from './design-intent.js';

const profile = {
  window: { width: 200, height: 120 }, pixelRatio: 2, fontScale: 1,
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
  root: { x: 0, y: 0, width: 100, height: 60 }, orientation: 'landscape' as const,
};
const hash = 'a'.repeat(64);
const reference = (overrides: Partial<DesignIntent> = {}): DesignIntent => ({
  kind: 'reference-annotations', scenarioId: 'screen', profile,
  image: { sha256: hash, width: 400, height: 300 },
  appRootPixels: { x: 40, y: 30, width: 200, height: 120 }, pixelsPerLogicalUnit: 2,
  annotations: [{ elementId: 'card', rectPixels: { x: 60, y: 50, width: 100, height: 40 } }],
  ...overrides,
} as DesignIntent);

const figma = (overrides: Record<string, unknown> = {}) => ({
  kind: 'figma-auto-layout' as const, scenarioId: 'screen', profile,
  frame: { id: 'frame', type: 'FRAME', absoluteBoundingBox: { x: 10, y: 20, width: 100, height: 60 },
    layoutMode: 'HORIZONTAL' as const, itemSpacing: 4, children: [
      { id: 'a', type: 'FRAME', absoluteBoundingBox: { x: 10, y: 20, width: 20, height: 20 } },
      { id: 'unknown', type: 'FRAME', absoluteBoundingBox: { x: 34, y: 20, width: 10, height: 20 } },
      { id: 'b', type: 'FRAME', absoluteBoundingBox: { x: 48, y: 20, width: 20, height: 20 } },
    ] }, elementMap: { a: 'first', b: 'second' }, logicalUnitsPerDesignUnit: 1,
    ...overrides,
});

describe('importDesignIntent', () => {
  it('normalizes annotation pixels from the app-root crop and scale', () => {
    const result = importDesignIntent(reference());
    expect(result.reviewRequired).toBe(true);
    expect(result.source).toBe('reference-annotations');
    expect(result.spec.constraints[0]).toMatchObject({ type: 'rect', elementId: 'card', target: { x: 10, y: 10, width: 50, height: 20 } });
    expect(result.spec.requiredElementIds).toEqual(['card']);
  });

  it('requires a mapped pair to be directly adjacent in the Figma child sequence', () => {
    const result = importDesignIntent(figma());
    expect(result.spec.constraints.filter(rule => rule.type === 'gap')).toEqual([]);
    expect(result.spec.constraints.filter(rule => rule.type === 'rect')).toHaveLength(2);
  });

  it('rejects duplicate element IDs, duplicate and malformed Figma node IDs, and missing mapped nodes', () => {
    expect(() => importDesignIntent(figma({ elementMap: { a: 'same', b: 'same' } } as any))).toThrow(BridgeFault);
    expect(() => importDesignIntent(figma({ frame: { ...figma().frame, children: [figma().frame.children[0], figma().frame.children[0]] } } as any))).toThrow(/Duplicate Figma node ID/);
    expect(() => importDesignIntent(figma({ frame: { ...figma().frame, children: [{ type: 'FRAME' }] } } as any))).toThrow(/Malformed Figma node/);
    expect(() => importDesignIntent(figma({ elementMap: { absent: 'missing' } } as any))).toThrow(/missing or has no bounds/);
  });

  it('rejects unsafe reference scales and crops', () => {
    expect(() => importDesignIntent(reference({ pixelsPerLogicalUnit: 0 } as Partial<DesignIntent>))).toThrow(BridgeFault);
    expect(() => importDesignIntent(reference({ appRootPixels: { x: 250, y: 0, width: 200, height: 120 } } as Partial<DesignIntent>))).toThrow(/crop must fit/);
    expect(() => importDesignIntent(reference({ pixelsPerLogicalUnit: 3 } as Partial<DesignIntent>))).toThrow(/scale disagree/);
  });

  it('does not mutate the input and preserves assertions while keeping review required', () => {
    const input = reference({ assertions: [{ id: 'assert:inside', type: 'insideSafeArea', elementId: 'other' }] } as Partial<DesignIntent>);
    const before = structuredClone(input);
    const result = importDesignIntent(input);
    expect(input).toEqual(before);
    expect(result.reviewRequired).toBe(true);
    expect(result.spec.constraints.at(-1)).toMatchObject(before.assertions?.[0] ?? {});
    expect(result.spec.requiredElementIds).toContain('other');
  });
});
