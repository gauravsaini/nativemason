import { describe, expect, it } from 'vitest';
import { Project, Node } from 'ts-morph';
import { type SourceRef, type RnStylePatch } from '@nativemason/contracts';
import { hashSource, planSourcePatch } from './planner.js';

function reference(text: string, index = 0): SourceRef {
  const p = new Project({ useInMemoryFileSystem: true });
  const file = p.createSourceFile('/source.tsx', text);
  const node = file.getDescendants().filter(n => Node.isJsxElement(n) || Node.isJsxSelfClosingElement(n))[index];
  const loc = file.getLineAndColumnAtPos(node.getStart());
  return { path: 'Screen.tsx', hash: hashSource(text), start: node.getStart(), end: node.getEnd(), line: loc.line, column: loc.column - 1 };
}
function patched(text: string, patch: RnStylePatch = { flexDirection: 'row' }): string {
  const result = planSourcePatch(text, reference(text), patch);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  expect(result.value.diff).toContain('Screen.tsx');
  return result.value.updatedText;
}
function rejected(text: string, message?: RegExp): void {
  const result = planSourcePatch(text, reference(text), { flexDirection: 'row' });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('UNSUPPORTED_EDIT');
    if (message) expect(result.error.message).toMatch(message);
  }
}

describe('source patch planning', () => {
  it('changes only literal value text, preserving comments and UTF-16 locations', () => {
    const text = '// emoji 😀\nexport const Screen = () => <LayoutView style={{ /* keep */ flexDirection: "column", gap: 8 }} />;\n';
    expect(patched(text)).toBe(text.replace('"column"', '"row"'));
  });
  it('adds supported properties deterministically and preserves other properties', () => {
    const text = 'const Screen = () => <LayoutView style={{ height: 40 }} />;';
    expect(patched(text, { gap: 12, flexDirection: 'row' })).toBe("const Screen = () => <LayoutView style={{ height: 40 , flexDirection: 'row', gap: 12 }} />;");
  });
  it('adds a style to JSX with no style prop', () => {
    expect(patched('const Screen = () => <LayoutView layoutId="footer" />;')).toBe("const Screen = () => <LayoutView style={{ flexDirection: 'row' }} layoutId=\"footer\" />;");
  });
  it('handles trailing commas and trailing comments without invalid syntax', () => {
    const text = 'const Screen = () => <LayoutView style={{ height: 40, /* keep */ }} />;';
    expect(patched(text)).toBe("const Screen = () => <LayoutView style={{ height: 40, /* keep */  flexDirection: 'row' }} />;");
  });
  it('preserves line comments after a trailing comma', () => {
    const text = 'const Screen = () => <LayoutView style={{ height: 40, // keep\n }} />;';
    expect(patched(text)).toBe("const Screen = () => <LayoutView style={{ height: 40, // keep\n  flexDirection: 'row' }} />;");
  });
  it('recognizes trailing commas after comments and whitespace', () => {
    const text = 'const Screen = () => <LayoutView style={{ height: 40 /* keep */  , }} />;';
    expect(patched(text)).toBe("const Screen = () => <LayoutView style={{ height: 40 /* keep */  ,  flexDirection: 'row' }} />;");
  });
  it('handles long alternating block comment delimiters in trailing trivia', () => {
    const comments = '*//*'.repeat(128);
    const text = `const Screen = () => <LayoutView style={{ height: 40, /*${comments}*/ }} />;`;
    expect(patched(text)).toBe(`const Screen = () => <LayoutView style={{ height: 40, /*${comments}*/  flexDirection: 'row' }} />;`);
  });
  it('edits local uniquely used StyleSheet entry with an aliased import', () => {
    const text = 'import { StyleSheet as SS } from "react-native";\nconst styles = SS.create({ footer: { flexDirection: "column", height: 48 }, other: { gap: 4 } });\nconst Screen = () => <LayoutView style={styles.footer} />;';
    expect(patched(text)).toBe(text.replace('"column"', '"row"'));
  });
  it('allows other entries from the same stylesheet without considering them shared', () => {
    const text = 'import { StyleSheet } from "react-native"; const styles=StyleSheet.create({footer:{flexDirection:"column"},other:{gap:2}}); const Other=()=> <View style={styles.other}/>; const Screen=()=> <LayoutView style={styles.footer}/>;';
    const result = planSourcePatch(text, reference(text, 1), { flexDirection: 'row' });
    expect(result.ok).toBe(true);
  });
  it('rejects a shared StyleSheet entry', () => {
    rejected('import { StyleSheet } from "react-native"; const styles=StyleSheet.create({footer:{flexDirection:"column"}}); const A=()=> <LayoutView style={styles.footer}/>; const B=()=> <View style={styles.footer}/>;', /Shared/);
  });
  it('rejects StyleSheet spreads, computed names and duplicate entries', () => {
    for (const entries of ['footer:{height:4}, ...other', 'footer:{height:4}, [key]:{}', 'footer:{height:4}, footer:{height:8}']) {
      rejected('import {StyleSheet} from "react-native"; const styles=StyleSheet.create({'+entries+'}); const Screen=()=> <LayoutView style={styles.footer}/>;');
    }
  });
  it('rejects stylesheet escapes and imported styles', () => {
    rejected('import { StyleSheet } from "react-native"; const styles=StyleSheet.create({footer:{height:4}}); doSomething(styles); const A=()=> <LayoutView style={styles.footer}/>;', /escapes/);
    rejected('import { styles } from "./styles"; const A=()=> <LayoutView style={styles.footer}/>;', /Imported/);
  });
  it.each([
    '<LayoutView style={[styles.footer]} />',
    '<LayoutView style={condition ? styles.a : styles.b} />',
    '<LayoutView style={() => ({ gap: 2 })} />',
    '<LayoutView style={{ ...base, gap: 2 }} />',
    '<LayoutView style={{ gap: spacing }} />',
    '<LayoutView style={{ [key]: 2 }} />',
    '<LayoutView style={{ gap: 2, gap: 3 }} />',
    '<LayoutView {...props} style={{ gap: 2 }} />',
    '<LayoutView style={{ gap: 2 }} style={{ gap: 3 }} />',
  ])('rejects dynamic or ambiguous styles: %s', jsx => rejected(`const Screen=()=> ${jsx};`));
  it('rejects JSX inside a render callback and loop', () => {
    rejected('const Screen=()=> items.map(item => <LayoutView style={{height:4}} />);', /callback/);
    rejected('function Screen(){for(const item of items){const x=<LayoutView style={{height:4}}/>;}return null;}', /Repeated/);
  });
  it('rejects foreign StyleSheet factories', () => {
    rejected('import { StyleSheet } from "other"; const styles=StyleSheet.create({footer:{height:4}}); const Screen=()=> <LayoutView style={styles.footer}/>;', /react-native/);
  });
  it('requires exact content hash, JSX range and location', () => {
    const text = 'const Screen=()=> <LayoutView style={{gap:4}} />;';
    const source=reference(text);
    for (const stale of [{...source,hash:'0'.repeat(64)},{...source,start:source.start+1},{...source,line:source.line+1}]) {
      const result=planSourcePatch(text,stale,{gap:8});
      expect(result.ok).toBe(false);
      if(!result.ok) expect(result.error.code).toBe('STALE_SOURCE');
    }
  });
  it('rejects unknown style mutations at the boundary', () => {
    const text='const Screen=()=> <LayoutView />;';
    const result=planSourcePatch(text,reference(text),{transform:[]} as unknown as RnStylePatch);
    expect(result).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
  });
  it('does not mutate its inputs or consult project files', () => {
    const text='const Screen=()=> <LayoutView style={{gap:4}} />;';
    const source=Object.freeze(reference(text));
    const patch=Object.freeze({gap:8});
    const first=planSourcePatch(text,source,patch);
    expect(planSourcePatch(text,source,patch)).toEqual(first);
  });
});


