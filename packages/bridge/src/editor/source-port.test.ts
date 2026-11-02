import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type EditPlan } from '@rn-layout/contracts';
import { createSourcePort } from './source-port.js';
import { hashSource } from './planner.js';

const directories: string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function setup(){const root=await mkdtemp(path.join(os.tmpdir(),'rn-layout-editor-'));directories.push(root);await writeFile(path.join(root,'Screen.tsx'),'old');const port=createSourcePort(root);const hash=hashSource('old');const plan:EditPlan={source:{path:'Screen.tsx',hash,start:1,end:2,line:1,column:1},expectedHash:hash,updatedText:'new',diff:'example diff'};return {root,port,plan};}
describe('source filesystem port',()=>{
  it('writes atomically, preserves mode and returns pending receipt',async()=>{const {root,port,plan}=await setup();await chmod(path.join(root,'Screen.tsx'),0o640);const result=await port.apply(plan);expect(result).toMatchObject({oldHash:hashSource('old'),newHash:hashSource('new'),nativeStatus:'pending'});expect(await readFile(path.join(root,'Screen.tsx'),'utf8')).toBe('new');expect((await stat(path.join(root,'Screen.tsx'))).mode&0o777).toBe(0o640);expect(await readdir(root)).toEqual(['Screen.tsx']);});
  it('replays the same intent and serializes concurrent applies',async()=>{const {port,plan}=await setup();const [first,second]=await Promise.all([port.apply(plan),port.apply(plan)]);expect(first).toEqual(second);expect(await port.read('Screen.tsx')).toMatchObject({text:'new',hash:hashSource('new')});});
  it('rejects stale writes and leaves contents intact',async()=>{const {root,port,plan}=await setup();await writeFile(path.join(root,'Screen.tsx'),'external');await expect(port.apply(plan)).rejects.toMatchObject({code:'STALE_SOURCE'});expect(await readdir(root)).toEqual(['Screen.tsx']);expect(await readFile(path.join(root,'Screen.tsx'),'utf8')).toBe('external');});
  it('does not return a replay after later external changes',async()=>{const {root,port,plan}=await setup();await port.apply(plan);await writeFile(path.join(root,'Screen.tsx'),'external');await expect(port.apply(plan)).rejects.toMatchObject({code:'STALE_SOURCE'});});
  it('rejects traversal and absolute paths',async()=>{const {port,plan}=await setup();for(const p of ['../Screen.tsx','/etc/passwd']){await expect(port.read(p)).rejects.toMatchObject({code:'SOURCE_OUTSIDE_PROJECT'});await expect(port.apply({...plan,source:{...plan.source,path:p}})).rejects.toMatchObject({code:'SOURCE_OUTSIDE_PROJECT'});}});
  it('rejects symlinks escaping the project, with an internal symlink positive control',async()=>{const {root,port}=await setup();await symlink('/etc/passwd',path.join(root,'outside'));await expect(port.read('outside')).rejects.toMatchObject({code:'SOURCE_OUTSIDE_PROJECT'});await symlink(path.join(root,'Screen.tsx'),path.join(root,'inside'));expect(await port.read('inside')).toMatchObject({text:'old'});});
  it('rejects malformed edit plans before any write',async()=>{const {port,plan}=await setup();await expect(port.apply({...plan,expectedHash:hashSource('other')})).rejects.toMatchObject({code:'INVALID_INPUT'});expect(await port.read('Screen.tsx')).toMatchObject({text:'old'});});
});
