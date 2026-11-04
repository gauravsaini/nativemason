import { describe, expect, it } from 'vitest';
import { LayoutRegistry, toSpatialNodes, type Registration } from './index.js';
const profile = { window: { width: 412, height: 915 }, pixelRatio: 2.625, fontScale: 1, insets: { top: 24, right: 0, bottom: 24, left: 0 }, root: { x: 0, y: 0, width: 412, height: 915 }, orientation: 'portrait' as const };
const source = { path: 'App.tsx', hash: 'a'.repeat(64), start: 10, end: 30, line: 1, column: 10 };
function entry(id = 'footer'): Registration { return { id, parentId: null, kind: 'View', role: null, styles: { flexDirection: 'column' }, source, dynamicStyle: false, host: {} }; }
describe('LayoutRegistry', () => {
  it('reuses a unique generated source identity after its host unmounts',()=>{
    const registry=new LayoutRegistry('footer',profile,'screen');
    const id=registry.claimAutoId('App.tsx#1','instance-a');
    const host={};registry.register({...entry(id),host,autoIdBase:'App.tsx#1',autoIdInstance:'instance-a'});
    registry.unregister(id,host);
    expect(registry.claimAutoId('App.tsx#1','instance-b')).toBe('App.tsx#1');
  });
  it('keeps measurement evidence separate from authored baseline identity',()=>{
    const registry=new LayoutRegistry('footer',profile,'screen');
    const first={...entry(),authoredSignature:'copy',measurementSignature:'before'};
    registry.register(first);const generation=registry.generation;
    registry.updateTextMetrics(first.id,2);registry.updateTextFit(first.id,{status:'unavailable'});
    registry.register({...first,measurementSignature:'trial'});
    expect(registry.generation).toBe(generation);
    registry.register({...first,authoredSignature:'changed copy'});
    expect(registry.generation).toBe(generation+1);
  });
  it('rejects duplicate mounted IDs, permits metadata refresh and increments generation for source changes', () => {
    const registry = new LayoutRegistry('footer', profile, 'screen');
    const first = entry(); registry.register(first); const generation = registry.generation;
    registry.register({ ...first }); expect(registry.generation).toBe(generation);
    expect(() => registry.register(entry())).toThrow('Duplicate layoutId');
    registry.register({ ...first, source: { ...source, hash: 'b'.repeat(64) } }); expect(registry.generation).toBe(generation + 1);
  });
  it('replaces overrides without invalidating baseline identity or mutating base styles', () => {
    const registry = new LayoutRegistry('footer', profile, 'screen'); registry.register(entry()); registry.register(entry('other'));
    const generation = registry.generation;
    registry.setTrial('footer', { flexDirection: 'row' }); registry.setTrial('other', { gap: 4 });
    expect(registry.overrides.has('footer')).toBe(false); registry.resetTrial();
    expect(registry.generation).toBe(generation); expect(registry.entries.get('footer')?.styles).toEqual({ flexDirection: 'column' });
  });
  it('replaces a batch atomically and an empty batch resets every override', () => {
    const registry = new LayoutRegistry('footer', profile, 'screen'); registry.register(entry()); registry.register(entry('other'));
    registry.setTrialBatch([{ elementId: 'footer', patch: { width: 20 } }, { elementId: 'other', patch: { height: 30 } }]);
    expect([...registry.overrides]).toEqual([['footer', { width: 20 }], ['other', { height: 30 }]]);
    registry.setTrialBatch([{ elementId: 'other', patch: { height: 40 } }]);
    expect([...registry.overrides]).toEqual([['other', { height: 40 }]]);
    registry.setTrialBatch([]);
    expect(registry.overrides.size).toBe(0);
  });
  it('prefers explicit per-node direction over global I18nManager evidence',()=>{
    const registry=new LayoutRegistry('footer',profile,'screen');
    registry.register({...entry('global'),accessibility:{direction:'rtl',directionSource:'native-global'}});
    registry.register({...entry('explicit'),styles:{direction:'ltr'},accessibility:{direction:'rtl',directionSource:'native-global'}});
    const nodes=toSpatialNodes(registry,new Map([['global',{x:0,y:0,width:20,height:20}],['explicit',{x:0,y:20,width:20,height:20}]]));
    expect(nodes.find(node=>node.id==='global')?.accessibility).toMatchObject({direction:'rtl',directionSource:'native-global'});
    expect(nodes.find(node=>node.id==='explicit')?.accessibility).toMatchObject({direction:'ltr',directionSource:'authored'});
  });
  it('rejects mismatched scenarios and reports repeated source sites as uneditable', () => {
    const registry = new LayoutRegistry('footer', profile, 'screen');
    expect(() => registry.configure({ sessionId: 's', scenarioId: 'other', profile })).toThrow('Scenario mismatch');
    registry.register(entry('one')); registry.register(entry('two'));
    const nodes = toSpatialNodes(registry, new Map([['one', { x: 0, y: 0, width: 20, height: 20 }], ['two', { x: 0, y: 30, width: 20, height: 20 }]]));
    expect(nodes.every(node => !node.editable)).toBe(true);
  });
  it('does not unregister a newer host when an old ref cleanup arrives', () => {
    const registry = new LayoutRegistry('footer', profile, 'screen'); const old = entry(); registry.register(old); registry.unregister(old.id, old.host);
    const newer = entry(); registry.register(newer); registry.unregister(old.id, old.host);
    expect(registry.entries.size).toBe(1);
  });
});
