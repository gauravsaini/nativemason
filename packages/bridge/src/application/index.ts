import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BridgeFault, ToolSchemas, ToolOutputSchemas, type ToolOutput, type ToolName, type ToolInput, type BrowserPort, type NativePort, type SourcePort, type SpatialSnapshot, type Trial, type WireframeSpec, type CommitReceipt, type EditPlan, type DeviceProfile, type NativeConnectionOptions } from '@rn-layout/contracts';
import { evaluateConstraints,diffSnapshots,buildOverlayScene,profilesMatch } from '../core/index.js';
import { createBrowserBridge } from '../browser/index.js';
import { createNativeBridge } from '../native/index.js';
import { createSourcePort,planSourcePatch } from '../editor/index.js';
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
  spec?:WireframeSpec;baseline?:SpatialSnapshot;baselineSpec?:WireframeSpec;baselineOverrideKey?:string;trial?:Trial;
  snapshots:Map<string,SpatialSnapshot>;commits:Map<string,{receipt:CommitReceipt;web:SpatialSnapshot|null;plan:EditPlan;trialId:string;spec:WireframeSpec}>;
  busy:boolean;
}
function allPass(results:ReturnType<typeof evaluateConstraints>):boolean {return results.every(r=>r.status==='pass');}
function fingerprint(s:SpatialSnapshot):string {return JSON.stringify({profile:s.profile,scenario:s.scenarioId,generation:s.generation,revisions:Object.entries(s.revisions).sort()});}
function overrideKey(value:ToolInput<'inspect_ui_spatial_graph'>['profileOverrides']):string{return JSON.stringify(value??{});}
function specForProfile(spec:WireframeSpec,snapshot:SpatialSnapshot):WireframeSpec{return {...spec,profile:snapshot.profile};}

