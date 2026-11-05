import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {access,readFile,writeFile} from 'node:fs/promises';
import {appendFileSync,mkdirSync} from 'node:fs';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {format,promisify} from 'node:util';
import {BridgeApplication} from '../../packages/bridge/src/application/index.js';
import {createBrowserBridge} from '../../packages/bridge/src/browser/index.js';
import {createNativeBridge} from '../../packages/bridge/src/native/index.js';
import {safeAreaRect} from '../../packages/bridge/src/core/index.js';
import {BridgeErrorSchema,BridgeFault,NativeScenarioFailureEvidenceSchema,ScenarioScriptSchema,type NativeTarget,type ScenarioScript,type SpatialSnapshot,type ToolOutput} from '@nativemason/contracts';

const root=process.cwd(),scenarioId='scroll-checkout',projectRoot=path.join(root,'examples/expo-fixture');
const runId=process.env.NM_NATIVE_SCENARIO_RUN_ID??`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`;
if(!/^[A-Za-z0-9-]{1,100}$/.test(runId))throw Error('NM_NATIVE_SCENARIO_RUN_ID must be a unique timestamp and UUID slug');
const runDir=path.join(root,'artifacts/native-scenarios',runId),runLog=path.join(runDir,'run.log');
mkdirSync(path.dirname(runDir),{recursive:true});
mkdirSync(runDir);
const required=(name:string)=>{const value=process.env[name];if(!value)throw Error(`Set ${name} explicitly`);return value;};
const command=promisify(execFile);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const ids={email:'checkout-email',toggle:'checkout-toggle',details:'checkout-details',scroll:'checkout-scroll',firstRow:'checkout-row-0',lastRow:'checkout-row-11',submit:'checkout-submit',success:'checkout-success'};
const inputValue=`native-actions-${Date.now()}@example.test`;
let currentStage='startup';
let failedStage:string|undefined;
let cleanupEvidence:Record<string,unknown>|undefined;
let sourceAfterSha256:string|undefined;

