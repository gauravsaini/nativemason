import {describe,expect,it,vi} from 'vitest';
import {BridgeFault} from '@nativemason/contracts';
import {createMcpServer} from './index.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';

describe('MCP tool responses',()=>{
 it('delivers a refined preview output through actual MCP schema validation',async()=>{
  const hash='a'.repeat(64);
  const plan={source:{path:'App.tsx',hash,start:0,end:1,line:1,column:0},expectedHash:hash,updatedText:'x',diff:'diff'};
  const server=createMcpServer({execute:async()=>({plan})} as never);
  const client=new Client({name:'preview-regression',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  try{await Promise.all([server.connect(a),client.connect(b)]);const response=await client.callTool({name:'commit_rn_ast_patch',arguments:{sessionId:'s',trialId:'t',expectedSourceHash:hash,mode:'preview'}});expect(response.isError).not.toBe(true);expect(response.structuredContent).toEqual({plan});}
  finally{await client.close();await server.close();}
 });
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
