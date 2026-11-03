import {describe,expect,it,vi} from 'vitest';
import {BridgeFault,type NativeScenarioOptions} from '@nativemason/contracts';
import {createNativeScenarioPort} from './index.js';

const base:NativeScenarioOptions={appId:'com.example.app',projectRoot:'/tmp/example',target:{targetId:'device-123',platform:'android',kind:'physical'}};
describe('native scenario driver validation',()=>{
 it('rejects unsafe app and device identifiers before running commands',()=>{
  expect(()=>createNativeScenarioPort({...base,appId:'com.example; touch /tmp/pwned'})).toThrow(BridgeFault);
  expect(()=>createNativeScenarioPort({...base,target:{...base.target,targetId:'device\n--malicious'}})).toThrow(BridgeFault);
 });
 it('validates the complete script before executing reset actions',async()=>{
  const runHook=vi.fn(async()=>{});const port=createNativeScenarioPort({...base,runHook});
  await expect(port.run({scenarioId:'checkout',reset:[{type:'hook',name:'reset'}],actions:[{type:'scroll',elementId:'list',x:0,y:100}]})).rejects.toMatchObject({code:'UNSUPPORTED_ACTION'});
  expect(runHook).not.toHaveBeenCalled();
 });
 it('rejects interpolated strings and unsupported Android Unicode before device access',async()=>{
  const port=createNativeScenarioPort(base);
  await expect(port.run({scenarioId:'checkout',reset:[],actions:[{type:'input',elementId:'email',text:'${secret}'}]})).rejects.toMatchObject({code:'UNSUPPORTED_ACTION'});
  await expect(port.run({scenarioId:'checkout',reset:[],actions:[{type:'input',elementId:'email',text:'café'}]})).rejects.toMatchObject({code:'UNSUPPORTED_ACTION'});
 });
 it('requires an explicit hook transport',async()=>{
  const port=createNativeScenarioPort(base);
  await expect(port.run({scenarioId:'checkout',reset:[],actions:[{type:'hook',name:'reset'}]})).rejects.toMatchObject({code:'UNSUPPORTED_ACTION'});
 });
});
