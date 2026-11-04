import {importDesignIntent} from '../core/design-intent.js';
import {inspectAccessibility} from '../core/accessibility.js';
import {createNativeScenarioPort,createNativeProfilePort} from '../scenario/index.js';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BridgeFault, ToolSchemas, ToolOutputSchemas, type ToolOutput, type ToolName, type ToolInput, type BrowserPort, type NativePort, type SourcePort, type SpatialSnapshot, type Trial, type WireframeSpec, type CommitReceipt, type EditPlan,type TransactionPlan, type DeviceProfile, type ScenarioPort,type NativeProfilePort,type TransactionSourcePort, type CommitReceipt as Receipt, type NativeConnectionOptions,type InteractionRequirement } from '@nativemason/contracts';
import { evaluateConstraints,diffSnapshots,buildOverlayScene,profilesMatch,generateFixCandidates,inferConstraints,evaluateDefaultRules } from '../core/index.js';
import { createBrowserBridge } from '../browser/index.js';
import { createNativeBridge } from '../native/index.js';
import { createTransactionSourcePort,planTransaction } from '../editor/index.js';
import { renderOverlay } from '../overlay/index.js';

type ClosableNative = NativePort & {close():Promise<void>};
interface Dependencies {
  browser(options:{webUrl:string;sessionId:string;scenarioId:string;profile:DeviceProfile;timeoutMs?:number}):Promise<BrowserPort>;
  native(options:NativeConnectionOptions):Promise<ClosableNative>;
  source(root:string):SourcePort;
  artifactsRoot:string;
}
interface Session {
  id:string;webUrl:string;browser:BrowserPort;native:ClosableNative;source:SourcePort;scenarioId:string;profile:DeviceProfile;
  spec?:WireframeSpec;baseline?:SpatialSnapshot;baselineSpec?:WireframeSpec;baselineOverrideKey?:string;baselineOverrides?:ToolInput<'inspect_ui_spatial_graph'>['profileOverrides'];trial?:Trial;
  snapshots:Map<string,SpatialSnapshot>;commits:Map<string,{receipt:CommitReceipt;web:SpatialSnapshot|null;plan:EditPlan;transactionPlan?:TransactionPlan;trialId:string;spec:WireframeSpec;pendingNativeConstraints:string[];interactions:InteractionRequirement[]}>;
  nativeScenario?:ScenarioPort;nativeProfiles?:NativeProfilePort;busy:boolean;nativeTarget?:ToolInput<'open_session'>['nativeTarget'];
}
function allPass(results:ReturnType<typeof evaluateConstraints>):boolean {return results.every(r=>r.status==='pass');}
function fingerprint(s:SpatialSnapshot):string {return JSON.stringify({platform:s.platform,profile:s.profile,scenario:s.scenarioId,generation:s.generation,states:s.nodes.filter(n=>n.pressableState!==undefined).map(n=>[n.id,n.pressableState]).sort(),revisions:Object.entries(s.revisions).sort()});}
function remember(s:Session,snapshot:SpatialSnapshot):void {s.snapshots.set(snapshot.snapshotId,snapshot);if(s.snapshots.size>32)s.snapshots.delete(s.snapshots.keys().next().value!);}
function pendingInteractions(snapshot:SpatialSnapshot,requirements:InteractionRequirement[]):InteractionRequirement[]{return requirements.filter(requirement=>snapshot.nodes.find(node=>node.id===requirement.elementId)?.pressableState!==(requirement.pressed?'pressed':'rest'));}
function overrideKey(value:ToolInput<'inspect_ui_spatial_graph'>['profileOverrides']):string{return JSON.stringify(value??{});}
function specForProfile(spec:WireframeSpec,snapshot:SpatialSnapshot):WireframeSpec{return {...spec,profile:snapshot.profile};}

