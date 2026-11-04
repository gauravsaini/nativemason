import {access,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const {execFileMock,executeMock}=vi.hoisted(()=>{
  const execFile=vi.fn();
  const execute=vi.fn();
  Object.defineProperty(execFile,Symbol.for('nodejs.util.promisify.custom'),{value:execute});
  return {execFileMock:execFile,executeMock:execute};
});
vi.mock('node:child_process',()=>({execFile:execFileMock}));

import {BridgeFault,NativeScenarioFailureEvidenceSchema,type NativeScenarioOptions,type ScenarioScript} from '@nativemason/contracts';
import {createNativeScenarioPort} from './index.js';

const base:NativeScenarioOptions={appId:'com.example.app',projectRoot:'/tmp/example',target:{targetId:'device-123',platform:'android',kind:'physical'}};
const inputScript=()=>({scenarioId:'checkout',reset:[],actions:[{type:'input' as const,mode:'replace' as const,elementId:'email',text:'reader@example.test'}]});
const failure=(message:string,fields:Record<string,unknown>={})=>Object.assign(new Error(message),fields);
async function faultFor(run:Promise<void>):Promise<BridgeFault>{
  try{await run;}catch(error){expect(error).toBeInstanceOf(BridgeFault);return error as BridgeFault;}
  throw new Error('Expected the native command to fail');
}
async function expectLocalFlowRemoved():Promise<void>{
  const args=executeMock.mock.calls[0]?.[1] as string[]|undefined;
  const file=args?.[3];
  expect(file).toBeTruthy();
  await expect(readFile(file!)).rejects.toMatchObject({code:'ENOENT'});
  await expect(access(path.dirname(file!))).rejects.toMatchObject({code:'ENOENT'});
}

beforeEach(()=>{execFileMock.mockReset();executeMock.mockReset();});
afterEach(()=>vi.restoreAllMocks());

describe('native scenario failure evidence',()=>{
  it('preserves local Maestro exit code and both output streams in direct typed details',async()=>{
    executeMock.mockRejectedValue(failure('Maestro assertion failed',{code:1,stdout:'before action\n',stderr:'Could not find element\n',killed:false}));
    const fault=await faultFor(createNativeScenarioPort(base).run(inputScript()));
    expect(fault.code).toBe('VERIFICATION_FAILED');
    expect(fault.message).toBe('Native scenario command failed: Maestro assertion failed');
    expect(NativeScenarioFailureEvidenceSchema.parse(fault.details)).toEqual({
      driver:'maestro',message:'Maestro assertion failed',exitCode:1,signal:null,terminated:false,
      stdout:'before action\n',stderr:'Could not find element\n',outputTruncated:false,
    });
    await expectLocalFlowRemoved();
  });

  it('keeps the SSH callback exit and output instead of reducing the failure to its message',async()=>{
    const remoteError=failure('ssh exited',{code:255});
    const existingTempDirs=new Set((await readdir(tmpdir())).filter(name=>name.startsWith('nativemason-maestro-')));
    let flow='';
    execFileMock.mockImplementation((_file:string,_args:string[],_options:unknown,callback:(error:Error|null,stdout:string,stderr:string)=>void)=>{
      queueMicrotask(()=>callback(remoteError,'remote stdout\n','maestro: command not found\n'));
      return {stdin:{end:(value:string)=>{flow=value;}}};
    });
    const port=createNativeScenarioPort({...base,ssh:{destination:'runner@host'}});
    const fault=await faultFor(port.run(inputScript()));
    expect(flow).toContain('copyTextFrom');
    expect(NativeScenarioFailureEvidenceSchema.parse(fault.details)).toEqual({
      driver:'maestro',message:'ssh exited',exitCode:255,signal:null,terminated:false,
      stdout:'remote stdout\n',stderr:'maestro: command not found\n',outputTruncated:false,
    });
    expect(execFileMock).toHaveBeenCalledWith('ssh',expect.any(Array),expect.objectContaining({maxBuffer:4*1024*1024}),expect.any(Function));
    const remainingTempDirs=(await readdir(tmpdir())).filter(name=>name.startsWith('nativemason-maestro-')&&!existingTempDirs.has(name));
    expect(remainingTempDirs).toEqual([]);
  });

  it('retains a missing Maestro binary error code without inventing process output',async()=>{
    executeMock.mockRejectedValue(failure('spawn maestro ENOENT',{code:'ENOENT',killed:false}));
    const fault=await faultFor(createNativeScenarioPort(base).run(inputScript()));
    expect(NativeScenarioFailureEvidenceSchema.parse(fault.details)).toMatchObject({
      driver:'maestro',exitCode:'ENOENT',signal:null,terminated:false,stdout:'',stderr:'',outputTruncated:false,
    });
    await expectLocalFlowRemoved();
  });

  it('bounds long process output and preserves signal termination metadata',async()=>{
    executeMock.mockRejectedValue(failure('x'.repeat(3000),{
      code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',killed:true,signal:'SIGTERM',
      stdout:'o'.repeat(20000),stderr:'e'.repeat(20000),
    }));
    const fault=await faultFor(createNativeScenarioPort(base).run(inputScript()));
    const details=NativeScenarioFailureEvidenceSchema.parse(fault.details);
    expect(fault.message.length).toBeLessThan(300);
    expect(details.message).toHaveLength(2048);
    expect(details.exitCode).toBe('ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
    expect(details.signal).toBe('SIGTERM');
    expect(details.terminated).toBe(true);
    expect(details.stdout).toHaveLength(16384);
    expect(details.stderr).toHaveLength(16384);
    expect(details.outputTruncated).toBe(true);
    await expectLocalFlowRemoved();
  });

  it('does not mutate a frozen caller script on success and removes the temporary flow',async()=>{
    const script:ScenarioScript={scenarioId:'checkout',reset:[],actions:[{type:'input',mode:'replace',elementId:'email',text:'reader@example.test'}]};
    const action=script.actions[0]!;
    Object.freeze(script.reset);
    Object.freeze(script.actions);
    Object.freeze(action);
    Object.freeze(script);
    executeMock.mockResolvedValue({stdout:'',stderr:''});
    await expect(createNativeScenarioPort(base).run(script)).resolves.toBeUndefined();
    expect(script.actions[0]).toBe(action);
    expect(executeMock).toHaveBeenCalledTimes(1);
    const args=executeMock.mock.calls[0]?.[1] as string[];
    await expect(readFile(args[3]!)).rejects.toMatchObject({code:'ENOENT'});
    await expect(access(path.dirname(args[3]!))).rejects.toMatchObject({code:'ENOENT'});
  });
});