describe('local literal folding and quote style',()=>{
  function local(text:string,patch:RnStylePatch={gap:12},scope:{kind:'local'}|{kind:'branch';branch:'consequent'|'alternate'}={kind:'local'}){
    const result=planSourcePatch(text,reference(text),patch,scope);if(!result.ok)throw Error(result.error.message);return result.value.updatedText;
  }
  it('updates inline literals and the final literal array entry without extra wrappers',()=>{
    const text="const A=()=> <LayoutView style={[getStyle(), { gap: 4 }]} />;";
    const once=local(text);expect(once).toBe(text.replace('gap: 4','gap: 12'));
    expect(local(once,{gap:16})).toBe(text.replace('gap: 4','gap: 16'));
    const inline="const A=()=> <LayoutView style={{gap:4}}/>;";expect(local(inline)).toBe(inline.replace('gap:4','gap:12'));
  });
  it('keeps a final override when a later expression can override the earlier literal',()=>{
    const text="const A=()=> <LayoutView style={[{gap:4}, getStyle()]} />;";
    expect(local(text)).toContain('style={[[{gap:4}, getStyle()], { gap: 12 }]}');
  });
  it('folds only the explicitly selected conditional arm',()=>{
    const text="const A=()=> <LayoutView style={active ? {gap:4} : {gap:8}}/>;";
    expect(local(text,{gap:12},{kind:'branch',branch:'alternate'})).toBe(text.replace('{gap:8}','{gap:12}'));
  });
  it('preserves existing value quotes and adopts JavaScript quotes for additions',()=>{
    const single=`import {View} from 'react-native';const A=()=> <View testID="box" style={{gap:4}}/>;`;
    const double='import {View} from "react-native";const A=()=> <View style={{gap:4}}/>;';
    expect(local(single,{flexDirection:'row'})).toContain("flexDirection: 'row'");
    expect(local(double,{flexDirection:'row'})).toContain('flexDirection: "row"');
    const family="const A=()=> <LayoutView style={{fontFamily:'Old'}}/>;";
    expect(local(family,{fontFamily:"Someone's Sans"})).toContain(String.raw`fontFamily:'Someone\'s Sans'`);
  });
  it('folds a unique local StyleSheet entry but keeps shared and dynamic definitions intact',()=>{
    const prefix="import {StyleSheet} from 'react-native';const styles=StyleSheet.create({box:{gap:4}});";
    const unique=prefix+"const A=()=> <LayoutView style={styles.box}/>;";
    expect(local(unique)).toBe(unique.replace('gap:4','gap:12'));
    const shared=unique+"const B=()=> <LayoutView style={styles.box}/>;";
    expect(local(shared)).toContain('box:{gap:4}');expect(local(shared)).toContain('style={[styles.box, { gap: 12 }]}');
    const dynamic="const A=()=> <LayoutView style={{gap:compute()}}/>;";
    expect(local(dynamic)).toContain('style={[{gap:compute()}, { gap: 12 }]}');
  });
});
