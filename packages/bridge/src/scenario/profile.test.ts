import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const {execFileMock,homeMock}=vi.hoisted(()=>({execFileMock:vi.fn(),homeMock:{value:''}}));
vi.mock('node:child_process',()=>({execFile:execFileMock}));
vi.mock('node:os',async()=>({...await vi.importActual<typeof import('node:os')>('node:os'),homedir:()=>homeMock.value}));

import {type NativeScenarioOptions} from '@nativemason/contracts';
import {createNativeProfilePort} from './index.js';

const base:NativeScenarioOptions={appId:'com.example.app',projectRoot:'/tmp/example',target:{targetId:'profile-test-device',platform:'android',kind:'physical'}};
let tempHome:string;
let settings:Record<string,string>;

beforeEach(async()=>{
  tempHome=await mkdtemp(path.join(os.tmpdir(),'native-profile-test-'));
  homeMock.value=tempHome;
  settings={font_scale:'1.0',user_rotation:'0',accelerometer_rotation:'1'};
  execFileMock.mockReset();
  execFileMock.mockImplementation((file:string,args:string[],_options:unknown,callback:(error:Error|null,result:{stdout:string;stderr:string})=>void)=>{
    if(file!=='adb')throw new Error(`Unexpected executable ${file}`);
    const index=args.indexOf('settings');
    const operation=args[index+1];
    const key=args[index+3];
    if(operation==='get')callback(null,{stdout:`${settings[key]??'null'}\n`,stderr:''});
    else if(operation==='put'){settings[key]=args[index+4]!;callback(null,{stdout:'',stderr:''});}
    else if(operation==='delete'){delete settings[key];callback(null,{stdout:'',stderr:''});}
    else callback(new Error(`Unexpected settings operation ${operation}`),{stdout:'',stderr:''});
  });
});
afterEach(async()=>{vi.restoreAllMocks();await rm(tempHome,{recursive:true,force:true});});

const journalPath=()=>path.join(tempHome,'.cache','nativemason','native-settings');

describe('native profile settings restoration',()=>{
  it('restores Android settings after successful work and returns the work result',async()=>{
    const port=createNativeProfilePort(base);
    await expect(port.withProfile({fontScale:1.4,orientation:'landscape'},async()=>{
      expect(settings).toMatchObject({font_scale:'1.4',user_rotation:'1',accelerometer_rotation:'0'});
      return 'done';
    })).resolves.toBe('done');
    expect(settings).toEqual({font_scale:'1.0',user_rotation:'0',accelerometer_rotation:'1'});
    await expect(port.recover()).resolves.toBeUndefined();
  });

  it('restores Android settings and preserves the callback error when work throws',async()=>{
    const port=createNativeProfilePort(base);
    const failure=new Error('scenario failed');
    await expect(port.withProfile({fontScale:1.5},async()=>{throw failure;})).rejects.toBe(failure);
    expect(settings).toEqual({font_scale:'1.0',user_rotation:'0',accelerometer_rotation:'1'});
    await expect(port.recover()).resolves.toBeUndefined();
  });

  it('recovers a dead process journal and restores the journaled settings',async()=>{
    const directory=journalPath();
    await mkdir(directory,{recursive:true});
    const port=createNativeProfilePort(base);
    const hashJournal=(await import('node:crypto')).createHash('sha256').update('local:android:profile-test-device').digest('hex')+'.json';
    const expected=path.join(directory,hashJournal);
    await writeFile(expected,JSON.stringify({pid:2147483647,platform:'android',fontScale:'0.9',rotation:'1',accelerometer:'0'}));
    settings={font_scale:'1.6',user_rotation:'0',accelerometer_rotation:'1'};
    await expect(port.recover()).resolves.toBeUndefined();
    expect(settings).toEqual({font_scale:'0.9',user_rotation:'1',accelerometer_rotation:'0'});
    await expect(readFile(expected,'utf8')).rejects.toMatchObject({code:'ENOENT'});
  });

  it('rejects a measured profile mismatch and restores settings afterward',async()=>{
    let now=0;
    vi.spyOn(Date,'now').mockImplementation(()=>{now+=11_000;return now;});
    const readProfile=vi.fn(async()=>({fontScale:1,orientation:'portrait'} as never));
    const port=createNativeProfilePort({...base,readProfile});
    await expect(port.withProfile({fontScale:1.3},async()=>undefined)).rejects.toMatchObject({code:'UNSUPPORTED_PROFILE'});
    expect(settings).toEqual({font_scale:'1.0',user_rotation:'0',accelerometer_rotation:'1'});
  });
});