export class BridgeApplication {
  private sessions=new Map<string,Session>();
  private deps:Dependencies;
  constructor(deps:Partial<Dependencies>={}) {
    this.deps={browser:createBrowserBridge,native:createNativeBridge,source:createTransactionSourcePort,artifactsRoot:path.resolve('artifacts/nativemason'),...deps};
  }
  async execute<K extends ToolName>(name:K,input:unknown):Promise<ToolOutput<K>> {
    return ToolOutputSchemas[name].parse(await this.dispatch(name,input)) as ToolOutput<K>;
  }
  private async dispatch(name:ToolName,input:unknown):Promise<unknown> {
    const parsed=ToolSchemas[name].safeParse(input);
    if(!parsed.success)throw new BridgeFault('INVALID_INPUT',parsed.error.message);
    if(name==='open_session') return this.open(parsed.data as ToolInput<'open_session'>);
    const sessionId=(parsed.data as {sessionId:string}).sessionId;
    const s=this.sessions.get(sessionId);
    if(!s)throw new BridgeFault('SESSION_NOT_FOUND','Session does not exist');
    if(s.busy)throw new BridgeFault('INVALID_INPUT','Another operation is in progress for this session');
    s.busy=true;
    try {
      switch(name) {
        case 'import_design_intent': {const {design}=ToolSchemas.import_design_intent.parse(input);if(design.scenarioId!==s.scenarioId||!profilesMatch(design.profile,s.profile))throw new BridgeFault('INVALID_INPUT','Design target must match the session scenario and profile');return importDesignIntent(design);}
        case 'inspect_accessibility': {const {target}=ToolSchemas.inspect_accessibility.parse(input);let snapshot:SpatialSnapshot;if(target==='native')snapshot=await s.native.capture((await this.capture(s)).revisions);else snapshot=s.browser.captureAccessibility?await s.browser.captureAccessibility():await this.capture(s);remember(s,snapshot);return {snapshot,findings:inspectAccessibility(snapshot)};}
        case 'load_wireframe_spec': {
          const {spec}=ToolSchemas.load_wireframe_spec.parse(input);
          if(spec.scenarioId!==s.scenarioId||!profilesMatch(spec.profile,s.profile))throw new BridgeFault('INVALID_INPUT','Spec scenario and profile must match the session');
          s.spec=spec;s.trial=undefined;s.baseline=undefined;s.baselineSpec=undefined;s.baselineOverrideKey=undefined;s.baselineOverrides=undefined;
          return {specId:randomUUID()};
        }
        case 'inspect_ui_spatial_graph': {
          const {profileOverrides}=ToolSchemas.inspect_ui_spatial_graph.parse(input);
          await s.browser.resetTrial();s.trial=undefined;
          const snapshot=await this.capture(s,profileOverrides);s.baseline=snapshot;s.baselineOverrideKey=overrideKey(profileOverrides);s.baselineOverrides=profileOverrides?structuredClone(profileOverrides):undefined;
          s.baselineSpec=s.spec?specForProfile(s.spec,snapshot):undefined;
          return {snapshot,results:s.baselineSpec?evaluateConstraints(snapshot,s.baselineSpec):[],webDiagnostics:snapshot.webDiagnostics};
        }
        case 'capture_annotated_overlay': {
          const {snapshotId}=ToolSchemas.capture_annotated_overlay.parse(input);
          const snapshot=s.snapshots.get(snapshotId);
          if(!snapshot)throw new BridgeFault('STALE_SNAPSHOT','Snapshot no longer exists');
          if(snapshot.platform!=='web')throw new BridgeFault('UNSUPPORTED_ACTION','Annotated overlays require a browser snapshot');
          const live=await s.browser.capture();
          if(fingerprint(live)!==fingerprint(snapshot)||JSON.stringify(live.nodes.map(n=>n.rect))!==JSON.stringify(snapshot.nodes.map(n=>n.rect)))throw new BridgeFault('STALE_SNAPSHOT','Live UI no longer matches the requested screenshot');
          const scene=buildOverlayScene(snapshot,this.spec(s));
          const pixels=await s.browser.screenshot();
          const after=await s.browser.capture();
          if(fingerprint(after)!==fingerprint(snapshot)||JSON.stringify(after.nodes.map(n=>({id:n.id,rect:n.rect})))!==JSON.stringify(snapshot.nodes.map(n=>({id:n.id,rect:n.rect}))))throw new BridgeFault('STALE_SNAPSHOT','UI changed while capturing screenshot');
          const png=await renderOverlay(pixels,scene,s.profile.pixelRatio);
          const artifact=await this.artifact(s.id,`${snapshotId}.png`,png);
          return {image:Buffer.from(png).toString('base64'),mimeType:'image/png',artifact,marks:scene.marks};
        }
        case 'simulate_layout_mutation': {
          const {baselineSnapshotId,elementId,patch,mutations,profileOverrides}=ToolSchemas.simulate_layout_mutation.parse(input);
          const baseline=s.baseline;
          if(!baseline||baseline.snapshotId!==baselineSnapshotId)throw new BridgeFault('STALE_SNAPSHOT','Inspect the UI before starting a trial');
          if(overrideKey(profileOverrides)!==s.baselineOverrideKey)throw new BridgeFault('STALE_SNAPSHOT','Profile overrides differ from the inspected baseline; inspect again for each profile');
          await this.assertRevisions(s,baseline);
          if(mutations&&patch===null)throw new BridgeFault('INVALID_INPUT','Reset cannot include mutations');
          if(patch===null){await s.browser.resetTrial();s.trial=undefined;const snapshot=await this.capture(s,profileOverrides);s.baseline=snapshot;return {snapshot,results:s.baselineSpec?evaluateConstraints(snapshot,s.baselineSpec):[],webDiagnostics:snapshot.webDiagnostics};}
          if(mutations&&(elementId!==undefined||patch!==undefined))throw new BridgeFault('INVALID_INPUT','Supply either mutations or the single-element shorthand');
          const batch=mutations??(elementId&&patch?[{elementId,patch}]:[]);
          if(!batch.length||new Set(batch.map(m=>m.elementId)).size!==batch.length)throw new BridgeFault('INVALID_INPUT','Supply unique mutations or elementId and patch');
          for(const m of batch)if(!baseline.nodes.some(n=>n.id===m.elementId))throw new BridgeFault('MISSING_ELEMENT',m.elementId);
          s.trial=undefined;
          const snapshot=batch.length===1?await s.browser.trial(batch[0].elementId,batch[0].patch,profileOverrides):s.browser.trialBatch?await s.browser.trialBatch(batch,profileOverrides):(()=>{throw new BridgeFault('UNSUPPORTED_EDIT','Browser does not support batch trials');})();
          if(fingerprint(snapshot)!==fingerprint(baseline))throw new BridgeFault('STALE_SNAPSHOT','Layout identity changed during trial');
          remember(s,snapshot);
          const trial:Trial={trialId:randomUUID(),baselineSnapshotId,elementId:batch[0].elementId,patch:batch[0].patch,mutations:batch,snapshot,delta:diffSnapshots(baseline,snapshot),results:[...evaluateConstraints(snapshot,s.baselineSpec??this.spec(s))]};
          s.trial=trial;return {...trial,webDiagnostics:snapshot.webDiagnostics};
        }
        case 'find_elements': {const {query}=ToolSchemas.find_elements.parse(input);const snapshot=await this.capture(s);return {nodes:snapshot.nodes.filter(n=>[n.id,n.role,n.kind,n.source?.path].some(v=>v?.toLowerCase().includes(query.toLowerCase()))) };}
        case 'infer_constraints': {const {snapshotId,options}=ToolSchemas.infer_constraints.parse(input);const snapshot=s.snapshots.get(snapshotId);if(!snapshot)throw new BridgeFault('STALE_SNAPSHOT','Snapshot expired');return {spec:inferConstraints(snapshot,options),findings:evaluateDefaultRules(snapshot)};}
        case 'suggest_fix': return this.suggest(s,ToolSchemas.suggest_fix.parse(input));
        case 'run_scenario': {const {script,target}=ToolSchemas.run_scenario.parse(input);if(script.scenarioId!==s.scenarioId)throw new BridgeFault('INVALID_INPUT','Script scenario differs from session');await s.browser.resetTrial();s.trial=undefined;s.baseline=undefined;if(target==='native'){if(!s.nativeScenario)throw new BridgeFault('UNSUPPORTED_ACTION','Configure nativeTarget and nativeScenario on open_session');await s.nativeScenario.run(script);}else{if(!s.browser.runScenario)throw new BridgeFault('UNSUPPORTED_ACTION','Browser scenario driver unavailable');await s.browser.runScenario(script);}const snapshot=target==='native'?await s.native.capture((await this.capture(s)).revisions):await this.capture(s);return {snapshot,results:s.spec?evaluateConstraints(snapshot,s.spec):[]};}
        case 'run_profile_matrix': {const {script,profiles,target}=ToolSchemas.run_profile_matrix.parse(input);this.spec(s);if(script.scenarioId!==s.scenarioId)throw new BridgeFault('INVALID_INPUT','Script scenario differs from session');const cells=[];s.trial=undefined;s.baseline=undefined;for(const profile of profiles){try{if(script.scenarioId!==s.scenarioId)throw new BridgeFault('INVALID_INPUT','Script scenario differs from session');await s.browser.resetTrial();const run=async()=>{if(target==='native'){if(!s.nativeScenario)throw new BridgeFault('UNSUPPORTED_ACTION','Native scenario driver not configured');await s.nativeScenario.run(script);return s.native.capture((await this.capture(s)).revisions);}if(!s.browser.runScenario)throw new BridgeFault('UNSUPPORTED_ACTION','Browser scenario driver unavailable');await this.capture(s,profile);await s.browser.runScenario(script);return this.capture(s,profile);};if(target==='native'&&!s.nativeProfiles)throw new BridgeFault('UNSUPPORTED_ACTION','Native profile driver not configured');const snapshot=target==='native'?await s.nativeProfiles!.withProfile(profile,run):await run();if(snapshot.status!=='stable')throw new BridgeFault('UNSTABLE_LAYOUT','Matrix layout did not settle');if((profile.fontScale!==undefined&&Math.abs(snapshot.profile.fontScale-profile.fontScale)>0.01)||(profile.orientation&&snapshot.profile.orientation!==profile.orientation))throw new BridgeFault('UNSUPPORTED_PROFILE','Measured native profile differs');const results=s.spec?evaluateConstraints(snapshot,specForProfile(s.spec,snapshot)):[];cells.push({targetId:target==='native'?(s.nativeTarget?.targetId??'native'):'web',scenarioId:script.scenarioId,orientation:snapshot.profile.orientation,fontScale:snapshot.profile.fontScale,status:results.length&&allPass(results)?'passed':'failed',snapshotId:snapshot.snapshotId});}catch(error){cells.push({targetId:target,scenarioId:script.scenarioId,orientation:profile.orientation??s.profile.orientation,fontScale:profile.fontScale??s.profile.fontScale,status:error instanceof BridgeFault&&['UNSUPPORTED_PROFILE','UNSUPPORTED_ACTION'].includes(error.code)?'unsupported':'unavailable',message:error instanceof Error?error.message:String(error)});}}await s.browser.resetTrial();await this.artifact(s.id,'matrix.json',JSON.stringify(cells,null,2));return {cells};}
        case 'revert_commit': {
          const {commitId}=ToolSchemas.revert_commit.parse(input);const source=s.source as TransactionSourcePort;
          if(!source.revert)throw new BridgeFault('UNSUPPORTED_EDIT','Source adapter cannot revert');
          const original=s.commits.get(commitId),spec=structuredClone(original?.spec??this.spec(s));
          const tx=await source.revert(commitId),first=tx.files[0];
          const receipt:Receipt={...tx,...first,diff:tx.files.map(f=>f.diff).join('\n')};
          s.baseline=undefined;s.trial=undefined;
          const file=await source.read(first.path);
          const plan:EditPlan={source:{path:first.path,hash:first.newHash,start:0,end:1,line:1,column:0},expectedHash:first.oldHash,updatedText:file.text,diff:first.diff};
          const entry={receipt,web:null as SpatialSnapshot|null,plan,trialId:'revert:'+commitId,spec,pendingNativeConstraints:original?.pendingNativeConstraints??[],interactions:original?.interactions??[]};
          s.commits.set(receipt.commitId,entry);
          entry.web=await this.captureCommitted(s,receipt);
          return {receipt,snapshot:entry.web,nativeStatus:'pending'};
        }
        case 'commit_rn_ast_patch': return await this.commit(s,ToolSchemas.commit_rn_ast_patch.parse(input));
        case 'verify_native_layout': return await this.verify(s,ToolSchemas.verify_native_layout.parse(input).commitId);
        case 'close_session': {
          const closed=await Promise.allSettled([s.browser.close(),s.native.close(),s.nativeScenario?.close()]);this.sessions.delete(s.id);
          const failure=closed.find(x=>x.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
          return {closed:true};
        }
      }
    } finally {s.busy=false;}
  }
  private async suggest(s:Session,input:ToolInput<'suggest_fix'>) {
    const baseline=s.baseline;
    if(!baseline||baseline.snapshotId!==input.baselineSnapshotId)throw new BridgeFault('STALE_SNAPSHOT','Inspect again');
    await this.assertRevisions(s,baseline);
    const candidates:ToolOutput<'suggest_fix'>['candidates']=[];
    const primarySpec=s.baselineSpec??this.spec(s);
    if(input.profiles?.some(p=>p.script&&p.script.scenarioId!==s.scenarioId))throw new BridgeFault('INVALID_INPUT','Profile scenario scripts must match the session scenario');
    type Evidence=NonNullable<ToolOutput<'suggest_fix'>['candidates'][number]['profiles']>[number];
    const contexts:{id:string;profile:DeviceProfile;port?:BrowserPort;snapshot?:SpatialSnapshot;spec?:WireframeSpec;scenarioState?:NonNullable<Evidence['scenarioState']>;error?:Evidence['error']}[]=[{id:'baseline',profile:baseline.profile,port:s.browser,snapshot:baseline,spec:primarySpec,scenarioState:'baseline'}];
    const opened:BrowserPort[]=[];
    let baselines:Evidence[]=[];
    const errorValue=(error:unknown):NonNullable<Evidence['error']>=>({code:error instanceof BridgeFault?error.code:'INTERNAL_ERROR',message:error instanceof Error?error.message:String(error)});
    const resultStatus=(results:ReturnType<typeof evaluateConstraints>):Evidence['status']=>!results.length||results.some(result=>result.status==='unavailable')?'unavailable':allPass(results)?'passed':'failed';
    const unavailableProfile=(error:Evidence['error']):Evidence['status']=>error?.code==='UNSUPPORTED_PROFILE'||error?.code==='UNSUPPORTED_ACTION'?'unsupported':'unavailable';
    let nativeBaseline:ToolOutput<'suggest_fix'>['nativeBaseline'];
    s.trial=undefined;
    try {
      if(input.includeNativeEvidence){
        try{
          const snapshot=await s.native.capture(baseline.revisions);
          const ids=snapshot.nodes.map(node=>node.id);
          if(snapshot.platform==='web'||snapshot.status!=='stable'||snapshot.sessionId!==s.id||snapshot.scenarioId!==s.scenarioId||!profilesMatch(snapshot.profile,baseline.profile)||new Set(ids).size!==ids.length||Object.entries(baseline.revisions).some(([file,revision])=>snapshot.revisions[file]!==revision)||(s.nativeTarget&&(snapshot.platform!==s.nativeTarget.platform||snapshot.nativeTarget?.targetId!==s.nativeTarget.targetId)))throw new BridgeFault('STALE_SNAPSHOT','Native baseline does not match the current session, profile, and source revisions');
          await this.assertRevisions(s,snapshot);
          nativeBaseline={status:'captured',snapshot,results:[...evaluateConstraints(snapshot,primarySpec)]};
        }catch(error){nativeBaseline={status:error instanceof BridgeFault&&['UNSUPPORTED_ACTION','UNSUPPORTED_PROFILE'].includes(error.code)?'unsupported':'unavailable',results:[],error:errorValue(error)};}
      }
      for(const requested of input.profiles??[]){
        const context:typeof contexts[number]={id:requested.id,profile:requested.profile};contexts.push(context);
        try{
          if(requested.profile.fontScale!==1)throw new BridgeFault('UNSUPPORTED_PROFILE','Chromium font-scale simulation has no rendered-text proof');
          const port=await this.deps.browser({sessionId:s.id,scenarioId:s.scenarioId,webUrl:s.webUrl,profile:requested.profile});opened.push(port);context.port=port;context.scenarioState='initial';
          if(requested.script){if(!port.runScenario)throw new BridgeFault('UNSUPPORTED_ACTION','Profile-specific scenarios require a browser scenario driver');await port.runScenario(requested.script);context.scenarioState='scripted';}
          context.snapshot=await port.capture();await this.assertRevisions(s,context.snapshot);context.spec=specForProfile(primarySpec,context.snapshot);
        }catch(error){context.error=errorValue(error);}
      }
      baselines=contexts.map(context=>{
        if(context.error)return {profileId:context.id,platform:'web',profile:context.profile,scenarioState:context.scenarioState,status:unavailableProfile(context.error),results:[],regressions:0,warnings:0,error:context.error};
        const results=evaluateConstraints(context.snapshot!,context.spec!);
        return {profileId:context.id,platform:'web',profile:context.profile,scenarioState:context.scenarioState,snapshotId:context.snapshot!.snapshotId,status:resultStatus(results),results:[...results],regressions:0,warnings:context.snapshot!.webDiagnostics?.warnings.filter(w=>w.severity==='confirmed').length??0};
      });
      const proposals=new Map<string,ReturnType<typeof generateFixCandidates>[number]>();
      for(const context of contexts)if(context.snapshot&&context.spec)for(const proposal of generateFixCandidates(context.snapshot,context.spec,input.limit)){const key=JSON.stringify(proposal.mutations);if(!proposals.has(key))proposals.set(key,proposal);}
      if(nativeBaseline?.status==='captured'&&nativeBaseline.snapshot)for(const proposal of generateFixCandidates(nativeBaseline.snapshot,primarySpec,input.limit)){const key=JSON.stringify(proposal.mutations);if(!proposals.has(key))proposals.set(key,proposal);}
      for(const candidate of [...proposals.values()].slice(0,input.limit)) {
        const evidence:Evidence[]=[];
        for(const context of contexts){
          try{
            if(context.error)throw new BridgeFault(context.error.code,context.error.message);
            const port=context.port!;
            if(candidate.mutations.length>1&&!port.trialBatch)throw new BridgeFault('UNSUPPORTED_EDIT','Browser adapter does not support a batch candidate');
            const overrides=context.id==='baseline'?s.baselineOverrides:undefined;
            const snapshot=port.trialBatch?await port.trialBatch(candidate.mutations,overrides):await port.trial(candidate.mutations[0].elementId,candidate.mutations[0].patch,overrides);
            await this.assertRevisions(s,snapshot);
            const results=[...evaluateConstraints(snapshot,context.spec!)],passes=new Set(evaluateConstraints(context.snapshot!,context.spec!).filter(r=>r.status==='pass').map(r=>r.constraintId));
            evidence.push({profileId:context.id,platform:'web',profile:snapshot.profile,scenarioState:context.scenarioState,snapshotId:snapshot.snapshotId,status:resultStatus(results),results,regressions:results.filter(r=>r.status==='fail'&&passes.has(r.constraintId)).length,warnings:snapshot.webDiagnostics?.warnings.filter(w=>w.severity==='confirmed').length??0});
          }catch(error){
            if(error instanceof BridgeFault&&['STALE_SOURCE','STALE_SNAPSHOT','SESSION_NOT_FOUND'].includes(error.code))throw error;
            const evidenceError=errorValue(error);evidence.push({profileId:context.id,platform:'web',profile:context.profile,scenarioState:context.scenarioState,status:unavailableProfile(evidenceError),results:[],regressions:0,warnings:0,error:evidenceError});
          }
        }
        const primary=evidence[0];candidates.push({...candidate,results:primary.results,warnings:primary.warnings,score:0,profiles:evidence,...(primary.error?{error:primary.error}:{})});
      }
    } finally {try{await s.browser.resetTrial();}finally{await Promise.allSettled(opened.map(port=>port.close()));}}
    const restored=await this.capture(s,s.baselineOverrides);
    if(fingerprint(restored)!==fingerprint(baseline)||JSON.stringify(restored.nodes.map(n=>n.rect))!==JSON.stringify(baseline.nodes.map(n=>n.rect))){s.baseline=undefined;throw new BridgeFault('STALE_SNAPSHOT','Candidate reset changed the baseline');}
    const unavailable=(candidate:typeof candidates[number])=>candidate.profiles?.filter(p=>p.status==='unavailable'||p.status==='unsupported').length??0;
    const regressions=(candidate:typeof candidates[number])=>candidate.profiles?.reduce((sum,p)=>sum+p.regressions,0)??0;
    const warnings=(candidate:typeof candidates[number])=>candidate.profiles?.reduce((sum,p)=>sum+p.warnings,0)??0;
    const remaining=(candidate:typeof candidates[number])=>candidate.profiles?.reduce((sum,p)=>sum+p.results.filter(result=>result.status==='fail').length,0)??0;
    const editSize=(candidate:typeof candidates[number])=>candidate.mutations.reduce((count,mutation)=>count+Object.keys(mutation.patch).length,0);
    candidates.sort((a,b)=>Number('error' in a)-Number('error' in b)||unavailable(a)-unavailable(b)||regressions(a)-regressions(b)||warnings(a)-warnings(b)||remaining(a)-remaining(b)||editSize(a)-editSize(b));
    const result={candidates:candidates.map((candidate,index)=>({...candidate,score:index+1})),baselineSnapshotId:input.baselineSnapshotId,baselines,...(input.includeNativeEvidence?{nativeBaseline}:{})};
    await this.artifact(s.id,'suggestions.json',JSON.stringify(result,null,2));return result;
  }
  private async open(input:ToolInput<'open_session'>) {
    if((input.nativePort===undefined)!==(input.nativeToken===undefined))throw new BridgeFault('INVALID_INPUT','nativePort and nativeToken must be supplied together');
    const id=randomUUID(),token=input.nativeToken??randomUUID(),port=input.nativePort??19482;
    const source=this.deps.source(input.projectRoot);
    const native=await this.deps.native({port,token,scenarioId:input.scenarioId,sessionId:id,targetId:input.nativeTarget?.targetId,platform:input.nativeTarget?.platform});
    let browser:BrowserPort;
    try {browser=await this.deps.browser({...input,sessionId:id});}catch(e){await native.close();throw e;}
    let nativeScenario:ScenarioPort|undefined,nativeProfiles:NativeProfilePort|undefined;
    if(input.nativeScenario){if(!input.nativeTarget){await Promise.allSettled([browser.close(),native.close()]);throw new BridgeFault('INVALID_INPUT','nativeScenario requires nativeTarget');}const options={...input.nativeScenario,target:input.nativeTarget,projectRoot:input.projectRoot,runHook:native.runHook?.bind(native),readProfile:async()=>(await native.capture({})).profile};nativeScenario=createNativeScenarioPort(options);nativeProfiles=createNativeProfilePort(options);try{await nativeProfiles.recover();}catch(error){await Promise.allSettled([browser.close(),native.close(),nativeScenario.close()]);throw error;}}
    this.sessions.set(id,{id,webUrl:input.webUrl,browser,native,source,scenarioId:input.scenarioId,profile:input.profile,snapshots:new Map(),commits:new Map(),busy:false,nativeTarget:input.nativeTarget,nativeScenario,nativeProfiles});
    return {sessionId:id,native:{port,token},capabilities:{trial:'rn-style-props',sourceEdits:'scoped-transactions',batchTrials:Boolean(browser.trialBatch),nativePlatforms:['android','ios'],nativeScenario:Boolean(nativeScenario),nativeVerification:'required'}};
  }
  private spec(s:Session):WireframeSpec {if(!s.spec)throw new BridgeFault('INVALID_INPUT','Load a wireframe specification first');return s.spec;}
  private async capture(s:Session,profileOverrides?:ToolInput<'inspect_ui_spatial_graph'>['profileOverrides']):Promise<SpatialSnapshot> {
    const snapshot=await s.browser.capture(profileOverrides);
    const expectedWindow=profileOverrides?.orientation&&profileOverrides.orientation!==s.profile.orientation ?
      {width:s.profile.window.height,height:s.profile.window.width}:s.profile.window;
    const dimensionsMatch=Math.abs(snapshot.profile.window.width-expectedWindow.width)<=0.01&&Math.abs(snapshot.profile.window.height-expectedWindow.height)<=0.01;
    if(snapshot.scenarioId!==s.scenarioId||(!profileOverrides&&!profilesMatch(snapshot.profile,s.profile))||
      (profileOverrides?.orientation&&snapshot.profile.orientation!==profileOverrides.orientation)||
      (profileOverrides?.fontScale!==undefined&&snapshot.profile.fontScale!==profileOverrides.fontScale)||!dimensionsMatch)
      throw new BridgeFault('STALE_SNAPSHOT','Runtime context differs from the requested session profile');
    if(snapshot.status!=='stable')throw new BridgeFault('UNSTABLE_LAYOUT','Layout did not settle');
    remember(s,snapshot);
    return snapshot;
  }
  private async assertRevisions(s:Session,snapshot:SpatialSnapshot) {
    for(const [file,hash]of Object.entries(snapshot.revisions))if((await s.source.read(file)).hash!==hash)throw new BridgeFault('STALE_SOURCE',`Source ${file} changed after capture`);
  }
  private async commit(s:Session,input:ToolInput<'commit_rn_ast_patch'>) {
    const replay=[...s.commits.values()].find(c=>c.trialId===input.trialId);
    if(replay){
      const files=replay.receipt.files??[replay.receipt];
      for(const file of files){
        const expected=input.expectedRevisions?.[file.path]??(files.length===1?input.expectedSourceHash:undefined);
        if(expected!==file.oldHash)throw new BridgeFault('STALE_SOURCE','Replay source hash differs',{path:file.path});
        if((await s.source.read(file.path)).hash!==file.newHash)throw new BridgeFault('STALE_SOURCE','Committed source changed',{path:file.path});
      }
      if(input.mode==='preview')return {plan:replay.plan,transactionPlan:replay.transactionPlan};
      if(replay.pendingNativeConstraints.length&&!input.allowNativePending)throw new BridgeFault('VERIFICATION_FAILED','Replay requires explicit allowNativePending for its deferred text-fit constraints');
      if(!replay.web)replay.web=await this.captureCommitted(s,replay.receipt);
      const pending=replay.web?pendingInteractions(replay.web,replay.interactions):replay.interactions;
      const webStatus=pending.length?'interaction-pending':replay.pendingNativeConstraints.length?'native-checks-pending':undefined;
      return {receipt:replay.receipt,snapshot:replay.web,...(replay.pendingNativeConstraints.length?{pendingNativeConstraints:replay.pendingNativeConstraints}:{}),...(pending.length?{pendingInteractions:pending}:{}),...(webStatus?{webStatus}:{})};
    }
    const trial=s.trial;
    if(!trial||trial.trialId!==input.trialId||!s.baseline)throw new BridgeFault('TRIAL_NOT_FOUND','Trial is no longer active');
    const trialSpec=s.baselineSpec??this.spec(s),trialIds=trial.results.map(result=>result.constraintId),allExpectedIds=[...trialSpec.requiredElementIds.map(id=>`required:${id}`),...trialSpec.constraints.map(rule=>rule.id)],expectedIds=[...trialSpec.requiredElementIds.filter(id=>!trial.snapshot.nodes.some(node=>node.id===id)).map(id=>`required:${id}`),...trialSpec.constraints.map(rule=>rule.id)];
    const deferred=trial.results.filter(result=>result.status==='unavailable');
    const pendingNativeConstraints:string[]=[];
    if(!allPass(trial.results)){
      const nodes=new Map(trial.snapshot.nodes.map(node=>[node.id,node]));
      const validDeferred=input.allowNativePending&&trial.snapshot.platform==='web'&&trial.snapshot.status==='stable'&&trial.snapshot.scenarioId===s.scenarioId&&profilesMatch(trial.snapshot.profile,s.profile)&&new Set(trial.snapshot.nodes.map(node=>node.id)).size===trial.snapshot.nodes.length&&new Set(allExpectedIds).size===allExpectedIds.length&&new Set(trialIds).size===trialIds.length&&expectedIds.length===trialIds.length&&expectedIds.every(id=>trialIds.includes(id))&&trialSpec.requiredElementIds.every(id=>nodes.has(id))&&deferred.length>0&&deferred.every(result=>{const rule=trialSpec.constraints.find(item=>item.id===result.constraintId),node=rule?.type==='textFits'?nodes.get(rule.elementId):undefined;return rule?.type==='textFits'&&!!node&&result.elementIds.length===1&&result.elementIds[0]===rule.elementId&&(!node.textFit||node.textFit.status==='unavailable');})&&trial.results.every(result=>result.status==='pass'||deferred.includes(result));
      if(!validDeferred)throw new BridgeFault('VERIFICATION_FAILED','Trial must pass every required constraint; only valid web text-fit evidence can be deferred to native');
      pendingNativeConstraints.push(...deferred.map(result=>result.constraintId));
    }
    if(input.mode==='apply'&&s.baseline&&!profilesMatch(s.baseline.profile,s.profile))throw new BridgeFault('UNSUPPORTED_PROFILE','Trials captured with profile overrides can be previewed but not committed for Android acceptance');
    if(input.mode==='apply'&&trial.snapshot.webDiagnostics?.warnings.some(w=>w.severity==='confirmed'))throw new BridgeFault('VERIFICATION_FAILED','Confirmed Chromium diagnostics must be resolved before applying this trial');
    const current=await s.browser.capture(s.baselineOverrides);
    if(fingerprint(current)!==fingerprint(trial.snapshot)||JSON.stringify(current.nodes.map(n=>n.rect))!==JSON.stringify(trial.snapshot.nodes.map(n=>n.rect)))throw new BridgeFault('STALE_SNAPSHOT','Trial layout changed before commit');
    await this.assertRevisions(s,s.baseline);
    const mutations=trial.mutations??[{elementId:trial.elementId,patch:trial.patch}];
    const source=s.source as TransactionSourcePort;
    const sourceMutations=mutations.map(m=>{const node=trial.snapshot.nodes.find(n=>n.id===m.elementId);if(!node?.source)throw new BridgeFault('UNSUPPORTED_EDIT','Source metadata missing');if(node.editReason==='Dynamic style expression')throw new BridgeFault('UNSUPPORTED_EDIT','Style callbacks are not source-editable');if(node.source.styleForm==='pressable-state'){if(input.scope?.kind!=='pressable-state'||!input.scope.state)throw new BridgeFault('UNSUPPORTED_EDIT','A supported callback requires explicit pressable-state scope and state');const active=current.nodes.find(n=>n.id===m.elementId)?.pressableState;if(node.pressableState!==input.scope.state||active!==input.scope.state)throw new BridgeFault('STALE_SNAPSHOT','Requested Pressable state is not the currently measured trial state');}if(input.expectedRevisions?.[node.source.path]!==undefined&&input.expectedRevisions[node.source.path]!==node.source.hash)throw new BridgeFault('STALE_SOURCE','Expected revision differs');if(input.expectedSourceHash&&input.expectedSourceHash!==node.source.hash)throw new BridgeFault('STALE_SOURCE','Expected hash differs');const instances=trial.snapshot.nodes.filter(n=>n.source?.path===node.source!.path&&n.source.start===node.source!.start);if(instances.length>1&&!input.scope?.acknowledgeInstances)throw new BridgeFault('UNSUPPORTED_EDIT','Repeated site requires acknowledgment');return {source:node.source,patch:m.patch,scope:input.scope??{kind:'local' as const}};});
    if(!input.expectedSourceHash&&!input.expectedRevisions)throw new BridgeFault('INVALID_INPUT','Expected source revisions are required');
    const files=source.readProject?await source.readProject():await Promise.all([...new Set(sourceMutations.map(m=>m.source.path))].map(p=>source.read(p)));
    const planned=planTransaction(files,sourceMutations);
    if(!planned.ok)throw new BridgeFault(planned.error.code,planned.error.message,planned.error.details);
    if(input.expectedSourceHash&&!input.expectedRevisions&&planned.value.files.some(file=>!sourceMutations.some(mutation=>mutation.source.path===file.source.path)))throw new BridgeFault('INVALID_INPUT','An imported style edit changes another file; supply expectedRevisions for every changed file');
    planned.value.intentId=trial.trialId;
    for(const consumer of planned.value.blastRadius.consumers){consumer.mountedIds=trial.snapshot.nodes.filter(n=>n.source?.path===consumer.source.path&&n.source.start===consumer.source.start).map(n=>n.id);consumer.requiredScenarios=consumer.mountedIds.length?[s.scenarioId]:[];}
    if(input.mode==='preview')return {plan:planned.value.files[0],transactionPlan:planned.value};
    if(input.scope?.kind==='shared'&&planned.value.blastRadius.consumers.some(consumer=>consumer.mountedIds.length===0))throw new BridgeFault('VERIFICATION_FAILED','Shared edits require measured coverage for every discovered consumer',{blastRadius:planned.value.blastRadius});
    for(const file of planned.value.files)if((input.expectedRevisions?.[file.source.path]??(planned.value.files.length===1?input.expectedSourceHash:undefined))!==file.expectedHash)throw new BridgeFault('STALE_SOURCE','Apply requires expected hashes for every changed file',{path:file.source.path});
    if(!source.applyTransaction)throw new BridgeFault('UNSUPPORTED_EDIT','Source adapter lacks transaction support');
    const tx=await source.applyTransaction(planned.value);
    const receipt:Receipt={...tx,...tx.files[0],diff:tx.files.map(f=>f.diff).join('\n')};
    const interactions:InteractionRequirement[]=mutations.flatMap(m=>trial.snapshot.nodes.find(n=>n.id===m.elementId)?.source?.styleForm==='pressable-state'?[{elementId:m.elementId,pressed:input.scope?.state==='pressed'}]:[]);
    const entry={receipt,web:null as SpatialSnapshot|null,plan:planned.value.files[0],transactionPlan:planned.value,trialId:trial.trialId,spec:structuredClone(trialSpec),pendingNativeConstraints,interactions};s.commits.set(receipt.commitId,entry);
    s.trial=undefined;s.baseline=undefined;
    // A source write can succeed even when HMR fails. Preserve and return its receipt.
    try {
      await this.artifact(s.id,`${receipt.commitId}.diff`,receipt.diff);
      entry.web=await this.captureCommitted(s,receipt);
      if(!entry.web)return {receipt,webStatus:'reload-timeout',nativeStatus:'pending'};
      const results=evaluateConstraints(entry.web,entry.spec),pending= pendingInteractions(entry.web,entry.interactions);
      await this.artifact(s.id,`${receipt.commitId}.web.json`,JSON.stringify({receipt,snapshot:entry.web,results},null,2));
      const onlyDeferredUnavailable=results.every(result=>result.status==='pass'||(result.status==='unavailable'&&pendingNativeConstraints.includes(result.constraintId)));
      const webStatus=!onlyDeferredUnavailable?'failed':pending.length?'interaction-pending':pendingNativeConstraints.length?'native-checks-pending':allPass(results)?'passed':'failed';
      return {receipt,snapshot:entry.web,results,webStatus,...(pendingNativeConstraints.length?{pendingNativeConstraints}:{}),...(pending.length?{pendingInteractions:pending}:{})};
    }catch(e){const failure={receipt,webStatus:'capture-failed',message:e instanceof Error?e.message:String(e)};await this.artifact(s.id,receipt.commitId+'.web-failure.json',JSON.stringify(failure,null,2)).catch(()=>undefined);return failure;}
  }
  private async verify(s:Session,commitId:string) {
    const entry=s.commits.get(commitId);
    if(!entry)throw new BridgeFault('INVALID_INPUT','Unknown commit');
    let currentWeb:SpatialSnapshot|null=null;
    try{currentWeb=await this.capture(s);}catch{/* A committed reload may still be settling; retry through the bounded reload waiter below. */}
    const files=entry.receipt.files??[entry.receipt];
    if(currentWeb&&files.every(file=>currentWeb!.revisions[file.path]===file.newHash))entry.web=currentWeb;
    else entry.web=await this.captureCommitted(s,entry.receipt);
    if(!entry.web)throw new BridgeFault('VERIFICATION_FAILED','Committed web result has not been captured; retry after reload');
    await this.assertRevisions(s,entry.web);
    const snapshot=await s.native.capture(entry.web.revisions);
    const results=[...evaluateConstraints(snapshot,entry.spec)];
    const sameSources=Object.entries(entry.web.revisions).every(([p,h])=>snapshot.revisions[p]===h);
    const sameElements=entry.web.nodes.length===snapshot.nodes.length&&entry.web.nodes.every(n=>snapshot.nodes.some(other=>n.id===other.id));
    const webResults=evaluateConstraints(entry.web,entry.spec),webRequiredPass=webResults.every(result=>result.status==='pass'||(result.status==='unavailable'&&entry.pendingNativeConstraints.includes(result.constraintId)));
    const pendingWebInteractions=pendingInteractions(entry.web,entry.interactions),pendingNativeInteractions=pendingInteractions(snapshot,entry.interactions);
    for(const requirement of entry.interactions)if(pendingWebInteractions.some(item=>item.elementId===requirement.elementId)||pendingNativeInteractions.some(item=>item.elementId===requirement.elementId))results.push({constraintId:`interaction:${requirement.elementId}`,status:'unavailable',elementIds:[requirement.elementId],deviation:null,tolerance:0,message:`Required ${requirement.pressed?'pressed':'rest'} interaction state was not measured on both web and native`});
    const targetMatches=snapshot.platform===(s.nativeTarget?.platform??'android')&&(!s.nativeTarget||snapshot.nativeTarget?.targetId===s.nativeTarget.targetId);
    const passed=targetMatches&&snapshot.status==='stable'&&snapshot.scenarioId===s.scenarioId&&snapshot.sessionId===s.id&&sameSources&&sameElements&&allPass(results)&&webRequiredPass&&!pendingWebInteractions.length&&!pendingNativeInteractions.length;
    entry.receipt.nativeStatus=passed?'passed':results.some(result=>result.status==='fail')?'failed':'pending';
    const result={receipt:entry.receipt,snapshot,results,delta:diffSnapshots(entry.web,snapshot),passed};
    await this.artifact(s.id,`${commitId}.native.json`,JSON.stringify(result,null,2));return result;
  }
  private async captureCommitted(s:Session,receipt:CommitReceipt):Promise<SpatialSnapshot|null> {
    const files=receipt.files??[receipt];
    const assertFiles=async()=>{for(const file of files)if((await s.source.read(file.path)).hash!==file.newHash)throw new BridgeFault('STALE_SOURCE','Committed source changed before reload verification');};
    await assertFiles();
    await s.browser.resetTrial();
    const deadline=Date.now()+20_000;
    let lastError:unknown;
    do {
      await assertFiles();
      try {
        const snapshot=await this.capture(s);
        if(files.every(file=>snapshot.revisions[file.path]===file.newHash))return snapshot;
      } catch(error) {
        if(!(error instanceof BridgeFault)||!['STALE_SOURCE','STALE_SNAPSHOT','MISSING_ELEMENT','UNSTABLE_LAYOUT','TIMEOUT'].includes(error.code))throw error;
        lastError=error;
      }
      await new Promise(resolve=>setTimeout(resolve,100));
    }while(Date.now()<deadline);
    await this.artifact(s.id,receipt.commitId+'.reload-timeout.json',JSON.stringify({receipt,error:lastError instanceof Error?lastError.message:'Committed revisions did not arrive'},null,2));
    return null;
  }
  private async artifact(sessionId:string,name:string,data:string|Uint8Array):Promise<string> {
    const dir=path.join(this.deps.artifactsRoot,sessionId);await mkdir(dir,{recursive:true});const file=path.join(dir,name.replace(/[^a-zA-Z0-9_.-]/g,'_'));await writeFile(file,data);return file;
  }
  async close():Promise<void>{const sessions=[...this.sessions.values()];this.sessions.clear();await Promise.allSettled(sessions.flatMap(s=>[s.browser.close(),s.native.close(),...(s.nativeScenario?[s.nativeScenario.close()]:[])]));}
}
