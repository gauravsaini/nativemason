import { transformSync } from '@babel/core';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import plugin from './index.js';
const code = `import { LayoutView as Box } from '@rn-layout/runtime';\nexport const Screen=()=> <Box layoutId="root" style={{gap:4}} />;`;
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
    expect(transform(code.replace('@rn-layout/runtime', 'another-package'))).not.toContain('__bridgeSource');
  });
  it('skips spread targets and rejects spoofed metadata', () => {
    expect(transform(code.replace('layoutId="root"', '{...props}'))).not.toContain('__bridgeSource');
    expect(() => transform(code.replace('layoutId="root"', '__bridgeSource={{}}'))).toThrow('reserved');
  });
});
