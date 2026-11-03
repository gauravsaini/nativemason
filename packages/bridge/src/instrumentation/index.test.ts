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
});

it('excludes virtual Metro polyfills from module imports and revision registration',()=>{const result=transformSync('global.answer = 42;', {filename:'/project/\0polyfill:external-require',configFile:false,babelrc:false,plugins:[[plugin,{projectRoot:'/project',autoInstrument:true,nativewind:true}]]})!.code!;expect(result).not.toContain('@nativemason/runtime');expect(result).not.toContain('registerSourceRevision');});
