import {createNativeScenarioPort,createNativeProfilePort} from '../scenario/index.js';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BridgeFault, ToolSchemas, ToolOutputSchemas, type ToolOutput, type ToolName, type ToolInput, type BrowserPort, type NativePort, type SourcePort, type SpatialSnapshot, type Trial, type WireframeSpec, type CommitReceipt, type EditPlan,type TransactionPlan, type DeviceProfile, type ScenarioPort,type NativeProfilePort,type TransactionSourcePort, type CommitReceipt as Receipt, type NativeConnectionOptions } from '@nativemason/contracts';
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
  id:string;browser:BrowserPort;native:ClosableNative;source:SourcePort;scenarioId:string;profile:DeviceProfile;
  spec?:WireframeSpec;baseline?:SpatialSnapshot;baselineSpec?:WireframeSpec;baselineOverrideKey?:string;baselineOverrides?:ToolInput<'inspect_ui_spatial_graph'>['profileOverrides'];trial?:Trial;
  snapshots:Map<string,SpatialSnapshot>;commits:Map<string,{receipt:CommitReceipt;web:SpatialSnapshot|null;plan:EditPlan;transactionPlan?:TransactionPlan;trialId:string;spec:WireframeSpec}>;
  nativeScenario?:ScenarioPort;nativeProfiles?:NativeProfilePort;busy:boolean;nativeTarget?:ToolInput<'open_session'>['nativeTarget'];
}
function allPass(results:ReturnType<typeof evaluateConstraints>):boolean {return results.every(r=>r.status==='pass');}
function fingerprint(s:SpatialSnapshot):string {return JSON.stringify({profile:s.profile,scenario:s.scenarioId,generation:s.generation,revisions:Object.entries(s.revisions).sort()});}
function overrideKey(value:ToolInput<'inspect_ui_spatial_graph'>['profileOverrides']):string{return JSON.stringify(value??{});}
function specForProfile(spec:WireframeSpec,snapshot:SpatialSnapshot):WireframeSpec{return {...spec,profile:snapshot.profile};}

