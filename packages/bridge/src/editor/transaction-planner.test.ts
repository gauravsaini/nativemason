import { describe, expect, it } from 'vitest';
import { Project, Node } from 'ts-morph';
import type { SourceFile, SourceMutation, SourceRef } from '@nativemason/contracts';
import { hashSource, planTransaction } from './index.js';

function file(path: string, text: string): SourceFile { return { path, text, hash: hashSource(text) }; }
function ref(path: string, text: string, index = 0): SourceRef {
  const project = new Project({ useInMemoryFileSystem: true });
  const source = project.createSourceFile('/' + path, text);
  const node = source.getDescendants().filter(n => Node.isJsxElement(n) || Node.isJsxSelfClosingElement(n))[index];
  const pos = source.getLineAndColumnAtPos(node.getStart());
  return { path, hash: hashSource(text), start: node.getStart(), end: node.getEnd(), line: pos.line, column: pos.column - 1 };
}

describe('transaction planning', () => {
  it.each(['const escaped = styles.footer;', 'const alias = styles.footer; const B=()=> <View style={alias}/>;'])('rejects shared initializer escapes: %s', escape => {
    const text = 'import { StyleSheet } from "react-native"; const styles=StyleSheet.create({footer:{gap:4}}); '+escape+' const A=()=> <View style={styles.footer}/>;';
    const result=planTransaction([file('Screen.tsx',text)],[{source:ref('Screen.tsx',text,escape.includes('<View')?1:0),patch:{gap:8},scope:{kind:'shared'}}]);
    expect(result).toMatchObject({ok:false,error:{code:'UNSUPPORTED_EDIT'}});
  });
  it('coalesces compatible edits in one file and rejects stale source hashes', () => {
    const text = 'const A=()=> <View style={{gap:4}}/>; const B=()=> <View style={{height:20}}/>;';
    const mutations: SourceMutation[] = [
      { source: ref('Screen.tsx', text, 0), patch: { gap: 8 } },
      { source: ref('Screen.tsx', text, 1), patch: { height: 24 } },
    ];
    const result = planTransaction([file('Screen.tsx', text)], mutations);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.files).toHaveLength(1);
      expect(result.value.files[0].updatedText).toContain('gap: 8');
      expect(result.value.files[0].updatedText).toContain('height: 24');
    }
    const stale = planTransaction([file('Screen.tsx', text + '\n')], mutations);
    expect(stale).toMatchObject({ ok: false, error: { code: 'STALE_SOURCE' } });
  });

  it('rejects conflicting values for the same source and property', () => {
    const text = 'const A=()=> <View style={{gap:4}}/>;';
    const source = ref('Screen.tsx', text);
    const result = planTransaction([file('Screen.tsx', text)], [
      { source, patch: { gap: 8 } }, { source, patch: { gap: 12 } },
    ]);
    expect(result).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_EDIT', message: 'Conflicting values target the same style property' } });
  });

  it('reports all statically resolved shared-style consumers and edits the definition once', () => {
    const text = 'import { StyleSheet } from "react-native"; const styles=StyleSheet.create({ footer: { gap: 4 } }); const A=()=> <View style={styles.footer}/>; const B=()=> <View style={styles.footer}/>;';
    const result = planTransaction([file('Screen.tsx', text)], [
      { source: ref('Screen.tsx', text, 0), patch: { gap: 10 }, scope: { kind: 'shared', acknowledgeInstances: true } },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.files.map(f => f.source.path)).toEqual(['Screen.tsx']);
      expect(result.value.files[0].updatedText).toContain('gap: 10');
      expect(result.value.blastRadius.consumers).toHaveLength(2);
      expect(result.value.blastRadius.consumers.map(c => c.source.path)).toEqual(['Screen.tsx', 'Screen.tsx']);
    }
  });

  it('rejects shared styles whose references escape JSX consumers', () => {
    const text = 'import { StyleSheet } from "react-native"; const styles=StyleSheet.create({footer:{gap:4}}); doSomething(styles.footer); const A=()=> <View style={styles.footer}/>;';
    const result = planTransaction([file('Screen.tsx', text)], [
      { source: ref('Screen.tsx', text), patch: { gap: 10 }, scope: { kind: 'shared', acknowledgeInstances: true } },
    ]);
    expect(result).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_EDIT', message: 'Shared definition has unresolved or escaping consumers' } });
  });
});
