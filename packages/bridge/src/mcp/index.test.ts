import {describe,expect,it,vi} from 'vitest';
import {BridgeFault} from '@nativemason/contracts';
import {createMcpServer} from './index.js';

describe('MCP tool responses',()=>{
 it('returns validated application results as structuredContent',async()=>{
  const result={sessionId:'session-1',nativePort:1234,nativeToken:'token'};
  const application={execute:vi.fn(async()=>result)};
  const server=createMcpServer(application as never) as unknown as {_registeredTools:Record<string,{handler:(input:unknown)=>Promise<any>}>};
  const response=await server._registeredTools.open_session.handler({});
  expect(response.structuredContent).toEqual(result);
  expect(response.content[0].text).toBe(JSON.stringify(result));
 });
 it('serializes contract faults as MCP errors',async()=>{
  const application={execute:vi.fn(async()=>{throw new BridgeFault('INVALID_INPUT','bad request',{field:'sessionId'});})};
  const server=createMcpServer(application as never) as unknown as {_registeredTools:Record<string,{handler:(input:unknown)=>Promise<any>}>};
  const response=await server._registeredTools.open_session.handler({});
  expect(response.isError).toBe(true);
  expect(JSON.parse(response.content[0].text)).toEqual({error:{code:'INVALID_INPUT',message:'bad request',details:{field:'sessionId'}}});
 });
});
