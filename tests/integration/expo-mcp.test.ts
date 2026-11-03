import { afterAll,beforeAll,describe,it,expect } from 'vitest';
import { spawn,type ChildProcess } from 'node:child_process';
import { cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WireframeSpecSchema,ToolSchemas,type ToolName } from '@nativemason/contracts';
import { BridgeApplication } from '../../packages/bridge/src/application/index.js';
import { createMcpServer } from '../../packages/bridge/src/mcp/index.js';
import { createBrowserBridge,type BrowserBridge } from '../../packages/bridge/src/browser/index.js';
import { createNativeBridge } from '../../packages/bridge/src/native/index.js';
import fixture from '../../packages/contracts/fixtures/footer.json';
const root=process.cwd();
let project='',metro:ChildProcess|undefined,app:BridgeApplication,client:Client,server:ReturnType<typeof createMcpServer>,browser:BrowserBridge;
let logs='';
const spec=WireframeSpecSchema.parse(fixture);
async function call(name:ToolName,args:unknown):Promise<any>{const r=await client.callTool({name,arguments:args as Record<string,unknown>});const content=r.content as {type:string;text?:string}[];const text=content.find(c=>c.type==='text')?.text;if(r.isError)throw Object.assign(new Error(text),{data:text?JSON.parse(text):null});return text?JSON.parse(text):r;}
beforeAll(async()=>{
 await mkdir(path.join(root,'artifacts'),{recursive:true});project=await mkdtemp(path.join(root,'artifacts/expo-integration-'));
 await cp(path.join(root,'examples/expo-fixture'),project,{recursive:true,filter:source=>!source.split(path.sep).some(part=>['node_modules','.expo','android','ios'].includes(part))});
 await symlink(path.join(root,'node_modules'),path.join(project,'node_modules'),'dir');
 metro=spawn(process.execPath,[path.join(root,'node_modules/expo/bin/cli'),'start',project,'--clear','--web','--localhost','--port','18081'],{cwd:project,detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'false',NODE_ENV:'development',EXPO_PUBLIC_LAYOUT_NATIVE_URL:'',EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN:''}});
 metro.stdout!.on('data',b=>{logs+=String(b);});metro.stderr!.on('data',b=>{logs+=String(b);});
 const deadline=Date.now()+60000;let ready=false;
 while(Date.now()<deadline){if(metro.exitCode!==null)throw new Error(`Metro exited: ${logs}`);try{const r=await fetch('http://localhost:18081/status');if((await r.text()).includes('packager-status:running')){ready=true;break;}}catch{ /* Retry until Metro is ready or deadline expires. */ }await new Promise(r=>setTimeout(r,200));}
 if(!ready)throw new Error(`Metro did not start: ${logs}`);
 app=new BridgeApplication({artifactsRoot:path.join(root,'artifacts/integration'),browser:async o=>{browser=await createBrowserBridge({...o,timeoutMs:90000});return browser;},native:o=>createNativeBridge({...o,timeoutMs:200})});
 server=createMcpServer(app);client=new Client({name:'nativemason-integration',version:'1.0.0'});const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(a),client.connect(b)]);
},90000);
afterAll(async()=>{await client?.close();await server?.close();await app?.close();if(metro?.pid){try{process.kill(-metro.pid,'SIGTERM');}catch{ /* Retry until Metro is ready or deadline expires. */ }}if(project)await rm(project,{recursive:true,force:true});},30000);
describe('real Expo + Chromium + MCP',()=>{
 it('inspects, trials, previews, commits, reloads and exposes native-disconnect honestly',async()=>{
  expect((await client.listTools()).tools).toHaveLength(Object.keys(ToolSchemas).length);
  const opened=await call('open_session',{projectRoot:project,webUrl:'http://localhost:18081/?scenario=broken-footer',scenarioId:spec.scenarioId,profile:spec.profile,nativePort:19483,nativeToken:'nativemason-integration-token'});const sessionId=opened.sessionId;
  try{
   await call('load_wireframe_spec',{sessionId,spec});
   const initial=await call('inspect_ui_spatial_graph',{sessionId});expect(initial.results.some((r:any)=>r.status==='fail')).toBe(true);expect(initial.snapshot.nodes.every((n:any)=>n.source?.path==='App.tsx')).toBe(true);
   const trial=await call('simulate_layout_mutation',{sessionId,baselineSnapshotId:initial.snapshot.snapshotId,elementId:'footer',patch:{flexDirection:'row'}});expect(trial.results.every((r:any)=>r.status==='pass')).toBe(true);
   const original=await readFile(path.join(project,'App.tsx'),'utf8');expect(original).toContain("flexDirection: 'column'");
   const image=await client.callTool({name:'capture_annotated_overlay',arguments:{sessionId,snapshotId:trial.snapshot.snapshotId}});expect(image.isError).not.toBe(true);expect((image.content as any[]).some(c=>c.type==='image')).toBe(true);
   const input={sessionId,trialId:trial.trialId,expectedSourceHash:initial.snapshot.revisions['App.tsx']};
   const preview=await call('commit_rn_ast_patch',{...input,mode:'preview'});expect(preview.plan.diff).toContain('row');expect(await readFile(path.join(project,'App.tsx'),'utf8')).toBe(original);
   const committed=await call('commit_rn_ast_patch',{...input,mode:'apply'});expect(committed.receipt.nativeStatus).toBe('pending');expect(committed.webStatus).toBe('passed');expect(committed.results.every((r:any)=>r.status==='pass')).toBe(true);
   const replay=await call('commit_rn_ast_patch',{...input,mode:'apply'});expect(replay.receipt.commitId).toBe(committed.receipt.commitId);
   await expect(call('verify_native_layout',{sessionId,commitId:committed.receipt.commitId})).rejects.toMatchObject({data:{error:{code:'NATIVE_DISCONNECTED'}}});
   const times=browser.timings();const percentile=(xs:number[],p:number)=>[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*p))];
   await writeFile(path.join(root,'artifacts/integration/timings.json'),JSON.stringify({capture:{samples:times.captureMs.length,p50:percentile(times.captureMs,.5),p95:percentile(times.captureMs,.95)},trial:{samples:times.trialMs.length,p50:percentile(times.trialMs,.5),p95:percentile(times.trialMs,.95)}},null,2));
  }finally{await call('close_session',{sessionId});}
 },150000);
 it('covers wrapping, safe-area, intentional overlap, and repeated source sites',async()=>{
  const scenarios=[['wrapping.json','text-wrapping'],['safe-area.json','safe-area'],['overlap.json','intentional-overlap'],['repeated.json','repeated-elements']] as const;
  for(const [file,scenarioId] of scenarios){
   const loaded=WireframeSpecSchema.parse(JSON.parse(await readFile(path.join(root,'packages/contracts/fixtures',file),'utf8')));
   const opened=await call('open_session',{projectRoot:project,webUrl:'http://localhost:18081/?scenario='+scenarioId,scenarioId,profile:loaded.profile,nativePort:19484,nativeToken:'nativemason-integration-token'});
   try {
    await call('load_wireframe_spec',{sessionId:opened.sessionId,spec:loaded});
    const inspected=await call('inspect_ui_spatial_graph',{sessionId:opened.sessionId});
    expect(inspected.snapshot.nodes.some((n:any)=>n.id==='screen')).toBe(true);
    if(scenarioId==='text-wrapping') {expect(inspected.snapshot.nodes.find((n:any)=>n.id==='wrapping-copy').rect.height).toBeGreaterThanOrEqual(48);expect(inspected.results.every((r:any)=>r.status==='pass')).toBe(true);}
    if(scenarioId==='safe-area')expect(inspected.results.some((r:any)=>r.constraintId==='action-safe'&&r.status==='fail')).toBe(true);
    if(scenarioId==='intentional-overlap'){
      expect(inspected.results.every((r:any)=>r.status==='pass')).toBe(true);
      await call('load_wireframe_spec',{sessionId:opened.sessionId,spec:{...loaded,constraints:[...loaded.constraints,{id:'layers-disjoint',type:'disjoint',first:'overlap-a',second:'overlap-b',tolerance:0}]}});
      const forbidden=await call('inspect_ui_spatial_graph',{sessionId:opened.sessionId});expect(forbidden.results.some((r:any)=>r.constraintId==='layers-disjoint'&&r.status==='fail')).toBe(true);
    }
    if(scenarioId==='repeated-elements'){
      expect(inspected.results.every((r:any)=>r.status==='pass')).toBe(true);
      for(const id of ['repeat-one','repeat-two','repeat-three']){const node=inspected.snapshot.nodes.find((n:any)=>n.id===id);expect(node.editable).toBe(false);expect(node.editReason).toContain('multiple mounted instances');}
    }
   } finally {await call('close_session',{sessionId:opened.sessionId});}
  }
 },120000);
 it('sweeps orientation with a profile-bound baseline and reports browser-only hazards',async()=>{
  const overlap=WireframeSpecSchema.parse(JSON.parse(await readFile(path.join(root,'packages/contracts/fixtures/overlap.json'),'utf8')));
  const opened=await call('open_session',{projectRoot:project,webUrl:'http://localhost:18081/?scenario=intentional-overlap',scenarioId:overlap.scenarioId,profile:overlap.profile,nativePort:19485,nativeToken:'nativemason-integration-token'});
  const sessionId=opened.sessionId;
  try{
   await call('load_wireframe_spec',{sessionId,spec:{...overlap,constraints:[]}});
   const overrides={orientation:'landscape'};
   const inspected=await call('inspect_ui_spatial_graph',{sessionId,profileOverrides:overrides});
   expect(inspected.snapshot.profile.orientation).toBe('landscape');
   expect(inspected.snapshot.profile.window.width).toBe(overlap.profile.window.height);
   expect(inspected.snapshot.webDiagnostics).toBeDefined();
   expect(inspected.webDiagnostics.nodes['overlap-a']).toBeDefined();
   expect(inspected.webDiagnostics.nodes['overlap-a'].centerHitTest).toBe('confirmed');
   await expect(call('simulate_layout_mutation',{sessionId,baselineSnapshotId:inspected.snapshot.snapshotId,elementId:'overlap-a',patch:{width:110}})).rejects.toMatchObject({data:{error:{code:'STALE_SNAPSHOT'}}});
   const trial=await call('simulate_layout_mutation',{sessionId,baselineSnapshotId:inspected.snapshot.snapshotId,elementId:'overlap-a',patch:{width:100},profileOverrides:overrides});
   expect(trial.webDiagnostics.warnings.some((w:any)=>w.elementId==='overlap-a'&&w.code==='OCCLUDED')).toBe(true);
   const commitInput={sessionId,trialId:trial.trialId,expectedSourceHash:inspected.snapshot.revisions['App.tsx']};
   const preview=await call('commit_rn_ast_patch',{...commitInput,mode:'preview'});
   expect(preview.plan.diff).toContain('100');
   await expect(call('commit_rn_ast_patch',{...commitInput,mode:'apply'})).rejects.toMatchObject({data:{error:{code:'UNSUPPORTED_PROFILE'}}});
   const portrait=await call('inspect_ui_spatial_graph',{sessionId});
   const portraitTrial=await call('simulate_layout_mutation',{sessionId,baselineSnapshotId:portrait.snapshot.snapshotId,elementId:'overlap-a',patch:{width:100}});
   const portraitCommit={sessionId,trialId:portraitTrial.trialId,expectedSourceHash:portrait.snapshot.revisions['App.tsx']};
   await call('commit_rn_ast_patch',{...portraitCommit,mode:'preview'});
   await expect(call('commit_rn_ast_patch',{...portraitCommit,mode:'apply'})).rejects.toMatchObject({data:{error:{code:'VERIFICATION_FAILED'}}});
   await expect(call('inspect_ui_spatial_graph',{sessionId,profileOverrides:{fontScale:1.2}})).rejects.toMatchObject({data:{error:{code:'UNSUPPORTED_PROFILE'}}});
  }finally{await call('close_session',{sessionId});}
 },90000);
 it('advertises strict inputs over the actual stdio executable',async()=>{
  const cli=new Client({name:'stdio-integration',version:'1'});const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'packages/bridge/dist/cli.js')],stderr:'pipe'});
  try{await cli.connect(transport);expect((await cli.listTools()).tools.map(t=>t.name)).toContain('verify_native_layout');const result=await cli.callTool({name:'close_session',arguments:{sessionId:'missing'}});expect(result.isError).toBe(true);expect(JSON.stringify(result.content)).toContain('SESSION_NOT_FOUND');}finally{await cli.close();}
 },15000);
});
