import { describe, expect, it } from 'vitest';
import { Node, Project } from 'ts-morph';
import type { EditScope, RnStylePatch, SourceRef } from '@nativemason/contracts';
import { hashSource, planSourcePatch } from './planner.js';

function reference(text: string, index = 0): SourceRef {
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true, compilerOptions: { jsx: 4, noResolve: true, noLib: true } });
  const file = project.createSourceFile('/source.tsx', text);
  const node = file.getDescendants().filter(n => Node.isJsxElement(n) || Node.isJsxSelfClosingElement(n))[index];
  const location = file.getLineAndColumnAtPos(node.getStart());
  return { path: 'Screen.tsx', hash: hashSource(text), start: node.getStart(), end: node.getEnd(), line: location.line, column: location.column - 1 };
}

function plan(text: string, patch: RnStylePatch, scope: EditScope, index = 0) {
  return planSourcePatch(text, reference(text, index), patch, scope);
}

function updated(text: string, patch: RnStylePatch, scope: EditScope): string {
  const result = plan(text, patch, scope);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.updatedText;
}

function expectRejected(text: string, scope: EditScope, message?: RegExp, patch: RnStylePatch = { gap: 12 }): void {
  const result = plan(text, patch, scope);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('UNSUPPORTED_EDIT');
    if (message) expect(result.error.message).toMatch(message);
  }
}

describe('Pressable state style edits', () => {
  it.each([
    ['import { Pressable as P } from "react-native";', 'P'],
    ['import * as RN from "react-native";', 'RN.Pressable'],
    ['import { LayoutPressable as LP } from "@nativemason/runtime";', 'LP'],
    ['import * as Runtime from "@nativemason/runtime";', 'Runtime.LayoutPressable'],
  ])('edits only the selected arm of imported %s', (declaration, component) => {
    const text = `${declaration}\nconst A=()=> <${component} testID='keep' style={({pressed}) => pressed ? { gap: 4, color: 'red' } : { gap: 8, color: 'blue' }} />;`;
    const expected = text.replace("{ gap: 4, color: 'red' }", "{ gap: 12, color: 'red' }");
    expect(updated(text, { gap: 12 }, { kind: 'pressable-state', state: 'pressed' })).toBe(expected);
    const restExpected = text.replace("{ gap: 8, color: 'blue' }", "{ gap: 12, color: 'blue' }");
    expect(updated(text, { gap: 12 }, { kind: 'pressable-state', state: 'rest' })).toBe(restExpected);
  });

  it('maps negated pressed and concise or single-return callbacks to the right arm', () => {
    const negated = 'import {Pressable} from "react-native";const A=()=> <Pressable style={({pressed}) => !pressed ? {gap:4} : {gap:8}}/>;';
    expect(updated(negated, { gap: 12 }, { kind: 'pressable-state', state: 'rest' })).toBe(negated.replace('{gap:4}', '{gap:12}'));
    expect(updated(negated, { gap: 12 }, { kind: 'pressable-state', state: 'pressed' })).toBe(negated.replace('{gap:8}', '{gap:12}'));
    const block = "import {Pressable} from 'react-native';const A=()=> <Pressable style={({pressed}) => { return pressed ? {gap:4} : {gap:8}; }}/>;";
    expect(updated(block, { gap: 12 }, { kind: 'pressable-state', state: 'pressed' })).toBe(block.replace('{gap:4}', '{gap:12}'));
  });

  it('keeps the selected arm in place and preserves its JavaScript quote convention', () => {
    const text = "import {Pressable} from 'react-native';const A=()=> <Pressable style={({pressed}) => pressed ? {fontFamily: 'Old'} : {fontFamily: 'Keep'}}/>;";
    expect(updated(text, { fontFamily: 'Avenir Next' }, { kind: 'pressable-state', state: 'pressed' }))
      .toBe(text.replace("fontFamily: 'Old'", "fontFamily: 'Avenir Next'"));
  });

  it.each([
    ['const A=()=> <Pressable style={({pressed})=> pressed ? {gap:4}:{gap:8}}/>;', { kind: 'pressable-state', state: 'pressed' } as EditScope],
    ['import {View} from "react-native";const A=()=> <View style={({pressed})=> pressed ? {gap:4}:{gap:8}}/>;', { kind: 'pressable-state', state: 'pressed' } as EditScope],
    ['import {Pressable} from "react-native";const A=()=> <Pressable style={({pressed})=> other ? {gap:4}:{gap:8}}/>;', { kind: 'pressable-state', state: 'pressed' } as EditScope],
    ['import {Pressable} from "react-native";const A=()=> <Pressable style={({pressed})=> pressed ? {...base,gap:4}:{gap:8}}/>;', { kind: 'pressable-state', state: 'pressed' } as EditScope],
    ['import {Pressable} from "react-native";const A=()=> <Pressable style={({pressed})=> pressed ? {gap:getGap()}:{gap:8}}/>;', { kind: 'pressable-state', state: 'pressed' } as EditScope],
    ['import {Pressable} from "react-native";const A=()=> <Pressable style={async ({pressed})=> pressed ? {gap:4}:{gap:8}}/>;', { kind: 'pressable-state', state: 'pressed' } as EditScope],
    ['import {Pressable} from "react-native";const A=()=> <Pressable style={({pressed = audit()})=> pressed ? {gap:4}:{gap:8}}/>;', { kind: 'pressable-state', state: 'pressed' } as EditScope],
    ['import {Pressable} from "react-native";const A=()=> <Pressable style={({pressed} = audit())=> pressed ? {gap:4}:{gap:8}}/>;', { kind: 'pressable-state', state: 'pressed' } as EditScope],
    ['import {Pressable} from "react-native";const A=()=> <Pressable style={({pressed})=> { audit(); return pressed ? {gap:4}:{gap:8}; }}/>;', { kind: 'pressable-state', state: 'pressed' } as EditScope],
  ])('rejects unsafe or incorrectly targeted state callbacks: %s', (text, scope) => expectRejected(text, scope));

  it('requires state and a JSX element with a supported import', () => {
    const text = 'import {Pressable} from "react-native";const A=()=> <Pressable style={({pressed})=> pressed ? {gap:4}:{gap:8}}/>;';
    expectRejected(text, { kind: 'pressable-state' }, /explicit/);
    expectRejected('import {Pressable} from "other";const A=()=> <Pressable style={({pressed})=> pressed ? {gap:4}:{gap:8}}/>;', { kind: 'pressable-state', state: 'pressed' });
  });
});