export class BridgeApplication {
  private sessions=new Map<string,Session>();
  private deps:Dependencies;
  constructor(deps:Partial<Dependencies>={}) {
    this.deps={browser:createBrowserBridge,native:createNativeBridge,source:createTransactionSourcePort,artifactsRoot:path.resolve('artifacts'),...deps};
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
          s.snapshots.set(snapshot.snapshotId,snapshot);
          const trial:Trial={trialId:randomUUID(),baselineSnapshotId,elementId:batch[0].elementId,patch:batch[0].patch,mutations:batch,snapshot,delta:diffSnapshots(baseline,snapshot),results:[...evaluateConstraints(snapshot,s.baselineSpec??this.spec(s))]};
          s.trial=trial;return {...trial,webDiagnostics:snapshot.webDiagnostics};
        }
        case 'find_elements': {const {query}=ToolSchemas.find_elements.parse(input);const snapshot=await this.capture(s);return {nodes:snapshot.nodes.filter(n=>[n.id,n.role,n.kind,n.source?.path].some(v=>v?.toLowerCase().includes(query.toLowerCase()))) };}
        case 'infer_constraints': {const {snapshotId,options}=ToolSchemas.infer_constraints.parse(input);const snapshot=s.snapshots.get(snapshotId);if(!snapshot)throw new BridgeFault('STALE_SNAPSHOT','Snapshot expired');return {spec:inferConstraints(snapshot,options),findings:evaluateDefaultRules(snapshot)};}
        case 'suggest_fix': return this.suggest(s,ToolSchemas.suggest_fix.parse(input));
        case 'run_scenario': {const {script,target}=ToolSchemas.run_scenario.parse(input);if(script.scenarioId!==s.scenarioId)throw new BridgeFault('INVALID_INPUT','Script scenario differs from session');await s.browser.resetTrial();s.trial=undefined;s.baseline=undefined;if(target==='native'){if(!s.nativeScenario)throw new BridgeFault('UNSUPPORTED_ACTION','Configure nativeTarget and nativeScenario on open_session');await s.nativeScenario.run(script);}else{if(!s.browser.runScenario)throw new BridgeFault('UNSUPPORTED_ACTION','Browser scenario driver unavailable');await s.browser.runScenario(script);}const snapshot=target==='native'?await s.native.capture((await this.capture(s)).revisions):await this.capture(s);return {snapshot,results:s.spec?evaluateConstraints(snapshot,s.spec):[]};}
        case 'run_profile_matrix': {const {script,profiles,target}=ToolSchemas.run_profile_matrix.parse(input);const cells=[];s.trial=undefined;s.baseline=undefined;for(const profile of profiles){try{if(script.scenarioId!==s.scenarioId)throw new BridgeFault('INVALID_INPUT','Script scenario differs from session');await s.browser.resetTrial();const run=async()=>{if(target==='native'){if(!s.nativeScenario)throw new BridgeFault('UNSUPPORTED_ACTION','Native scenario driver not configured');await s.nativeScenario.run(script);return s.native.capture((await this.capture(s)).revisions);}if(!s.browser.runScenario)throw new BridgeFault('UNSUPPORTED_ACTION','Browser scenario driver unavailable');await this.capture(s,profile);await s.browser.runScenario(script);return this.capture(s,profile);};if(target==='native'&&!s.nativeProfiles)throw new BridgeFault('UNSUPPORTED_ACTION','Native profile driver not configured');const snapshot=target==='native'?await s.nativeProfiles!.withProfile(profile,run):await run();if(snapshot.status!=='stable')throw new BridgeFault('UNSTABLE_LAYOUT','Matrix layout did not settle');if((profile.fontScale!==undefined&&Math.abs(snapshot.profile.fontScale-profile.fontScale)>0.01)||(profile.orientation&&snapshot.profile.orientation!==profile.orientation))throw new BridgeFault('UNSUPPORTED_PROFILE','Measured native profile differs');const results=s.spec?evaluateConstraints(snapshot,specForProfile(s.spec,snapshot)):[];cells.push({targetId:target==='native'?(s.nativeTarget?.targetId??'native'):'web',scenarioId:script.scenarioId,orientation:snapshot.profile.orientation,fontScale:snapshot.profile.fontScale,status:results.length&&allPass(results)?'passed':'failed',snapshotId:snapshot.snapshotId});}catch(error){cells.push({targetId:target,scenarioId:script.scenarioId,orientation:profile.orientation??s.profile.orientation,fontScale:profile.fontScale??s.profile.fontScale,status:error instanceof BridgeFault&&['UNSUPPORTED_PROFILE','UNSUPPORTED_ACTION'].includes(error.code)?'unsupported':'unavailable',message:error instanceof Error?error.message:String(error)});}}await s.browser.resetTrial();await this.artifact(s.id,'matrix.json',JSON.stringify(cells,null,2));return {cells};}
        case 'revert_commit': {
          const {commitId}=ToolSchemas.revert_commit.parse(input);const source=s.source as TransactionSourcePort;
          if(!source.revert)throw new BridgeFault('UNSUPPORTED_EDIT','Source adapter cannot revert');
          const original=s.commits.get(commitId),spec=structuredClone(original?.spec??this.spec(s));
          const tx=await source.revert(commitId),first=tx.files[0];
          const receipt:Receipt={...tx,...first,diff:tx.files.map(f=>f.diff).join('\n')};
          s.baseline=undefined;s.trial=undefined;
          const file=await source.read(first.path);
          const plan:EditPlan={source:{path:first.path,hash:first.newHash,start:0,end:1,line:1,column:0},expectedHash:first.oldHash,updatedText:file.text,diff:first.diff};
          const entry={receipt,web:null as SpatialSnapshot|null,plan,trialId:'revert:'+commitId,spec};
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
    const candidates=[];
    s.trial=undefined;
    try {
      for(const candidate of generateFixCandidates(baseline,s.baselineSpec??this.spec(s),input.limit)) {
        try {
          const snapshot=s.browser.trialBatch?await s.browser.trialBatch(candidate.mutations,s.baselineOverrides):await s.browser.trial(candidate.mutations[0].elementId,candidate.mutations[0].patch,s.baselineOverrides);
          const results=[...evaluateConstraints(snapshot,s.baselineSpec??this.spec(s))];
          const warnings=snapshot.webDiagnostics?.warnings.filter(w=>w.severity==='confirmed').length??0;
          candidates.push({...candidate,results,warnings,score:results.filter(r=>r.status!=='pass').length*1000+warnings*100+candidate.mutations.reduce((n,m)=>n+Object.keys(m.patch).length,0)});
        } catch(error) {
          if(error instanceof BridgeFault&&['STALE_SOURCE','STALE_SNAPSHOT','SESSION_NOT_FOUND'].includes(error.code))throw error;
          candidates.push({...candidate,results:[],warnings:0,score:100000,error:{code:error instanceof BridgeFault?error.code:'INTERNAL_ERROR' as const,message:error instanceof Error?error.message:String(error)}});
        }
      }
    } finally { await s.browser.resetTrial(); }
    const restored=await this.capture(s,s.baselineOverrides);
    if(fingerprint(restored)!==fingerprint(baseline)||JSON.stringify(restored.nodes.map(n=>n.rect))!==JSON.stringify(baseline.nodes.map(n=>n.rect))){s.baseline=undefined;throw new BridgeFault('STALE_SNAPSHOT','Candidate reset changed the baseline');}
    return {candidates:candidates.sort((a,b)=>a.score-b.score),baselineSnapshotId:input.baselineSnapshotId};
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
    this.sessions.set(id,{id,browser,native,source,scenarioId:input.scenarioId,profile:input.profile,snapshots:new Map(),commits:new Map(),busy:false,nativeTarget:input.nativeTarget,nativeScenario,nativeProfiles});
    return {sessionId:id,native:{port,token},capabilities:{trial:'rn-style-props',sourceEdits:'static-local-styles',nativeVerification:'required'}};
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
    s.snapshots.set(snapshot.snapshotId,snapshot);
    while(s.snapshots.size>32)s.snapshots.delete(s.snapshots.keys().next().value!);
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
      if(!replay.web)replay.web=await this.captureCommitted(s,replay.receipt);
      return {receipt:replay.receipt,snapshot:replay.web};
    }
    const trial=s.trial;
    if(!trial||trial.trialId!==input.trialId||!s.baseline)throw new BridgeFault('TRIAL_NOT_FOUND','Trial is no longer active');
    if(!allPass(trial.results))throw new BridgeFault('VERIFICATION_FAILED','Trial must pass every required constraint before committing');
    if(input.mode==='apply'&&s.baseline&&!profilesMatch(s.baseline.profile,s.profile))throw new BridgeFault('UNSUPPORTED_PROFILE','Trials captured with profile overrides can be previewed but not committed for Android acceptance');
    if(input.mode==='apply'&&trial.snapshot.webDiagnostics?.warnings.some(w=>w.severity==='confirmed'))throw new BridgeFault('VERIFICATION_FAILED','Confirmed Chromium diagnostics must be resolved before applying this trial');
    const current=await s.browser.capture(s.baselineOverrides);
    if(fingerprint(current)!==fingerprint(trial.snapshot)||JSON.stringify(current.nodes.map(n=>n.rect))!==JSON.stringify(trial.snapshot.nodes.map(n=>n.rect)))throw new BridgeFault('STALE_SNAPSHOT','Trial layout changed before commit');
    await this.assertRevisions(s,s.baseline);
    const mutations=trial.mutations??[{elementId:trial.elementId,patch:trial.patch}];
    const source=s.source as TransactionSourcePort;
    const sourceMutations=mutations.map(m=>{const node=trial.snapshot.nodes.find(n=>n.id===m.elementId);if(!node?.source)throw new BridgeFault('UNSUPPORTED_EDIT','Source metadata missing');if(node.editReason==='Dynamic style expression')throw new BridgeFault('UNSUPPORTED_EDIT','Style callbacks are not source-editable');if(input.expectedRevisions?.[node.source.path]!==undefined&&input.expectedRevisions[node.source.path]!==node.source.hash)throw new BridgeFault('STALE_SOURCE','Expected revision differs');if(input.expectedSourceHash&&input.expectedSourceHash!==node.source.hash)throw new BridgeFault('STALE_SOURCE','Expected hash differs');const instances=trial.snapshot.nodes.filter(n=>n.source?.path===node.source!.path&&n.source.start===node.source!.start);if(instances.length>1&&!input.scope?.acknowledgeInstances)throw new BridgeFault('UNSUPPORTED_EDIT','Repeated site requires acknowledgment');return {source:node.source,patch:m.patch,scope:input.scope??{kind:'local' as const}};});
    if(!input.expectedSourceHash&&!input.expectedRevisions)throw new BridgeFault('INVALID_INPUT','Expected source revisions are required');
    const files=source.readProject?await source.readProject():await Promise.all([...new Set(sourceMutations.map(m=>m.source.path))].map(p=>source.read(p)));
    const planned=planTransaction(files,sourceMutations);
    if(!planned.ok)throw new BridgeFault(planned.error.code,planned.error.message,planned.error.details);
    planned.value.intentId=trial.trialId;
    for(const consumer of planned.value.blastRadius.consumers){consumer.mountedIds=trial.snapshot.nodes.filter(n=>n.source?.path===consumer.source.path&&n.source.start===consumer.source.start).map(n=>n.id);consumer.requiredScenarios=consumer.mountedIds.length?[s.scenarioId]:[];}
    if(input.mode==='preview')return {plan:planned.value.files[0],transactionPlan:planned.value};
    if(input.scope?.kind==='shared'&&planned.value.blastRadius.consumers.some(consumer=>consumer.mountedIds.length===0))throw new BridgeFault('VERIFICATION_FAILED','Shared edits require measured coverage for every discovered consumer',{blastRadius:planned.value.blastRadius});
    for(const file of planned.value.files)if((input.expectedRevisions?.[file.source.path]??(planned.value.files.length===1?input.expectedSourceHash:undefined))!==file.expectedHash)throw new BridgeFault('STALE_SOURCE','Apply requires expected hashes for every changed file',{path:file.source.path});
    if(!source.applyTransaction)throw new BridgeFault('UNSUPPORTED_EDIT','Source adapter lacks transaction support');
    const tx=await source.applyTransaction(planned.value);
    const receipt:Receipt={...tx,...tx.files[0],diff:tx.files.map(f=>f.diff).join('\n')};
    const entry={receipt,web:null as SpatialSnapshot|null,plan:planned.value.files[0],transactionPlan:planned.value,trialId:trial.trialId,spec:structuredClone(s.baselineSpec??this.spec(s))};s.commits.set(receipt.commitId,entry);
    s.trial=undefined;s.baseline=undefined;
    // A source write can succeed even when HMR fails. Preserve and return its receipt.
    try {
      await this.artifact(s.id,`${receipt.commitId}.diff`,receipt.diff);
      entry.web=await this.captureCommitted(s,receipt);
      if(!entry.web)return {receipt,webStatus:'reload-timeout',nativeStatus:'pending'};
      const results=evaluateConstraints(entry.web,entry.spec);
      await this.artifact(s.id,`${receipt.commitId}.web.json`,JSON.stringify({receipt,snapshot:entry.web,results},null,2));
      return {receipt,snapshot:entry.web,results,webStatus:allPass(results)?'passed':'failed'};
    }catch(e){const failure={receipt,webStatus:'capture-failed',message:e instanceof Error?e.message:String(e)};await this.artifact(s.id,receipt.commitId+'.web-failure.json',JSON.stringify(failure,null,2));return failure;}
  }
  private async verify(s:Session,commitId:string) {
    const entry=s.commits.get(commitId);
    if(!entry)throw new BridgeFault('INVALID_INPUT','Unknown commit');
    if(!entry.web)entry.web=await this.captureCommitted(s,entry.receipt);
    if(!entry.web)throw new BridgeFault('VERIFICATION_FAILED','Committed web result has not been captured; retry after reload');
    await this.assertRevisions(s,entry.web);
    const snapshot=await s.native.capture(entry.web.revisions);
    const results=evaluateConstraints(snapshot,entry.spec);
    const sameSources=Object.entries(entry.web.revisions).every(([p,h])=>snapshot.revisions[p]===h);
    const sameElements=entry.web.nodes.length===snapshot.nodes.length&&entry.web.nodes.every(n=>snapshot.nodes.some(other=>n.id===other.id));
    const passed=snapshot.platform===(s.nativeTarget?.platform??'android')&&snapshot.sessionId===s.id&&sameSources&&sameElements&&allPass(results)&&allPass(evaluateConstraints(entry.web,entry.spec));
    entry.receipt.nativeStatus=passed?'passed':'failed';
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