export class BridgeApplication {
  private sessions=new Map<string,Session>();
  private deps:Dependencies;
  constructor(deps:Partial<Dependencies>={}) {
    this.deps={browser:createBrowserBridge,native:createNativeBridge,source:createSourcePort,artifactsRoot:path.resolve('artifacts'),...deps};
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
          s.spec=spec;s.trial=undefined;s.baseline=undefined;s.baselineSpec=undefined;s.baselineOverrideKey=undefined;
          return {specId:randomUUID()};
        }
        case 'inspect_ui_spatial_graph': {
          const {profileOverrides}=ToolSchemas.inspect_ui_spatial_graph.parse(input);
          await s.browser.resetTrial();s.trial=undefined;
          const snapshot=await this.capture(s,profileOverrides);s.baseline=snapshot;s.baselineOverrideKey=overrideKey(profileOverrides);
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
          const {baselineSnapshotId,elementId,patch,profileOverrides}=ToolSchemas.simulate_layout_mutation.parse(input);
          const baseline=s.baseline;
          if(!baseline||baseline.snapshotId!==baselineSnapshotId)throw new BridgeFault('STALE_SNAPSHOT','Inspect the UI before starting a trial');
          if(overrideKey(profileOverrides)!==s.baselineOverrideKey)throw new BridgeFault('STALE_SNAPSHOT','Profile overrides differ from the inspected baseline; inspect again for each profile');
          await this.assertRevisions(s,baseline);
          if(patch===null){await s.browser.resetTrial();s.trial=undefined;const snapshot=await this.capture(s,profileOverrides);s.baseline=snapshot;return {snapshot,results:s.baselineSpec?evaluateConstraints(snapshot,s.baselineSpec):[],webDiagnostics:snapshot.webDiagnostics};}
          if(!baseline.nodes.some(n=>n.id===elementId))throw new BridgeFault('MISSING_ELEMENT',`Element ${elementId} is absent`);
          s.trial=undefined;
          const snapshot=await s.browser.trial(elementId,patch,profileOverrides);
          if(fingerprint(snapshot)!==fingerprint(baseline))throw new BridgeFault('STALE_SNAPSHOT','Layout identity changed during trial');
          s.snapshots.set(snapshot.snapshotId,snapshot);
          const trial:Trial={trialId:randomUUID(),baselineSnapshotId,elementId,patch,snapshot,delta:diffSnapshots(baseline,snapshot),results:[...evaluateConstraints(snapshot,s.baselineSpec??this.spec(s))]};
          s.trial=trial;return {...trial,webDiagnostics:snapshot.webDiagnostics};
        }
        case 'commit_rn_ast_patch': return await this.commit(s,ToolSchemas.commit_rn_ast_patch.parse(input));
        case 'verify_native_layout': return await this.verify(s,ToolSchemas.verify_native_layout.parse(input).commitId);
        case 'close_session': {
          const closed=await Promise.allSettled([s.browser.close(),s.native.close()]);this.sessions.delete(s.id);
          const failure=closed.find(x=>x.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
          return {closed:true};
        }
      }
    } finally {s.busy=false;}
  }
  private async open(input:ToolInput<'open_session'>) {
    if((input.nativePort===undefined)!==(input.nativeToken===undefined))throw new BridgeFault('INVALID_INPUT','nativePort and nativeToken must be supplied together');
    const id=randomUUID(),token=input.nativeToken??randomUUID(),port=input.nativePort??19482;
    const source=this.deps.source(input.projectRoot);
    const native=await this.deps.native({port,token,scenarioId:input.scenarioId,sessionId:id});
    let browser:BrowserPort;
    try {browser=await this.deps.browser({...input,sessionId:id});}catch(e){await native.close();throw e;}
    this.sessions.set(id,{id,browser,native,source,scenarioId:input.scenarioId,profile:input.profile,snapshots:new Map(),commits:new Map(),busy:false});
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
    if(replay){if(input.expectedSourceHash!==replay.receipt.oldHash)throw new BridgeFault('STALE_SOURCE','Replay source hash differs');if((await s.source.read(replay.receipt.path)).hash!==replay.receipt.newHash)throw new BridgeFault('STALE_SOURCE','Committed source changed');if(!replay.web)replay.web=await this.captureCommitted(s,replay.receipt);return {receipt:replay.receipt,snapshot:replay.web};}
    const trial=s.trial;
    if(!trial||trial.trialId!==input.trialId||!s.baseline)throw new BridgeFault('TRIAL_NOT_FOUND','Trial is no longer active');
    if(!allPass(trial.results))throw new BridgeFault('VERIFICATION_FAILED','Trial must pass every required constraint before committing');
    if(input.mode==='apply'&&s.baseline&&!profilesMatch(s.baseline.profile,s.profile))throw new BridgeFault('UNSUPPORTED_PROFILE','Trials captured with profile overrides can be previewed but not committed for Android acceptance');
    if(input.mode==='apply'&&trial.snapshot.webDiagnostics?.warnings.some(w=>w.severity==='confirmed'))throw new BridgeFault('VERIFICATION_FAILED','Confirmed Chromium diagnostics must be resolved before applying this trial');
    const current=await s.browser.capture();
    if(fingerprint(current)!==fingerprint(trial.snapshot)||JSON.stringify(current.nodes.map(n=>n.rect))!==JSON.stringify(trial.snapshot.nodes.map(n=>n.rect)))throw new BridgeFault('STALE_SNAPSHOT','Trial layout changed before commit');
    await this.assertRevisions(s,s.baseline);
    const node=trial.snapshot.nodes.find(n=>n.id===trial.elementId)!;
    if(!node.source||!node.editable)throw new BridgeFault('UNSUPPORTED_EDIT',node.editReason??'Element lacks editable source metadata');
    const ref=node.source;
    if(trial.snapshot.nodes.filter(n=>n.source?.path===ref.path&&n.source.start===ref.start).length!==1)throw new BridgeFault('UNSUPPORTED_EDIT','Source site renders multiple instrumented instances');
    if(input.expectedSourceHash!==ref.hash)throw new BridgeFault('STALE_SOURCE','Expected hash differs from captured source');
    const source=await s.source.read(ref.path),planned=planSourcePatch(source.text,ref,trial.patch);
    if(!planned.ok)throw new BridgeFault(planned.error.code,planned.error.message);
    if(input.mode==='preview')return {plan:planned.value};
    const receipt=await s.source.apply(planned.value);
    const entry={receipt,web:null as SpatialSnapshot|null,plan:planned.value,trialId:trial.trialId,spec:structuredClone(s.baselineSpec??this.spec(s))};s.commits.set(receipt.commitId,entry);
    s.trial=undefined;s.baseline=undefined;
    // A source write can succeed even when HMR fails. Preserve and return its receipt.
    try {
      await this.artifact(s.id,`${receipt.commitId}.diff`,receipt.diff);
      entry.web=await this.captureCommitted(s,receipt);
      if(!entry.web)return {receipt,webStatus:'reload-timeout',nativeStatus:'pending'};
      const results=evaluateConstraints(entry.web,entry.spec);
      await this.artifact(s.id,`${receipt.commitId}.web.json`,JSON.stringify({receipt,snapshot:entry.web,results},null,2));
      return {receipt,snapshot:entry.web,results,webStatus:allPass(results)?'passed':'failed'};
    }catch(e){return {receipt,webStatus:'capture-failed',message:e instanceof Error?e.message:String(e)};}
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
    const passed=snapshot.platform==='android'&&snapshot.sessionId===s.id&&sameSources&&sameElements&&allPass(results)&&allPass(evaluateConstraints(entry.web,entry.spec));
    entry.receipt.nativeStatus=passed?'passed':'failed';
    const result={receipt:entry.receipt,snapshot,results,delta:diffSnapshots(entry.web,snapshot),passed};
    await this.artifact(s.id,`${commitId}.native.json`,JSON.stringify(result,null,2));return result;
  }
  private async captureCommitted(s:Session,receipt:CommitReceipt):Promise<SpatialSnapshot|null> {
    if((await s.source.read(receipt.path)).hash!==receipt.newHash)throw new BridgeFault('STALE_SOURCE','Committed source changed before reload verification');
    await s.browser.resetTrial();
    const deadline=Date.now()+20_000;
    do {
      const snapshot=await this.capture(s);
      if(snapshot.revisions[receipt.path]===receipt.newHash)return snapshot;
      await new Promise(resolve=>setTimeout(resolve,100));
    }while(Date.now()<deadline);
    return null;
  }
  private async artifact(sessionId:string,name:string,data:string|Uint8Array):Promise<string> {
    const dir=path.join(this.deps.artifactsRoot,sessionId);await mkdir(dir,{recursive:true});const file=path.join(dir,name.replace(/[^a-zA-Z0-9_.-]/g,'_'));await writeFile(file,data);return file;
  }
  async close():Promise<void>{const sessions=[...this.sessions.values()];this.sessions.clear();await Promise.allSettled(sessions.flatMap(s=>[s.browser.close(),s.native.close()]));}
}
