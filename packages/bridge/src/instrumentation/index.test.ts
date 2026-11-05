import {mkdtempSync,writeFileSync,rmSync,symlinkSync,realpathSync,mkdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { transformSync } from '@babel/core';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import plugin from './index.js';
const code = `import { LayoutView as Box } from '@nativemason/runtime';\nexport const Screen=()=> <Box layoutId="root" style={{gap:4}} />;`;
function transform(source = code, envName = 'development') {
  return transformSync(source, { filename: '/project/App.tsx', envName, configFile: false, babelrc: false, parserOpts: { plugins: ['jsx', 'typescript'] }, plugins: [[plugin, { projectRoot: '/project' }]] })!.code!;
}
describe('source instrumentation', () => {
  it('stamps original source hash and full JSX range including aliased imports', () => {
    const result = transform();
    expect(result).toContain('__bridgeSource'); expect(result).toContain(createHash('sha256').update(code).digest('hex'));
    expect(result).toContain(`start: ${code.indexOf('<Box')}`); expect(result).toContain(`end: ${code.indexOf('/>') + 2}`);
    expect(result).toContain('path: "App.tsx"');
  });
  it('does not stamp production builds or similarly named unrelated components', () => {
    expect(transform(code, 'production')).not.toContain('__bridgeSource');
    expect(transform(code.replace('@nativemason/runtime', 'another-package'))).not.toContain('__bridgeSource');
  });
  it('skips spread targets and rejects spoofed metadata', () => {
    expect(transform(code.replace('layoutId="root"', '{...props}'))).toContain('__bridgeSource');
    expect(() => transform(code.replace('layoutId="root"', '__bridgeSource={{}}'))).toThrow('reserved');
  });
  it('automatically instruments React Native hosts with deterministic file-local IDs', () => {
    const source = `import { View, Text as Label } from 'react-native';\nexport const Screen=()=> <View><Label>Hi</Label><View /></View>;`;
    const result = transformSync(source, { filename: '/project/Screen.tsx', envName: 'development', configFile: false, babelrc: false, parserOpts: { plugins: ['jsx', 'typescript'] }, plugins: [[plugin, { projectRoot: '/project', autoInstrument: true }]] })!.code!;
    expect(result).toContain('LayoutView as _NativeMasonView');
    expect(result).toContain('LayoutText as _NativeMasonText');
    expect(result.match(/__bridgeId="Screen\.tsx#\d+"/g)).toHaveLength(3);
    expect(transformSync(source, { filename: '/project/Screen.tsx', envName: 'production', configFile: false, babelrc: false, parserOpts: { plugins: ['jsx', 'typescript'] }, plugins: [[plugin, { projectRoot: '/project', autoInstrument: true }]] })!.code).not.toContain('__bridgeId');
  });
  it('marks only statically proven inline Pressable state callbacks',()=>{
    const supported="import {LayoutPressable} from '@nativemason/runtime';export const A=()=> <LayoutPressable style={({pressed})=>pressed?{opacity:0.5}:{opacity:1}}/>;";
    const unsupported="import {LayoutPressable} from '@nativemason/runtime';const style=({pressed})=>({opacity:pressed?0.5:1});export const A=()=> <LayoutPressable style={style}/>;";
    expect(transform(supported)).toContain('styleForm: "pressable-state"');
    expect(transform(unsupported)).not.toContain('styleForm');
    expect(transform(supported,'production')).not.toContain('__bridgeSource');
  });
});

it('excludes virtual Metro polyfills from module imports and revision registration',()=>{const result=transformSync('global.answer = 42;', {filename:'/project/\0polyfill:external-require',configFile:false,babelrc:false,plugins:[[plugin,{projectRoot:'/project',autoInstrument:true,nativewind:true}]]})!.code!;expect(result).not.toContain('@nativemason/runtime');expect(result).not.toContain('registerSourceRevision');});

it('keeps host identity when Expo web optimization rewrites RN imports',()=>{const result=transformSync("import {View,Text} from 'react-native';export default function App(){return <View testID='screen'><Text>Hi</Text></View>}",{filename:'/project/App.tsx',envName:'development',configFile:false,babelrc:false,caller:{name:'metro',...{platform:'web'},supportsStaticESM:false},presets:['babel-preset-expo'],plugins:[[plugin,{projectRoot:'/project',autoInstrument:true}]]})!.code!;expect(result).toContain('__bridgeSource');expect(result).toContain('LayoutView');expect(result).toContain('LayoutText');});
it('tracks local style/token dependencies without unrelated component imports',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'nm-style-deps-'));
 try{
  writeFileSync(path.join(root,'tokens.ts'),'export const spacing={small:8};');
  writeFileSync(path.join(root,'theme.ts'),"import {spacing} from './tokens';export const styles={box:{gap:spacing.small}};");
  writeFileSync(path.join(root,'Other.tsx'),'export default function Other(){return null;}');
  const source="import {View} from 'react-native';import {styles} from './theme';import Other from './Other';export default ()=> <View style={styles.box}/>;";
  writeFileSync(path.join(root,'App.tsx'),source);
  const result=transformSync(source,{filename:path.join(root,'App.tsx'),envName:'development',configFile:false,babelrc:false,parserOpts:{plugins:['jsx','typescript']},plugins:[[plugin,{projectRoot:root,autoInstrument:true}]]})!.code!;
  expect(result).toContain('dependencies: ["theme.ts", "tokens.ts"]');
  expect(result).not.toContain('dependencies: ["Other.tsx"');
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('disables instrumentation for Metro release callers even without a production envName',()=>{
 const result=transformSync("import {View} from 'react-native';export default ()=> <View/>;",{filename:'/project/App.tsx',envName:'development',configFile:false,babelrc:false,caller:{name:'metro',...{dev:false}},parserOpts:{plugins:['jsx']},plugins:[[plugin,{projectRoot:'/project',autoInstrument:true,rootComponent:'App.tsx'}]]})!.code!;
 expect(result).not.toContain('__bridgeSource');expect(result).not.toContain('registerSourceRevision');expect(result).not.toContain('withLayoutRoot');
});

it('canonicalizes real source and project paths across symlink aliases',()=>{const root=mkdtempSync(path.join(os.tmpdir(),'nm-alias-'));try{const actual=path.join(root,'actual'),alias=path.join(root,'alias');mkdirSync(actual);symlinkSync(actual,alias,'dir');const source="import {View} from 'react-native';export default ()=> <View/>;";writeFileSync(path.join(actual,'App.tsx'),source);const result=transformSync(source,{filename:realpathSync(path.join(actual,'App.tsx')),envName:'development',configFile:false,babelrc:false,parserOpts:{plugins:['jsx']},plugins:[[plugin,{projectRoot:alias,autoInstrument:true}]]})!.code!;expect(result).toContain('__bridgeSource');expect(result).toContain('path: "App.tsx"');}finally{rmSync(root,{recursive:true,force:true});}});

it('wraps roots before Expo React Refresh collects its registration bindings',()=>{
 const result=transformSync("import {View} from 'react-native';export default function App(){return <View testID='root'/>;}",{filename:'/project/App.tsx',envName:'development',configFile:false,babelrc:false,caller:{name:'metro',...{platform:'android',dev:true,isDev:true,isHMREnabled:true}},presets:['babel-preset-expo'],plugins:[[plugin,{projectRoot:'/project',autoInstrument:true,rootComponent:'App.tsx'}]]})!;
 expect(result.code).toContain('withLayoutRoot');
 // Every Refresh assignment must have a declaration in this module.
 const declared=new Set<string>(),assigned=new Set<string>();
 const visit=(value:unknown)=>{if(!value||typeof value!=='object')return;const node=value as {type?:string;id?:{name?:string};left?:{name?:string}};if(node.type==='VariableDeclarator'&&node.id?.name)declared.add(node.id.name);if(node.type==='AssignmentExpression'&&node.left?.name?.match(/^_c\d*$/))assigned.add(node.left.name);for(const [key,child] of Object.entries(value))if(key!=='loc'&&key!=='extra'){if(Array.isArray(child))child.forEach(visit);else visit(child);}};
 const ast=transformSync(result.code!,{configFile:false,babelrc:false,ast:true})!.ast;visit(ast);
 expect(assigned.size).toBeGreaterThan(0);for(const binding of assigned)expect(declared.has(binding),binding).toBe(true);
});
