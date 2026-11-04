import { afterAll,beforeAll,describe,it,expect } from 'vitest';
import { spawn,type ChildProcess } from 'node:child_process';
import { cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WireframeSpecSchema,VisualEvidenceRunSchema,ToolSchemas,type ToolName } from '@nativemason/contracts';
import { BridgeApplication } from '../../packages/bridge/src/application/index.js';
import { createMcpServer } from '../../packages/bridge/src/mcp/index.js';
import { createBrowserBridge,type BrowserBridge } from '../../packages/bridge/src/browser/index.js';
import { createNativeBridge } from '../../packages/bridge/src/native/index.js';
import { createNativeScenarioPort } from '../../packages/bridge/src/scenario/index.js';
import fixture from '../../packages/contracts/fixtures/footer.json';
const root=process.cwd();
let project='',metro:ChildProcess|undefined,app:BridgeApplication,client:Client,server:ReturnType<typeof createMcpServer>,browser:BrowserBridge;
let logs='';
const spec=WireframeSpecSchema.parse(fixture);
async function call(name:ToolName,args:unknown):Promise<any>{const r=await client.callTool({name,arguments:args as Record<string,unknown>});const content=r.content as {type:string;text?:string}[];const text=content.find(c=>c.type==='text')?.text;if(r.isError){let data:unknown=null;try{data=text?JSON.parse(text):null;}catch{data=text;}throw Object.assign(new Error(text),{data});}return text?JSON.parse(text):r;}
beforeAll(async()=>{
 await mkdir(path.join(root,'artifacts'),{recursive:true});project=await mkdtemp(path.join(root,'artifacts/expo-integration-'));
 await cp(path.join(root,'examples/expo-fixture'),project,{recursive:true,filter:source=>!source.split(path.sep).some(part=>['node_modules','.expo','android','ios'].includes(part))});
 const appFile=path.join(project,'App.tsx'),appText=await readFile(appFile,'utf8');
 await writeFile(appFile,appText.replace("import React from 'react';","import React from 'react';\nimport { pressStyles } from './imported-press';")
  .replace("case 'broken-footer': return <FooterScenario />;",`case 'pressable-state': return <LayoutView layoutId="press-screen" style={styles.screen}><LayoutPressable layoutId="state-button" accessibilityLabel="State button" style={({pressed})=>pressed?{backgroundColor:'#dc2626',width:120}:{backgroundColor:'#2563eb',width:100}}><LayoutText>Hold</LayoutText></LayoutPressable><LayoutPressable layoutId="aria-hidden-button" accessibilityLabel="AX hidden but tabbable" accessibilityElementsHidden style={{height:48}}><LayoutText>Hidden from AX</LayoutText></LayoutPressable></LayoutView>;
    case 'contrast-evidence': return <LayoutView layoutId="contrast-screen" style={styles.screen}><LayoutText layoutId="text-fill" style={{color:'black',backgroundColor:'white',WebkitTextFillColor:'white'}}>Filled text</LayoutText><LayoutText layoutId="text-stroke" style={{color:'black',backgroundColor:'white',WebkitTextStrokeWidth:1}}>Stroked text</LayoutText><LayoutPressable layoutId="disabled-control" accessibilityRole="button" accessibilityState={{disabled:true}} disabled style={{backgroundColor:'white'}}><LayoutText layoutId="disabled-label" style={{color:'white'}}>Inactive text</LayoutText></LayoutPressable></LayoutView>;
    case 'imported-press': return <LayoutView layoutId="import-screen" style={styles.screen}><LayoutPressable layoutId="imported-button" accessibilityLabel="Imported button" style={pressStyles.button}><LayoutText>Imported</LayoutText></LayoutPressable></LayoutView>;
    case 'broken-footer': return <FooterScenario />;`));
 await writeFile(path.join(project,'imported-press.ts'),'export const pressStyles = { button: { width: 120, height: 48, backgroundColor: \'#2563eb\' } };\n');
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
  const opened=await call('open_session',{projectRoot:project,webUrl:'http://localhost:18081/?scenario=broken-footer',scenarioId:spec.scenarioId,profile:spec.profile,nativePort:19483,nativeToken:'nativemason-integration-token'});const sessionId=opened.sessionId;const primaryBrowser=browser;
  try{
   await call('load_wireframe_spec',{sessionId,spec});
   const initial=await call('inspect_ui_spatial_graph',{sessionId});expect(initial.results.some((r:any)=>r.status==='fail')).toBe(true);expect(initial.snapshot.nodes.filter((n:any)=>n.source).every((n:any)=>n.source.path==='App.tsx')).toBe(true);
   const accessibility=await call('inspect_accessibility',{sessionId,target:'web'});expect(accessibility.snapshot.platform).toBe('web');
   const cancel=accessibility.snapshot.nodes.find((node:any)=>node.id==='cancel'),label=accessibility.snapshot.nodes.find((node:any)=>node.id==='cancel-label');
   expect(cancel.accessibility.browser.name).toBe('Cancel');expect(cancel.accessibility.browser.focusOrderSource).toBe('dom-sequential-estimate');expect(cancel.accessibility.directionSource).toBe('browser-computed');
   expect(accessibility.findings.some((finding:any)=>finding.code==='ACCESSIBLE_NAME'&&finding.elementIds.includes('cancel')&&finding.status==='pass')).toBe(true);
   expect(label.accessibility.browser.contrast).toMatchObject({status:'measured',requiredRatio:4.5});expect(label.accessibility.browser.contrast.ratio).toBeGreaterThanOrEqual(4.5);
   const design=await call('import_design_intent',{sessionId,design:{kind:'reference-annotations',scenarioId:spec.scenarioId,profile:spec.profile,image:{sha256:'a'.repeat(64),width:824,height:1830},appRootPixels:{x:0,y:0,width:824,height:1830},pixelsPerLogicalUnit:2,annotations:[{elementId:'footer',rectPixels:{x:20,y:20,width:80,height:80}}]}});
   expect(design.reviewRequired).toBe(true);expect(design.spec.constraints[0]).toMatchObject({type:'rect',elementId:'footer',target:{x:10,y:10,width:40,height:40}});
   const suggestions=await call('suggest_fix',{sessionId,baselineSnapshotId:initial.snapshot.snapshotId,limit:4,profiles:[{id:'compact',profile:{...spec.profile,window:{width:360,height:800},root:{x:0,y:0,width:360,height:800}}},{id:'font-scale',profile:{...spec.profile,fontScale:1.3}}]});
   expect(suggestions.baselines.map((row:any)=>row.profileId)).toEqual(['baseline','compact','font-scale']);expect(suggestions.baselines[0].scenarioState).toBe('baseline');expect(suggestions.baselines[1].scenarioState).toBe('initial');expect(suggestions.baselines[2].status).toBe('unsupported');
   expect(suggestions.candidates.length).toBeGreaterThan(0);for(const candidate of suggestions.candidates){expect(candidate.profiles.map((p:any)=>p.profileId)).toEqual(['baseline','compact','font-scale']);expect(candidate.profiles[2].status).toBe('unsupported');expect(candidate.profiles[1].profile.window.width).toBe(360);expect(candidate.profiles[1].scenarioState).toBe('initial');expect(candidate.profiles[0].snapshotId).not.toBe(candidate.profiles[1].snapshotId);}
   const trial=await call('simulate_layout_mutation',{sessionId,baselineSnapshotId:initial.snapshot.snapshotId,elementId:'footer',patch:{flexDirection:'row'}});expect(trial.results.every((r:any)=>r.status==='pass')).toBe(true);
   const original=await readFile(path.join(project,'App.tsx'),'utf8');expect(original).toContain("flexDirection: 'column'");
   const image=await client.callTool({name:'capture_annotated_overlay',arguments:{sessionId,snapshotId:trial.snapshot.snapshotId}});expect(image.isError).not.toBe(true);expect((image.content as any[]).some(c=>c.type==='image')).toBe(true);
   const input={sessionId,trialId:trial.trialId,expectedSourceHash:initial.snapshot.revisions['App.tsx']};
   const preview=await call('commit_rn_ast_patch',{...input,mode:'preview'});expect(preview.plan.diff).toContain('row');expect(await readFile(path.join(project,'App.tsx'),'utf8')).toBe(original);
   const committed=await call('commit_rn_ast_patch',{...input,mode:'apply'});expect(committed.receipt.nativeStatus).toBe('pending');expect(committed.webStatus).toBe('passed');expect(committed.results.every((r:any)=>r.status==='pass')).toBe(true);
   const visualRun=VisualEvidenceRunSchema.parse({id:'web-footer',title:'Footer source correction',target:'web',before:initial.snapshot,after:committed.snapshot,results:committed.results,receipt:committed.receipt,nativeStatus:'pending',notes:['Chromium measurements; native acceptance is separate.']});
   await writeFile(path.join(root,'artifacts/integration/visual-evidence.json'),JSON.stringify(visualRun,null,2));
   const replay=await call('commit_rn_ast_patch',{...input,mode:'apply'});expect(replay.receipt.commitId).toBe(committed.receipt.commitId);
   await expect(call('verify_native_layout',{sessionId,commitId:committed.receipt.commitId})).rejects.toMatchObject({data:{error:{code:'NATIVE_DISCONNECTED'}}});
   const times=primaryBrowser.timings();const percentile=(xs:number[],p:number)=>[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*p))];
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
 it('runs stateful checkout and applies/reverts a two-file transaction',async()=>{
  const scenarioId='keyboard-form';const opened=await call('open_session',{projectRoot:project,webUrl:'http://localhost:18081/?scenario='+scenarioId,scenarioId,profile:spec.profile,nativePort:19486,nativeToken:'nativemason-integration-token'});const sessionId=opened.sessionId;
  const paths=['ComplexFlows.tsx','OrderSummary.tsx'];const originals=await Promise.all(paths.map(file=>readFile(path.join(project,file),'utf8')));
  try{
   await call('load_wireframe_spec',{sessionId,spec:{...spec,scenarioId,requiredElementIds:['checkout-submit'],constraints:[{id:'button-size',type:'minTouchTarget',elementId:'checkout-submit',width:48,height:48,tolerance:0}]}});
   const state=await call('run_scenario',{sessionId,target:'web',script:{scenarioId,reset:[{type:'hook',name:'resetCheckout'}],actions:[{type:'input',elementId:'checkout-email',text:'person@example.com'},{type:'tap',elementId:'checkout-toggle'},{type:'wait',elementId:'checkout-details',timeoutMs:5000}]}});expect(state.snapshot.nodes.some((node:any)=>node.id==='checkout-details')).toBe(true);
   const inspected=await call('inspect_ui_spatial_graph',{sessionId});
   const trial=await call('simulate_layout_mutation',{sessionId,baselineSnapshotId:inspected.snapshot.snapshotId,mutations:[{elementId:'checkout-toggle',patch:{marginTop:20}},{elementId:'checkout-summary',patch:{fontSize:18}}]});
   await writeFile(path.join(root,'artifacts/integration/checkout-trial.json'),JSON.stringify(trial,null,2));const input={sessionId,trialId:trial.trialId,expectedRevisions:trial.snapshot.revisions};const preview=await call('commit_rn_ast_patch',{...input,mode:'preview'});expect(preview.transactionPlan.files).toHaveLength(2);
   const committed=await call('commit_rn_ast_patch',{...input,mode:'apply'});expect(committed.webStatus).toBe('passed');expect(committed.receipt.files).toHaveLength(2);
   const reverted=await call('revert_commit',{sessionId,commitId:committed.receipt.commitId});expect(reverted.receipt.nativeStatus).toBe('pending');expect(reverted.snapshot).not.toBeNull();
   for(let i=0;i<paths.length;i++)expect(await readFile(path.join(project,paths[i]),'utf8')).toBe(originals[i]);
  }finally{for(let i=0;i<paths.length;i++)await writeFile(path.join(project,paths[i]),originals[i]);await call('close_session',{sessionId});}
 },120000);
 it('applies and reverts a NativeWind conditional class edit against measured constraints',async()=>{
  const scenarioId='nativewind',file=path.join(project,'NativeWindFlow.tsx'),original=await readFile(file,'utf8');
  const {sessionId}=await call('open_session',{projectRoot:project,webUrl:'http://localhost:18081/?scenario='+scenarioId,scenarioId,profile:spec.profile,nativePort:19487,nativeToken:'nativemason-integration-token'});
  try{
   await call('load_wireframe_spec',{sessionId,spec:{...spec,scenarioId,requiredElementIds:['utility-cancel','utility-submit'],constraints:[{id:'utility-size',type:'minTouchTarget',elementId:'utility-cancel',width:48,height:48,tolerance:0},{id:'utility-row',type:'align',axis:'y',edge:'center',elementIds:['utility-cancel','utility-submit']},{id:'utility-gap',type:'gap',axis:'x',first:'utility-cancel',second:'utility-submit',value:12}]}});
   const before=await call('inspect_ui_spatial_graph',{sessionId});expect(before.results.some((r:any)=>r.status==='fail')).toBe(true);expect(before.snapshot.nodes.find((node:any)=>node.id==='utility-cancel').rect.height).toBe(48);
   const trial=await call('simulate_layout_mutation',{sessionId,baselineSnapshotId:before.snapshot.snapshotId,elementId:'utility-footer',patch:{flexDirection:'row',gap:12}});expect(trial.results.every((r:any)=>r.status==='pass')).toBe(true);
   const input={sessionId,trialId:trial.trialId,expectedRevisions:trial.snapshot.revisions,scope:{kind:'nativewind',branch:'alternate'}};
   const preview=await call('commit_rn_ast_patch',{...input,mode:'preview'});expect(preview.plan.diff).toContain('flex-row');expect(preview.plan.diff).toContain('gap-');
   const applied=await call('commit_rn_ast_patch',{...input,mode:'apply'});expect(applied.webStatus).toBe('passed');
   const inspected=await call('inspect_ui_spatial_graph',{sessionId});expect(inspected.results.every((r:any)=>r.status==='pass')).toBe(true);
   const reverted=await call('revert_commit',{sessionId,commitId:applied.receipt.commitId});expect(reverted.snapshot).not.toBeNull();expect(await readFile(file,'utf8')).toBe(original);
  }finally{await writeFile(file,original);await call('close_session',{sessionId});}
 },90000);
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
 it('applies a Pressable rest branch, then holds pressed state for a review-only preview',async()=>{
  const scenarioId='pressable-state',opened=await call('open_session',{projectRoot:project,webUrl:'http://localhost:18081/?scenario='+scenarioId,scenarioId,profile:spec.profile,nativePort:19488,nativeToken:'nativemason-integration-token'}),sessionId=opened.sessionId,file=path.join(project,'App.tsx'),original=await readFile(file,'utf8');
  try{
   await call('load_wireframe_spec',{sessionId,spec:{...spec,scenarioId,requiredElementIds:[],constraints:[]}});
   const baseline=await call('inspect_ui_spatial_graph',{sessionId}),rest=baseline.snapshot.nodes.find((node:any)=>node.id==='state-button');
   expect(rest.pressableState).toBe('rest');expect(rest.source.styleForm).toBe('pressable-state');
   const a11y=await call('inspect_accessibility',{sessionId,target:'web'}),hidden=a11y.snapshot.nodes.find((node:any)=>node.id==='aria-hidden-button');
   expect(hidden.accessibility.hidden).toBe(true);expect(typeof hidden.accessibility.browser.focusOrder).toBe('number');
   expect(a11y.findings).toContainEqual(expect.objectContaining({code:'FOCUS_ORDER',status:'advisory',elementIds:['aria-hidden-button']}));
   const trial=await call('simulate_layout_mutation',{sessionId,baselineSnapshotId:baseline.snapshot.snapshotId,elementId:'state-button',patch:{width:110}});
   const restInput={sessionId,trialId:trial.trialId,expectedRevisions:trial.snapshot.revisions,scope:{kind:'pressable-state',state:'rest'}};
   const preview=await call('commit_rn_ast_patch',{...restInput,mode:'preview'});expect(preview.plan.diff).toContain('110');expect(await readFile(file,'utf8')).toBe(original);
   const applied=await call('commit_rn_ast_patch',{...restInput,mode:'apply'});expect(applied.webStatus).toBe('passed');
   expect(await readFile(file,'utf8')).toContain('width:110');
   const reverted=await call('revert_commit',{sessionId,commitId:applied.receipt.commitId});expect(reverted.snapshot).not.toBeNull();expect(await readFile(file,'utf8')).toBe(original);
   const held=await call('run_scenario',{sessionId,target:'web',script:{scenarioId,reset:[],actions:[{type:'press',elementId:'state-button',phase:'down'}]}});
   expect(held.snapshot.nodes.find((node:any)=>node.id==='state-button').pressableState).toBe('pressed');
   const pressedBaseline=await call('inspect_ui_spatial_graph',{sessionId});expect(pressedBaseline.snapshot.nodes.find((node:any)=>node.id==='state-button').pressableState).toBe('pressed');
   const pressedTrial=await call('simulate_layout_mutation',{sessionId,baselineSnapshotId:pressedBaseline.snapshot.snapshotId,elementId:'state-button',patch:{width:130}});
   const pressedInput={sessionId,trialId:pressedTrial.trialId,expectedRevisions:pressedTrial.snapshot.revisions,scope:{kind:'pressable-state',state:'pressed'}};
   const pressedPreview=await call('commit_rn_ast_patch',{...pressedInput,mode:'preview'});expect(pressedPreview.plan.diff).toContain('130');
   await expect(call('commit_rn_ast_patch',{...pressedInput,scope:{kind:'pressable-state',state:'rest'},mode:'preview'})).rejects.toMatchObject({data:{error:{code:'STALE_SNAPSHOT'}}});
   await call('run_scenario',{sessionId,target:'web',script:{scenarioId,reset:[],actions:[{type:'press',elementId:'state-button',phase:'up'}]}});
  }finally{await writeFile(file,original);await call('close_session',{sessionId});}
 },90000);
 it('requires revisions for an imported literal fold and applies/reverts the imported style edit',async()=>{
  const scenarioId='imported-press',source=path.join(project,'App.tsx'),imported=path.join(project,'imported-press.ts'),originals=await Promise.all([readFile(source,'utf8'),readFile(imported,'utf8')]);
  const {sessionId}=await call('open_session',{projectRoot:project,webUrl:'http://localhost:18081/?scenario='+scenarioId,scenarioId,profile:spec.profile,nativePort:19489,nativeToken:'nativemason-integration-token'});
  try{
   await call('load_wireframe_spec',{sessionId,spec:{...spec,scenarioId,requiredElementIds:[],constraints:[]}});
   const before=await call('inspect_ui_spatial_graph',{sessionId});expect(before.snapshot.revisions['imported-press.ts']).toBeTruthy();
   const trial=await call('simulate_layout_mutation',{sessionId,baselineSnapshotId:before.snapshot.snapshotId,elementId:'imported-button',patch:{height:56}});
   const input={sessionId,trialId:trial.trialId,scope:{kind:'local'}};
   await expect(call('commit_rn_ast_patch',{...input,expectedSourceHash:trial.snapshot.revisions['App.tsx'],mode:'preview'})).rejects.toMatchObject({data:{error:{code:'INVALID_INPUT',message:expect.stringContaining('expectedRevisions')}}});
   const expectedRevisions={...trial.snapshot.revisions};
   const preview=await call('commit_rn_ast_patch',{...input,expectedRevisions,mode:'preview'});expect(preview.transactionPlan.files.map((file:any)=>file.source.path)).toContain('imported-press.ts');
   const applied=await call('commit_rn_ast_patch',{...input,expectedRevisions,mode:'apply'});expect(applied.webStatus).toBe('passed');expect(await readFile(imported,'utf8')).toContain('height: 56');
   const reverted=await call('revert_commit',{sessionId,commitId:applied.receipt.commitId});expect(reverted.snapshot).not.toBeNull();expect(await readFile(imported,'utf8')).toBe(originals[1]);
  }finally{await Promise.all([writeFile(source,originals[0]),writeFile(imported,originals[1])]);await call('close_session',{sessionId});}
 },90000);
 it('rejects native held-pointer actions before dispatching to any target',async()=>{
  const port=createNativeScenarioPort({target:{targetId:'unused-target',platform:'android',kind:'physical'},appId:'com.example.app',projectRoot:project});
  try{await expect(port.run({scenarioId:'screen',reset:[],actions:[{type:'press',elementId:'button',phase:'down'}]})).rejects.toMatchObject({code:'UNSUPPORTED_ACTION'});}finally{await port.close();}
 });
 it('restores an interactive pressed state only when a profile scenario supplies it',async()=>{
  const scenarioId='pressable-state',opened=await call('open_session',{projectRoot:project,webUrl:'http://localhost:18081/?scenario='+scenarioId,scenarioId,profile:spec.profile,nativePort:19490,nativeToken:'nativemason-integration-token'}),sessionId=opened.sessionId;
  try{
   await call('load_wireframe_spec',{sessionId,spec:{...spec,scenarioId,requiredElementIds:[],constraints:[]}});
   const accessibility=await call('inspect_accessibility',{sessionId,target:'web'}),hidden=accessibility.snapshot.nodes.find((node:any)=>node.id==='aria-hidden-button');expect(hidden.accessibility.hidden).toBe(true);expect(hidden.accessibility.browser.focusOrderSource).toBe('dom-sequential-estimate');expect(hidden.accessibility.browser.focusOrder).not.toBeNull();
   const held=await call('run_scenario',{sessionId,target:'web',script:{scenarioId,reset:[],actions:[{type:'press',elementId:'state-button',phase:'down'}]}});
   const target=held.snapshot.nodes.find((node:any)=>node.id==='state-button');expect(target.pressableState).toBe('pressed');
   const constraint={id:'pressed-width',type:'rect',elementId:'state-button',target:target.rect,tolerance:0};
   await call('load_wireframe_spec',{sessionId,spec:{...spec,scenarioId,requiredElementIds:['state-button'],constraints:[constraint]}});
   const baseline=await call('inspect_ui_spatial_graph',{sessionId});expect(baseline.snapshot.nodes.find((node:any)=>node.id==='state-button').pressableState).toBe('pressed');
   const result=await call('suggest_fix',{sessionId,baselineSnapshotId:baseline.snapshot.snapshotId,profiles:[
    {id:'fresh-page',profile:spec.profile},
    {id:'restored',profile:spec.profile,script:{scenarioId,reset:[],actions:[{type:'press',elementId:'state-button',phase:'down'}]}},
   ]});
   expect(result.baselines.find((row:any)=>row.profileId==='baseline')).toMatchObject({scenarioState:'baseline',status:'passed'});
   expect(result.baselines.find((row:any)=>row.profileId==='fresh-page')).toMatchObject({scenarioState:'initial',status:'failed'});
   expect(result.baselines.find((row:any)=>row.profileId==='restored')).toMatchObject({scenarioState:'scripted',status:'passed'});
  }finally{await call('close_session',{sessionId});}
 },90000);
 it('does not verify a pressed callback from a later rest capture',async()=>{
  const scenarioId='pressable-state',file=path.join(project,'App.tsx'),original=await readFile(file,'utf8');let latest:any;const nativePressed=true;
  const stateApp=new BridgeApplication({artifactsRoot:path.join(root,'artifacts/state-integration'),browser:async options=>{const port=await createBrowserBridge({...options,timeoutMs:90000}),capture=port.capture.bind(port);return {...port,capture:async(profileOverrides?:any)=>{latest=await capture(profileOverrides);return latest;}};},native:async()=>({close:async()=>{},capture:async(revisions:any)=>{if(!latest)throw Error('Web must be captured first');const {webDiagnostics:_webDiagnostics,...nativeSnapshot}=latest;return {...nativeSnapshot,platform:'android',revisions,nodes:latest.nodes.map((node:any)=>node.id==='state-button'?{...node,pressableState:nativePressed?'pressed':'rest'}:node)};}})});
  try{
   const {sessionId}=await stateApp.execute('open_session',{projectRoot:project,webUrl:'http://localhost:18081/?scenario='+scenarioId,scenarioId,profile:spec.profile});
   await stateApp.execute('load_wireframe_spec',{sessionId,spec:{...spec,scenarioId,requiredElementIds:[],constraints:[]}});
   await stateApp.execute('run_scenario',{sessionId,target:'web',script:{scenarioId,reset:[],actions:[{type:'press',elementId:'state-button',phase:'down'}]}});
   const baseline=await stateApp.execute('inspect_ui_spatial_graph',{sessionId}),trial=await stateApp.execute('simulate_layout_mutation',{sessionId,baselineSnapshotId:baseline.snapshot.snapshotId,elementId:'state-button',patch:{width:130}});if(!('trialId'in trial))throw Error('Expected callback mutation trial');
   const applied=await stateApp.execute('commit_rn_ast_patch',{sessionId,trialId:trial.trialId,expectedRevisions:trial.snapshot.revisions,scope:{kind:'pressable-state',state:'pressed'},mode:'apply'});expect(applied.receipt).toBeDefined();
   await stateApp.execute('run_scenario',{sessionId,target:'web',script:{scenarioId,reset:[],actions:[{type:'press',elementId:'state-button',phase:'up'}]}});
   const verification=await stateApp.execute('verify_native_layout',{sessionId,commitId:applied.receipt!.commitId});expect(verification.passed).toBe(false);expect(verification.results).toContainEqual(expect.objectContaining({constraintId:'interaction:state-button',status:'unavailable'}));expect(await readFile(file,'utf8')).toContain('width:130');
   const reverted=await stateApp.execute('revert_commit',{sessionId,commitId:applied.receipt!.commitId});const revertVerification=await stateApp.execute('verify_native_layout',{sessionId,commitId:reverted.receipt.commitId});expect(revertVerification.passed).toBe(false);expect(revertVerification.results).toContainEqual(expect.objectContaining({constraintId:'interaction:state-button',status:'unavailable'}));
  }finally{await writeFile(file,original);await stateApp.close();}
 },90000);
 it('uses computed text fill and withholds contrast for stroked or inactive text',async()=>{
  const scenarioId='contrast-evidence',opened=await call('open_session',{projectRoot:project,webUrl:'http://localhost:18081/?scenario='+scenarioId,scenarioId,profile:spec.profile,nativePort:19491,nativeToken:'nativemason-integration-token'});
  try{
   const result=await call('inspect_accessibility',{sessionId:opened.sessionId,target:'web'}),node=(id:string)=>result.snapshot.nodes.find((item:any)=>item.id===id);
   expect(node('text-fill').accessibility.browser.contrast).toMatchObject({status:'measured',ratio:1});
   expect(node('text-stroke').accessibility.browser.contrast).toMatchObject({status:'unavailable',reason:expect.stringContaining('Text stroke')});
   expect(node('disabled-label').accessibility.browser.contrast).toMatchObject({status:'unavailable',reason:expect.stringContaining('inactive control')});
   expect(result.findings).not.toContainEqual(expect.objectContaining({code:'TEXT_CONTRAST',status:'fail',elementIds:['disabled-label']}));
  }finally{await call('close_session',{sessionId:opened.sessionId});}
 },90000);
});