describe('NativeWind state style utilities', () => {
  it('writes literal font family names with spaces as safe arbitrary utilities', () => {
    const text = 'const A=()=> <Text className="text-sm font-bold text-red-500" />;';
    expect(updated(text, { fontFamily: 'Avenir Next' }, { kind: 'nativewind' })).toBe('const A=()=> <Text className="text-sm font-bold text-red-500 font-[family-name:Avenir_Next]" />;');
    expect(updated(text, { fontFamily: 'Inter UI' }, { kind: 'nativewind' })).toContain('font-[family-name:Inter_UI]');
    expect(updated(text, { fontFamily: 'Noto_Sans' }, { kind: 'nativewind' })).toContain(String.raw`font-[family-name:Noto\\_Sans]`);
  });

  it('replaces a typed family once, stays idempotent, and preserves unrelated weight utilities', () => {
    const text = 'const A=()=> <Text className="font-[family-name:Inter] font-semibold md:font-bold text-sm" />;';
    const once = updated(text, { fontFamily: 'Open Sans' }, { kind: 'nativewind' });
    expect(once).toBe('const A=()=> <Text className="font-semibold md:font-bold text-sm font-[family-name:Open_Sans]" />;');
    expect(updated(once, { fontFamily: 'Open Sans' }, { kind: 'nativewind' })).toBe(once);
  });

  it('rejects a variant-specific typed family edit without removing its family colon', () => {
    const text = 'const A=()=> <Text className="font-semibold md:font-[family-name:Inter]" />;';
    expectRejected(text, { kind: 'nativewind' }, undefined, { fontFamily: 'Open Sans' });
  });

  it('maps added font weight, logical spacing, aspect ratio and alignSelf utilities', () => {
    const text = 'const A=()=> <View className="p-2 md:gap-4 flex-row" />;';
    expect(updated(text, { fontWeight: '600', paddingStart: 8, marginEnd: 4, aspectRatio: 1.5, alignSelf: 'flex-end' }, { kind: 'nativewind' }))
      .toBe('const A=()=> <View className="p-2 md:gap-4 flex-row aspect-[1.5] ps-[8px] me-[4px] font-semibold self-end" />;');
  });

  it('preserves unrelated classes and variants and replaces only same-property unvarianted classes', () => {
    const text = "const A=()=> <View className={'p-2 hover:text-red-500 text-sm'} />;";
    expect(updated(text, { padding: 6 }, { kind: 'nativewind' })).toBe("const A=()=> <View className='hover:text-red-500 text-sm p-[6px]' />;");
  });

  it.each([
    ['font-[theme(fontFamily.sans)]', { fontFamily: 'Avenir Next' }],
    ['font-[$brandFont]', { fontFamily: 'Avenir Next' }],
    ['font-[var(--brand-font)]', { fontFamily: 'Avenir Next' }],
  ])('rejects conflicting unsupported dynamic font utility %s', (className, patch) => {
    const text = `const A=()=> <Text className="${className}" />;`;
    expectRejected(text, { kind: 'nativewind' }, undefined, patch as RnStylePatch);
  });

  it('rejects dynamic class construction and requires explicit conditional branch selection', () => {
    expectRejected('const A=()=> <View className={`p-${size}`} />;', { kind: 'nativewind' });
    const text = 'const A=()=> <View className={active ? "p-2" : "p-4"} />;';
    const result = plan(text, { padding: 6 }, { kind: 'nativewind' });
    expect(result).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_EDIT' } });
    const consequent = planSourcePatch(text, reference(text), { padding: 6 }, { kind: 'nativewind', branch: 'consequent' });
    expect(consequent.ok && consequent.value.updatedText).toBe(text.replace('"p-2"', '"p-[6px]"'));
  });
});