function log(...values:unknown[]){const line=`${new Date().toISOString()} ${format(...values)}`;appendFileSync(runLog,`${line}\n`);console.log(...values);}
function stage(name:string){currentStage=name;log(`NATIVE_STAGE_START ${name}`);}
function node(snapshot:SpatialSnapshot,id:string){const result=snapshot.nodes.find(item=>item.id===id);assert.ok(result,`Snapshot is missing ${id}`);return result;}
function keyboardVisible(dump:string){const match=dump.match(/mInputShown=(true|false)/);assert.ok(match,'ADB input_method output did not contain mInputShown evidence');return match[1]==='true';}
function rawInputText(xml:string,elementId:string,appId:string){
  const decode=(value:string)=>value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g,(_match,entity:string)=>entity.startsWith('#')?String.fromCodePoint(Number.parseInt(entity.slice(entity[1]==='x'?2:1),entity[1]==='x'?16:10)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[entity]!));
  assert.match(xml,/<hierarchy\b[\s\S]*<\/hierarchy>/,'ADB hierarchy must contain complete XML evidence');
  const matches=[...xml.matchAll(/<node\b(?:"[^"]*"|'[^']*'|[^'">])*>/g)].map(match=>new Map([...match[0].matchAll(/([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(attribute=>[attribute[1],decode(attribute[2]??attribute[3]??'')]))).filter(attributes=>attributes.get('resource-id')===elementId||attributes.get('resource-id')===`${appId}:id/${elementId}`);
  assert.equal(matches.length,1,`Raw hierarchy must contain exactly one ${elementId} input`);
  const attributes=matches[0]!;
  assert.equal(attributes.get('package'),appId,'Raw input evidence must belong to the selected app');
  assert.ok(attributes.has('text'),'Raw input evidence is missing its actual text attribute');
  return attributes.get('text')!;
}
function visibleHeight(rect:{y:number;height:number},viewport:{y:number;height:number}){return Math.max(0,Math.min(rect.y+rect.height,viewport.y+viewport.height)-Math.max(rect.y,viewport.y));}
function scrollViewport(snapshot:SpatialSnapshot){
  const viewport=node(snapshot,ids.scroll).rect,safe=safeAreaRect(snapshot.profile);
  const left=Math.max(safe.x,viewport.x),right=Math.min(safe.x+safe.width,viewport.x+viewport.width),top=Math.max(safe.y,viewport.y),bottom=Math.min(safe.y+safe.height,viewport.y+viewport.height);
  return {x:left,y:top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
}
function fullyVisible(snapshot:SpatialSnapshot,elementId:string){const rect=node(snapshot,elementId).rect,viewport=scrollViewport(snapshot);return rect.width>0&&rect.height>0&&rect.x>=viewport.x&&rect.x+rect.width<=viewport.x+viewport.width&&visibleHeight(rect,viewport)>=rect.height;}
async function revealMeasuredTarget(initial:SpatialSnapshot,elementId:string,swipe:()=>Promise<SpatialSnapshot>,record:(snapshot:SpatialSnapshot,attempt:number)=>Promise<void>){
  let snapshot=initial;
  await record(snapshot,0);
  for(let attempt=1;attempt<=6&&!fullyVisible(snapshot,elementId);attempt++){
    snapshot=await swipe();
    await record(snapshot,attempt);
  }
  return snapshot;
}
function evidenceSnapshot(snapshot:SpatialSnapshot){return {snapshotId:snapshot.snapshotId,platform:snapshot.platform,scenarioId:snapshot.scenarioId,status:snapshot.status,profile:snapshot.profile,revisions:snapshot.revisions,nodes:snapshot.nodes.map(({id,parentId,kind,rect,pressableState})=>({id,parentId,kind,rect,pressableState}))};}

async function main(){
  log('NATIVE_RUN_ARTIFACTS',runDir);
  const serial=required('ADB_SERIAL'),maestroPath=required('NM_MAESTRO_PATH'),token=required('EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN'),webUrl=required('NM_NATIVE_SCENARIO_WEB_URL'),appId=required('NM_NATIVE_SCENARIO_APP_ID');
  const nativePort=Number(required('NM_NATIVE_SCENARIO_PORT'));
  if(!Number.isInteger(nativePort)||nativePort<1024||nativePort>65535)throw Error('NM_NATIVE_SCENARIO_PORT must be a valid TCP port');
  if(token.length<16)throw Error('EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN must contain at least 16 characters');
  await access(maestroPath);
  const adb=async(args:string[])=> (await command('adb',['-s',serial,...args],{timeout:30000,maxBuffer:4*1024*1024})).stdout.trim();
  const assertRawInputText=async(expected:string,phase:'typed'|'reset')=>{
    const hierarchyFile=`/sdcard/nativemason-${runId}-${phase}.xml`;
    try{
      const focusedWindow=(await adb(['shell','dumpsys','window'])).split(/\r?\n/).find(line=>line.includes('mCurrentFocus='));
      assert.ok(focusedWindow?.includes(` ${appId}/`),'Raw input verification requires the selected app to remain focused');
      await adb(['shell','uiautomator','dump',hierarchyFile]);
      const hierarchy=await adb(['shell','cat',hierarchyFile]);
      assert.equal(rawInputText(hierarchy,ids.email,appId),expected,`Native ${phase} input must match actual raw text independently of its placeholder`);
    }finally{await adb(['shell','rm','-f',hierarchyFile]);}
  };
  stage('validate-selected-target');
  assert.equal(await adb(['get-state']),'device','Selected ADB target must be connected');
  assert.ok(Number(await adb(['shell','getprop','ro.build.version.sdk']))>=24,'Android API 24 or newer is required');
  assert.ok((await adb(['shell','pm','list','packages','--user','current',appId])).split(/\r?\n/).includes(`package:${appId}`),'The selected app package must be installed');

  stage('capture-run-baseline');
  const originalSource=await readFile(path.join(projectRoot,'App.tsx'),'utf8');
  const original={fontScale:await adb(['shell','settings','get','system','font_scale']),imeVisible:keyboardVisible(await adb(['shell','dumpsys','input_method'])),reverseMappings:(await adb(['reverse','--list'])).split(/\r?\n/).filter(Boolean)};
  const sourceBeforeSha256=hash(originalSource);
  const target:NativeTarget={targetId:serial,platform:'android',kind:'physical'},calibrationId=`scenario-calibration-${Date.now()}`;
  await writeFile(path.join(runDir,'run.json'),JSON.stringify({runId,scenarioId,target:{platform:target.platform,kind:target.kind},startedAt:new Date().toISOString(),sourceBeforeSha256,deviceBaseline:original},null,2));

  const app=new BridgeApplication({artifactsRoot:runDir,browser:options=>createBrowserBridge({...options,timeoutMs:90000}),native:options=>createNativeBridge({...options,timeoutMs:45000})});
  let sessionId:string|undefined,successEvidence:Record<string,unknown>|undefined;
  let initialRevisions:Record<string,string>|undefined,sourceRevisionHashesBefore:Record<string,string>|undefined;
  const run=async(targetName:'web'|'native',script:ScenarioScript):Promise<ToolOutput<'run_scenario'>>=>app.execute('run_scenario',{sessionId:sessionId!,target:targetName,script});
  const make=(actions:ScenarioScript['actions'],reset:ScenarioScript['reset']=[]):ScenarioScript=>ScenarioScriptSchema.parse({scenarioId,reset,actions});
  const wait=(elementId:string)=>({type:'wait' as const,elementId,timeoutMs:15000});
  const reset=[{type:'hook' as const,name:'resetCheckout'}];
  const scrollEvidence:Record<string,{attempt:number;snapshotId:string;elementId:string;rect:SpatialSnapshot['nodes'][number]['rect'];viewport:SpatialSnapshot['nodes'][number]['rect'];visibleHeight:number;fullyVisible:boolean}[]>={};
  const recordScroll=async(snapshot:SpatialSnapshot,elementId:string,attempt:number,label:string)=>{
    const rect=node(snapshot,elementId).rect,viewport=scrollViewport(snapshot);
    (scrollEvidence[label]??=[])[attempt]={attempt,snapshotId:snapshot.snapshotId,elementId,rect,viewport,visibleHeight:visibleHeight(rect,viewport),fullyVisible:fullyVisible(snapshot,elementId)};
    await writeFile(path.join(runDir,'scroll.json'),JSON.stringify(scrollEvidence,null,2));
  };
  const reveal=async(platform:'web'|'native',elementId:string,initial:SpatialSnapshot,direction:'UP'|'DOWN',label:string)=>revealMeasuredTarget(initial,elementId,async()=>(await run(platform,make([{type:'swipe',elementId:ids.scroll,direction}]))).snapshot,(snapshot,attempt)=>recordScroll(snapshot,elementId,attempt,label));
  try{
    stage('verify-initial-ime-hidden');
    assert.equal(original.imeVisible,false,'The native scenario requires the keyboard hidden at startup');
    stage('native-calibration-capture');
    const calibration=await createNativeBridge({port:nativePort,token,scenarioId,sessionId:calibrationId,platform:'android',targetId:serial,timeoutMs:45000});
    let calibrated:SpatialSnapshot;
    try{calibrated=await calibration.capture({});}finally{await calibration.close();}
    assert.equal(calibrated.platform,'android');assert.equal(calibrated.scenarioId,scenarioId);assert.equal(calibrated.nativeTarget?.targetId,serial);

    stage('open-session');
    const opened=await app.execute('open_session',{projectRoot,webUrl,scenarioId,profile:calibrated.profile,nativeTarget:target,nativeScenario:{appId,adbSerial:serial,maestroPath},nativePort,nativeToken:token});
    sessionId=opened.sessionId;
    stage('load-empty-spec');
    await app.execute('load_wireframe_spec',{sessionId,spec:{schemaVersion:1,scenarioId,profile:calibrated.profile,requiredElementIds:[],constraints:[]}});

    stage('web-reset-initial-state');const webInitialState=await run('web',make([],reset));
    stage('native-reset-initial-state');const nativeInitialState=await run('native',make([],reset));
    stage('web-initial-input-scroll');const webInitialVisible=await reveal('web',ids.email,webInitialState.snapshot,'DOWN','web-initial-down');
    stage('native-initial-input-scroll');const nativeInitialVisible=await reveal('native',ids.email,nativeInitialState.snapshot,'DOWN','native-initial-down');
    assert.ok(fullyVisible(webInitialVisible,ids.email)&&fullyVisible(nativeInitialVisible,ids.email),'Initial reset must reveal the input in the safe viewport');
    const initialScript=make([wait(ids.email),wait(ids.scroll),wait(ids.toggle)]);
    stage('web-reset-and-initial-capture');const webInitial=await run('web',initialScript);
    stage('native-reset-and-initial-capture');const nativeInitial=await run('native',initialScript);
    assert.equal(webInitial.snapshot.scenarioId,scenarioId);assert.equal(nativeInitial.snapshot.platform,'android');
    assert.deepEqual(nativeInitial.snapshot.profile,calibrated.profile,'Native profile must stay at its calibrated baseline before actions');
    assert.deepEqual(nativeInitial.snapshot.revisions,webInitial.snapshot.revisions,'Web and native must capture identical source revisions');
    assert.equal(nativeInitial.snapshot.nodes.some(item=>item.id===ids.details),false);
    assert.equal(nativeInitial.snapshot.nodes.some(item=>item.id===ids.success),false);
    initialRevisions=nativeInitial.snapshot.revisions;
    stage('hash-captured-source-revisions');
    sourceRevisionHashesBefore=Object.fromEntries(await Promise.all(Object.entries(initialRevisions).map(async([file,revision])=>{
      const resolved=path.resolve(projectRoot,file),relative=path.relative(projectRoot,resolved);
      assert.ok(relative&&!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative),`Captured source revision escapes the fixture: ${file}`);
      const actualHash=hash(await readFile(resolved,'utf8'));
      assert.equal(actualHash,revision,`Captured source revision differs from the current file: ${file}`);
      return [file,actualHash] as const;
    })));
    await writeFile(path.join(runDir,'run.json'),JSON.stringify({runId,scenarioId,target:{platform:target.platform,kind:target.kind},startedAt:new Date().toISOString(),sourceBeforeSha256,sourceRevisionHashesBefore,deviceBaseline:original},null,2));

    const typedScript=make([{type:'input',elementId:ids.email,text:inputValue,mode:'replace'}]);
    stage('web-typed-input');const webTyped=await run('web',typedScript);
    stage('native-typed-input-maestro-assertion');const nativeTyped=await run('native',typedScript);
    assert.equal(node(webTyped.snapshot,ids.email).id,ids.email);assert.equal(node(nativeTyped.snapshot,ids.email).id,ids.email);
    stage('native-raw-email-after-input');await assertRawInputText(inputValue,'typed');
    const keyboardShown=keyboardVisible(await adb(['shell','dumpsys','input_method']));
    assert.equal(keyboardShown,true,'Native text entry must show the software keyboard before dismissal');

    const hideKeyboard=make([{type:'keyboard',visible:false}]);
    stage('web-keyboard-dismissal');const webHidden=await run('web',hideKeyboard);
    stage('native-keyboard-dismissal');const nativeHidden=await run('native',hideKeyboard);
    const keyboardHidden=keyboardVisible(await adb(['shell','dumpsys','input_method']));
    assert.equal(keyboardHidden,false,'Maestro keyboard dismissal must leave the software keyboard hidden');
    assert.deepEqual(nativeHidden.snapshot.profile,calibrated.profile,'Device profile must return to baseline after keyboard dismissal');

    const expand=make([{type:'tap',elementId:ids.toggle},wait(ids.details)]);
    stage('web-expand-details');const webExpanded=await run('web',expand);
    stage('native-expand-details');const nativeExpanded=await run('native',expand);
    node(webExpanded.snapshot,ids.details);node(nativeExpanded.snapshot,ids.details);

    const collapse=make([{type:'tap',elementId:ids.toggle}]);
    stage('web-hide-details');const webCollapsed=await run('web',collapse);
    stage('native-hide-details');const nativeCollapsed=await run('native',collapse);
    assert.equal(webCollapsed.snapshot.nodes.some(item=>item.id===ids.details),false,'Toggle must hide the measured web details node');
    assert.equal(nativeCollapsed.snapshot.nodes.some(item=>item.id===ids.details),false,'Toggle must hide the measured native details node');
    stage('web-reexpand-details');const webReexpanded=await run('web',expand);
    stage('native-reexpand-details');const nativeReexpanded=await run('native',expand);
    node(webReexpanded.snapshot,ids.details);node(nativeReexpanded.snapshot,ids.details);

    stage('validate-submit-scroll-overflow');
    await recordScroll(webReexpanded.snapshot,ids.submit,0,'web-up');
    await recordScroll(nativeReexpanded.snapshot,ids.submit,0,'native-up');
    if(fullyVisible(webReexpanded.snapshot,ids.submit)||fullyVisible(nativeReexpanded.snapshot,ids.submit))throw new BridgeFault('UNSUPPORTED_PROFILE','The scroll fixture requires an initially overflowing submit button on both targets');
    stage('web-swipe-and-measure-viewport');const webScrolled={snapshot:await reveal('web',ids.submit,webReexpanded.snapshot,'UP','web-up')};
    stage('native-swipe-and-measure-viewport');const nativeScrolled={snapshot:await reveal('native',ids.submit,nativeReexpanded.snapshot,'UP','native-up')};
    const nativeLastBefore=node(nativeReexpanded.snapshot,ids.lastRow).rect,nativeLastAfter=node(nativeScrolled.snapshot,ids.lastRow).rect,nativeViewport=scrollViewport(nativeScrolled.snapshot);
    const webLastBefore=node(webReexpanded.snapshot,ids.lastRow).rect,webLastAfter=node(webScrolled.snapshot,ids.lastRow).rect,webViewport=scrollViewport(webScrolled.snapshot);
    const nativeSubmitBefore=node(nativeReexpanded.snapshot,ids.submit).rect,nativeSubmitAfter=node(nativeScrolled.snapshot,ids.submit).rect;
    const webSubmitBefore=node(webReexpanded.snapshot,ids.submit).rect,webSubmitAfter=node(webScrolled.snapshot,ids.submit).rect;
    assert.ok(nativeLastAfter.y<nativeLastBefore.y-10,'Native swipe must move the last row upward in measured viewport coordinates');
    assert.ok(visibleHeight(nativeSubmitAfter,nativeViewport)>visibleHeight(nativeSubmitBefore,scrollViewport(nativeReexpanded.snapshot)),'Native swipe must reveal more of the submit button inside the scroll viewport');
    assert.ok(webLastAfter.y<webLastBefore.y-10,'Matching web swipe must move the last row upward in measured viewport coordinates');
    assert.ok(visibleHeight(webSubmitAfter,webViewport)>visibleHeight(webSubmitBefore,scrollViewport(webReexpanded.snapshot)),'Web swipe must reveal more of the submit button inside the scroll viewport');
    assert.ok(fullyVisible(webScrolled.snapshot,ids.submit),'Web submit must be fully inside the measured scroll viewport before tapping');
    assert.ok(fullyVisible(nativeScrolled.snapshot,ids.submit),'Native submit must be fully inside the measured scroll viewport before tapping');
    const submit=make([{type:'tap',elementId:ids.submit}]);
    stage('web-submit-and-measure-success');const webSubmittedState=await run('web',submit);
    stage('native-submit-and-measure-success');const nativeSubmittedState=await run('native',submit);
    node(webSubmittedState.snapshot,ids.success);node(nativeSubmittedState.snapshot,ids.success);
    stage('web-reveal-success');const webSuccessVisible=await reveal('web',ids.success,webSubmittedState.snapshot,'UP','web-success-up');
    stage('native-reveal-success');const nativeSuccessVisible=await reveal('native',ids.success,nativeSubmittedState.snapshot,'UP','native-success-up');
    assert.ok(fullyVisible(webSuccessVisible,ids.success),'Web success message must become fully visible');
    assert.ok(fullyVisible(nativeSuccessVisible,ids.success),'Native success message must become fully visible');
    stage('web-success-wait');const webSubmitted=await run('web',make([wait(ids.success)]));
    stage('native-success-wait');const nativeSubmitted=await run('native',make([wait(ids.success)]));

    stage('web-reset-and-measure-state');const webResetState=await run('web',make([],reset));
    stage('native-reset-and-measure-state');const nativeResetState=await run('native',make([],reset));
    stage('web-restore-input-scroll');const webRestored=await reveal('web',ids.email,webResetState.snapshot,'DOWN','web-reset-down');
    stage('native-restore-input-scroll');const nativeRestored=await reveal('native',ids.email,nativeResetState.snapshot,'DOWN','native-reset-down');
    assert.ok(fullyVisible(webRestored,ids.email),'Web reset must restore the input to its measured scroll viewport');
    assert.ok(fullyVisible(nativeRestored,ids.email),'Native reset must restore the input to its measured scroll viewport');
    const resetScript=make([wait(ids.email),wait(ids.toggle)]);
    stage('web-reset-waits');const webReset=await run('web',resetScript);
    stage('native-reset-waits');const nativeReset=await run('native',resetScript);
    assert.equal(webReset.snapshot.nodes.some(item=>item.id===ids.details),false,'Reset hook must collapse the conditional details');
    assert.equal(webReset.snapshot.nodes.some(item=>item.id===ids.success),false,'Reset hook must clear the submitted state');
    assert.equal(nativeReset.snapshot.nodes.some(item=>item.id===ids.details),false,'Native reset hook must collapse the conditional details');
    assert.equal(nativeReset.snapshot.nodes.some(item=>item.id===ids.success),false,'Native reset hook must clear the submitted state');

    stage('native-raw-email-empty-after-reset');await assertRawInputText('','reset');

    const snapshots={web:{initial:webInitial.snapshot,typed:webTyped.snapshot,keyboardHidden:webHidden.snapshot,expanded:webExpanded.snapshot,collapsed:webCollapsed.snapshot,reexpanded:webReexpanded.snapshot,scrolled:webScrolled.snapshot,submitted:webSubmitted.snapshot,reset:webReset.snapshot},native:{initial:nativeInitial.snapshot,typed:nativeTyped.snapshot,keyboardHidden:nativeHidden.snapshot,expanded:nativeExpanded.snapshot,collapsed:nativeCollapsed.snapshot,reexpanded:nativeReexpanded.snapshot,scrolled:nativeScrolled.snapshot,submitted:nativeSubmitted.snapshot,reset:nativeReset.snapshot}};
    for(const [platform,stages]of Object.entries(snapshots))for(const [name,snapshot]of Object.entries(stages))assert.deepEqual(snapshot.revisions,initialRevisions,`${platform} ${name} capture changed source revisions`);
    const sourceRevisions=nativeInitial.snapshot.revisions,inputSha256=hash(inputValue);
    const metadata={scenarioId,target:{platform:'android',kind:'physical'},profile:calibrated.profile,sourceRevisions,sourceBeforeSha256,inputSha256};
    const typedMetadata={elementId:ids.email,mode:'replace',valueSha256:inputSha256};
    successEvidence={runId,scenarioId,target:metadata.target,profile:calibrated.profile,metadataSha256:hash(JSON.stringify(metadata)),typedMetadata,typedMetadataHash:hash(JSON.stringify(typedMetadata)),sourceSha256:{before:sourceBeforeSha256},sourceRevisionHashesBefore,sourceRevisions,inputSha256,deviceBaseline:original,keyboard:{visibleAfterInput:keyboardShown,visibleAfterDismiss:keyboardHidden},scroll:{targetElementId:ids.submit,measurements:scrollEvidence,nativeLastRowYBefore:nativeLastBefore.y,nativeLastRowYAfter:nativeLastAfter.y,nativeSubmitVisibleHeightBefore:visibleHeight(nativeSubmitBefore,scrollViewport(nativeReexpanded.snapshot)),nativeSubmitVisibleHeightAfter:visibleHeight(nativeSubmitAfter,nativeViewport),nativeSubmitFullyVisibleAfter:fullyVisible(nativeScrolled.snapshot,ids.submit),webLastRowYBefore:webLastBefore.y,webLastRowYAfter:webLastAfter.y,webSubmitVisibleHeightBefore:visibleHeight(webSubmitBefore,scrollViewport(webReexpanded.snapshot)),webSubmitVisibleHeightAfter:visibleHeight(webSubmitAfter,webViewport),webSubmitFullyVisibleAfter:fullyVisible(webScrolled.snapshot,ids.submit)},conditionalAndSubmit:{detailsVisibleAfterExpand:true,detailsHiddenAfterCollapse:true,successVisibleAfterSubmit:true,detailsPresentAfterReset:false,successPresentAfterReset:false,emailEmptyAfterReset:true},snapshots:Object.fromEntries(Object.entries(snapshots).map(([platform,stages])=>[platform,Object.fromEntries(Object.entries(stages).map(([name,snapshot])=>[name,evidenceSnapshot(snapshot)]))]))};
  }catch(error){failedStage=currentStage;throw error;
  }finally{
    stage('cleanup-start');
    const cleanupErrors:string[]=[];
    if(sessionId)try{
      const resetState=await run('native',make([],reset));
      const restored=await reveal('native',ids.email,resetState.snapshot,'DOWN','native-cleanup-down');
      assert.ok(fullyVisible(restored,ids.email),'Cleanup must restore the native input to its measured scroll viewport');
      await run('native',make([wait(ids.email),wait(ids.toggle)]));
    }catch(error){cleanupErrors.push(error instanceof Error?error.message:String(error));}
    try{await app.close();}catch(error){cleanupErrors.push(error instanceof Error?error.message:String(error));}
    let actual:Record<string,unknown>|undefined;
    try{
      const fontScale=await adb(['shell','settings','get','system','font_scale']);
      const imeVisible=keyboardVisible(await adb(['shell','dumpsys','input_method']));
      const reverseMappings=(await adb(['reverse','--list'])).split(/\r?\n/).filter(Boolean);
      sourceAfterSha256=hash(await readFile(path.join(projectRoot,'App.tsx'),'utf8'));
      const sourceRevisionHashesAfter=initialRevisions?Object.fromEntries(await Promise.all(Object.keys(initialRevisions).map(async file=>[file,hash(await readFile(path.resolve(projectRoot,file),'utf8'))] as const))):{};
      const sourceRevisionsPreserved=!sourceRevisionHashesBefore||JSON.stringify(sourceRevisionHashesAfter)===JSON.stringify(sourceRevisionHashesBefore);
      const sourcePreserved=sourceAfterSha256===sourceBeforeSha256&&sourceRevisionsPreserved;
      actual={fontScale,imeVisible,reverseMappings,sourceAfterSha256,sourceRevisionHashesAfter,sourcePreserved};
      const checks={fontScaleRestored:fontScale===original.fontScale,imeRestored:imeVisible===original.imeVisible,reverseMappingsRestored:JSON.stringify(reverseMappings)===JSON.stringify(original.reverseMappings),sourcePreserved};
      cleanupEvidence={original,actual,checks,errors:cleanupErrors,restored:Object.values(checks).every(Boolean)&&cleanupErrors.length===0};
    }catch(error){cleanupEvidence={original,error:error instanceof Error?error.message:String(error),errors:cleanupErrors,restored:false};}
    await writeFile(path.join(runDir,'cleanup.json'),JSON.stringify(cleanupEvidence,null,2));
    log('NATIVE_CLEANUP_RESULT',cleanupEvidence);
  }
  if(!cleanupEvidence?.restored)throw new BridgeFault('RECOVERY_CONFLICT','Native scenario cleanup did not restore its recorded device and source state',cleanupEvidence);
  if(successEvidence){successEvidence.sourceSha256={before:sourceBeforeSha256,after:sourceAfterSha256};successEvidence.cleanup=cleanupEvidence;await writeFile(path.join(runDir,'evidence.json'),JSON.stringify(successEvidence,null,2));log('NATIVE_SCENARIOS_PASSED',runDir);}
}

main().catch(async error=>{
  const fault=error instanceof BridgeFault?BridgeErrorSchema.parse({code:error.code,message:error.message,...(error.details===undefined?{}:{details:error.details})}):BridgeErrorSchema.parse({code:'INTERNAL_ERROR',message:error instanceof Error?error.message:String(error)});
  const driverFailure=NativeScenarioFailureEvidenceSchema.safeParse(fault.details);
  const failure={runId,failedAt:new Date().toISOString(),stage:failedStage??currentStage,error:fault,...(driverFailure.success?{nativeDriver:driverFailure.data}:{}),...(cleanupEvidence?{cleanup:cleanupEvidence}:{})};
  await writeFile(path.join(runDir,'failure.json'),JSON.stringify(failure,null,2));
  log('NATIVE_SCENARIOS_INCOMPLETE',failure);
  process.exitCode=1;
});
