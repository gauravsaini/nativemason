import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {BridgeFault} from '@nativemason/contracts';
import {initialize} from './index.js';

const roots:string[]=[];
async function project(files:Record<string,string>={}) {
 const root=await mkdtemp(path.join(os.tmpdir(),'nm-init-'));roots.push(root);
 await writeFile(path.join(root,'package.json'),JSON.stringify({dependencies:{expo:'~54.0.0'}}));
 await writeFile(path.join(root,'App.tsx'),'export default function App() { return null; }');
 for(const [name,value] of Object.entries(files)){await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),value);}
 return root;
}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

describe('initialize',()=>{
 it('is idempotent and preserves existing plugin configuration',async()=>{
  const original="module.exports = api => ({ presets: ['babel-preset-expo'], plugins: ['other-plugin'] });\n";
  const root=await project({'babel.config.js':original});
  const first=await initialize(root);const once=await readFile(path.join(root,'babel.config.js'),'utf8');
  const second=await initialize(root);const twice=await readFile(path.join(root,'babel.config.js'),'utf8');
  expect(first.changed).toBe(true);expect(second.changed).toBe(false);expect(twice).toBe(once);
  expect(once).toContain("'other-plugin'");expect(once).toContain('nativemason/babel');expect(once).not.toContain(root);expect(once).toContain('__dirname');expect(await readFile(path.join(root,'.gitignore'),'utf8')).toContain('/.nativemason/');
 });
 it('dry run reports the exact edit without writing',async()=>{
  const root=await project();const result=await initialize(root,true);
  expect(result.changed).toBe(true);expect(result.before).not.toBe(result.after);
  await expect(readFile(path.join(root,'babel.config.cjs'),'utf8')).rejects.toMatchObject({code:'ENOENT'});
 });
 it('returns a suggested plugin for unsupported computed configuration',async()=>{
  const root=await project({'babel.config.js':"module.exports = () => ({ presets: ['babel-preset-expo'], plugins: getPlugins() });"});
  await expect(initialize(root)).rejects.toMatchObject({code:'UNSUPPORTED_EDIT',details:{suggestedPlugin:['nativemason/babel',expect.objectContaining({autoInstrument:true})]}} satisfies Partial<BridgeFault>);
 });
 it('rejects ambiguous app roots and missing Expo dependency',async()=>{
  const root=await project({'src/App.tsx':'export default function App() { return null; }'});
  await expect(initialize(root)).rejects.toMatchObject({code:'INVALID_INPUT'});
  const noExpo=await project();await writeFile(path.join(noExpo,'package.json'),JSON.stringify({dependencies:{}}));
  await expect(initialize(noExpo)).rejects.toMatchObject({code:'INVALID_INPUT'});
 });
});
it('preserves an existing explicit provider instead of injecting another root provider',async()=>{
 const root=await project({'App.tsx':"import {LayoutProvider as Provider} from '@nativemason/runtime';export default ()=> <Provider rootId='screen' scenarioId='app'/>;"});
 const result=await initialize(root);
 expect(result.automaticRoot).toBe(false);expect(result.after).toContain('autoInstrument');expect(result.after).not.toContain('"rootComponent"');
});
